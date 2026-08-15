<!-- One match: the bowl, and the little that has to be said around it.

     This is the only place the network and the scene meet. The match client
     knows nothing about Three.js and the scene knows nothing about Firestore;
     this component holds both, keeps the reactive half for the interface, and
     calls into the scene directly so that nothing reactive gets anywhere near
     the render loop. -->
<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import DieFace from '@/components/die_face.vue'
import {MatchClient} from '@/match/match_client'
import type {MatchPlayer, MatchState, ThrowRecord} from '@/match/match_state'
import type {ThrowLaunch} from '@/scene/die_state'
import {DIE_LIMIT} from '@/scene/dimensions'
import {DishScene} from '@/scene/dish_scene'

const route = useRoute()
const router = useRouter()

const parameter = route.params.code
const code = (typeof parameter === 'string' ? parameter : '').toUpperCase()

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

const COPIED_MILLISECONDS = 2000 // How long the copy button holds its answer

// None of these are refs: the scene mutates every frame and must stay out of
// reactivity, and the client and the two counters are only ever read from
// callbacks that already know when they changed
let scene: DishScene | null = null
let client: MatchClient | null = null
let pendingSeq = 0 // The throw made here that is waiting to come to rest
let appliedBowlVersion = -1 // The last bowl handed to the scene; -1 so the opening one lands
let copiedTimer = 0 // The pending reset of the copy button, so it can be called off

const state = shallowRef<MatchState | null>(null)
const uid = ref('')
const busy = ref(false) // A throw made here is still in the air
const copyResult = ref<'none' | 'done' | 'failed'>('none') // What the last press of copy came to
const error = ref('')

const activePlayer = computed<MatchPlayer | null>(() => {
  const match = state.value

  return match === null ? null : match.players[match.turnIndex] ?? null
})

const playing = computed<boolean>(() => state.value?.phase === 'playing')
const isMyTurn = computed<boolean>(() => uid.value !== '' && activePlayer.value?.uid === uid.value)
const bowlFull = computed<boolean>(() => (state.value?.bowl.length ?? 0) >= DIE_LIMIT)

const canThrow = computed<boolean>(
  () => playing.value && isMyTurn.value && !busy.value && !bowlFull.value,
)

const canPass = computed<boolean>(
  () => playing.value && isMyTurn.value && !busy.value && state.value?.hasThrown === true,
)

const seatsTaken = computed<number>(() => state.value?.players.length ?? 0)
const seatsTotal = computed<number>(() => state.value?.playerCount ?? 0)

const waitingLine = computed<string>(() => {
  const match = state.value

  if (match === null) {
    return 'Connecting to the match'
  }

  const empty = match.playerCount - match.players.length

  return empty === 1
    ? 'Waiting for one more player.'
    : `Waiting for ${empty} more players.`
})

const status = computed<string>(() => {
  const match = state.value

  if (match === null) {
    return 'Finding the match'
  }

  if (busy.value) {
    return 'Rolling'
  }

  if (!isMyTurn.value) {
    return `${activePlayer.value?.name ?? 'Someone'} is up`
  }

  if (bowlFull.value) {
    return 'The bowl is full — pass to end your turn'
  }

  return match.hasThrown ? 'Throw again, or pass' : 'Drag across the bowl to throw'
})

// The gesture is closed off the moment the turn is not this player's, so a
// throw cannot be started on the canvas and refused afterwards
watch(canThrow, (enabled) => {
  if (scene !== null) {
    scene.throwEnabled = enabled
  }
})

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Try again.'
}

function seatedName(seat: number): string {
  return state.value?.players[seat - 1]?.name ?? 'Waiting for player…'
}

/**
 * Puts the code on the clipboard, so it can be sent rather than dictated.
 *
 * The clipboard is missing altogether outside a secure context — which is what
 * a phone opening this over plain http on the local network gets — so the
 * failure is answered rather than swallowed. Answered here rather than on the
 * match's own error line: that line is never cleared, and one press of a button
 * should not pin a message over the scene for the rest of the game.
 */
async function runCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(code)

    copyResult.value = 'done'
  } catch {
    copyResult.value = 'failed'
  }

  window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => {
    copyResult.value = 'none'
  }, COPIED_MILLISECONDS)
}

function onCopy(): void {
  void runCopy()
}

/**
 * Takes the match as it now stands.
 * @param next - The match, freshly read
 * @param confirmed - Whether the server answered for this read, rather than the local cache
 */
function onState(next: MatchState, confirmed: boolean): void {
  // Somebody opened the match's address without a seat in it — a shared link,
  // or a browser that lost the identity it joined under. The lobby is the only
  // way in, so they go there with the code already filled in.
  //
  // Only ever on a confirmed read. A player arriving straight from taking a
  // seat is answered from the local cache first, and that cache can still hold
  // the match from before their seat was written — turning them away from the
  // match they had in fact just joined.
  if (confirmed && !next.players.some((player) => player.uid === uid.value)) {
    void router.replace({
      name: 'home',
      query: {
        code: next.code,
      },
    })

    return
  }

  state.value = next

  // Only when the bowl has actually been rewritten. Between a throw being
  // announced and its result being written, the match still holds the bowl
  // from before it — applying that would take the flying die back off the
  // table on every screen watching it.
  if (next.bowlVersion !== appliedBowlVersion) {
    appliedBowlVersion = next.bowlVersion
    scene?.reconcileBowl(next.bowl)
  }
}

/**
 * Plays somebody else's throw, so that a player who is not throwing still
 * watches a die fly rather than watching one appear.
 * @param record - The throw, as its thrower described it
 */
function onThrow(record: ThrowRecord): void {
  scene?.applyThrow(record.dieId, record.launch)
}

/**
 * Sends a throw made on this canvas, and makes it here at once.
 * @param launch - The finished gesture
 */
function onLaunch(launch: ThrowLaunch): void {
  const match = state.value
  const connected = client

  if (match === null || connected === null || !canThrow.value) {
    return
  }

  const seq = match.throwSeq + 1

  pendingSeq = seq
  busy.value = true
  scene?.applyThrow(String(seq), launch)

  connected.submitThrow(seq, launch).catch((reason: unknown) => {
    busy.value = false
    error.value = describe(reason)
  })
}

/**
 * Publishes where the dice stopped.
 *
 * The scene reports this for every throw it runs, including the ones this
 * player only watched, so the first thing it does is check that the throw was
 * this player's to finish.
 */
function onSettled(): void {
  const connected = client

  if (!busy.value || connected === null) {
    return
  }

  const bowl = scene?.bowlSnapshot ?? []

  busy.value = false

  connected.submitResult(pendingSeq, bowl).catch((reason: unknown) => {
    error.value = describe(reason)
  })
}

function onPass(): void {
  const match = state.value
  const connected = client

  if (match === null || connected === null) {
    return
  }

  connected.pass(match).catch((reason: unknown) => {
    error.value = describe(reason)
  })
}

async function connect(): Promise<void> {
  try {
    const opened = await MatchClient.open(code)

    uid.value = opened.uid
    client = opened
    opened.listen(onState, onThrow)
  } catch (reason: unknown) {
    error.value = describe(reason)
  }
}

onMounted(() => {
  const element = canvas.value

  if (!element) {
    return
  }

  scene = new DishScene(element)
  scene.onLaunch = onLaunch
  scene.onSettled = onSettled
  scene.start()

  // Deliberately not awaited. The bowl paints on the first frame either way,
  // and the match arriving a moment later simply fills it.
  void connect()
})

onBeforeUnmount(() => {
  window.clearTimeout(copiedTimer)
  client?.dispose()
  client = null
  scene?.dispose()
  scene = null
})
</script>

<template>
  <main class="match">
    <!-- The right button orbits the camera, so the browser's own menu on that
         button has to stay out of the way -->
    <canvas
      ref="canvas"
      class="match__canvas"
      @contextmenu.prevent
    />

    <!-- Mounted from the first frame and merely covered while the seats fill,
         so the wait for the last player is also the wait for the physics -->
    <div v-if="!playing" class="waiting">
      <div class="waiting__card">
        <p class="label">Match code</p>

        <div class="waiting__row">
          <p class="waiting__code">{{ code }}</p>

          <button
            type="button"
            class="copy"
            :class="{'copy--done': copyResult === 'done'}"
            :aria-label="copyResult === 'done' ? 'Match code copied' : 'Copy match code'"
            @click="onCopy"
          >
            <svg class="copy__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path v-if="copyResult === 'done'" d="m4 12.5 5 5 11-11" />
              <g v-else>
                <path d="M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3" />
                <path d="M11 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z" />
              </g>
            </svg>
          </button>
        </div>

        <p v-if="copyResult === 'failed'" class="waiting__snag" role="alert">
          Could not copy the code.
        </p>

        <p class="waiting__line">{{ waitingLine }}</p>

        <ul class="seats">
          <li v-for="seat in seatsTotal" :key="seat" class="seats__seat">
            <DieFace :value="seat" :lit="seat <= seatsTaken" />
            <span class="seats__name" :class="{'seats__name--open': seat > seatsTaken}">
              {{ seatedName(seat) }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <div v-else class="chrome">
      <header class="chrome__top">
        <p class="chrome__code">{{ code }}</p>

        <ul class="rail">
          <li
            v-for="(player, seat) in state?.players ?? []"
            :key="player.uid"
            class="rail__player"
            :class="{'rail__player--active': player.uid === activePlayer?.uid}"
          >
            <DieFace :value="seat + 1" :lit="player.uid === activePlayer?.uid" />
            <span class="rail__name">{{ player.name }}</span>
          </li>
        </ul>
      </header>

      <footer class="chrome__bottom">
        <p class="chrome__status" :class="{'chrome__status--mine': isMyTurn}">{{ status }}</p>

        <button
          v-if="canPass"
          type="button"
          class="action"
          @click="onPass"
        >
          Pass
        </button>
      </footer>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </main>
</template>

<style scoped>
.match {
    position: relative;
    height: 100%;
}

.match__canvas {
    display: block;
    width: 100%;
    height: 100%;

    /* Matches BACKGROUND_COLOR in dimensions.ts, so the first frame does not
       arrive over a white page */
    background: #0e1210;

    /* Lets the controls handle drags on touch instead of the page scrolling */
    touch-action: none;
}

.label {
    font: var(--plate);
    letter-spacing: var(--plate-tracking);
    text-transform: uppercase;
    color: var(--bone-faint);
}

/* ============================================
   Waiting for the seats to fill
   ============================================ */

.waiting {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;

    /* Translucent, so the bowl is already there behind the wait rather than
       revealed as though it had just been built */
    background: rgb(14 18 16 / 82%);
}

.waiting__card {
    width: 100%;
    max-width: 22rem;
    padding: 1.75rem;
    border: 1px solid var(--brass-edge);
    border-radius: 0.75rem;
    background: var(--panel);
    text-align: center;
    box-shadow:
        inset 0 1px 0 rgb(200 164 104 / 18%),
        0 1.5rem 3rem rgb(0 0 0 / 45%);
}

/* The code and the button that copies it read as one object, so the pair is
   centred rather than the code alone */
.waiting__row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    margin-top: 0.75rem;
}

.waiting__code {
    font-family: var(--font-mono);
    font-size: 2.5rem;
    font-weight: 600;
    letter-spacing: 0.28em;
    text-indent: 0.28em;
    color: var(--brass);
}

.copy {
    display: flex;
    padding: 0.5rem;
    border: 0;
    border-radius: 0.5rem;
    background: transparent;
    color: var(--bone-faint);
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease;
}

.copy:hover {
    background: var(--brass-glow);
    color: var(--brass);
}

/* Stays lit while the tick is up, so the press is answered even after the
   pointer has left the button */
.copy--done {
    color: var(--brass);
}

.copy__icon {
    width: 1.25rem;
    height: 1.25rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}

/* The copy button's own failure, and only for as long as the button holds it */
.waiting__snag {
    margin-top: 0.5rem;
    font-size: 0.8125rem;
    color: var(--brass);
}

.waiting__line {
    margin-top: 0.75rem;
    font-size: 0.875rem;
    color: var(--bone-dim);
}

.seats {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    margin-top: 1.5rem;
    list-style: none;
    text-align: left;
}

.seats__seat {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.seats__seat .die-face {
    --size: 1.5rem;
}

.seats__name {
    font-size: 0.9375rem;
}

.seats__name--open {
    color: var(--bone-faint);
}

/* ============================================
   Playing
   ============================================ */

/* The chrome never takes the pointer; only the controls inside it do, so a
   drag that begins over a label still reaches the bowl */
.chrome {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 1.25rem;
    pointer-events: none;
}

.chrome__top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
}

.chrome__code {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    font-weight: 500;
    letter-spacing: 0.2em;
    color: var(--bone-faint);
}

.rail {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    list-style: none;
}

.rail__player {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.625rem 0.375rem 0.375rem;
    border: 1px solid transparent;
    border-radius: 999px;
    background: rgb(14 18 16 / 55%);
    transition: border-color 200ms ease, background 200ms ease;
}

.rail__player--active {
    border-color: var(--brass-edge);
    background: rgb(43 23 13 / 80%);
}

.rail__player .die-face {
    --size: 1.375rem;
}

.rail__name {
    font-size: 0.8125rem;
    color: var(--bone-dim);
}

.rail__player--active .rail__name {
    color: var(--bone);
}

.chrome__bottom {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
}

.chrome__status {
    font-size: 0.9375rem;
    color: var(--bone-dim);
}

.chrome__status--mine {
    color: var(--baize-lit);
}

.action {
    padding: 0.625rem 1.5rem;
    border: 0;
    border-radius: 999px;
    background: var(--brass);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--pip);
    cursor: pointer;
    pointer-events: auto;
    transition: filter 160ms ease;
}

.action:hover {
    filter: brightness(1.12);
}

.error {
    position: absolute;
    inset: auto 1.25rem 4.5rem;
    text-align: center;
    font-size: 0.875rem;
    color: var(--brass);
}
</style>
