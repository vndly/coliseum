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
import {MatchAudio} from '@/audio/match_audio'
import DieFace from '@/components/die_face.vue'
import RulesSheet from '@/components/rules_sheet.vue'
import {nextBotEmote, nextBotMove} from '@/match/bots'
import type {BotMove} from '@/match/bots'
import {isMatchCode, normaliseMatchCode} from '@/match/codes'
import {EMOTES, emote} from '@/match/emotes'
import {MatchClient} from '@/match/match_client'
import type {EmoteRecord, MatchPlayer, MatchState, ThrowRecord} from '@/match/match_state'
import {drawFromHand, nextActivePlayer, poolSize, returnedDiceKind, throwSize} from '@/match/rules'
import {dieSkin, dieSkinCss} from '@/scene/die_skins'
import type {ThrowLaunch, ThrowResolution} from '@/scene/die_state'
import {DIE_LIMIT} from '@/scene/dimensions'
import {DishScene} from '@/scene/dish_scene'

const route = useRoute()
const router = useRouter()
const matchAudio = new MatchAudio()

const parameter = route.params.code

// Put through the same normalisation the lobby applies before it joins one.
// This address is the one meant to be shared, and it was the single entry
// point that handed whatever it was given straight to the store as a
// document's name — where a code carrying a slash is answered with the store's
// account of its own path rather than with the game's account of the code.
const code = normaliseMatchCode(typeof parameter === 'string' ? parameter : '')

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const notice = useTemplateRef<HTMLElement>('notice')
const rulesButton = useTemplateRef<HTMLButtonElement>('rulesButton')
const emotePicker = useTemplateRef<HTMLElement>('emotePicker')
const emoteButton = useTemplateRef<HTMLButtonElement>('emoteButton')

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
 * How many seats stand on one row of the rail.
 *
 * Fixed rather than however many the width happens to allow. The rail is read
 * at a glance and mid-throw, and one that re-wrapped as the names on it changed
 * would put every seat somewhere new each time a player had to find theirs. Two
 * is as many as the narrowest table has room for beside the fitting in the
 * corner opposite, and it holds a full table of six to three rows.
 */
const RAIL_SEATS_PER_ROW = 2

/**
 * How long a player must wait between saying one thing and the next.
 *
 * Every client is trusted, so this is the interface declining to offer a second
 * emote rather than the store refusing one — the same trade every other rule in
 * this game is kept by. It is not kept across a reload either, and deliberately
 * so: reloading a match costs a great deal more than five seconds, and a player
 * who would rather spend it that way has earned the emote.
 */
const EMOTE_COOLDOWN_MILLISECONDS = 5000

/**
 * How long one emote stays on screen.
 *
 * Shorter than the wait above, which is what keeps a player to one row at a
 * time: their last is always gone before their next can be sent, so the log
 * never has to decide what to do about somebody talking over themselves.
 */
const EMOTE_ROW_MILLISECONDS = 3000

/**
 * How many emotes are shown at once.
 *
 * A full table reacting to one flush is six of them in the same breath — the
 * five other seats MAX_PLAYERS allows, and this player's own — and six pills
 * climbing the side of the screen would reach the rail and read as a fault
 * rather than as a table talking. The newest are kept.
 */
const EMOTE_ROWS = 4

/**
 * How long a bot is left quiet between one thing it says and the next, at its
 * shortest and its longest.
 *
 * Far longer than the wait a player is held to, because a bot is answering every
 * verdict at the table rather than choosing a moment, and drawn afresh each time
 * for the same reason the pause before a move is: five bots on one interval
 * answer in chorus, which is the one thing that would give away that nobody is
 * sitting at those seats.
 */
const BOT_EMOTE_QUIET_MINIMUM = 12000 // Milliseconds
const BOT_EMOTE_QUIET_MAXIMUM = 24000

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
let emoteCooldownTimer = 0 // The pending end of the wait between emotes, so it can be called off
let emoteRowTimer = 0 // The pending trim of the emotes on screen, so it can be called off
let emoteSweepFrame = 0 // The frame the arc is told to start emptying on, so it can be called off
let emoteArrival = 0 // Counts emotes shown here, which is what names one row apart from the next
let lastThrower = '' // The seat that made the throw now being judged, for the bots to answer
let judgedVerdict: ThrowResolution | null = null // The verdict being played out, for the same
const botEmoteQuiet = new Map<string, number>() // Seat to the time it may next say something
let botTimer = 0 // The pending move of the bot whose turn it is, so it can be called off
let leaveAllowed = false // Set by every departure made here, so the guard lets those through
let unmounted = false // Whether the screen has gone, for the connection still being opened
let releaseBotSeats: (() => void) | null = null // Gives up the claim on the bot seats
let screenWakeLock: WakeLockSentinel | null = null // What is keeping the device awake, once it is
let askingScreenAwake = false // Whether a request for that lock is already in the air
let lossSoundPlayed = false // A player can see both defeat notices, but only hears the first
let endSoundPlayed = false // A leave question can hide and reveal the match-over card

const state = shallowRef<MatchState | null>(null)
const uid = ref('')
const busy = ref(false) // A throw made here is still in the air
const writing = ref(false) // And its write has not reached the match yet
const simulating = ref(false) // Whether the scene has a physics world to throw into
const resolving = ref(false) // A verdict is being played out, here and on every other table
const calledTurn = ref(-1) // The seat the call names, once a turn has been called
const calling = ref(false) // Whether that call is up, and the move it names held back for it
const acknowledgedLoss = ref(false) // Whether this player has closed the notice that they are out
const acknowledgedEnd = ref(false) // Whether this player has closed the notice naming the winner
const showLeave = ref(false) // Whether the question about leaving the match is up
const showRules = ref(false) // Whether the rules stand over the table
const showConfig = ref(false) // Whether the plate naming what this table plays by is out
const picking = ref(false) // Whether the emotes are laid out over the table
const cooling = ref(false) // Whether the wait between one emote and the next is running
const sweeping = ref(false) // And whether the arc drawing that wait has begun emptying
const unreadable = ref(false) // Whether the match itself can no longer be read
const botDriver = ref(false) // Whether this view is the one playing the seats nobody is behind
const copyResult = ref<'none' | 'done' | 'failed'>('none') // What the last press of copy came to
const error = ref('')
const musicEnabled = ref(matchAudio.isMusicEnabled)
const effectsEnabled = ref(matchAudio.isEffectsEnabled)

/**
 * One emote on screen, for as long as it is on screen.
 *
 * The seat is read once, as the emote arrives, rather than looked up again every
 * time the list is drawn: a seat is settled the moment the match starts, so
 * neither the name nor the colour on a row can go out of date inside its three
 * seconds. Keyed by arrival rather than by player, so a row leaving while
 * another arrives is two elements and not one changing its mind.
 */
interface EmoteRow {
  key: number
  name: string
  color: number
  emote: number
  expires: number // On the monotonic clock, which is what the trim below reads
}

const emoteRows = ref<EmoteRow[]>([])

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
// Closed again for as long as a turn is being called. The call is the one beat
// in a match where the table is worth looking at rather than played on, and the
// layer carrying it takes nothing — so the two controls that would answer it
// are the only things holding it, and everything else on screen stays live.
//
// And closed for as long as the emotes are laid out. Nothing on that layer takes
// a pointer it was not given, and the press that puts it away is deliberately
// let through to whatever it was aimed at — which on the canvas is an aim, and
// twice inside the double-press window is the whole hand dropped on the table
// unasked. Shutting the gesture is what makes letting that press through safe.
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
    && !picking.value
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
 * Whether anything at all stands over the table.
 *
 * The rules are not a question — they are closed when they have been read, and
 * nothing is riding on the press — but they cover the screen exactly as a card
 * does, so everything under them is shut away exactly as it is under one.
 */
const overlayShowing = computed<boolean>(() => noticeShowing.value || showRules.value)

/**
 * The same answer as an attribute. Nothing at all rather than false, because
 * inert is not one of the attributes Vue knows to take off an element on a
 * false — written out as the string "false" it is every bit as inert as it is
 * written out as anything else.
 *
 * It shuts the fittings and the emote corner as well as the chrome: both are
 * hardware set into the table, and neither is reachable while something stands
 * over it. A turn being called is not one of those — it is read and not
 * answered, and nothing about turning the music down or looking up the rules
 * bears on whose turn it is.
 */
const behindOverlay = computed<true | undefined>(() => overlayShowing.value || undefined)

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

/**
 * Whether the table's own chrome is on screen, which is when there is something
 * to say and somebody to say it to.
 *
 * The two corners the emotes live in are laid over the table rather than in the
 * column the rail and the buttons share, so they cannot be raised by the same
 * branch the chrome is. This is that branch, said once.
 */
const atTable = computed<boolean>(() => !unreadable.value && !showWaiting.value)

/**
 * Whether anything is standing on the line across the bottom of the table.
 *
 * The emotes sit on that line while it is clear and are lifted off it while it
 * is not, rather than being held permanently above a band that is usually empty.
 * Three things can take it: the Pass button, the way back to the lobby once a
 * finished match has been acknowledged, and the line a refused write is said on.
 *
 * That third one never stands on the bottom row of emotes — it is set a little
 * higher than one, and grows upwards from there rather than down — but it does
 * cross the second row and everything above it, which is reason enough. It is
 * also never cleared once written, so on the narrow tables where this answer is
 * acted on at all the emotes stay lifted for the rest of the match. That is the
 * right way round: what is standing in the gap is the line itself.
 */
const bottomLineTaken = computed<boolean>(
  () => error.value !== ''
    || canPass.value
    || (finished.value && acknowledgedEnd.value),
)

/**
 * The rail, as the rows it is drawn in: the seats still in the match, then the
 * ones out of it, cut into rows of RAIL_SEATS_PER_ROW.
 *
 * Filled a row at a time, so the rows above the last are always full and a last
 * row of one hangs under the seat above it on a rail that packs to the right.
 *
 * The seats out are set after the seats still in rather than left where they
 * play. Who is left is a fact about the match, so a spent seat keeps its pill —
 * but the rail is otherwise in play order, and that order stops meaning
 * anything the moment a seat is skipped, so the ones with nothing left to throw
 * are moved out of the run rather than left as gaps in it. Ordered here rather
 * than by the stylesheet, because the rows are cut from this sequence: CSS
 * could only reorder seats inside the rows it had already been handed.
 */
const railRows = computed<MatchPlayer[][]>(() => {
  const players = state.value?.players ?? []
  const ordered = [
    ...players.filter((player) => !isOut(player)),
    ...players.filter((player) => isOut(player)),
  ]
  const rows: MatchPlayer[][] = []

  for (let i = 0; i < ordered.length; i += RAIL_SEATS_PER_ROW) {
    rows.push(ordered.slice(i, i + RAIL_SEATS_PER_ROW))
  }

  return rows
})

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

// The emotes belong to the table, so they go away with it. Anything standing over
// the match shuts this corner along with the fittings opposite, and a set of
// glyphs left open inside an inert layer is a panel nobody can put away, over a
// card that is asking something. Closed bare, without handing the keyboard back:
// whatever raised the layer is owed the focus, and the watcher below gives it.
watch(behindOverlay, (shut) => {
  if (shut) {
    picking.value = false
  }
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
// question being asked rather than left on the layer just shut behind it. The
// rules are put away first: they are the one layer here that was opened rather
// than raised by the match, and a card arriving under them — the back button,
// the last of this player's dice, the match itself ending — is a question that
// owns the screen.
watch(noticeShowing, (showing) => {
  if (!showing) {
    return
  }

  showRules.value = false

  void nextTick(() => {
    notice.value?.querySelector('button')?.focus()
  })
})

// Music belongs to play rather than to the waiting room, and is left running
// through the final card so that the end of the match does not turn silent.
watch(playing, (started) => {
  if (started) {
    matchAudio.startMusic()
  }
})

// In a match with more than two seats, defeat can be known before the match is
// over. That first notice owns the sound; the final card must not play it again.
watch(showLoss, (showing) => {
  if (!showing || lossSoundPlayed) {
    return
  }

  matchAudio.playLost()
  lossSoundPlayed = true
})

// A leave question can stand over the final card and uncover it again. The
// card still belongs to one match ending, so its sound is guarded separately.
watch(showEnd, (showing) => {
  const match = state.value

  if (!showing || endSoundPlayed || match === null) {
    return
  }

  if (match.winner === uid.value) {
    matchAudio.playWin()
  } else if (!lossSoundPlayed) {
    matchAudio.playLost()
    lossSoundPlayed = true
  }

  endSoundPlayed = true
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
  // Held before the match is replaced, because the turn is what names the seat
  // that threw and the verdict below is the write that moves it on
  const previous = state.value

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
  judgedVerdict = next.verdict

  // Read off the turn as it stood before this verdict rather than off the throw
  // that made it. A throw does not move the turn — only the verdict does — so
  // the seat the turn was sitting on is the seat that threw, whoever published
  // it and whether or not this browser ever saw the throw itself. Taken from
  // the record instead, it would be missing in every view that did not animate
  // the throw: the throws beneath a match are delivered to every player but the
  // one whose identifier they carry, and an origin's tabs share one identifier,
  // so the view playing the bots in a match being played in another tab is told
  // nothing at all. What it answered with instead was a seat holding no dice,
  // which reads as an elimination to everything that asks.
  lastThrower = previous?.players[previous.turnIndex]?.uid ?? ''

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

/**
 * Lets the bots answer the throw the table has just watched being judged.
 *
 * Answered here rather than when the verdict landed, because a verdict lands
 * before its dice have been taken out of the bowl: a bot remarking then would be
 * talking over the thing it is remarking on. This is the moment the bowl it
 * describes is actually on the table.
 *
 * One voice per throw, drawn from whichever bots are not still quiet from the
 * last thing they said. A whole table answering one flush at once is a wall of
 * glyphs rather than a table talking, and the log would spend its four rows on a
 * single moment.
 *
 * Only ever from the view holding the bot seats, like every other move made for
 * them: a browser's tabs share the identity those seats were taken under, so two
 * views of one match would otherwise each speak for every bot at it. A write
 * that is refused is dropped in silence, because nobody pressed anything — the
 * line the player's own refusals are said on is for presses they made.
 */
function runBotEmotes(): void {
  const match = state.value
  const connected = client
  const resolution = judgedVerdict

  if (match === null || connected === null || resolution === null || !botDriver.value) {
    return
  }

  // Spent as it is read. Nothing fires this twice for one verdict, and a stale
  // one answered a second time would have the table remarking on a bowl that is
  // no longer in front of it.
  judgedVerdict = null

  const now = performance.now()
  const speaking: {seat: string,
    emote: number}[] = []

  for (const seat of match.players) {
    if (!seat.bot || (botEmoteQuiet.get(seat.uid) ?? 0) > now) {
      continue
    }

    const sent = nextBotEmote(match, seat.uid, resolution, lastThrower)

    if (sent !== null) {
      speaking.push({
        seat: seat.uid,
        emote: sent,
      })
    }
  }

  // Drawn rather than taken in seat order, so that the bot sitting first is not
  // the one who answers every throw the whole table had something to say about
  const chosen = speaking[Math.floor(Math.random() * speaking.length)]

  if (chosen === undefined) {
    return
  }

  const quiet = BOT_EMOTE_QUIET_MINIMUM
    + Math.random() * (BOT_EMOTE_QUIET_MAXIMUM - BOT_EMOTE_QUIET_MINIMUM)

  botEmoteQuiet.set(chosen.seat, now + quiet)

  connected.sendEmote(chosen.emote, chosen.seat).catch((reason: unknown) => {
    // Nobody pressed anything, so nothing is owed the screen — but a bot writing
    // under a seat that is not the one this browser signed in as is the one write
    // here a store could single out, and swallowed outright it would fail in
    // perfect silence. Said where the emotes that cannot be followed are said.
    console.error('A bot could not say anything.', reason)
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

function onToggleMusic(): void {
  const enabled = !musicEnabled.value

  matchAudio.setMusicEnabled(enabled)
  musicEnabled.value = enabled
}

function onToggleEffects(): void {
  const enabled = !effectsEnabled.value

  matchAudio.setEffectsEnabled(enabled)
  effectsEnabled.value = enabled
}

/**
 * Puts an emote on screen for its three seconds.
 * @param seat - Who said it
 * @param sent - Which of EMOTES they said
 */
function showEmote(seat: MatchPlayer, sent: number): void {
  emoteArrival++

  const row: EmoteRow = {
    key: emoteArrival,
    name: seat.name,
    color: seat.color,
    emote: sent,
    expires: performance.now() + EMOTE_ROW_MILLISECONDS,
  }

  emoteRows.value = [
    ...emoteRows.value,
    row,
  ].slice(-EMOTE_ROWS)

  trimEmoteRows()
}

/**
 * Takes off the rows whose time is up, and puts the next trim on the clock.
 *
 * One timer for the whole list rather than one per row. Every row is given the
 * same length and rows are appended in the order they arrive, so the first of
 * them is always the next to go and there is never a later one to wait on.
 */
function trimEmoteRows(): void {
  const now = performance.now()

  emoteRows.value = emoteRows.value.filter((row) => row.expires > now)

  window.clearTimeout(emoteRowTimer)

  const earliest = emoteRows.value[0]

  if (earliest !== undefined) {
    emoteRowTimer = window.setTimeout(trimEmoteRows, earliest.expires - now)
  }
}

/**
 * Takes somebody else's emote.
 *
 * Dropped outright while the page is hidden, which is the same answer the
 * priming in the client gives and for the same reason: an emote is three
 * seconds of somebody reacting, and somebody who was not looking has missed it
 * rather than being owed it. What it actually buys is more than manners. A
 * hidden page is given no animation frames, so the transition taking a row off
 * screen never finishes and Vue leaves the element in the page — a match left
 * open in a background tab would collect one invisible row per emote for as long
 * as it sat there, and hand the lot of them back at once on the way in.
 * @param record - The emote, as they sent it
 */
function onEmote(record: EmoteRecord): void {
  if (document.visibilityState === 'hidden') {
    return
  }

  const seat = state.value?.players.find((player) => player.uid === record.uid)

  // An emote from nobody at this table. Nothing above this refuses a write from
  // outside the match, and a row with no seat behind it has no name to carry and
  // nothing anybody here would recognise.
  if (seat === undefined) {
    return
  }

  showEmote(seat, record.emote)
}

/**
 * Says something to the table, and says it here at once.
 *
 * Shown before the write rather than after it, so that what answers the press is
 * the press rather than the round trip. Left standing if that write is refused,
 * which is the one place this deliberately parts company with a throw: dice no
 * other player has are a table two people disagree about, and a glyph no other
 * player saw is gone in three seconds either way. The refusal is still said, on
 * the line every other refused write is said on.
 * @param sent - Which of EMOTES to say
 */
function onSendEmote(sent: number): void {
  const connected = client
  const seat = state.value?.players.find((player) => player.uid === uid.value)

  if (connected === null || seat === undefined || cooling.value) {
    return
  }

  // Put away through the same door a press outside uses, so the keyboard that
  // was on the glyph lands back on the button rather than on the document. That
  // is only possible because the wait leaves the button focusable: taken off it
  // outright, focus would be handed to a disabled element and dropped.
  closePicker()

  showEmote(seat, sent)
  startEmoteCooldown()

  connected.sendEmote(sent, seat.uid).catch((reason: unknown) => {
    error.value = describe(reason)
  })
}

/**
 * Holds the button for five seconds and draws the wait around its own rim.
 *
 * The arc is painted full for a frame before it is told to empty, because a
 * property that has never been painted at its starting value has nothing to
 * transition from and would simply appear already empty. Waited for rather than
 * assumed: the arc does not exist until Vue has patched the button, which is a
 * microtask away, and a frame asked for before that would find nothing there.
 */
function startEmoteCooldown(): void {
  cooling.value = true
  sweeping.value = false

  window.clearTimeout(emoteCooldownTimer)
  emoteCooldownTimer = window.setTimeout(() => {
    cooling.value = false
  }, EMOTE_COOLDOWN_MILLISECONDS)

  window.cancelAnimationFrame(emoteSweepFrame)

  void nextTick(() => {
    emoteSweepFrame = window.requestAnimationFrame(() => {
      sweeping.value = true
    })
  })
}

/**
 * Puts the emotes away and gives the button back whatever focus it was holding.
 *
 * The same answer the lobby's palette gives, and for the same reason: the set is
 * dropped from the page rather than hidden, so closing it while a glyph is
 * focused destroys the focused element and focus falls to the document — where
 * the next tab starts again from the top and nothing has said the emotes closed.
 */
function closePicker(): void {
  const wasInside = emotePicker.value?.contains(document.activeElement) ?? false

  picking.value = false

  if (wasInside) {
    void nextTick(() => {
      emoteButton.value?.focus()
    })
  }
}

/**
 * Closes the emotes when the next press lands outside them.
 *
 * Bound on the window rather than on a backdrop, exactly as the lobby binds it,
 * so the press that closes them still reaches whatever it was aimed at — a player
 * going from the emotes straight to Pass presses it once and not twice. What that
 * costs in the lobby is nothing, and what it would cost here is the table: a
 * press falling through to the canvas is an aim, and two of them inside the
 * double-press window is the whole hand dropped into the bowl unasked. Shutting
 * the gesture for as long as these are open is what makes letting it through safe.
 *
 * Bound in the capture phase, which the lobby's does not have to be. The music
 * switch stops every press it is given — `match_audio.ts` listens for one on the
 * window to answer a browser that refused to start the music, and a press meant
 * for the switch is not the gesture that retry is waiting on — so on the way up
 * this would never hear the one control on screen that swallows it, and the
 * emotes would stay open over the table with the throw gesture shut behind them.
 * The same trap `onKeyDown` is bound ahead of, for the same switch.
 *
 * Ahead of the canvas rather than behind it now, which changes nothing that
 * matters: the watcher that reopens the gesture is a pre-flush job and the whole
 * dispatch is one task, so the press that closes these still meets a table whose
 * gesture is shut, and is still spent rather than thrown.
 * @param event - The press, wherever it landed
 */
function onPressAnywhere(event: PointerEvent): void {
  const inside = event.target instanceof Node && emotePicker.value?.contains(event.target) === true

  if (!inside) {
    picking.value = false
  }
}

/**
 * Lays the emotes out, or puts them away again.
 *
 * Refused outright while the wait is running, rather than laid out with nothing
 * in them that can be pressed. A tray a player can open and choose nothing from
 * is a tray that reads as broken; the arc on the button is already saying why.
 */
function onToggleEmotes(): void {
  if (cooling.value) {
    return
  }

  picking.value = !picking.value
}

function onKeepWatching(): void {
  acknowledgedLoss.value = true
}

function onStay(): void {
  acknowledgedEnd.value = true
}

/**
 * Puts the rules away and gives the fitting that opened them the keyboard back.
 *
 * The sheet is dropped from the page rather than hidden, so closing it destroys
 * whatever inside it was holding focus, and focus falls to the document — where
 * the next tab starts again from the top and nothing has said the rules closed.
 */
function closeRules(): void {
  showRules.value = false

  void nextTick(() => {
    rulesButton.value?.focus()
  })
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
 * The whole surface rather than the flat colour under it, because the rail is
 * where the skins are told apart from one another: bone, marble, pearl and ice
 * are four different dice and one pale dot.
 * @param player - The seat to paint
 * @returns The skin, as CSS, and the name for anything reading the rail out
 */
function colorOf(player: MatchPlayer): {surface: string,
  name: string} {
  return {
    surface: dieSkinCss(player.color).surface,
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
    opened.listen(onState, onThrow, onEmote, onLost, onSnag)
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
 * Asks the device not to put its screen out while the match is on it.
 *
 * A match is watched far more than it is touched: a player waiting on three
 * other people to throw goes minutes without pressing anything, which is about
 * how long a phone waits before it sleeps. So the lock is held over the whole
 * screen rather than over this player's own turn, since the waiting is the part
 * that needs it.
 *
 * Every way it can fail leaves a match that plays exactly as it did before, and
 * none of them is worth a word on the screen: a browser that has never heard of
 * the lock, one that refuses because the page was hidden at the moment of
 * asking, and one that gives it up again under battery saver.
 */
async function holdScreenAwake(): Promise<void> {
  // Nothing to do for a browser without the API, for a lock still holding the
  // screen, or for one already being asked for — two requests would leave the
  // first sentinel held by nothing that could ever release it.
  //
  // The sentinel is asked whether it is still holding rather than merely being
  // there, because the browser takes a lock back on its own and the event
  // saying so is a separate errand. Trusted to have arrived first, a page
  // coming back to a sentinel that is already spent would take itself for
  // covered and never ask again.
  if (typeof navigator.wakeLock === 'undefined' || askingScreenAwake) {
    return
  }

  if (screenWakeLock !== null && !screenWakeLock.released) {
    return
  }

  askingScreenAwake = true

  try {
    const sentinel = await navigator.wakeLock.request('screen')

    // Handed straight back for a screen that has gone while the request was in
    // the air: the teardown that would have released it has already run
    if (unmounted) {
      await sentinel.release()

      return
    }

    screenWakeLock = sentinel

    // The browser takes the lock back on its own whenever the page is hidden,
    // and says so here. Forgotten at that point so that the page coming back
    // asks for it again rather than believing it still holds one.
    sentinel.addEventListener('release', () => {
      if (screenWakeLock === sentinel) {
        screenWakeLock = null
      }
    })
  } catch {
    // Refused. Asked again the next time the page is shown.
  } finally {
    askingScreenAwake = false
  }
}

/**
 * Answers Escape with the same question the back button is answered with.
 *
 * Bound on the window, because the match is a canvas and a scrim: there is
 * usually nothing focused for the press to travel up from. Three things get it
 * first, and each of them is already an answer to the same press — the rules
 * sheet, which closes on it; a card that is already asking something; and an
 * aim mid-drag, which `ThrowController` abandons on it. A turn being called is
 * not among them: it is read rather than answered, so a press it was never
 * aimed at goes to the match like any other.
 *
 * Bound in the capture phase, which is what makes the last of those true, and
 * what gets this press here at all. The controller's own listener is on the
 * window as well and is added first, in the scene's constructor, so on the way
 * up it would have cancelled the aim this asks about before it could be asked —
 * the guard would read an aim that had just stopped existing and open the card
 * anyway. And the music switch stops every keydown it is given, to keep the
 * press that works it from spending the gesture the autoplay retry is waiting
 * on; on the way up that would swallow this press on one of four neighbouring
 * controls and no other. Capture is ahead of both. What it costs is that
 * nothing below can take Escape by stopping it any more — a control that wants
 * it has to be named in the guards above instead.
 *
 * The emotes are answered here rather than deferred to, unlike those three.
 * They are the nearest thing a player has open, so the press closes them and
 * stops — asking about leaving the match in the same breath would answer a
 * press nobody aimed at the match. Their own handlers cover the keyboard that
 * is inside them; this covers the far commoner case of a set opened by a thumb,
 * where the press has nothing to travel up from.
 *
 * A finished or unreadable match is left alone for the same reason the back
 * button leaves it alone: there is nothing to walk out of, and the card on
 * screen already leads to the lobby.
 * @param event - The key pressed, wherever it landed
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || showRules.value || noticeShowing.value) {
    return
  }

  if (picking.value) {
    closePicker()

    return
  }

  if (finished.value || unreadable.value || scene?.isAiming === true) {
    return
  }

  showLeave.value = true
}

/**
 * Asks for the lock again once the page is being looked at again.
 *
 * The browser gives no lock to a page nobody can see and takes back the one it
 * had — a call answered, the phone put face down — so coming back to the match
 * is the moment to ask for another.
 */
function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    void holdScreenAwake()
  }
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
  scene.onRollImpact = (impact) => {
    if (impact === 'single') {
      matchAudio.playRollSingle()
    } else {
      matchAudio.playRollMultiple()
    }
  }
  scene.onVerdictBeat = (beat, resolution) => {
    if (beat === 'fail') {
      matchAudio.playFail()

      return
    }

    const kind = returnedDiceKind(resolution)

    if (kind === 'flush') {
      matchAudio.playFlush()
    } else if (kind === 'pair') {
      matchAudio.playPair()
    }
  }
  scene.onResolved = () => {
    resolving.value = false
    runBotEmotes()
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

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('pointerdown', onPressAnywhere, true)
  void holdScreenAwake()
})

onBeforeUnmount(() => {
  unmounted = true

  window.clearTimeout(copiedTimer)
  window.clearTimeout(takeoverTimer)
  window.clearTimeout(turnCallTimer)
  window.clearTimeout(botTimer)
  window.clearTimeout(emoteCooldownTimer)
  window.clearTimeout(emoteRowTimer)
  window.cancelAnimationFrame(emoteSweepFrame)
  releaseBotSeats?.()
  releaseBotSeats = null
  botDriver.value = false
  client?.dispose()
  client = null
  scene?.dispose()
  scene = null
  matchAudio.dispose()

  // Last, behind the connection and the scene. Nothing above it needs the
  // screen awake, and everything above it matters more than whether this
  // browser's own release call comes back.
  document.removeEventListener('visibilitychange', onVisibilityChange)
  // The phase has to match the one it was added in, or the listener is left behind
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('pointerdown', onPressAnywhere, true)

  // Handed back rather than left to the page, since a match is left far more
  // often than the tab it was open in is closed
  void screenWakeLock?.release().catch(() => {
    // Already gone, which is the outcome either way
  })

  screenWakeLock = null
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

    <!-- Direct switches rather than a settings drawer: sound is adjusted in the
         moment, and neither choice is buried behind another press. The two
         rules buttons are set apart from that pair in a fitting of their own,
         because what they do is not something about the table being altered:
         one says how the game is played and the other what this table plays
         by, and a player reaches for either while the bowl sits still. -->
    <div v-if="!unreadable" class="table-controls" :inert="behindOverlay">
      <div class="table-controls__row">
        <div class="fitting" role="group" aria-label="Audio">
          <button
            type="button"
            class="fitting__button"
            :class="{'fitting__button--off': !musicEnabled}"
            aria-label="Background music"
            :aria-pressed="musicEnabled"
            :title="musicEnabled ? 'Turn music off' : 'Turn music on'"
            @pointerdown.stop
            @keydown.stop
            @click="onToggleMusic"
          >
            <svg class="fitting__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 17V5l10-2v12" />
              <circle cx="6.5" cy="17.5" r="2.5" />
              <circle cx="16.5" cy="15.5" r="2.5" />
              <path v-if="!musicEnabled" class="fitting__slash" d="M4 4l16 16" />
            </svg>
          </button>

          <button
            type="button"
            class="fitting__button"
            :class="{'fitting__button--off': !effectsEnabled}"
            aria-label="Sound effects"
            :aria-pressed="effectsEnabled"
            :title="effectsEnabled ? 'Turn sound effects off' : 'Turn sound effects on'"
            @click="onToggleEffects"
          >
            <svg class="fitting__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              <template v-if="effectsEnabled">
                <path d="M16 9.5a4 4 0 0 1 0 5" />
                <path d="M18.5 6.5a8 8 0 0 1 0 11" />
              </template>
              <path v-else class="fitting__slash" d="M4 4l16 16" />
            </svg>
          </button>
        </div>

        <div class="fitting" role="group" aria-label="Rules">
          <button
            ref="rulesButton"
            type="button"
            class="fitting__button"
            aria-label="How to play"
            title="How to play"
            @click="showRules = true"
          >
            <svg class="fitting__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.6 9.4a3.4 3.4 0 1 1 3.4 3.4v1.7" />
              <circle cx="12" cy="17.9" r="0.9" fill="currentColor" stroke="none" />
            </svg>
          </button>

          <!-- Held back with the plate it opens, rather than standing over the
               wait with nothing to answer a press with -->
          <button
            v-if="state !== null && !showWaiting"
            type="button"
            class="fitting__button"
            aria-label="Match rules"
            :aria-expanded="showConfig"
            :title="showConfig ? 'Hide match rules' : 'Show match rules'"
            @click="showConfig = !showConfig"
          >
            <!-- The plate itself, with its two rows stamped on it: what the
                 button opens is what the button is drawn as. -->
            <svg class="fitting__icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
              <path d="M7.5 10.25h9" />
              <path d="M7.5 13.75h5" />
            </svg>
          </button>
        </div>
      </div>

      <!-- What this table plays by. Both are settled when the match is made
           and never written again, and neither can be read off the bowl: a
           player who joined by code has no other way of knowing whether three
           of a kind is a group or whether the flush is in.

           Behind the button beside the sheet's, because it is read once and
           then in the way — two lines that answer a question nobody asks twice,
           standing over the corner of the table for the rest of the match. The
           press that opened the plate puts it away again. The sheet next to it
           stays the game rather than this match, which is what lets the lobby
           open the same one.

           A plate rather than a run of buttons, because there is nothing here
           to press: what the button did was answer, and this is the answer.

           Held back until the seats are full, along with the button that opens
           it. The card that waits for them is centred and grows with every
           seat, so on a phone it reaches up into this corner — and the plate,
           which is drawn over it, would stand across the match code, which is
           the one thing that screen exists to show. -->
      <dl v-if="showConfig && state !== null && !showWaiting" class="placard">
        <dt class="label">Groups</dt>

        <!-- A figure rather than dice, the way the rail says a hand: dice drawn
             on a plate over the table would read as dice in play. The lobby
             draws this same number as dice because there it is the choice
             rather than the answer. -->
        <dd class="placard__answer">{{ state.groupSize }}</dd>

        <dt class="label">Flush</dt>

        <!-- The one rule a match can turn off, and the one with no picture:
             what is switched off is a hand nobody plays, and a hand nobody
             plays cannot be drawn. So it is named, in the lobby's own words. -->
        <dd
          class="placard__answer"
          :class="{'placard__answer--off': !state.flush}"
        >
          {{ state.flush ? 'ON' : 'OFF' }}
        </dd>
      </dl>
    </div>

    <!-- Mounted from the first frame and merely covered while the seats fill,
         so the wait for the last player is also the wait for the physics.

         Hidden rather than dropped while the question about leaving is up: it
         is the wait that decides which chrome exists, and the two scrims over
         one another only muddy the card that is being answered. -->
    <div v-if="showWaiting" v-show="!showLeave" :inert="behindOverlay" class="waiting">
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

    <div v-else-if="!unreadable" :inert="behindOverlay" class="chrome">
      <header class="chrome__top">
        <!-- A list for each row rather than one list that wraps, because a row
             is what keeps its two pills against the right edge with the one gap
             between them: a rail laid out in columns instead would either
             stretch the pills to the widest name on it or open a different gap
             on every row. Keyed by position, so a row stays the row it was and
             only the seats on it change. -->
        <div class="rail">
          <ul
            v-for="(row, index) in railRows"
            :key="index"
            class="rail__row"
          >
            <li
              v-for="player in row"
              :key="player.uid"
              class="rail__player"
              :class="{
                'rail__player--active': !finished && player.uid === activePlayer?.uid,
                'rail__player--out': isOut(player),
              }"
            >
              <span
                class="rail__swatch"
                :style="{background: colorOf(player).surface}"
                :title="colorOf(player).name"
              />

              <span class="rail__name">{{ player.name }}</span>

              <!-- Counted while there is a hand to count. The nought at the end
                   is the one figure worth nothing: the struck-through name has
                   already said it, and a rail of them reads as a column of
                   noughts rather than as the players still in.

                   Keyed on the count so the element is rebuilt whenever it
                   changes, which is what replays the flare. Dice leaving a hand
                   and coming back to it is the whole game, and it happens off
                   screen. -->
              <span
                v-if="!isOut(player)"
                :key="handOf(player)"
                class="rail__hand"
              >{{ handOf(player) }}</span>
            </li>
          </ul>
        </div>
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

    <!-- What the table has just said, in the corner nothing else claims. A log
         rather than a flourish: an emote is worth nothing without knowing who
         sent it, so each one arrives on the rail's own pill, with the rail's own
         swatch and name, at the far end of the screen from it. Newest at the
         bottom, nearest the button that sends them.

         Never pressed, so it never takes the pointer — a drag that begins over
         one still reaches the bowl, exactly as it does over the chrome.

         Before the corner below it in the page, so that a tray of glyphs being
         chosen from cleanly covers whatever a row behind it was saying rather
         than interleaving with it. -->
    <TransitionGroup
      v-if="atTable"
      tag="ul"
      name="said"
      class="emote-log"
      :class="{'emote-log--lifted': bottomLineTaken}"
      role="log"
      aria-live="polite"
    >
      <li v-for="row in emoteRows" :key="row.key" class="emote-log__row">
        <span
          class="emote-log__swatch"
          :style="{background: dieSkinCss(row.color).surface}"
        />

        <span class="emote-log__name">{{ row.name }}</span>

        <span
          class="emote-log__glyph"
          role="img"
          :aria-label="emote(row.emote).name"
        >{{ emote(row.emote).glyph }}</span>
      </li>
    </TransitionGroup>

    <!-- The corner opposite the table's own switches, and deliberately the same
         hardware in it: one more fitting set into the same table, rather than a
         new kind of control. It is down here because it is pressed while the
         dice are being watched, which is what the thumb is already near, and
         because the corner above carries a figure the rail has to hold clear of.

         The glyphs are laid out in a tray that slides out of it, and nothing
         about them is named in words — six pictures in a well, the way the
         lobby lays its sixteen dice out in one. -->
    <div v-if="atTable" class="emote-controls" :inert="behindOverlay">
      <div ref="emotePicker" class="emote">
        <ul v-if="picking" class="emote__set" @keydown.esc="closePicker">
          <li v-for="(option, index) in EMOTES" :key="option.glyph">
            <button
              type="button"
              class="emote__option"
              :aria-label="option.name"
              :title="option.name"
              @click="onSendEmote(index)"
            >
              {{ option.glyph }}
            </button>
          </li>
        </ul>

        <div class="fitting">
          <button
            ref="emoteButton"
            type="button"
            class="fitting__button emote__button"
            aria-label="Say something"
            :aria-expanded="picking"
            :title="cooling ? 'Wait a moment' : 'Say something'"
            :aria-disabled="cooling"
            @keydown.esc="closePicker"
            @click="onToggleEmotes"
          >
            <svg class="fitting__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16h-.5A2.5 2.5 0 0 1 4 13.5v-7A2.5 2.5 0 0 1 6.5 4z"
              />
            </svg>

            <!-- The wait, drawn around the button's own rim rather than said in
                 words. It empties rather than fills, so what is left of the ring
                 is what is left of the wait. -->
            <svg v-if="cooling" class="emote__wait" viewBox="0 0 44 44" aria-hidden="true">
              <circle
                class="emote__arc"
                :class="{'emote__arc--spent': sweeping}"
                cx="22"
                cy="22"
                r="20.5"
                pathLength="100"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Whose turn it is is the one thing the table cannot say for itself: the
         rail lights the new seat, but a player watching the bowl never sees it
         happen. Called in the middle of the screen, over the bowl, and answered
         by nobody — it stands over the table for a beat without taking it, so
         a player who wants to watch the bowl from another angle while reading
         it still can.

         Under the cards below rather than over them, so that a question already
         being asked keeps both the screen and the presses that answer it. -->
    <Transition name="call">
      <div v-if="calling" class="call" role="status">
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

    <!-- Last, over every layer the match raises for itself. It is the one
         thing on this screen a player opened rather than was shown, and the
         watcher above takes it away again the moment the match has something
         to ask. -->
    <RulesSheet v-if="showRules" @close="closeRules" />
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

/* Set into the table's empty upper-left corner, where the wells read as
   hardware belonging to the table rather than as floating app chrome, and leave
   the upper-right to the players the rail already names.

   The switches on top and the plate under them: everything in the row can be
   altered, and nothing on the plate can be — which is why the corner passes
   the pointer on and the fittings take it back, the arrangement the chrome
   opposite is built on. The table is behind all of this, and a press that
   lands on a thing with nothing to press is a press meant for the bowl. */
.table-controls {
    position: absolute;
    z-index: 1;
    top: calc(1.25rem + env(safe-area-inset-top, 0px));
    left: calc(1.25rem + env(safe-area-inset-left, 0px));
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    pointer-events: none;
}

/* Two fittings rather than one run of four: the pair on the left alter the
   table, and the pair beside them only say things about it. */
.table-controls__row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
}

/* What the corner takes its room from is the rail across the top. Stacked, the
   corner is one fitting wide rather than two — and the plate, which is opened
   under them, is wider than one of them, so from this width on it is the plate
   the rail has to clear. */
@media (width < 28rem) {
    .table-controls__row {
        flex-direction: column;
    }
}

/* The plate the table's own rules are stamped on. Cut from the same dark
   walnut and brass as the fittings above it, and square where they are round:
   a fitting is a thing to press, and this is a thing to read. */
.placard {
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    gap: 0.375rem 0.625rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--brass-edge);
    border-radius: 0.5rem;
    background: rgb(18 11 6 / 78%);
    box-shadow:
        inset 0 1px 0 rgb(200 164 104 / 18%),
        0 0.5rem 1.25rem rgb(0 0 0 / 24%);
}

/* Brass for a rule this match plays, which is the colour everything in play
   is named in here — the hand worth counting, the button worth pressing. */
.placard__answer {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--brass);
}

/* And faded for one it does not. Not struck through: the rail already spends
   that on a player who is out, and a rule nobody chose to play was never in. */
.placard__answer--off {
    color: var(--bone-faint);
}

.fitting {
    display: flex;
    gap: 0.25rem;
    padding: 0.25rem;
    pointer-events: auto;
    border: 1px solid var(--brass-edge);
    border-radius: 999px;
    background: rgb(18 11 6 / 78%);
    box-shadow:
        inset 0 1px 0 rgb(200 164 104 / 18%),
        0 0.5rem 1.25rem rgb(0 0 0 / 24%);
}

.fitting__button {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--brass-glow);
    color: var(--brass);
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease;
}

.fitting__button:hover {
    background: rgb(200 164 104 / 20%);
}

/* A switch that has been turned off. Nothing here but the two audio ones can
   be, so the state belongs to the button rather than to either of them. */
.fitting__button--off {
    background: transparent;
    color: var(--bone-faint);
}

.fitting__icon {
    width: 1.25rem;
    height: 1.25rem;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.fitting__slash {
    color: var(--ember);
    stroke-width: 2;
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

/* Held off the corner opposite, and the figure is whatever is widest down
   there: the rail stacks downwards past all of it. That is the two fittings
   side by side, until they stack — under which the plate is the widest thing
   instead, and it is wider than one fitting on its own. Room kept for the
   plate whether or not it is out, because the press that opens it is not a
   press the rail above can be asked to reflow for. */
.chrome__top {
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    gap: 1rem;
    padding-left: calc(13.75rem + env(safe-area-inset-left, 0px));
}

@media (width < 28rem) {
    .chrome__top {
        padding-left: calc(7.75rem + env(safe-area-inset-left, 0px));
    }
}

/* The rows stack downwards from the corner, which is the direction the corner
   opposite keeps its room in */
.rail {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.5rem;
    min-width: 0;
    max-width: 100%;
}

/* Its own line, so the two pills on it hold the one gap between them and sit
   against the right edge whatever the names on them come to. Narrow enough and
   they shrink into it rather than reflowing, which is the truncation the names
   are already drawn for: where a seat is on the rail stays put. */
.rail__row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    min-width: 0;
    max-width: 100%;
    list-style: none;
}

/* Below the width where two pills cannot hold even their own furniture, the
   second one drops to a line of its own. Two pills floor at 9.55rem — the
   paddings, the swatches, the gaps and the counts, with the names already
   shrunk to nothing — and the rail is given the screen less the 10.25rem the
   corner opposite and the chrome's insets take, so 20rem of table is the last
   width at which the pair still fits. Under it the pills would keep shrinking
   and stand their figures outside the lozenges they belong to.

   Inert above this, and the query has to stay narrow to be: flex wraps on the
   names rather than on the furniture, so one set any wider would put the rail
   back to a seat a row at every phone width. A single pill still spills below
   about 15rem, exactly as it did before the rail was laid out in rows. */
@media (width < 20rem) {
    .rail__row {
        flex-wrap: wrap;
    }
}

.rail__player {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-width: 0;
    max-width: 100%;
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
    min-width: 0;
    overflow: hidden;
    font-size: 0.8125rem;
    text-overflow: ellipsis;
    white-space: nowrap;
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
   Where it is kept is railRows' to say, since the rows are cut from the order
   that puts the seats in. */
.rail__player--out {
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
   Saying something
   ============================================ */

/* Set into the corner opposite the table's own switches, and built the same way:
   a layer that passes the pointer on, with the hardware in it taking it back. The
   table is behind all of it, and a press that lands on nothing is a press meant
   for the bowl.

   The vertical inset is the chrome's own padding rather than the safe area the
   corner above uses, because this button stands beside the Pass button and has to
   sit on the same line as it. The horizontal one is the safe area, since nothing
   is beside it that way. */
.emote-controls {
    position: absolute;
    z-index: 1;
    right: calc(1.25rem + env(safe-area-inset-right, 0px));
    bottom: 1.25rem;
    pointer-events: none;
}

/* The glyphs hang off this rather than off the corner, so they are placed against
   the button they came out of and not against the screen. The lobby hangs its
   colours the same way, from the other end. */
.emote {
    position: relative;
}

/* Holds the wait drawn over it. Nothing else about it differs from the switches
   opposite, which is the point of it. */
.emote__button {
    position: relative;
}

/* Spent rather than switched off, and the two must not read alike: the audio
   switches go to bone when they are turned off, and this stays brass — dimmed,
   with the arc around it saying how long for.

   Said with aria-disabled rather than taken off the button outright, because the
   press that spends it is made from inside the tray it closes: focus has to land
   back on this button, and focus handed to a disabled element is focus dropped on
   the floor. What refuses the press is the guard in `onToggleEmotes`. */
.emote__button[aria-disabled='true'] {
    color: var(--brass-edge);
    cursor: default;
}

/* A tray of glyphs drawn out of the fitting, cut from the same walnut and brass
   and carrying the same pair of shadows. Squarer than the pill it comes out of,
   because six things laid three by two is a tray and not a switch. */
.emote__set {
    position: absolute;
    right: 0;
    bottom: calc(100% + 0.5rem);
    display: grid;
    grid-template-columns: repeat(3, auto);
    gap: 0.25rem;
    padding: 0.375rem;
    border: 1px solid var(--brass-edge);
    border-radius: 1.25rem;
    background: rgb(18 11 6 / 78%);
    pointer-events: auto;
    list-style: none;
    box-shadow:
        inset 0 1px 0 rgb(200 164 104 / 18%),
        0 1rem 2rem rgb(0 0 0 / 55%);

    /* Drawn out of the button rather than faded in, so it reads as the tray being
       pulled rather than as a panel arriving over the table */
    transform-origin: bottom right;
    animation: emotes-opened 140ms ease-out;
}

@keyframes emotes-opened {
    from {
        transform: scale(0.9) translateY(0.25rem);
        opacity: 0;
    }

    to {
        transform: scale(1) translateY(0);
        opacity: 1;
    }
}

/* Cut into the tray the way the lobby's fields are cut into their card: the same
   well, the same rim on hover. What sits in it is the one thing in this interface
   drawn in colours it did not choose, which is the whole reason everything around
   it is walnut, brass and bone and nothing else. */
.emote__option {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 0.75rem;
    background: var(--well);
    font-size: 1.375rem;
    line-height: 1;
    cursor: pointer;
    transition: border-color 160ms ease, background 160ms ease;
}

.emote__option:hover {
    border-color: var(--brass-edge);
    background: var(--brass-glow);
}

/* The wait. A circle begins at three o'clock and this has to begin at twelve. */
.emote__wait {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
    pointer-events: none;
}

.emote__arc {
    fill: none;
    stroke: var(--brass);
    stroke-width: 2;
    stroke-linecap: round;

    /* pathLength normalises the circumference to a hundred, so the ring can be
       written as a whole without the radius ever coming into it */
    stroke-dasharray: 100;
    stroke-dashoffset: 0;

    /* The whole of EMOTE_COOLDOWN_MILLISECONDS, and the two have to agree: that
       timer decides when the button comes back, and this decides when it looks
       as though it has */
    transition: stroke-dashoffset 5000ms linear;
}

.emote__arc--spent {
    stroke-dashoffset: 100;
}

/* On the same line as the button that sends them and the one press the table
   asks for, which is where the bottom of this screen already is. Never pressed,
   so it never takes the pointer: a drag that begins over a row still reaches
   the bowl. */
.emote-log {
    position: absolute;
    z-index: 1;
    bottom: 1.25rem;
    left: calc(1.25rem + env(safe-area-inset-left, 0px));
    display: flex;

    /* Held clear of the tray of glyphs that opens across from it, which reaches
       11.7rem in from the right edge — so a row stops short of that, of this
       corner's own inset, and of a rem of slack that also covers a safe area on
       the left. Floored, because below about a phone's width the two cannot both
       be had and a row worth reading is worth more than the clearance: the tray
       is opaque and drawn over the top, so what it covers there it covers
       cleanly. Capped, because a name is not worth twenty rem of the table. */
    max-width: min(20rem, max(11rem, calc(100vw - 14rem)));
    flex-direction: column;
    gap: 0.375rem;
    pointer-events: none;
    list-style: none;
    transition: bottom 200ms ease;
}

/* Lifted clear of whichever button has taken that line, which a row would
   otherwise stand across. Moved rather than reserved for, so the corner is not
   held empty for the greater part of a match in which neither button is up.

   And only where the two cannot both be had. Those buttons are centred and this
   corner is not, so on a wide enough table they never meet and lifting would be
   a gap under a row for no reason anybody looking at that corner could see. The
   figure is where they stop meeting: the Pass button is the wider of the two at
   9.25rem, so its left edge is half the table less 4.625rem, and a row reaches
   this corner's own inset plus its 20rem ceiling. Those cross a little under
   54rem, and a rem of air between them puts it here.

   Taken off the buttons rather than off the line a refused write is said on,
   which is centred text and so reaches further in than either of them. For a
   rem or two above this figure a second row of emotes can still graze that
   line — and only then, since it clears the bottom row at every width. Chasing
   it would mean a figure high enough to hold the corner empty on a table wide
   enough for nothing to be wrong with it, which is the thing this is here to
   stop. */
@media (width < 56rem) {
    .emote-log--lifted {
        bottom: 6.5rem;
    }
}

/* The rail's own pill, at the other end of the screen. Deliberately the same
   object: the rail is where a player learns to read a swatch and a name as a
   seat, and an emote is worth nothing until it is read as coming from one. */
.emote-log__row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 1rem;
    border-radius: 999px;
    background: rgb(14 18 16 / 55%);
}

/* The rail's swatch, repeated here rather than shared, since the two corners are
   free to drift apart and this one has no seat to be active or out */
.emote-log__swatch {
    width: 0.625rem;
    height: 0.625rem;
    flex: none;
    border-radius: 22%;
    box-shadow:
        inset 0 1px 0 rgb(243 236 224 / 32%),
        0 0 0 1px var(--brass-edge);
}

/* Truncated harder than the rail truncates, because this stands at the end of a
   row that already carries a glyph, and because the tray of glyphs opens across
   the screen from it */
.emote-log__name {
    min-width: 0;
    overflow: hidden;
    font-size: 0.8125rem;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--bone-dim);
}

/* Large enough to read as something said rather than as a mark beside a name.
   The one thing on this screen the interface did not choose the colour of. */
.emote-log__glyph {
    flex: none;
    font-size: 1.25rem;
    line-height: 1;
}

/* Both ends are transitions off a class rather than an animation ending at
   nothing, so that the reduced-motion rule crushing them to an instant leaves a
   row on screen for its three seconds instead of leaving it invisible for them —
   the same reason the call below is built this way. */
.said-enter-active {
    transition: opacity 180ms ease-out, transform 180ms ease-out;
}

/* Left in the flow as it fades, which is not the usual answer for a leaving row.
   Taken out of it, an absolutely positioned child of a flex container is placed
   at that container's own start corner — and this one is held against its bottom
   edge and empties from the top, so a zero-height log hangs the last row out of
   it below the table and takes the whole page into a scrollbar with it. Nothing
   is bought by taking it out, either: every row still standing is held against
   that same bottom edge, so removing the one above them moves none of them. */
.said-leave-active {
    transition: opacity 320ms ease-in;
}

.said-enter-from {
    opacity: 0;
    transform: translateY(0.375rem);
}

.said-leave-to {
    opacity: 0;
}

.said-move {
    transition: transform 220ms ease;
}

/* The one place the reduced-motion rule has to be argued with rather than obeyed.
   Crushed to an instant, the arc would empty in a hundredth of a second and leave
   a button that looks live for the five seconds it is not. Held full instead, and
   static: the wait is still said, it is simply not drawn running. */
@media (prefers-reduced-motion: reduce) {
    .emote__arc--spent {
        stroke-dashoffset: 0;
    }
}

/* ============================================
   The turn being called
   ============================================ */

/* Read rather than answered, and never in the way: the call passes every
   pointer straight down to the table, so the camera, the switches and the
   emotes all stay in the player's hands for the beat it is up. What it does
   hold off is the one thing that would be answering it — a throw or a pass —
   and that is held by the controls themselves rather than by this layer.

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

    /* Which is also what keeps the browser's own gestures off it: a layer
       nobody can hit is not the element a right button or a second finger is
       measured against, so the canvas below goes on answering both. */
    pointer-events: none;
    z-index: 2;
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
    z-index: 2;
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
