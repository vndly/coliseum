import {MAX_PLAYERS, MIN_PLAYERS, STARTING_POOL} from '@/match/rules'
import {BONE_SKIN, isDieSkin} from '@/scene/die_skins'
import type {DieSnapshot, ThrowLaunch, ThrowResolution, ThrownDie} from '@/scene/die_state'

/**
 * The shape of a match as it is stored, and the readers that turn a stored
 * document back into it.
 *
 * Everything arriving from the database is read as unknown and checked field
 * by field. Nothing here trusts the document: a match is keyed by a code short
 * enough to guess, the security rules are permissive, and a half-written or
 * hand-edited document should leave a player looking at "no such match" rather
 * than at a scene built from nonsense.
 */

/** Whether the match is still filling its seats, being played, or over. */
export type MatchPhase = 'lobby' | 'playing' | 'finished'

export interface MatchPlayer {
  uid: string
  name: string

  /**
   * The colour this player's own six dice are painted in, as an index into
   * DIE_SKINS.
   *
   * Chosen in the lobby and settled with the seat, like the name beside it.
   * Two people may sit down in the same one: a colour is a skin a player picked
   * for themselves rather than a badge the match hands out, and nothing in the
   * rules reads it. Bots are the exception, and are drawn apart on purpose —
   * a table nobody chose the colours of should still be one you can read.
   */
  color: number

  /**
   * Whether nobody is sitting behind this seat.
   *
   * A bot is a seat like any other — it holds dice, it takes its turn, it is
   * eliminated by running out — and everything in the rules reads it without
   * knowing. What it is for is the one browser in the match: a bot's turns are
   * played by whoever started it, and this is how that browser tells the seats
   * it has to play from the one it is sitting in.
   */
  bot: boolean
}

export interface MatchState {
  code: string
  playerCount: number
  phase: MatchPhase
  players: MatchPlayer[] // Join order while the lobby fills; the order they play in once it has

  /**
   * What each player is holding, by identifier.
   *
   * Kept apart from players rather than on it, because the two change at
   * completely different rates: the seats are written once and never again,
   * while this is rewritten by every throw. An unreadable seat list makes the
   * whole match vanish, and nothing rewritten that often should be able to do
   * that.
   *
   * A list rather than a count, and each entry is the colour of one die in
   * hand. The paint on a die outlives the hand it is in — a die won in a pair
   * keeps the colour of whoever put it in the bowl — so a hand has to say what
   * it is holding and not merely how much. The count everything else asks for
   * is this list's length, and nothing else counts a hand.
   *
   * A hand is charged the moment its dice leave it and paid back only when the
   * throw is judged, so empty on its own is not elimination — a player whose
   * dice are still in the air is holding nothing and is very much still in.
   * Empty *once that throw has been judged* is elimination, and needs no flag
   * beside it to say so: a hand only ever grows by its own player pairing dice,
   * which needs their turn, which is skipped once they have none. Past that
   * point nothing in the game can take a hand off zero, and it is a one-way
   * door.
   */
  pools: Record<string, number[]>

  turnIndex: number // Into players
  hasThrown: boolean // Whether the player whose turn it is may pass yet
  bowl: DieSnapshot[] // Authoritative; every player's bowl is set from this
  throwSeq: number // The last throw made, and the name of the die it produced

  /**
   * What the last throw came to, kept so that every player watches the same
   * dice being taken out of the bowl for the same stated reason.
   *
   * It is a replay and not a state: the bowl above already holds where this
   * ends up. Null only before the first throw of a match — a stored verdict
   * that cannot be read fails the whole document instead, because this field
   * is not only the replay. `judged` on the match screen, and the idempotency
   * guards in both `submitVerdict` and the takeover behind it, all read it as
   * the record of what has been judged, and a verdict quietly dropped would
   * stop every turn and let the next takeover pay a throw's winnings twice.
   */
  verdict: ThrowResolution | null

  winner: string | null // Set with the finished phase, and never unset

  /**
   * Counts every write to the bowl above, and nothing else.
   *
   * Needed because a throw writes twice: once to say it happened, and again to
   * say where the dice stopped. Between the two, the match holds a bowl that
   * predates the die now flying across every player's screen, and a player who
   * applied it would take that die back off their own table.
   *
   * A counter rather than the number of the throw that wrote it, because the
   * bowl is also written when the match starts and the opening die is placed —
   * which no throw is responsible for, and which a player already watching the
   * lobby would otherwise never see change.
   */
  bowlVersion: number
}

/**
 * One throw, as the player who made it described it. A list of dice rather than
 * a single one, because a turn that begins with an empty bowl throws a whole
 * hand on one gesture — and is still one throw.
 */
export interface ThrowRecord {
  seq: number
  uid: string
  dice: ThrownDie[]
}

/**
 * Every die a match can hold, which is the most any one hand could be.
 *
 * One more than the hands were dealt: the opening die is placed into the bowl
 * when the match starts and no hand ever paid for it, so it is the one die
 * that can make a hand larger than the deal. A player holding all of them is
 * the player who has just won, and the document that says so has to be
 * readable.
 */
const MATCH_DICE = STARTING_POOL * MAX_PLAYERS + 1

/**
 * How far a stored attitude may be from being a unit quaternion before it is
 * refused. Wide enough for the rounding a number takes on its way through JSON
 * and back, and far narrower than anything that would reach the simulation as
 * a scaling.
 */
const QUATERNION_TOLERANCE = 1e-3

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Reads a fixed-length run of numbers, which is how every position, rotation
 * and velocity is stored.
 * @param value - The field as it came out of the document
 * @param length - How many numbers there must be, exactly
 * @returns The numbers, or null if the field is not that
 */
function readNumbers(value: unknown, length: number): number[] | null {
  if (!isArray(value) || value.length !== length) {
    return null
  }

  const numbers: number[] = []

  for (const entry of value) {
    const number = readNumber(entry)

    if (number === null) {
      return null
    }

    numbers.push(number)
  }

  return numbers
}

/**
 * The length is already known by the time these run, so the fallbacks below
 * are unreachable. They are there because indexing yields a possible undefined
 * and the project does not assert that away.
 */
function readTriple(value: unknown): [number, number, number] | null {
  const numbers = readNumbers(value, 3)

  if (numbers === null) {
    return null
  }

  return [
    numbers[0] ?? 0,
    numbers[1] ?? 0,
    numbers[2] ?? 0,
  ]
}

/**
 * Reads an attitude, which is the only thing four numbers are ever stored as
 * here.
 *
 * Checked for being a unit quaternion as well as for being four numbers,
 * because this is the one place every stored rotation passes through and what
 * is downstream of it cannot check for itself. A body built with a rotation
 * that is not a unit quaternion is a body the simulation never moves and never
 * puts to sleep, and one of those in the bowl holds the whole table unsettled:
 * every throw then waits out the settle timeout rather than being answered by
 * the engine.
 * @param value - The field as it came out of the document
 * @returns The attitude, or null if it is not one a die could be resting in
 */
function readQuadruple(value: unknown): [number, number, number, number] | null {
  const numbers = readNumbers(value, 4)

  if (numbers === null) {
    return null
  }

  const norm = Math.hypot(
    numbers[0] ?? 0,
    numbers[1] ?? 0,
    numbers[2] ?? 0,
    numbers[3] ?? 0,
  )

  if (Math.abs(norm - 1) > QUATERNION_TOLERANCE) {
    return null
  }

  return [
    numbers[0] ?? 0,
    numbers[1] ?? 0,
    numbers[2] ?? 0,
    numbers[3] ?? 0,
  ]
}

/**
 * Reads a die's colour.
 *
 * Read leniently, like the flag that says a seat is a bot: a die is bone
 * unless the document names a colour it can be painted in. Matches written
 * before there were colours say nothing at all, and a skin naming a swatch
 * this browser has never heard of is a document from a newer palette — neither
 * is worth refusing a whole bowl over.
 * @param value - The field as it came out of the document
 * @returns The skin, or bone if there is not one there
 */
function readSkin(value: unknown): number {
  const skin = readNumber(value)

  return skin !== null && isDieSkin(skin) ? skin : BONE_SKIN
}

/**
 * Reads a die's value, which is the one field here with a range worth stating.
 * Everything else is a coordinate and any number is a possible one; a face
 * outside one to six is a die the rules would judge and never remove.
 * @param value - The field as it came out of the document
 * @returns The value, or null if it is not a face a die has
 */
function readFace(value: unknown): number | null {
  const face = readNumber(value)

  if (face === null || !Number.isInteger(face) || face < 1 || face > 6) {
    return null
  }

  return face
}

/**
 * Reads how many seats the match has.
 *
 * Bounded before it is built, in the same way and for the same reason a hand
 * is: this number is handed to the interface as a length, so a stored 2.5 is an
 * invalid array length and a stored billion is an allocation that takes the tab
 * down with it. Bounded here rather than only beside the lobby's own list, so
 * that the match screen inherits it too: it draws the seats from this number
 * as well, and had nothing of its own saying what it could be. The lobby's
 * check stands where it is, nearest the value it hands to a renderer, and now
 * answers a question this has already answered. Nothing this game writes is
 * outside the range, so what this refuses is a document written by something
 * that is not this game.
 * @param value - The field as it came out of the document
 * @returns The seat count, or null if it is not one a match could have been made for
 */
function readSeatCount(value: unknown): number | null {
  const count = readNumber(value)

  if (count === null || !Number.isInteger(count)) {
    return null
  }

  return count >= MIN_PLAYERS && count <= MAX_PLAYERS ? count : null
}

function readDieSnapshot(value: unknown): DieSnapshot | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const position = readTriple(value.position)
  const rotation = readQuadruple(value.rotation)
  const face = readFace(value.face)

  if (id === null || position === null || rotation === null || face === null) {
    return null
  }

  return {
    id: id,
    position: position,
    rotation: rotation,
    face: face,
    skin: readSkin(value.skin),
  }
}

/**
 * Reads a run of identifiers, which is how a verdict names the dice it took.
 * @param value - The field as it came out of the document
 * @returns The identifiers, or null if any of them could not be read
 */
function readStrings(value: unknown): string[] | null {
  if (!isArray(value)) {
    return null
  }

  const strings: string[] = []

  for (const entry of value) {
    const text = readString(entry)

    if (text === null) {
      return null
    }

    strings.push(text)
  }

  return strings
}

/**
 * Reads the last throw's verdict.
 * @param value - The field as it came out of the document
 * @returns The verdict, or null if there is nothing followable there
 */
function readResolution(value: unknown): ThrowResolution | null {
  if (!isRecord(value)) {
    return null
  }

  const seq = readNumber(value.seq)
  const atRest = readBowl(value.atRest)
  const removed = readStrings(value.removed)
  const returned = readStrings(value.returned)

  if (seq === null || atRest === null || removed === null || returned === null) {
    return null
  }

  return {
    seq: seq,
    atRest: atRest,
    removed: removed,
    returned: returned,
  }
}

/**
 * Reads one hand: the colour of every die in it, in the order they will be
 * thrown.
 *
 * A bare number is accepted as that many bone dice, which is what a hand
 * written before dice had colours looks like. It is the one place the two
 * shapes meet, and it is here rather than anywhere further in so that
 * everything downstream reads one hand and not two.
 * @param value - One player's entry, as it came out of the document
 * @returns The hand, or null if it is neither shape
 */
function readHand(value: unknown): number[] | null {
  const count = readNumber(value)

  // Bounded before it is built, in the same way and for the same reason the
  // lobby bounds a stored seat count: this number is handed to a constructor
  // as a length, so a stored 2.5 is an invalid array length and a stored
  // billion is an allocation that takes the tab down with it — and this runs
  // inside parseMatchState, which the lobby calls on every open match it is
  // shown. Every die in the match is accounted for, so nothing this game
  // writes is outside the range and what this refuses is a document written
  // by something that is not this game.
  if (count !== null) {
    return Number.isInteger(count) && count >= 0 && count <= MATCH_DICE
      ? new Array<number>(count).fill(BONE_SKIN)
      : null
  }

  if (!isArray(value) || value.length > MATCH_DICE) {
    return null
  }

  return value.map((entry) => readSkin(entry))
}

/**
 * Reads every player's hand.
 *
 * A hand belonging to nobody at the table is kept rather than refused: seats
 * are written once and hands are rewritten by every throw, so the two are read
 * against each other where they are used and not here.
 * @param value - The field as it came out of the document
 * @returns Every hand, or null if any of them could not be read
 */
function readPools(value: unknown): Record<string, number[]> | null {
  if (!isRecord(value)) {
    return null
  }

  const pools: Record<string, number[]> = {}

  for (const [
    uid,
    hand,
  ] of Object.entries(value)) {
    const held = readHand(hand)

    if (held === null) {
      return null
    }

    pools[uid] = held
  }

  return pools
}

/**
 * Reads the bowl. A single unreadable die fails the whole bowl rather than
 * being skipped: a bowl is applied as a complete state, and one quietly
 * dropped from it would be taken as a die that had left the match.
 *
 * Bounded before it is built, in the same way and for the same reason a hand
 * is, and against the same figure: a bowl holds dice out of the same match the
 * hands are dealt from, so it can never hold more of them than the match has.
 * Every entry becomes a rigid body and two meshes when the scene restores it,
 * so a stored bowl of a few thousand takes the tab down with it — and it would
 * do so on every player at the table at once.
 * @param value - The field as it came out of the document
 * @returns Every die, or null if any of them could not be read
 */
function readBowl(value: unknown): DieSnapshot[] | null {
  if (!isArray(value) || value.length > MATCH_DICE) {
    return null
  }

  const bowl: DieSnapshot[] = []

  for (const entry of value) {
    const die = readDieSnapshot(entry)

    if (die === null) {
      return null
    }

    bowl.push(die)
  }

  return bowl
}

function readPlayers(value: unknown): MatchPlayer[] | null {
  if (!isArray(value)) {
    return null
  }

  const players: MatchPlayer[] = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      return null
    }

    const uid = readString(entry.uid)
    const name = readString(entry.name)

    if (uid === null || name === null) {
      return null
    }

    players.push({
      uid: uid,
      name: name,
      color: readSkin(entry.color),

      // Read leniently, like the flag that says a turn has had a throw:
      // a seat is a person unless the document says otherwise, and matches
      // written before there were bots say nothing at all
      bot: entry.bot === true,
    })
  }

  return players
}

function readLaunch(value: Record<string, unknown>): ThrowLaunch | null {
  const origin = readTriple(value.origin)
  const velocity = readTriple(value.velocity)
  const orientation = readQuadruple(value.orientation)
  const angularVelocity = readTriple(value.angularVelocity)

  if (origin === null || velocity === null || orientation === null || angularVelocity === null) {
    return null
  }

  return {
    origin: origin,
    velocity: velocity,
    orientation: orientation,
    angularVelocity: angularVelocity,
  }
}

/**
 * Turns a stored match document into a match.
 * @param code - The code the document was read under; it is the document's own name
 * @param value - The document's fields, or undefined if there is no such document
 * @returns The match, or null if there is nothing readable there
 */
export function parseMatchState(code: string, value: unknown): MatchState | null {
  if (!isRecord(value)) {
    return null
  }

  const playerCount = readSeatCount(value.playerCount)
  const phase = readString(value.phase)
  const players = readPlayers(value.players)
  const pools = readPools(value.pools)
  const turnIndex = readNumber(value.turnIndex)
  const bowl = readBowl(value.bowl)
  const throwSeq = readNumber(value.throwSeq)
  const bowlVersion = readNumber(value.bowlVersion)

  if (playerCount === null || players === null || pools === null || turnIndex === null) {
    return null
  }

  if (bowl === null || throwSeq === null || bowlVersion === null) {
    return null
  }

  // Absent before the first throw, and read as strictly as the bowl beside it
  // once it is there. It looks decorative — it is what plays the dice being
  // taken out — but three things read it as the record of what has been
  // judged: the interface asks it whether the turn may act, and both the
  // verdict write and the takeover behind it ask it whether the throw has
  // already been paid for. A verdict that will not parse reads as no verdict
  // at all, which stops every turn and disarms both of those guards, so the
  // next takeover judges a throw whose winnings have already been paid.
  const stored = value.verdict
  const written = stored !== undefined && stored !== null
  const verdict = written ? readResolution(stored) : null

  if (written && verdict === null) {
    return null
  }

  if (phase !== 'lobby' && phase !== 'playing' && phase !== 'finished') {
    return null
  }

  return {
    code: code,
    playerCount: playerCount,
    phase: phase,
    players: players,
    pools: pools,
    turnIndex: turnIndex,
    hasThrown: value.hasThrown === true,
    bowl: bowl,
    throwSeq: throwSeq,

    verdict: verdict,

    winner: readString(value.winner),
    bowlVersion: bowlVersion,
  }
}

/**
 * Turns a stored throw document into a throw.
 * @param value - The document's fields
 * @returns The throw, or null if there is nothing readable there
 */
export function parseThrowRecord(value: unknown): ThrowRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const seq = readNumber(value.seq)
  const uid = readString(value.uid)
  const dice = readThrownDice(value.dice)

  if (seq === null || uid === null || dice === null) {
    return null
  }

  return {
    seq: seq,
    uid: uid,
    dice: dice,
  }
}

/**
 * Reads the dice of one throw. A throw with none of them fails rather than
 * being played as nothing: every throw puts at least one die in the air, so an
 * empty list is a document that was written wrong.
 * @param value - The field as it came out of the document
 * @returns Every die of the throw, or null if any of them could not be read
 */
function readThrownDice(value: unknown): ThrownDie[] | null {
  if (!isArray(value) || value.length === 0) {
    return null
  }

  const dice: ThrownDie[] = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      return null
    }

    const id = readString(entry.id)
    const launch = readLaunch(entry)

    if (id === null || launch === null) {
      return null
    }

    dice.push({
      id: id,
      skin: readSkin(entry.skin),
      launch: launch,
    })
  }

  return dice
}
