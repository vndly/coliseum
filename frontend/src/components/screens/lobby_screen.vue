<!-- The way into a match: say who you are, then start one or take a seat in
     one that exists. The name is out on its own at the top because it is asked
     once and stands for every way in beneath it.

     There are three of those, and the middle one is only in the page while it
     has something to offer: a match somebody is already sitting in, waiting, is
     quicker than either half of the card under it. A code is still enough on its
     own — typing one takes the seat as its last character lands — and the match's
     own screen is where the seats filling up is watched, so the lobby never
     shows a match it is about to join. -->
<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import DieFace from '@/components/die_face.vue'
import {createBots} from '@/match/bots'
import {isMatchCode, normaliseMatchCode} from '@/match/codes'
import {watchPlayerId} from '@/match/firebase'
import {MatchClient} from '@/match/match_client'
import {watchOpenMatches} from '@/match/open_matches'
import type {OpenMatch} from '@/match/open_matches'
import {MAX_PLAYERS, MIN_PLAYERS} from '@/match/rules'
import {BONE_SKIN, dieSkin, isDieSkin} from '@/scene/die_skins'

const CODE_LENGTH = 4
const NAME_LIMIT = 16
const NAME_KEY = 'coliseum.player-name' // Where the last name played under is kept
const COLOR_KEY = 'coliseum.player-color' // And the colour played in, beside it

// Presentation order only: the numbers remain the stable skin identifiers that
// are stored locally and sent through a match.
const SWATCH_ORDER = [
  0,
  2,
  3,
  1,
  6,
  5,
  4,
  7,
] as const

const route = useRoute()
const router = useRouter()

const nameField = useTemplateRef<HTMLInputElement>('nameField')
const codeField = useTemplateRef<HTMLInputElement>('codeField')
const picker = useTemplateRef<HTMLElement>('picker')
const pickerButton = useTemplateRef<HTMLButtonElement>('pickerButton')

// Neither is a ref: both are only ever the call that ends a subscription
let stopWatchingMatches: (() => void) | null = null
let stopWatchingPlayer: (() => void) | null = null

const mode = ref<'create' | 'join'>('create')
const playerName = ref('')
const playerColor = ref(BONE_SKIN)
const picking = ref(false) // Whether the colours are open under the button
const playerCount = ref(MIN_PLAYERS)
const code = ref('')
const busy = ref(false)
const error = ref('')
const openMatches = ref<OpenMatch[]>([])

// The row being joined, by code, and empty whenever the wait belongs to the
// card below instead. A press has to be attributable: it dims the whole screen
// like any other, but only the control that was actually pressed may say what
// is happening.
const seatingCode = ref('')

// Which of the two ways into a new match was pressed. The pair are answered
// the same way the list above is: the whole screen goes quiet, and only the
// control that was actually pressed says what is happening.
const pressed = ref<'none' | 'match' | 'bots'>('none')

// The identity this browser already has, if it has one. Only ever to mark a
// player's own match in the list — a browser that has never taken a seat has
// none, and is not given one for the sake of a label.
const playerId = ref('')

const seatCounts = computed<number[]>(() => {
  const counts: number[] = []

  for (let count = MIN_PLAYERS; count <= MAX_PLAYERS; count++) {
    counts.push(count)
  }

  return counts
})

const trimmedName = computed<string>(() => playerName.value.trim())
const colorName = computed<string>(() => dieSkin(playerColor.value).name)
const canCreate = computed<boolean>(() => trimmedName.value.length > 0 && !busy.value)

const canJoin = computed<boolean>(
  () => trimmedName.value.length > 0
    && normaliseMatchCode(code.value).length === CODE_LENGTH
    && !busy.value,
)

// A row in the list is a join that skips the code, so it asks for what is left:
// a name to play under, and no other seat already being taken
const canTakeSeat = computed<boolean>(() => trimmedName.value.length > 0 && !busy.value)

// What the card below is doing, rather than what the list above it is. Both
// wait on the same flag, but "Creating…" is the button's account of its own
// press and would be a lie about a seat being taken out of the list.
const formBusy = computed<boolean>(() => busy.value && seatingCode.value === '')

const creatingMatch = computed<boolean>(() => formBusy.value && pressed.value === 'match')
const startingBots = computed<boolean>(() => formBusy.value && pressed.value === 'bots')

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
 * The colour this browser last played in.
 *
 * Guarded like the name beside it, and checked against the palette rather than
 * trusted: what is in storage was written by an older build of this page, and
 * a colour that has since been taken out of the palette is a die drawn in
 * nothing.
 * @returns The stored colour, or bone if there is none to be had
 */
function rememberedColor(): number {
  try {
    const stored = Number(localStorage.getItem(COLOR_KEY))

    return isDieSkin(stored) ? stored : BONE_SKIN
  } catch {
    return BONE_SKIN
  }
}

/**
 * Keeps the name and the colour for the next match, so both are chosen once
 * rather than every time.
 * @param name - The name being played under, already trimmed
 * @param color - The colour being played in
 */
function remember(name: string, color: number): void {
  try {
    localStorage.setItem(NAME_KEY, name)
    localStorage.setItem(COLOR_KEY, String(color))
  } catch {
    // Storage is blocked; neither is remembered
  }
}

/**
 * Takes a colour and puts the palette away.
 * @param skin - The colour chosen
 */
function onPickColor(skin: number): void {
  playerColor.value = skin
  closePalette()
}

/**
 * Puts the palette away and gives the button back whatever focus it was holding.
 *
 * The palette is dropped from the page rather than hidden, so closing it while
 * a swatch is focused destroys the focused element — and focus falls to the
 * document, where the next tab starts again from the top and nothing has said
 * the colours closed. It goes back to the button that opened them, which is
 * where somebody who has just chosen a colour is standing.
 */
function closePalette(): void {
  const wasInside = picker.value?.contains(document.activeElement) ?? false

  picking.value = false

  if (wasInside) {
    void nextTick(() => {
      pickerButton.value?.focus()
    })
  }
}

/**
 * Closes the palette when the next press lands outside it.
 *
 * Bound on the window rather than on a backdrop element, so the press that
 * closes the palette still reaches whatever it was aimed at — a player going
 * straight from the colours to the button that starts the match presses it
 * once, not twice.
 * @param event - The press, wherever it landed
 */
function onPressAnywhere(event: PointerEvent): void {
  const inside = event.target instanceof Node && picker.value?.contains(event.target) === true

  if (!inside) {
    picking.value = false
  }
}

onMounted(() => {
  playerName.value = rememberedName()
  playerColor.value = rememberedColor()

  window.addEventListener('pointerdown', onPressAnywhere)

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

  // Before the matches, and not merely beside them. Asking for the identity is
  // also what introduces the signed-in user to the database client, and the
  // list's query is the one read in this app that is made without signing in
  // first — asked before this, it would go out with no identity at all, for
  // everybody rather than only for a browser that has never played.
  stopWatchingPlayer = watchPlayerId((identifier) => {
    playerId.value = identifier ?? ''
  })

  stopWatchingMatches = watchOpenMatches((matches) => {
    openMatches.value = matches
  })
})

onBeforeUnmount(() => {
  stopWatchingMatches?.()
  stopWatchingPlayer?.()
  window.removeEventListener('pointerdown', onPressAnywhere)
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

/**
 * Starts a match and goes to it.
 *
 * The bots are drawn here rather than inside the client, because they are the
 * whole of what separates the two buttons: seats nobody is coming to fill. A
 * match given them is full the moment it is written and begins on the spot; a
 * match without them is a lobby, waiting.
 * @param withBots - Whether every seat but this player's is taken by a bot
 */
async function runCreate(withBots: boolean): Promise<void> {
  busy.value = true
  pressed.value = withBots ? 'bots' : 'match'
  error.value = ''
  remember(trimmedName.value, playerColor.value)

  try {
    const bots = withBots
      ? createBots(playerCount.value - 1, trimmedName.value, playerColor.value)
      : []

    const created = await MatchClient.create(
      trimmedName.value,
      playerColor.value,
      playerCount.value,
      bots,
    )

    await router.push({
      name: 'match',
      params: {
        code: created,
      },

      // Carried so the match's own screen knows what it is before it has read
      // it. The card that waits for players stands over the table from the
      // first frame, and there is nobody to wait for in this one.
      query: withBots ? {
        bots: '1',
      } : undefined,
    })
  } catch (reason: unknown) {
    error.value = describe(reason)
    busy.value = false
    pressed.value = 'none'
  }
}

/**
 * Takes a seat in one match and goes to it, however that match was named.
 *
 * Both ways in are the same seat being taken, so both come through here: the
 * code typed into the field below, and the row pressed in the list above it.
 * Every way it can fail — no such match, full, already under way — is refused
 * by the join itself and comes back as a sentence. Where that sentence is shown
 * is left to the caller, because it belongs beside whichever of the two was
 * used.
 * @param match - The match's code, already normalised
 * @returns Why the seat was refused, or an empty string if it was taken
 */
async function takeSeat(match: string): Promise<string> {
  busy.value = true
  pressed.value = 'none'
  remember(trimmedName.value, playerColor.value)

  try {
    await MatchClient.join(match, trimmedName.value, playerColor.value)

    await router.push({
      name: 'match',
      params: {
        code: match,
      },
    })

    return ''
  } catch (reason: unknown) {
    busy.value = false

    return describe(reason)
  }
}

async function runJoin(): Promise<void> {
  error.value = ''

  const typed = normaliseMatchCode(code.value)

  // Asked here as well as of the clipboard, because a code is a document's own
  // name and this is where one arrives that nobody has read. Left to the
  // database, a code carrying a slash is not a name a document can have, and
  // what the player would be shown is the store's account of its own path
  // rather than the game's account of their code. Four characters is not the
  // whole of the answer — the alphabet is the rest of it.
  const known = isMatchCode(typed)

  // The clear above has to reach the screen before the refusal is written over
  // it. A join that goes to the database gets that for free from its own wait;
  // a code refused here has nothing to wait on, and cleared and rewritten
  // inside one flush is a line that never changed — so a second bad code in a
  // row is a refusal the alert never reads out at all.
  if (!known) {
    await nextTick()
  }

  const refusal = known
    ? await takeSeat(typed)
    : 'No match with that code.'

  if (refusal === '') {
    return
  }

  error.value = refusal

  // The code is the only thing here that can be wrong, and a join that began on
  // its last character took the caret out of it. It goes back.
  await nextTick()
  codeField.value?.focus()
}

/**
 * Takes the seat a row in the list stands for, which is the code entered
 * without anybody having to read it first.
 *
 * The refusal is shown under the form below rather than beside the row that was
 * pressed, because by the time there is one that row is gone: the only refusal
 * a listed match can give is that somebody else took the last seat, and the
 * write that did so is the same one that takes the match out of the list. A
 * message in a card that the message's own cause has just closed is a message
 * nobody reads.
 * @param match - The match the row was drawn from
 */
async function runTakeSeat(match: OpenMatch): Promise<void> {
  error.value = ''
  seatingCode.value = match.code

  const refusal = await takeSeat(match.code)

  seatingCode.value = ''
  error.value = refusal
}

/**
 * Whether this player is already sitting in a listed match — their own, most
 * often, left behind by walking out of it rather than by never joining.
 * @param match - The match the row was drawn from
 * @returns Whether their identifier is one of the seats
 */
function isSeated(match: OpenMatch): boolean {
  return playerId.value !== '' && match.uids.includes(playerId.value)
}

/**
 * What a row says when it is read out rather than looked at, since the dice on
 * it are decorative and carry nothing on their own.
 * @param match - The match the row was drawn from
 * @returns The match named, and how full it is
 */
function seatLine(match: OpenMatch): string {
  const seats = `${match.seatsTaken} of ${match.seatsTotal} seats taken`

  return isSeated(match) ? `Your match, ${seats}` : `${match.host}, ${seats}`
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

/**
 * Takes what has been typed into the code field and puts it into the form a
 * code is actually in.
 *
 * Normalised as it is typed rather than only when it is read. A length cap on
 * the field alone is enforced by the browser on the insertion, before anything
 * here sees it — so a code pasted with the space in front of it that copying
 * one out of a message brings along arrived with its last character cut off,
 * in a field already full, that nothing could then complete or repair.
 *
 * The cap is still a cap, and answers the two ways past it differently. Typing
 * into a code that is already whole is the insertion the browser used to
 * refuse outright, so it is refused here too: cutting the tail off instead
 * would throw away a character the player had already typed, and hand what was
 * left to the watcher that joins on a whole code. Anything else over-long is
 * something dropped in from outside, and is taken up to the length of a code
 * exactly as the field itself used to take it.
 * @param event - The input event the field raised
 */
function onCodeInput(event: Event): void {
  const field = event.target

  if (!(field instanceof HTMLInputElement)) {
    return
  }

  const normalised = normaliseMatchCode(field.value)

  const typed = normalised.length > CODE_LENGTH && code.value.length === CODE_LENGTH
    ? code.value
    : normalised.slice(0, CODE_LENGTH)

  // Written back to the field as well as to the code, because what was dropped
  // was never a character the code held: bound alone, a value that normalises
  // to what it already was leaves the field showing whitespace nothing counts.
  // Written only when the two differ, and with the caret carried back by
  // whatever came out in front of it, so that a correction typed into the
  // middle of a code does not send the caret to the end.
  if (field.value !== typed) {
    const caret = field.selectionStart ?? typed.length
    const moved = Math.max(caret - (field.value.length - typed.length), 0)

    field.value = typed
    field.setSelectionRange(moved, moved)
  }

  code.value = typed
}

function onCreate(): void {
  void runCreate(false)
}

function onPlayBots(): void {
  void runCreate(true)
}

function onJoin(): void {
  void runJoin()
}

function onTakeSeat(match: OpenMatch): void {
  void runTakeSeat(match)
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
        <div class="field">
          <label class="field__label" for="player-name">Your name</label>

          <!-- The colour sits on the row with the name because it is the other
               half of the same answer: who you are at this table, and which
               dice on it are yours. It is a die rather than a chip, in the
               colour and with the pip the real ones will carry, so what is
               being chosen is shown rather than described. -->
          <div class="named">
            <input
              id="player-name"
              ref="nameField"
              v-model="playerName"
              class="field__input"
              type="text"
              form="lobby-form"
              :maxlength="NAME_LIMIT"
              :disabled="busy"
              autocomplete="nickname"
            >

            <div ref="picker" class="picker">
              <button
                ref="pickerButton"
                type="button"
                class="picker__button"
                :class="{'picker__button--open': picking}"
                :aria-label="`Dice colour: ${colorName}`"
                :aria-expanded="picking"
                :disabled="busy"
                @click="picking = !picking"
                @keydown.esc="closePalette"
              >
                <DieFace :value="1" :skin="playerColor" />
              </button>

              <ul v-if="picking" class="palette" @keydown.esc="closePalette">
                <li v-for="skin in SWATCH_ORDER" :key="skin">
                  <button
                    type="button"
                    class="palette__option"
                    :class="{'palette__option--taken': skin === playerColor}"
                    :aria-label="dieSkin(skin).name"
                    :aria-pressed="skin === playerColor"
                    :disabled="busy"
                    @click="onPickColor(skin)"
                  >
                    <DieFace :value="1" :skin="skin" />
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- Only in the page while somebody is waiting in something. A match with
           a seat still open is quicker than either half of the card below, so it
           sits above it — and when there is none, the two cards close back up as
           though this one had never been there. -->
      <section v-if="openMatches.length > 0" class="card card--matches">
        <p class="field__label">Open matches</p>

        <ul class="matches">
          <li v-for="match in openMatches" :key="match.code">
            <button
              type="button"
              class="match"
              :class="{'match--busy': seatingCode === match.code}"
              :aria-label="seatLine(match)"
              :disabled="!canTakeSeat"
              @click="onTakeSeat(match)"
            >
              <span class="match__host" :class="{'match__host--yours': isSeated(match)}">
                {{ isSeated(match) ? 'Your match' : match.host }}
              </span>

              <!-- The dice count the seats the same way they do inside the
                   match, lit as far as the seats are taken — until this is the
                   row being joined, when what is happening takes their place -->
              <span v-if="seatingCode === match.code" class="match__word">Joining…</span>

              <span v-else class="match__seats">
                <DieFace
                  v-for="seat in match.seatsTotal"
                  :key="seat"
                  :value="seat"
                  :lit="seat <= match.seatsTaken"
                />
              </span>
            </button>
          </li>
        </ul>

        <p v-if="trimmedName === ''" class="hint">Type your name to take a seat</p>
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

            <!-- Two ways to start the same match, side by side rather than
                 stacked: the dice above are stood to the height of the code
                 field so that swapping the halves of the card never moves this
                 row, and a second button under the first would undo that. -->
            <div class="actions">
              <button
                type="submit"
                class="action"
                :class="{'action--busy': creatingMatch}"
                :disabled="!canCreate"
                @click="onCreate"
              >
                {{ creatingMatch ? 'Creating…' : 'Create match' }}
              </button>

              <button
                type="button"
                class="action action--quiet"
                :class="{'action--busy': startingBots}"
                :disabled="!canCreate"
                @click="onPlayBots"
              >
                {{ startingBots ? 'Starting…' : 'Play with bots' }}
              </button>
            </div>
          </template>

          <template v-else>
            <!-- Not a label wrapped round its input like the name above: a label
                 may hold one labelable element, and the paste button is a second -->
            <div class="field">
              <label class="field__label" for="match-code">Match code</label>

              <div class="code">
                <!-- Bound through a handler rather than with v-model, and
                     with no length cap of its own: both the normalisation and
                     the cap are applied to what was typed, in that order -->
                <input
                  id="match-code"
                  ref="codeField"
                  class="field__input field__input--code"
                  type="text"
                  :value="code"
                  :disabled="busy"
                  autocapitalize="characters"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="K7QM"
                  @input="onCodeInput"
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
              :class="{'action--busy': formBusy}"
              :disabled="!canJoin"
              @click="onJoin"
            >
              {{ formBusy ? 'Joining…' : 'Join match' }}
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

/* The list's own card is a column, so the label over it and whatever is said
   under it are spaced by one rule. A margin instead would reach the error in
   the card below as well, since both are the same class */
.card--matches {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

/* Given a ceiling rather than a length: past four rows it scrolls, so however
   busy the game gets the two ways into a match stay on the fold under it. On a
   screen too short for four, the viewport sets the figure instead */
.matches {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: min(13.5rem, 30vh);
    overflow-y: auto;
    list-style: none;
    scrollbar-width: thin;
    scrollbar-color: rgb(200 164 104 / 20%) transparent;
}

/* Cut into the card the way the switch and the seat counts are, so a row reads
   as something to press rather than something to read. The rim is there before
   it is lit, so hovering a row does not move the one under it */
.match {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    background: var(--well);
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease;
}

.match:hover:not(:disabled) {
    border-color: var(--brass);
    background: var(--brass-glow);
}

/* A name is whatever its player typed, so it is cut off at the end of the room
   it has rather than allowed to push the dice off the row */
.match__host {
    overflow: hidden;
    font-size: 0.9375rem;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* A match this player is already sitting in, in the brass everything of theirs
   on this screen is named in */
.match__host--yours {
    color: var(--brass);
}

/* Stands where the dice stood, once the row has been pressed and the count has
   nothing left to say */
.match__word {
    flex-shrink: 0;
    font-size: 0.8125rem;
    color: var(--brass);
}

/* The dice are the whole of what a row counts, so they are read as one run and
   never wrap out of it — a six-seat match keeps its six on the line */
.match__seats {
    display: flex;
    flex-shrink: 0;
    gap: 0.25rem;
}

.match__seats .die-face {
    --size: 1.25rem;
}

/* What the greyed-out rows are waiting for. Only while the name is missing:
   once a join is under way there is nothing left to ask for */
.hint {
    font-size: 0.8125rem;
    color: var(--bone-faint);
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

/* Every card goes quiet the moment a match is being made: the press has been
   taken, and nothing here can be touched again until it is answered. Whatever
   was pressed is the exception — it is carrying the only word about what the
   screen is doing, so it stays lit while the rest dims. There are two of those,
   the row below and the action button further down, and both are written after
   this rule rather than before it: each weighs exactly what this weighs, so
   nothing but the order they are read in lets them win */
.match:disabled,
.switch__option:disabled,
.field__input:disabled,
.picker__button:disabled,
.palette__option:disabled,
.counts__option:disabled,
.paste:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

/* The row a seat is being taken out of */
.match--busy:disabled {
    border-color: var(--brass-edge);
    opacity: 1;
    cursor: wait;
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

/* The name and the colour are one answer on one line. The button is square
   and stretches to whatever the input is tall, so the two read as halves of a
   single control rather than as a field with something bolted beside it */
.named {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
}

/* The colours hang off this rather than off the row, so they are placed
   against the button they came out of and not against the card */
.picker {
    position: relative;
    flex: none;
}

/* Cut out of the card exactly as the field beside it is: same rim, same well,
   same corner. What separates them is that this one is a die */
.picker__button {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    height: 100%;
    padding: 0;
    border: 1px solid var(--brass-edge);
    border-radius: 0.5rem;
    background: var(--well);
    cursor: pointer;
    transition: border-color 160ms ease;
}

.picker__button:hover:not(:disabled),
.picker__button--open {
    border-color: var(--brass);
}

/* Sized off the button rather than left at the face's own default, so the die
   sits inside the rim with the same air the caret has inside the field */
.picker__button :deep(.die-face) {
    --size: 1.5rem;
}

/* Over the card below rather than in the stack, so opening the colours does
   not push the two ways into a match down the screen and then pull them back.
   Hung from the right edge, which is the edge the button is on */
.palette {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(4, auto);
    gap: 0.5rem;
    padding: 0.625rem;
    border: 1px solid var(--brass-edge);
    border-radius: 0.75rem;
    background: var(--panel);
    list-style: none;

    /* The card's own pair of shadows, since this is a card that opened */
    box-shadow:
        inset 0 1px 0 rgb(200 164 104 / 18%),
        0 1rem 2rem rgb(0 0 0 / 55%);

    /* Dropped from the button rather than faded in, so it reads as the eight
       dice being set out on the table under it */
    transform-origin: top right;
    animation: palette-opened 140ms ease-out;
}

@keyframes palette-opened {
    from {
        transform: scale(0.9);
        opacity: 0;
    }

    to {
        transform: scale(1);
        opacity: 1;
    }
}

/* The ring the seat counts are chosen by, on the colour that is */
.palette__option {
    padding: 0;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    cursor: pointer;
}

.palette__option--taken {
    box-shadow: 0 0 0 2px var(--brass);
}

.field__input--code {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.75rem;
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

/* Stood to the height of a code field, so that either half of the switch brings
   the card up to the same height and the button under them does not move as
   they are swapped. The figure is the code field's own box: 1.75rem of line
   between 0.75rem of padding and a 1px border on each side */
.counts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    min-height: 3.375rem;
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

/* The pair share the row evenly: neither is the afterthought, and a label as
   long as the second one's needs the whole half. They fall into a column only
   where half a card is too narrow to hold one — a phone turned the short way,
   which is the one place the row would break a word instead. */
.actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
    gap: 0.5rem;
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

/* The other way in, and the quieter one. Sunk into the panel like the wells
   the fields are cut into — the same treatment the match screen gives a second
   answer — so the two read as one choice with a default rather than as two
   presses of equal weight. Rimmed by an inset shadow rather than a border,
   which would make it a pixel taller than the button beside it. */
.action--quiet {
    background: var(--well);
    color: var(--bone-dim);
    box-shadow: inset 0 0 0 1px var(--brass-edge);
}

.action--quiet:hover:not(:disabled) {
    color: var(--bone);
}

.action--quiet:disabled {
    background: var(--well);
    color: var(--bone-faint);
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
