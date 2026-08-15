<!-- The way into a match: start one, or take a seat in one that exists.

     A code is enough on its own. Typing one and pressing the button takes the
     seat, and the match's own screen is where the seats filling up is watched —
     the lobby never shows a match it is about to join. -->
<script setup lang="ts">
import {computed, onMounted, ref} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import DieFace from '@/components/die_face.vue'
import {normaliseMatchCode} from '@/match/codes'
import {MatchClient} from '@/match/match_client'

const MIN_PLAYERS = 2
const MAX_PLAYERS = 6
const CODE_LENGTH = 4
const NAME_LIMIT = 16
const NAME_KEY = 'coliseum.player-name' // Where the last name played under is kept

const route = useRoute()
const router = useRouter()

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
})

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Try again.'
}

function chooseMode(next: 'create' | 'join'): void {
  mode.value = next
  error.value = ''
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
  }
}

function onCreate(): void {
  void runCreate()
}

function onJoin(): void {
  void runJoin()
}
</script>

<template>
  <main class="lobby">
    <header class="lobby__head">
      <h1 class="lobby__wordmark">Coliseum</h1>
    </header>

    <section class="card">
      <div class="switch" role="group" aria-label="Start or join">
        <button
          type="button"
          class="switch__option"
          :class="{'switch__option--on': mode === 'create'}"
          :aria-pressed="mode === 'create'"
          @click="chooseMode('create')"
        >
          New match
        </button>
        <button
          type="button"
          class="switch__option"
          :class="{'switch__option--on': mode === 'join'}"
          :aria-pressed="mode === 'join'"
          @click="chooseMode('join')"
        >
          Join a match
        </button>
      </div>

      <form class="form" @submit.prevent>
        <label class="field">
          <span class="field__label">Your name</span>
          <input
            v-model="playerName"
            class="field__input"
            type="text"
            :maxlength="NAME_LIMIT"
            autocomplete="nickname"
            placeholder="Ana"
          >
        </label>

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
                @click="playerCount = count"
              >
                <DieFace :value="count" :lit="playerCount === count" />
              </button>
            </div>
          </div>

          <button
            type="submit"
            class="action"
            :disabled="!canCreate"
            @click="onCreate"
          >
            {{ busy ? 'Creating…' : 'Create match' }}
          </button>
        </template>

        <template v-else>
          <label class="field">
            <span class="field__label">Match code</span>
            <input
              v-model="code"
              class="field__input field__input--code"
              type="text"
              :maxlength="CODE_LENGTH"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck="false"
              placeholder="K7QM"
            >
          </label>

          <button
            type="submit"
            class="action"
            :disabled="!canJoin"
            @click="onJoin"
          >
            {{ busy ? 'Joining…' : 'Join match' }}
          </button>
        </template>

        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </form>
    </section>
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

    /* A pool of warmth behind the card, as though the one lamp over the table
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

.card {
    width: 100%;
    max-width: 24rem;
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

.field__input:hover {
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

.error {
    font-size: 0.875rem;
    color: var(--brass);
}
</style>
