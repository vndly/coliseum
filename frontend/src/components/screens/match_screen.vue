<!-- One match: the bowl, and the little that has to be said around it.

     This is the only place the network and the scene meet. The match client
     knows nothing about Three.js and the scene knows nothing about Firestore;
     this component holds both, keeps the reactive half for the interface, and
     calls into the scene directly so that nothing reactive gets anywhere near
     the render loop. -->
<script setup lang="ts">
import {computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch} from 'vue'
import {onBeforeRouteLeave, useRoute, useRouter} from 'vue-router'
import DieFace from '@/components/die_face.vue'
import {nextBotMove} from '@/match/bots'
import type {BotMove} from '@/match/bots'
import {isMatchCode, normaliseMatchCode} from '@/match/codes'
import {MatchClient} from '@/match/match_client'
import type {MatchPlayer, MatchState, ThrowRecord} from '@/match/match_state'
import {drawFromHand, nextActivePlayer, poolSize, throwSize} from '@/match/rules'
import {dieSkin, dieSkinCss} from '@/scene/die_skins'
import type {ThrowLaunch} from '@/scene/die_state'
import {DIE_LIMIT} from '@/scene/dimensions'
import {DishScene} from '@/scene/dish_scene'

const route = useRoute()
const router = useRouter()

const parameter = route.params.code

// Put through the same normalisation the lobby applies before it joins one.
// This address is the one meant to be shared, and it was the single entry
// point that handed whatever it was given straight to the store as a
// document's name — where a code carrying a slash is answered with the store's
// account of its own path rather than with the game's account of the code.
const code = normaliseMatchCode(typeof parameter === 'string' ? parameter : '')

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const notice = useTemplateRef<HTMLElement>('notice')

const COPIED_MILLISECONDS = 2000 // How long the copy button holds its answer

/**
 * How long a settled bowl is left unjudged before somebody else judges it.
 *
 * The thrower publishes what their throw came to as soon as their own dice
 * stop, so this only ever runs out when they have closed the tab between the
 * two. Long enough that an ordinary round trip is never mistaken for one.
 */
const TAKEOVER_MILLISECONDS = 5000

/**
 * How long between one offer to judge a settled bowl and the next.
 *
 * The first offer is the next player's alone, so that five tables do not all
 * reach for one bowl. Every offer after it is open to anybody who ran the
 * throw through their own scene, because the seat that was asked first can be
 * the seat that has gone — and a bowl nobody judges is a match where nobody
 * can throw, pass or be paid what their throw won them again.
 */
const TAKEOVER_RETRY_MILLISECONDS = 5000

/** How many times a bowl is offered around before it is left alone. */
const TAKEOVER_ATTEMPTS = 6

/** What the claim on a match's bot seats is named, with the code after it. */
const BOT_LOCK = 'coliseum-bots-'

/** How long a turn is called for before the call fades and the table is let go. */
const TURN_CALL_MILLISECONDS = 1000

/**
 * How long a bot is left to think, at its quickest and its slowest.
 *
 * Long enough that the call naming the seat has been read and whatever the
 * last throw came to has been seen, and drawn afresh for every move rather
 * than fixed: a table of five bots on one timer moves like a metronome, which
 * is the one thing that would give away that nobody is sitting at it.
 */
const BOT_PAUSE_MINIMUM = 600 // Milliseconds
const BOT_PAUSE_MAXIMUM = 1400

// None of these are refs: the scene mutates every frame and must stay out of
// reactivity, and the client and the counters are only ever read from callbacks
// that already know when they changed
let scene: DishScene | null = null
let client: MatchClient | null = null
let pendingSeq = 0 // The throw made here that is waiting to come to rest
let pendingThrower = '' // The seat that throw was made from, which is a bot's on a bot's turn
let pendingThrow: Promise<void> = Promise.resolve() // That throw's own write, still in flight
let awaitingSeq = 0 // Somebody else's throw that has stopped and not yet been judged
let takeoverTimer = 0 // The pending offer to judge it for them, so it can be called off
let takeoverAttempt = 0 // How many offers this bowl has already had
let appliedBowlVersion: number | null = null // The last bowl handed to the scene, once one has been
let copiedTimer = 0 // The pending reset of the copy button, so it can be called off
let turnCallTimer = 0 // The pending end of the turn call, so it can be called off
let botTimer = 0 // The pending move of the bot whose turn it is, so it can be called off
let leaveAllowed = false // Set by every departure made here, so the guard lets those through
let unmounted = false // Whether the screen has gone, for the connection still being opened
let releaseBotSeats: (() => void) | null = null // Gives up the claim on the bot seats

const state = shallowRef<MatchState | null>(null)
const uid = ref('')
const busy = ref(false) // A throw made here is still in the air
const writing = ref(false) // And its write has not reached the match yet
const simulating = ref(false) // Whether the scene has a physics world to throw into
const resolving = ref(false) // A verdict is being played out, here and on every other table
const calledTurn = ref(-1) // The seat the call names, once a turn has been called
const calling = ref(false) // Whether that call is up, and the table held for it
const acknowledgedLoss = ref(false) // Whether this player has closed the notice that they are out
const acknowledgedEnd = ref(false) // Whether this player has closed the notice naming the winner
const showLeave = ref(false) // Whether the question about leaving the match is up
const unreadable = ref(false) // Whether the match itself can no longer be read
const botDriver = ref(false) // Whether this view is the one playing the seats nobody is behind
const copyResult = ref<'none' | 'done' | 'failed'>('none') // What the last press of copy came to
const error = ref('')

const activePlayer = computed<MatchPlayer | null>(() => {
  const match = state.value

  return match === null ? null : match.players[match.turnIndex] ?? null
})

// Seats, then play, then a winner. The wait is shown for the first of the three
// and the chrome for the other two, so a finished match is still a match.
const inLobby = computed<boolean>(() => state.value === null || state.value.phase === 'lobby')
const playing = computed<boolean>(() => state.value?.phase === 'playing')
const finished = computed<boolean>(() => state.value?.phase === 'finished')

const isMyTurn = computed<boolean>(() => uid.value !== '' && activePlayer.value?.uid === uid.value)
const bowlFull = computed<boolean>(() => (state.value?.bowl.length ?? 0) >= DIE_LIMIT)

const myPool = computed<number>(() => {
  const match = state.value

  return match === null || uid.value === '' ? 0 : poolSize(match, uid.value)
})

/**
 * Whether the last throw has been judged.
 *
 * A hand is charged the moment its dice leave it and paid back only when the
 * throw is judged, so between those two writes a player can be holding nothing
 * without being out — and because the charge is on the match document, every
 * client reads that gap, not just the one that threw. Everything that would
 * otherwise mistake it for elimination, or let a second throw into it, waits on
 * this rather than on a flag only the thrower's own machine has.
 */
const judged = computed<boolean>(() => {
  const match = state.value

  return match === null || (match.verdict?.seq ?? 0) === match.throwSeq
})

const eliminated = computed<boolean>(
  () => !inLobby.value && uid.value !== '' && isSpent(uid.value),
)

/** How many dice the next gesture on the canvas is to put in the air. */
const handToThrow = computed<number>(() => {
  const match = state.value

  return match === null || uid.value === '' ? 1 : throwSize(match, uid.value)
})

/**
 * Whose turn it is, once there is nothing left to watch.
 *
 * A turn is called as it begins, and -1 is every moment that is not the
 * beginning of one: before the first deal, after the match is over, and for as
 * long as the scene is still playing out the verdict that moved the turn on.
 * That last one is why this waits rather than reading the turn straight off the
 * match — a call made there would stand over the dice leaving the bowl, which
 * is the part of a throw worth watching.
 */
const settledTurn = computed<number>(() => {
  const match = state.value

  return match === null || !playing.value || resolving.value ? -1 : match.turnIndex
})

/** The player the call on screen names, for as long as it is up. */
const calledPlayer = computed<MatchPlayer | null>(
  () => state.value?.players[calledTurn.value] ?? null,
)

/** What the call says: the second person to the player it is asking something of. */
const callLine = computed<string>(() => {
  const player = calledPlayer.value

  if (player === null) {
    return ''
  }

  return player.uid === uid.value ? 'Your turn' : `${player.name}'s turn`
})

// Both close over the whole of a throw, not just its flight. The dice stopping
// is not the end of it: the verdict is still being written, and a gesture or a
// pass landing in that gap would be judged against a bowl the match has not
// finished with — or would move the turn out from under the verdict on its way
// to the thrower's own hand.
//
// Closed again for as long as a turn is being called. The layer that carries
// the call is already holding every pointer on the screen; this is what stops
// the one press that layer cannot — a Pass the keyboard still has hold of.
//
// And closed until there is a simulation to throw into at all. A throw is
// written to the match before the dice it names ever come to rest, and a scene
// with no physics world never brings them to rest — the hand is charged, the
// turn moves nowhere, and nothing here would ever open again. The takeover
// already refuses to publish a bowl from a scene like that; this refuses to
// make one.
const canThrow = computed<boolean>(
  () => playing.value
    && simulating.value
    && isMyTurn.value
    && !busy.value
    && !writing.value
    && !resolving.value
    && !calling.value
    && judged.value
    && !bowlFull.value
    && myPool.value > 0,
)

/** The seat playing now, when there is nobody sitting behind it. */
const activeBot = computed<MatchPlayer | null>(() => {
  const player = activePlayer.value

  return player !== null && player.bot ? player : null
})

/**
 * What the bot whose turn it is does next, or null when no bot is waiting on
 * this browser.
 *
 * Held off by the same things that close the player's own controls, and for
 * the same reasons: a throw or a pass landing while the dice are still moving,
 * while the verdict is still being written, or while the turn is still being
 * called would be answered against a bowl the match has not finished with —
 * and a bot throwing into a scene with no physics locks the match up exactly
 * as a player doing so would.
 */
const botMove = computed<BotMove | null>(() => {
  const match = state.value
  const player = activeBot.value

  if (match === null || player === null || !playing.value) {
    return null
  }

  if (!simulating.value || busy.value || writing.value || resolving.value || calling.value) {
    return null
  }

  if (!judged.value) {
    return null
  }

  // And held off entirely unless this view is the one playing the bot seats.
  // A browser's tabs share the identity a seat was taken under, so the same
  // match opened twice is the same seated player twice — and both views would
  // otherwise draw their own pause and move for every bot at the table.
  if (!botDriver.value) {
    return null
  }

  return nextBotMove(match, player.uid)
})

/**
 * The bot move now due, named so that one is told apart from the next.
 *
 * A watcher on the move alone would sit still through a row of them: two bots
 * passing in turn is the same answer twice, and nothing would fire the second.
 * Everything that makes this a different decision from the last one is in the
 * name.
 */
const botTurnKey = computed<string | null>(() => {
  const match = state.value
  const move = botMove.value

  if (match === null || move === null) {
    return null
  }

  return `${match.turnIndex}:${match.throwSeq}:${String(match.hasThrown)}:${move}`
})

const canPass = computed<boolean>(
  () => playing.value
    && isMyTurn.value
    && !busy.value
    && !resolving.value
    && !calling.value
    && judged.value
    && state.value?.hasThrown === true,
)

// The question about leaving takes the screen on its own — it is the only thing
// being asked, and either answer puts it away again — so both cards it could
// otherwise stand over give way to it
const showLoss = computed<boolean>(
  () => !showLeave.value && eliminated.value && !finished.value && !acknowledgedLoss.value,
)

/**
 * Whether the card naming the winner is up.
 *
 * Held back until the scene has finished playing the verdict out. The write
 * that ends a match is the same one the washes are read from, so a card shown
 * the moment it lands stands over the very throw it is reporting — and in a
 * match of two, that throw is the one the loser most wants to look at.
 */
const showEnd = computed<boolean>(
  () => !showLeave.value && finished.value && !acknowledgedEnd.value && !resolving.value,
)

/**
 * Whether a card standing over the table is waiting to be answered.
 *
 * The layer behind one keeps its place in the tab order otherwise. A scrim
 * takes the pointer and has nothing to say to the keyboard, so Tab and Enter
 * reached straight past the question about leaving to the Pass button behind
 * it — ending a turn in answer to a question about something else.
 */
const noticeShowing = computed<boolean>(
  () => showLeave.value || showLoss.value || showEnd.value || unreadable.value,
)

/**
 * The same answer as an attribute. Nothing at all rather than false, because
 * inert is not one of the attributes Vue knows to take off an element on a
 * false — written out as the string "false" it is every bit as inert as it is
 * written out as anything else.
 */
const behindNotice = computed<true | undefined>(() => noticeShowing.value || undefined)

const winnerLine = computed<string>(() => {
  const match = state.value

  if (match === null || match.winner === null) {
    return ''
  }

  if (match.winner === uid.value) {
    return 'You win'
  }

  return `${match.players.find((player) => player.uid === match.winner)?.name ?? 'Someone'} wins`
})

/**
 * Whether the card that waits for players stands over the table.
 *
 * The match answers this for itself the moment it arrives: a lobby is waiting
 * and anything else is not, which is why a match against bots — written
 * straight into play, and joinable by nobody — never shows it. Before it
 * arrives there is nothing to read the answer off, and the card would be
 * offering a code to invite people into a match that has no room for any. So
 * the one thing this browser already knows is carried on the address and
 * answers that window alone; from the first read on, the phase decides.
 */
const showWaiting = computed<boolean>(
  () => !unreadable.value && inLobby.value && (state.value !== null || route.query.bots !== '1'),
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

// The gesture is closed off the moment the turn is not this player's, so a
// throw cannot be started on the canvas and refused afterwards
watch(canThrow, (enabled) => {
  if (scene !== null) {
    scene.throwEnabled = enabled
  }
})

// A turn that begins with an empty bowl throws the whole hand on one gesture,
// so the canvas has to know how many dice a release is worth before it happens
watch(handToThrow, (count) => {
  if (scene !== null) {
    scene.throwCount = count
  }
})

// A turn is called once, as it begins. Watched rather than written into the
// verdict, because a turn also begins on a pass, on the first deal, and on a
// player opening a match that is already part way through one.
watch(settledTurn, (seat) => {
  if (seat === -1 || seat === calledTurn.value) {
    return
  }

  calledTurn.value = seat
  calling.value = true

  window.clearTimeout(turnCallTimer)
  turnCallTimer = window.setTimeout(() => {
    calling.value = false
  }, TURN_CALL_MILLISECONDS)
})

// A bot is given a moment before it moves. Cleared on every change rather than
// only on a new turn: anything that takes the decision away — the player's own
// throw landing first, the match ending — leaves a timer that would otherwise
// fire into a match that has moved on, and the move it was drawn for is
// recomputed from the state it arrives at anyway.
watch(botTurnKey, (key) => {
  window.clearTimeout(botTimer)

  if (key === null) {
    return
  }

  const pause = BOT_PAUSE_MINIMUM + Math.random() * (BOT_PAUSE_MAXIMUM - BOT_PAUSE_MINIMUM)

  botTimer = window.setTimeout(runBotTurn, pause)
})

// Focus is moved into a card as it opens, so that the keyboard is inside the
// question being asked rather than left on the layer just shut behind it
watch(noticeShowing, (showing) => {
  if (!showing) {
    return
  }

  void nextTick(() => {
    notice.value?.querySelector('button')?.focus()
  })
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
 * Answers a match that can no longer be read at all: no document at that code,
 * a document this game cannot make a match out of, or a listener the store has
 * torn down under it.
 *
 * The match is put down rather than left standing. Held on to, the last state
 * that did read keeps the rail, the turn and the throw controls live over a
 * match that is not there — and the player only finds out when the write their
 * gesture made is refused.
 * @param reason - Why it cannot be read
 */
function onLost(reason: unknown): void {
  unreadable.value = true
  state.value = null
  error.value = describe(reason)
}

/**
 * Answers the throws beneath the match going quiet. The match itself still
 * reads, and every bowl still arrives through it — what is lost is watching
 * somebody else's dice fly rather than finding them already landed.
 * @param reason - Why they stopped arriving
 */
function onSnag(reason: unknown): void {
  error.value = describe(reason)
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
    leaveAllowed = true

    void router.replace({
      name: 'home',
      query: {
        code: next.code,
      },
    })

    return
  }

  // The match reads again, so whatever could not be read before is over and
  // the line that said so goes with it
  if (unreadable.value) {
    unreadable.value = false
    error.value = ''
  }

  state.value = next

  // The throw made here has reached the match, which is what the controls were
  // waiting on rather than the write's own answer: it is this reading of the
  // match that everything below decides against.
  if (next.throwSeq >= pendingSeq) {
    writing.value = false
  }

  // Only when the bowl has actually been rewritten. Between a throw being
  // announced and its result being written, the match still holds the bowl
  // from before it — applying that would take the flying die back off the
  // table on every screen watching it.
  if (next.bowlVersion === appliedBowlVersion) {
    return
  }

  const arriving = appliedBowlVersion === null

  appliedBowlVersion = next.bowlVersion

  // Whatever this bowl was waiting on has happened
  window.clearTimeout(takeoverTimer)

  // A player who has only just opened the match has no bowl for a verdict to
  // take dice out of. They are given the one it ended at, and what happened on
  // the way there is somebody else's memory.
  if (next.verdict === null || arriving) {
    scene?.reconcileBowl(next.bowl)

    return
  }

  resolving.value = true
  scene?.applyVerdict(next.verdict, next.bowl)
}

/**
 * Plays somebody else's throw, so that a player who is not throwing still
 * watches the dice fly rather than watching them appear.
 * @param record - The throw, as its thrower described it
 */
function onThrow(record: ThrowRecord): void {
  // A throw the match has already judged is one whose dice are in the bowl this
  // player has been handed, or gone out of it — and the two listeners are
  // independent, so the verdict is free to arrive first. Played from here it
  // would build dice the bowl already holds, under identifiers it is already
  // using, and hand a hand back twice for one die when this table's bowl is
  // next published.
  if (record.seq <= (state.value?.verdict?.seq ?? 0)) {
    return
  }

  scene?.applyThrow(record.dice)
}

/**
 * Sends a throw made on this canvas, and makes it here at once.
 *
 * The dice are named after the throw and their place in it, so a hand thrown
 * all at once still gives every die a name every player agrees on.
 * @param launches - The finished gesture, one launch per die it put in the air
 */
function onLaunch(launches: ThrowLaunch[]): void {
  const match = state.value
  const connected = client
  const player = activePlayer.value

  if (match === null || connected === null || player === null) {
    return
  }

  // A gesture on the canvas is this player's own, and a throw with nobody's
  // hand on it belongs to the bot the turn is sitting on. Either way the seat
  // that made it is the seat whose turn it is, and neither is let through
  // unless that turn is genuinely open.
  if (!canThrow.value && botMove.value !== 'throw') {
    return
  }

  // The front of the hand, which is what a queue hands over. The colours go
  // out with the throw rather than being looked up when it lands, so that
  // every player builds the same coloured die from the same record.
  const drawn = drawFromHand(match, player.uid, launches.length)

  const seq = match.throwSeq + 1
  const dice = launches.map((launch, index) => ({
    id: `${seq}-${index}`,
    skin: drawn.thrown[index] ?? player.color,
    launch: launch,
  }))

  pendingSeq = seq
  pendingThrower = player.uid
  busy.value = true

  // Held until the match itself says the throw is in it. The dice stopping is
  // not that moment: the write is a transaction, so nothing of it reaches this
  // browser's own reading of the match until the server has answered, and a
  // bowl that settles before then would leave the controls open over a match
  // still holding the count from before — where the next gesture takes the
  // same number, and so the very same names for its dice.
  writing.value = true

  scene?.applyThrow(dice)

  const submitted = connected.submitThrow(seq, dice, player.uid, drawn.kept)

  pendingThrow = submitted

  submitted.catch((reason: unknown) => {
    // The throw never landed, so the dice it put on this table are dice no
    // other player has and the match has never heard of. Taken back out, so
    // that the retry the line below invites builds them once rather than
    // beside the copies already standing there — the sequence number is free
    // again, so the retry gives them the very same identifiers.
    scene?.withdrawThrow(dice)
    busy.value = false
    writing.value = false
    error.value = describe(reason)
  })
}

/**
 * Judges the bowl once it has stopped.
 *
 * The scene reports this for every throw it runs, including the ones this
 * player only watched, and the two are answered differently: the thrower
 * judges their own bowl straight away, and everybody else starts a clock in
 * case they never do.
 */
function onSettled(): void {
  const match = state.value
  const connected = client

  if (match === null || connected === null) {
    return
  }

  const bowl = scene?.bowlSnapshot ?? []

  if (busy.value) {
    const seq = pendingSeq
    const thrower = pendingThrower

    busy.value = false

    // Chained onto the throw's own write rather than fired beside it. The
    // verdict is refused by a match that has not heard of the throw yet, and
    // over a slow connection the dice can stop before that write has landed.
    pendingThrow
      .then(() => connected.submitVerdict(seq, bowl, thrower))
      .catch((reason: unknown) => {
        error.value = describe(reason)
      })

    return
  }

  awaitingSeq = match.throwSeq
  takeoverAttempt = 0

  armTakeover(TAKEOVER_MILLISECONDS)
}

/**
 * Puts the next offer to judge the settled bowl on the clock.
 * @param delay - How long to wait before making it
 */
function armTakeover(delay: number): void {
  window.clearTimeout(takeoverTimer)
  takeoverTimer = window.setTimeout(runTakeover, delay)
}

/**
 * Judges a bowl the player who threw it never got around to judging.
 *
 * The first offer is the next player's alone, so that five tables do not all
 * reach for the same bowl at once — and the write refuses itself anyway if the
 * thrower turns out to have managed it after all. Every offer after that is
 * open to anybody whose own scene ran the throw, because the seat asked first
 * can be a seat that has gone, or a client that reloaded through the throw and
 * so has no bowl of its own to publish. Offered again rather than once,
 * because a bowl nobody judges is a match in which nobody can throw or pass
 * ever again, and the thrower's hand stays charged for dice it never got back.
 *
 * Every way out of this that is not "the bowl has been judged" puts the next
 * offer on the clock, up to a fixed number of them: a write that is refused, a
 * scene not in a state to publish, and a seat that is not the one being asked.
 */
function runTakeover(): void {
  const match = state.value
  const connected = client

  if (match === null || connected === null || match.phase !== 'playing') {
    return
  }

  if (match.verdict !== null && match.verdict.seq >= awaitingSeq) {
    return
  }

  const attempt = takeoverAttempt

  takeoverAttempt++

  if (attempt >= TAKEOVER_ATTEMPTS) {
    return
  }

  // Nothing here is worth publishing yet. A scene whose physics never started
  // reports an empty bowl rather than no bowl, and a scene part way through a
  // verdict is holding the previous throw's dice — either would be written over
  // the match as though it were what the thrower saw.
  if (scene === null || !scene.isSimulating || resolving.value) {
    armTakeover(TAKEOVER_RETRY_MILLISECONDS)

    return
  }

  const seat = match.players.findIndex((player) => player.uid === uid.value)

  // Not at this table at all, and on the way back to the lobby
  if (seat === -1) {
    return
  }

  if (attempt === 0 && nextActivePlayer(match.players, match.pools, match.turnIndex) !== seat) {
    armTakeover(TAKEOVER_RETRY_MILLISECONDS)

    return
  }

  // Armed before the write rather than after it, so that a write which never
  // answers is answered by the next offer rather than by nothing. The verdict
  // landing clears it on its way through the bowl, and a second attempt over a
  // throw already judged is refused inside the transaction.
  armTakeover(TAKEOVER_RETRY_MILLISECONDS)

  // Nobody here threw this one, so the turn is handed on for whoever did
  connected.submitVerdict(awaitingSeq, scene.bowlSnapshot, null).catch((reason: unknown) => {
    error.value = describe(reason)
  })
}

/**
 * Plays the turn of a seat nobody is sitting behind.
 *
 * The whole of a bot is here and in the strategy it asks: it throws through
 * the same scene the player throws through, and its throw and its pass are the
 * same two writes any other player makes. What it is not is a second kind of
 * turn — everything that judges the bowl afterwards reads it as the seat it
 * was made from, and never knows the difference.
 */
function runBotTurn(): void {
  const match = state.value
  const connected = client
  const player = activeBot.value
  const move = botMove.value

  // Drawn again rather than trusted from when the timer was set: anything at
  // all can have arrived in the pause, and the move is only ever made on the
  // match as it stands now
  if (match === null || connected === null || player === null || move === null) {
    return
  }

  if (move === 'pass') {
    connected.pass(match).catch((reason: unknown) => {
      error.value = describe(reason)
    })

    return
  }

  scene?.throwUnaimed(throwSize(match, player.uid))
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

function onKeepWatching(): void {
  acknowledgedLoss.value = true
}

function onStay(): void {
  acknowledgedEnd.value = true
}

function onCancelLeave(): void {
  showLeave.value = false
}

/**
 * Goes back to the lobby, and tells the guard this one was asked for.
 *
 * The only way out of the match that is not the back button, and the only one
 * the guard below does not stop — every press that reaches here has already
 * been answered by whoever pressed it.
 *
 * Replaces rather than pushes: the match is behind whoever is leaving it, and
 * an address left standing in the history is one the back button would walk
 * them straight back into — with their seat still in the match, nothing there
 * would turn them away again.
 */
function onLeave(): void {
  leaveAllowed = true
  showLeave.value = false

  void router.replace({
    name: 'home',
  })
}

/**
 * Whether a hand of nothing is a player out of the match, rather than one whose
 * dice are still in the air.
 *
 * A hand is charged the moment its dice leave it and paid back only when the
 * throw is judged, so an empty hand mid-throw is a real and temporary reading —
 * but it is only ever the thrower's. Everybody else at the table is holding
 * exactly what they were holding before, so their nought means what it always
 * means. Testing the whole table on the throw, which is what waiting for the
 * verdict alone does, takes the mark off every player who is genuinely out for
 * as long as anybody is throwing.
 * @param player - The identifier to judge
 * @returns Whether they are out of the match
 */
function isSpent(player: string): boolean {
  const match = state.value

  if (match === null || poolSize(match, player) > 0) {
    return false
  }

  return judged.value || player !== activePlayer.value?.uid
}

/**
 * How many dice a player is holding, for the rail.
 * @param player - The seat to count
 * @returns Their hand, which is zero once they are out
 */
function handOf(player: MatchPlayer): number {
  const match = state.value

  return match === null ? 0 : poolSize(match, player.uid)
}

/**
 * The colour a seat is playing in, ready for its swatch on the rail.
 *
 * The swatch says which seat is which and nothing more. What anybody is
 * holding is deliberately left to the count beside it: a hand broken out by
 * colour would tell the whole table what each player is about to throw, which
 * is a fact the game does not otherwise give away.
 * @param player - The seat to paint
 * @returns The colour, as CSS, and the name for anything reading the rail out
 */
function colorOf(player: MatchPlayer): {body: string,
  name: string} {
  return {
    body: dieSkinCss(player.color).body,
    name: dieSkin(player.color).name,
  }
}

/**
 * Whether a player is out of the match, rather than merely empty-handed for as
 * long as their own dice are in the air.
 * @param player - The seat to test
 * @returns Whether their hand is empty and that emptiness is theirs to keep
 */
function isOut(player: MatchPlayer): boolean {
  return isSpent(player.uid)
}

/**
 * Opens this player's connection to the match, and begins following it.
 *
 * Opening waits on anonymous sign-in, which is a round trip, and the screen can
 * be left while it is still in flight — a player who backs out of an address
 * that still says "Connecting to the match". Unmounting disposes a client that
 * is still null in that window, so the listeners are checked for a screen to
 * belong to before they are installed rather than left following the match for
 * the rest of the tab's life. A leaked one is not idle: it answers an
 * unseated read by sending the shared router home, out from under whatever
 * match the player has since walked into.
 */
async function connect(): Promise<void> {
  // Asked here for the same reason the lobby asks it of a typed code: this is
  // a document's own name, and a code that is not one is a question about the
  // store's own paths rather than about the match the player was sent to
  if (!isMatchCode(code)) {
    onLost(new Error('No match with that code.'))

    return
  }

  try {
    const opened = await MatchClient.open(code)

    if (unmounted) {
      opened.dispose()

      return
    }

    uid.value = opened.uid
    client = opened
    opened.listen(onState, onThrow, onLost, onSnag)
  } catch (reason: unknown) {
    error.value = describe(reason)
  }
}

/**
 * Claims the right to play this match's bot seats, for this view of it alone.
 *
 * A bot's turns are played by the browser that started the match, and a
 * browser is not the same thing as a view of it: anonymous sign-in is shared
 * across an origin, so the same match opened in two tabs is the same seated
 * player twice and both would move for every bot. The lock reaches exactly as
 * far as the identity the seat was taken under does, and is held for as long
 * as this screen is.
 */
function claimBotSeats(): void {
  // A browser with no lock manager plays them as it always has. One view is
  // the ordinary case, and the race this closes needs a second one.
  if (typeof navigator.locks === 'undefined') {
    botDriver.value = true

    return
  }

  navigator.locks.request(`${BOT_LOCK}${code}`, async () => {
    if (unmounted) {
      return
    }

    botDriver.value = true

    await new Promise<void>((resolve) => {
      releaseBotSeats = resolve
    })
  }).catch(() => {
    // The claim could not be made at all, which is not a reason for a match
    // against bots to sit still: this view plays them, as it did before there
    // was anything to claim.
    botDriver.value = true
  })
}

/**
 * Answers the back button with a question rather than with the lobby.
 *
 * A match is left by leaving its address, and the back button is the one way to
 * do that without meaning to — a phone's own edge gesture, a press aimed at the
 * page before this one. The seat survives it, so this is a question and not a
 * warning, but it is asked. A finished match has nothing left to walk out of.
 * @returns Whether the navigation may go ahead
 */
onBeforeRouteLeave((): boolean => {
  // A match that cannot be read is not one there is anything to walk out of,
  // so the question is not asked over it
  if (leaveAllowed || finished.value || unreadable.value) {
    return true
  }

  showLeave.value = true

  return false
})

onMounted(() => {
  const element = canvas.value

  if (!element) {
    return
  }

  scene = new DishScene(element)
  scene.onLaunch = onLaunch
  scene.onSettled = onSettled
  scene.onResolved = () => {
    resolving.value = false
  }

  scene.onPhysicsStarted = () => {
    simulating.value = true
  }

  scene.onPhysicsFailed = (reason: unknown) => {
    error.value = describe(reason)
  }

  scene.start()

  // Deliberately not awaited. The bowl paints on the first frame either way,
  // and the match arriving a moment later simply fills it.
  void connect()

  claimBotSeats()
})

onBeforeUnmount(() => {
  unmounted = true

  window.clearTimeout(copiedTimer)
  window.clearTimeout(takeoverTimer)
  window.clearTimeout(turnCallTimer)
  window.clearTimeout(botTimer)
  releaseBotSeats?.()
  releaseBotSeats = null
  botDriver.value = false
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
         so the wait for the last player is also the wait for the physics.

         Hidden rather than dropped while the question about leaving is up: it
         is the wait that decides which chrome exists, and the two scrims over
         one another only muddy the card that is being answered. -->
    <div v-if="showWaiting" v-show="!showLeave" :inert="behindNotice" class="waiting">
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

    <div v-else-if="!unreadable" :inert="behindNotice" class="chrome">
      <header class="chrome__top">
        <ul class="rail">
          <li
            v-for="player in state?.players ?? []"
            :key="player.uid"
            class="rail__player"
            :class="{
              'rail__player--active': !finished && player.uid === activePlayer?.uid,
              'rail__player--out': isOut(player),
            }"
          >
            <span
              class="rail__swatch"
              :style="{background: colorOf(player).body}"
              :title="colorOf(player).name"
            />

            <span class="rail__name">{{ player.name }}</span>

            <!-- Counted while there is a hand to count. The nought at the end
                 is the one figure worth nothing: the struck-through name has
                 already said it, and a rail of them reads as a column of
                 noughts rather than as the players still in.

                 Keyed on the count so the element is rebuilt whenever it changes,
                 which is what replays the flare. Dice leaving a hand and coming
                 back to it is the whole game, and it happens off screen. -->
            <span
              v-if="!isOut(player)"
              :key="handOf(player)"
              class="rail__hand"
            >{{ handOf(player) }}</span>
          </li>
        </ul>
      </header>

      <!-- Nothing is said down here. The lit seat, the hand counts and the
           washes on the dice carry the state of play between them, and a line
           reading it back would only name what the player is looking at. -->
      <footer class="chrome__bottom">
        <button
          v-if="canPass"
          type="button"
          class="action action--large"
          @click="onPass"
        >
          Pass
        </button>

        <!-- The way out, once the card that was holding it has been put away.
             Nothing else on a finished table leads anywhere. -->
        <button
          v-if="finished && acknowledgedEnd"
          type="button"
          class="action"
          @click="onLeave"
        >
          Back to lobby
        </button>
      </footer>
    </div>

    <!-- Whose turn it is is the one thing the table cannot say for itself: the
         rail lights the new seat, but a player watching the bowl never sees it
         happen. Called in the middle of the screen, over the bowl, and answered
         by nobody — it holds the table for a beat and then lets it go.

         Under the cards below rather than over them, so that a question already
         being asked keeps both the screen and the presses that answer it.

         The right button orbits the camera, and this layer stands in front of
         the canvas that keeps the browser's menu on that button out of the way,
         so it has to keep it out of the way itself. -->
    <Transition name="call">
      <div v-if="calling" class="call" role="status" @contextmenu.prevent>
        <p class="call__line" :class="{'call__line--mine': calledPlayer?.uid === uid}">
          {{ callLine }}
        </p>
      </div>
    </Transition>

    <!-- Every card that has to be answered, on one layer. Only ever one of
         them: the question about leaving puts both the others away, and a
         player cannot be out of a match that is over. One layer is what lets
         the two beneath it be shut behind whichever card is up, and what gives
         the focus one place to go when a card opens.

         All three leave the bowl visible. One says to keep watching and one is
         over the bowl everybody wants to see, so none can be the blackout the
         lobby uses. -->
    <div v-if="noticeShowing" ref="notice" class="notice">
      <div
        v-if="showLeave"
        class="notice__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-heading"
      >
        <p id="leave-heading" class="label">Leave the match</p>

        <div class="notice__answers notice__answers--spaced">
          <button type="button" class="action" @click="onCancelLeave">
            Stay
          </button>

          <button type="button" class="action action--quiet" @click="onLeave">
            Leave
          </button>
        </div>
      </div>

      <div
        v-else-if="showLoss"
        class="notice__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loss-heading"
      >
        <p id="loss-heading" class="label">Out of the match</p>
        <p class="notice__line">You have no dice left. Stay and see who takes it.</p>

        <button type="button" class="action" @click="onKeepWatching">
          Keep watching
        </button>
      </div>

      <div
        v-else-if="showEnd"
        class="notice__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="winner-heading"
      >
        <p class="label">Match over</p>
        <p id="winner-heading" class="notice__winner">{{ winnerLine }}</p>

        <div class="notice__answers">
          <button type="button" class="action" @click="onLeave">
            Back to lobby
          </button>

          <!-- The bowl the match was decided in is still on the table behind
               this, and a player who has just lost one is owed a look at it -->
          <button type="button" class="action action--quiet" @click="onStay">
            Stay
          </button>
        </div>
      </div>

      <!-- Nothing else on the screen leads anywhere once the match cannot be
           read: the chrome is gone with the match it was drawn from, so the way
           back to the lobby is offered here or nowhere -->
      <div
        v-else
        class="notice__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unreadable-heading"
      >
        <p id="unreadable-heading" class="label">No such match</p>
        <p class="notice__line">{{ error === '' ? 'This match could not be read.' : error }}</p>

        <button type="button" class="action" @click="onLeave">
          Back to lobby
        </button>
      </div>
    </div>

    <p v-if="error && !unreadable" class="error" role="alert">{{ error }}</p>
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
    justify-content: flex-end;
    gap: 1rem;
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
    gap: 0.625rem;
    padding: 0.625rem 1rem;
    border: 1px solid transparent;
    border-radius: 999px;
    background: rgb(14 18 16 / 55%);
    transition: border-color 200ms ease, background 200ms ease;
}

.rail__player--active {
    border-color: var(--brass-edge);
    background: rgb(43 23 13 / 80%);
}

/* Small, and set against the pill rather than on it: the colour is how a seat
   is recognised in the bowl, so the rail only has to hold up the same colour
   beside the name. */
.rail__swatch {
    width: 0.625rem;
    height: 0.625rem;
    flex: none;

    /* The proportion the real die is rounded by, on a square this small */
    border-radius: 22%;

    /* The rim keeps a bone seat from disappearing into the light, and the bead
       along the top is what keeps a near-black one from disappearing into the
       pill it sits on — without it a dark swatch reads as an empty outline
       rather than as a filled chip, which is the one way two seats can be
       confused for each other on a rail whose whole job is telling them
       apart. It is the same lit lip the cards in the lobby are drawn with. */
    box-shadow:
        inset 0 1px 0 rgb(243 236 224 / 32%),
        0 0 0 1px var(--brass-edge);
}

/* A seat with nothing left to throw keeps its colour, faded with the name it
   is beside — the dice it painted are still out there in other people's hands */
.rail__player--out .rail__swatch {
    opacity: 0.4;
}

.rail__name {
    font-size: 0.8125rem;
    color: var(--bone-dim);
}

.rail__player--active .rail__name {
    color: var(--bone);
}

/* The hand is the one number on screen worth reading, so it is set in the face
   the match code is set in — this interface's voice for a value rather than a
   word. Tabular, because six of these are rewritten every few seconds and a
   rail that reflowed each time would be unreadable while it mattered most. */
.rail__hand {
    min-width: 1ch;
    font-family: var(--font-mono);
    font-size: 0.875rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--brass);

    /* Rebuilt whenever the count changes, so this plays on exactly the throws
       that paid somebody and on none of the others */
    animation: hand-changed 520ms ease-out;
}

/* Dice moving between the bowl and a hand is the whole of the game, and the
   only part of it that happens away from the table */
@keyframes hand-changed {
    from {
        color: var(--bone);
        text-shadow: 0 0 0.85rem var(--brass);
    }

    to {
        color: var(--brass);
        text-shadow: none;
    }
}

/* Kept on the rail rather than taken off it. Who is left is a fact about the
   match, and a pill that quietly disappeared would take the answer with it.

   Set after the players still in, which on a rail that packs to the right is
   the right of it. The seats are otherwise in the order they play in, and that
   order stops meaning anything the moment a seat is skipped — so the ones with
   nothing left to throw are moved out of the run rather than left as gaps in
   it. Ordered rather than sorted, so the list itself stays in play order for
   anything reading it out. */
.rail__player--out {
    order: 1;
    background: rgb(14 18 16 / 35%);
}

.rail__player--out .rail__name {
    color: var(--bone-faint);
    text-decoration: line-through;
}

.chrome__bottom {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
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

/* The second answer to a question the card has already put one answer to. Sunk
   into the panel rather than raised off it — the same well the lobby cuts its
   fields into — so the pair reads as one control and its alternative rather
   than as two presses of equal weight. Rimmed by an inset shadow rather than a
   border, which would make it a pixel taller than the button above it. */
.action--quiet {
    background: var(--well);
    color: var(--bone-dim);
    box-shadow: inset 0 0 0 1px var(--brass-edge);
}

.action--quiet:hover {
    color: var(--bone);
}

/* The only press the table itself asks for, and the one a player reaches for
   without looking away from the bowl. Sized for that thumb, and set large
   enough to be read at the edge of an eye held on the dice. */
.action--large {
    padding: 1rem 3rem;
    font-size: 1.5rem;
}

/* ============================================
   The turn being called
   ============================================ */

/* The one layer here that keeps every pointer it is given rather than passing
   it down to the canvas. A call cannot be answered, so while one is up the
   table is held: no gesture, no orbit, no button.

   Lit rather than curtained off. A flat scrim would take the bowl away for the
   whole of the call, and the bowl is what the player has just been told to look
   at; this is the lamp the scene is already lit by, turned up over the middle
   of the table for as long as there is something to read there. */
.call {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;
    background: radial-gradient(
        circle 24rem at center,
        rgb(14 18 16 / 82%) 0%,
        rgb(14 18 16 / 58%) 40%,
        rgb(14 18 16 / 0%) 100%
    );

    /* Holding the pointer is not enough on touch: the two fingers that orbit
       the camera are also the browser's own zoom, and a layer that only stopped
       them reaching the canvas would hand them to the page instead — leaving
       the table zoomed long after the call has gone. The canvas gives this up
       for the same reason. */
    touch-action: none;
}

/* The whole of the call, so it is set at the size of a thing said across a room
   rather than a line of interface. Held off the longest name the rail can carry
   by the viewport term, which brings it down before it can reach the edges. */
.call__line {
    font-size: clamp(2rem, 9vw, 3.25rem);
    font-weight: 600;
    line-height: 1.1;
    text-align: center;
    color: var(--bone);
    user-select: none;
}

/* Brass is what this interface says "yours" in — the hand being counted, the
   button worth pressing — so the one call that asks for something is set in it */
.call__line--mine {
    color: var(--brass);
}

/* Both ends are transitions off a class rather than an animation ending at
   nothing, so that the reduced-motion rule crushing them to an instant leaves
   the call on screen for its length instead of leaving it invisible for it */
.call-enter-active {
    transition: opacity 260ms ease-out;
}

.call-leave-active {
    transition: opacity 400ms ease-in;

    /* The table is let go the moment the call starts to leave, so that the last
       of the fade is not felt as a refused drag */
    pointer-events: none;
}

.call-enter-from,
.call-leave-to {
    opacity: 0;
}

/* ============================================
   Out, and over
   ============================================ */

/* The same raised surface the lobby uses, over a far lighter scrim. One of
   these tells the player to keep watching and the other stands over the bowl
   the whole match was played for; blacking either of them out would argue with
   what the card says. */
.notice {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;
    background: rgb(14 18 16 / 62%);
}

.notice__card {
    width: 100%;
    max-width: 20rem;
    padding: 1.75rem;
    border: 1px solid var(--brass-edge);
    border-radius: 0.75rem;
    background: var(--panel);
    text-align: center;
    box-shadow:
        inset 0 1px 0 rgb(200 164 104 / 18%),
        0 1.5rem 3rem rgb(0 0 0 / 45%);
}

.notice__line {
    margin: 0.75rem 0 1.5rem;
    font-size: 0.9375rem;
    color: var(--bone-dim);
}

/* A code is a serial number and is set as one; a name is not. The winner is the
   only thing on this screen set large in the interface's own face, which is
   what keeps the two kinds of value from reading as the same thing. */
.notice__winner {
    margin: 0.75rem 0 1.5rem;
    font-size: 2rem;
    font-weight: 600;
    line-height: 1.1;
    color: var(--brass);
}

/* Stacked rather than set side by side. The card is twenty rem at its widest
   and these are pills with a pill's padding, so a row would either break the
   longer word across two lines or push the pair past the card. */
.notice__answers {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
}

/* The leave card asks the whole question in its heading, so the space the other
   cards get from the line under theirs has to come from here instead. */
.notice__answers--spaced {
    margin-top: 1.5rem;
}

.error {
    position: absolute;
    inset: auto 1.25rem 4.5rem;
    text-align: center;
    font-size: 0.875rem;
    color: var(--brass);
}
</style>
