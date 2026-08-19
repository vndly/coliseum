<!-- The way into a match: say who you are, then start one or take a seat in one
     that exists. Two cards, because the name is asked once and the choice under
     it is only ever between the two ways in.

     A code is enough on its own. Typing one takes the seat as its last
     character lands, and the match's own screen is where the seats filling up is
     watched — the lobby never shows a match it is about to join. -->
<script setup lang="ts">
import {computed, nextTick, onMounted, ref, useTemplateRef, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import DieFace from '@/components/die_face.vue'
import {isMatchCode, normaliseMatchCode} from '@/match/codes'
import {MatchClient} from '@/match/match_client'

const MIN_PLAYERS = 2
const MAX_PLAYERS = 6
const CODE_LENGTH = 4
const NAME_LIMIT = 16
const NAME_KEY = 'coliseum.player-name' // Where the last name played under is kept

const route = useRoute()
const router = useRouter()

const nameField = useTemplateRef<HTMLInputElement>('nameField')
const codeField = useTemplateRef<HTMLInputElement>('codeField')

const mode = ref<'create' | 'join'>('create')
const playerName = ref('')
const playerCount = ref(MIN_PLAYERS)
const code = ref('')
const busy = ref(false)
const error = ref('')

const seatCounts = computed<number[]>(() => {
  const counts: number[] = []

  for (let count = MIN_PLAYERS; count <= MAX_PLAYERS; count++) {
    counts.push(count)
  }

  return counts
})

const trimmedName = computed<string>(() => playerName.value.trim())
const canCreate = computed<boolean>(() => trimmedName.value.length > 0 && !busy.value)

const canJoin = computed<boolean>(
  () => trimmedName.value.length > 0
    && normaliseMatchCode(code.value).length === CODE_LENGTH
    && !busy.value,
)

/**
 * The name this browser last played under.
 *
 * Guarded because reaching for storage at all throws outright in a browser set
 * to block it, and a name is not worth taking the lobby down for.
 * @returns The stored name, or an empty string if there is none to be had
 */
function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * Keeps the name for the next match, so it is typed once rather than every time.
 * @param name - The name being played under, already trimmed
 */
function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Storage is blocked; the name simply is not remembered
  }
}

onMounted(() => {
  playerName.value = rememberedName()

  // A player arriving from a match they turned out not to be in, with the code
  // carried over so they only have to say who they are
  const carried = route.query.code

  if (typeof carried === 'string') {
    code.value = carried
    mode.value = 'join'
  }

  // A code is four characters and no more, so the character that completes one
  // says everything pressing the button would, and the seat is taken on it. The
  // button stays for the codes this does not speak for: one finished before the
  // name was, one already turned down once, and the one carried in above.
  //
  // Watched from here rather than from the setup above, so that the code
  // carried in is not taken for a code the player typed. A field that filled
  // itself is not somebody saying they are ready to go.
  watch(code, () => {
    if (canJoin.value) {
      void runJoin()
    }
  })
})

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Try again.'
}

/**
 * Puts the caret on whichever half of a seat is still missing.
 *
 * A name is remembered between matches, so a player who has one already is here
 * for the code alone and lands on it. The wait is for the field to exist at all:
 * it is only in the page while the join form is.
 */
async function focusJoinForm(): Promise<void> {
  await nextTick()

  if (trimmedName.value === '') {
    nameField.value?.focus()
  } else {
    codeField.value?.focus()
  }
}

function chooseMode(next: 'create' | 'join'): void {
  mode.value = next
  error.value = ''

  if (next === 'join') {
    void focusJoinForm()
  }
}

async function runCreate(): Promise<void> {
  busy.value = true
  error.value = ''
  rememberName(trimmedName.value)

  try {
    const created = await MatchClient.create(trimmedName.value, playerCount.value)

    await router.push({
      name: 'match',
      params: {
        code: created,
      },
    })
  } catch (reason: unknown) {
    error.value = describe(reason)
    busy.value = false
  }
}

// The seat is taken on the strength of the code alone. Every way that can fail
// — no such match, full, already under way — is refused by the join itself, and
// arrives here as the message shown under the form.
async function runJoin(): Promise<void> {
  const match = normaliseMatchCode(code.value)

  busy.value = true
  error.value = ''
  rememberName(trimmedName.value)

  try {
    await MatchClient.join(match, trimmedName.value)

    await router.push({
      name: 'match',
      params: {
        code: match,
      },
    })
  } catch (reason: unknown) {
    error.value = describe(reason)
    busy.value = false

    // The code is the only thing here that can be wrong, and a join that began
    // on its last character took the caret out of it. It goes back.
    await nextTick()
    codeField.value?.focus()
  }
}

/**
 * What the clipboard is holding, if the browser will say.
 *
 * Refusal is an answer like any other here — a page served over plain http has
 * no clipboard to read at all, and a player can turn the browser's own prompt
 * down — so it comes back as nothing rather than as a throw.
 * @returns The clipboard's text, or null if it was not handed over
 */
async function readClipboard(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}

/**
 * Fills the code from the clipboard, for a code that arrived in a message
 * rather than out loud.
 *
 * A clipboard can only be read on a press like this one and never merely looked
 * at, so the button is offered whenever the field is empty rather than only
 * when there is a code sitting there to take.
 */
async function runPaste(): Promise<void> {
  error.value = ''

  const held = await readClipboard()

  // The browser answers a clipboard read from behind a prompt, and going
  // somewhere else is one of the ways that prompt is dismissed. By the time it
  // answers the player may have left the form that asked — gone to start a
  // match of their own, or typed the code out themselves — and an answer to a
  // question nobody is still asking is dropped rather than shown.
  if (mode.value !== 'join' || code.value.trim() !== '') {
    return
  }

  if (held === null) {
    error.value = 'Could not read the clipboard.'

    return
  }

  const pasted = normaliseMatchCode(held)

  if (!isMatchCode(pasted)) {
    error.value = 'The clipboard does not hold a match code.'

    return
  }

  code.value = pasted

  // The button is gone the moment the field has a code in it, so the caret goes
  // into the field rather than the focus onto nothing — unless the code was
  // whole enough to be taken on the spot, and the field is already shut behind
  // the join it started
  await nextTick()

  if (!busy.value) {
    codeField.value?.focus()
  }
}

function onCreate(): void {
  void runCreate()
}

function onJoin(): void {
  void runJoin()
}

function onPaste(): void {
  void runPaste()
}
</script>

<template>
  <main class="lobby">
    <header class="lobby__head">
      <h1 class="lobby__wordmark">Coliseum</h1>
    </header>

    <div class="lobby__cards">
      <!-- Out on its own, above the switch rather than under it. A name is
           asked once and stands for both ways in, so inside the form it read as
           part of whichever half was showing. The form attribute keeps it a
           field of that form across the gap all the same, so Enter here still
           presses whatever the card below is offering. -->
      <section class="card">
        <label class="field">
          <span class="field__label">Your name</span>
          <input
            ref="nameField"
            v-model="playerName"
            class="field__input"
            type="text"
            form="lobby-form"
            :maxlength="NAME_LIMIT"
            :disabled="busy"
            autocomplete="nickname"
          >
        </label>
      </section>

      <section class="card">
        <div class="switch" role="group" aria-label="Start or join">
          <button
            type="button"
            class="switch__option"
            :class="{'switch__option--on': mode === 'create'}"
            :aria-pressed="mode === 'create'"
            :disabled="busy"
            @click="chooseMode('create')"
          >
            Create match
          </button>
          <button
            type="button"
            class="switch__option"
            :class="{'switch__option--on': mode === 'join'}"
            :aria-pressed="mode === 'join'"
            :disabled="busy"
            @click="chooseMode('join')"
          >
            Join a match
          </button>
        </div>

        <form id="lobby-form" class="form" @submit.prevent>
          <template v-if="mode === 'create'">
            <!-- A group rather than a fieldset: a legend is taken out of its
                 parent's flex flow, and lands on top of the dice -->
            <div class="field" role="group" aria-label="Players">
              <span class="field__label" aria-hidden="true">Players</span>
              <div class="counts">
                <button
                  v-for="count in seatCounts"
                  :key="count"
                  type="button"
                  class="counts__option"
                  :class="{'counts__option--on': playerCount === count}"
                  :aria-pressed="playerCount === count"
                  :aria-label="`${count} players`"
                  :disabled="busy"
                  @click="playerCount = count"
                >
                  <DieFace :value="count" :lit="playerCount === count" />
                </button>
              </div>
            </div>

            <button
              type="submit"
              class="action"
              :class="{'action--busy': busy}"
              :disabled="!canCreate"
              @click="onCreate"
            >
              {{ busy ? 'Creating…' : 'Create match' }}
            </button>
          </template>

          <template v-else>
            <!-- Not a label wrapped round its input like the name above: a label
                 may hold one labelable element, and the paste button is a second -->
            <div class="field">
              <label class="field__label" for="match-code">Match code</label>

              <div class="code">
                <input
                  id="match-code"
                  ref="codeField"
                  v-model="code"
                  class="field__input field__input--code"
                  type="text"
                  :maxlength="CODE_LENGTH"
                  :disabled="busy"
                  autocapitalize="characters"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="K7QM"
                >

                <button
                  v-if="code.trim() === ''"
                  type="button"
                  class="paste"
                  aria-label="Paste the code"
                  :disabled="busy"
                  @click="onPaste"
                >
                  <svg class="paste__icon" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="8" y="2" width="8" height="4" rx="1" />
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  </svg>
                </button>
              </div>
            </div>

            <button
              type="submit"
              class="action"
              :class="{'action--busy': busy}"
              :disabled="!canJoin"
              @click="onJoin"
            >
              {{ busy ? 'Joining…' : 'Join match' }}
            </button>
          </template>

          <p v-if="error" class="error" role="alert">{{ error }}</p>
        </form>
      </section>
    </div>
  </main>
</template>

<style scoped>
.lobby {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2.5rem;
    min-height: 100%;
    padding: 2rem 1.25rem;

    /* A pool of warmth behind the cards, as though the one lamp over the table
       in the scene reached this screen too */
    background:
        radial-gradient(120% 90% at 50% 12%, rgb(74 122 96 / 8%), transparent 60%),
        var(--ground);
}

.lobby__head {
    text-align: center;
}

/* The tracking comes down as the size goes up: what reads as a stamped plate at
   a caption's size gaps the word into eight loose letters at a title's */
.lobby__wordmark {
    font-size: clamp(2.25rem, 11vw, 3rem);
    font-weight: 700;
    letter-spacing: 0.16em;
    text-indent: 0.16em; /* Puts the tracking back inside the centred line */
    text-transform: uppercase;
    color: var(--brass);
}

/* The two cards are one stack and are spaced as one, leaving the lobby's own
   gap to fall under the wordmark alone, where the separation is meant. The
   width is carried here rather than by each card, so both are cut to it */
.lobby__cards {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 24rem;
}

.card {
    padding: 1.5rem;
    border: 1px solid var(--brass-edge);
    border-radius: 0.75rem;
    background: var(--panel);

    /* Two shadows: the bead of light along the top edge that a turned lip
       catches, and the weight of the card on the ground beneath it */
    box-shadow:
        inset 0 1px 0 rgb(200 164 104 / 18%),
        0 1.5rem 3rem rgb(0 0 0 / 45%);
}

.switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem;
    padding: 0.25rem;
    border-radius: 0.5rem;
    background: var(--well);
}

.switch__option {
    padding: 0.5rem;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--bone-dim);
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease;
}

.switch__option--on {
    background: var(--walnut);
    color: var(--bone);
}

.form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    margin-top: 1.5rem;
}

/* Both cards go quiet the moment a match is being made: the press has been
   taken, and nothing here can be touched again until it is answered. The button
   that was pressed is the exception, further down — it is carrying the only
   word about what the card is doing, so it does not dim with the rest */
.switch__option:disabled,
.field__input:disabled,
.counts__option:disabled,
.paste:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border: 0;
}

.field__label {
    font: var(--plate);
    letter-spacing: var(--plate-tracking);
    text-transform: uppercase;
    color: var(--bone-faint);
}

.field__input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--brass-edge);
    border-radius: 0.5rem;
    background: var(--well);
    font-size: 1rem;
    transition: border-color 160ms ease;
}

.field__input::placeholder {
    color: var(--bone-faint);
}

.field__input:hover:not(:disabled) {
    border-color: var(--brass);
}

.field__input--code {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: 0.3em;
    text-align: center;
    text-transform: uppercase;
    text-indent: 0.3em;
}

/* Holds the paste button inside the input's right edge. It is only ever there
   while the field is empty, so it has nothing but the placeholder to clear */
.code {
    position: relative;
    display: flex;
}

.paste {
    position: absolute;
    top: 50%;
    right: 0.5rem;
    display: flex;
    padding: 0.375rem;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--bone-faint);
    cursor: pointer;
    transform: translateY(-50%);
    transition: background 160ms ease, color 160ms ease;
}

.paste:hover:not(:disabled) {
    background: var(--brass-glow);
    color: var(--brass);
}

.paste__icon {
    width: 1.25rem;
    height: 1.25rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.counts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.counts__option {
    padding: 0;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    cursor: pointer;
}

.counts__option--on {
    box-shadow: 0 0 0 2px var(--brass);
}

.action {
    padding: 0.8125rem;
    border: 0;
    border-radius: 0.5rem;
    background: var(--brass);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--pip);
    cursor: pointer;
    transition: filter 160ms ease;
}

.action:hover:not(:disabled) {
    filter: brightness(1.12);
}

.action:disabled {
    background: var(--brass-glow);
    color: var(--bone-faint);
    cursor: not-allowed;
}

/* Pressed and waiting, rather than not yet ready. The surface sinks to the same
   brass-rimmed well the fields are cut into, and the word on it stays lit: it is
   the only account of what the card is doing. Rimmed by an inset shadow rather
   than a border, which would move the button as it was pressed */
.action--busy:disabled {
    background: var(--well);
    color: var(--brass);
    cursor: wait;
    box-shadow: inset 0 0 0 1px var(--brass-edge);
}

.error {
    font-size: 0.875rem;
    color: var(--ember);
}
</style>
