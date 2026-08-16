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
}

export interface MatchState {
  code: string
  playerCount: number
  phase: MatchPhase
  players: MatchPlayer[] // In the order they joined, which is the order they play in

  /**
   * How many dice each player is holding, by identifier.
   *
   * Kept apart from players rather than on it, because the two change at
   * completely different rates: the seats are written once and never again,
   * while this is rewritten by every throw. An unreadable seat list makes the
   * whole match vanish, and nothing rewritten that often should be able to do
   * that.
   *
   * A hand is charged the moment its dice leave it and paid back only when the
   * throw is judged, so zero on its own is not elimination — a player whose
   * dice are still in the air is holding nothing and is very much still in.
   * Zero *once that throw has been judged* is elimination, and needs no flag
   * beside it to say so: a hand only ever grows by its own player pairing dice,
   * which needs their turn, which is skipped once they have none. Past that
   * point nothing in the game can take a hand off zero, and it is a one-way
   * door.
   */
  pools: Record<string, number>

  turnIndex: number // Into players
  hasThrown: boolean // Whether the player whose turn it is may pass yet
  bowl: DieSnapshot[] // Authoritative; every player's bowl is set from this
  throwSeq: number // The last throw made, and the name of the die it produced

  /**
   * What the last throw came to, kept so that every player watches the same
   * dice being taken out of the bowl for the same stated reason.
   *
   * It is a replay and not a state: the bowl above already holds where this
   * ends up. Null before the first throw of a match, and — deliberately —
   * whenever it cannot be read, since a verdict nobody can follow is only a
   * missed animation, while a bowl nobody can read is a match nobody can play.
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

function readQuadruple(value: unknown): [number, number, number, number] | null {
  const numbers = readNumbers(value, 4)

  if (numbers === null) {
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
 * Reads every player's hand.
 *
 * A hand belonging to nobody at the table is kept rather than refused: seats
 * are written once and hands are rewritten by every throw, so the two are read
 * against each other where they are used and not here.
 * @param value - The field as it came out of the document
 * @returns Every hand, or null if any count could not be read
 */
function readPools(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null
  }

  const pools: Record<string, number> = {}

  for (const [
    uid,
    count,
  ] of Object.entries(value)) {
    const size = readNumber(count)

    if (size === null) {
      return null
    }

    pools[uid] = size
  }

  return pools
}

/**
 * Reads the bowl. A single unreadable die fails the whole bowl rather than
 * being skipped: a bowl is applied as a complete state, and one quietly
 * dropped from it would be taken as a die that had left the match.
 * @param value - The field as it came out of the document
 * @returns Every die, or null if any of them could not be read
 */
function readBowl(value: unknown): DieSnapshot[] | null {
  if (!isArray(value)) {
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

  const playerCount = readNumber(value.playerCount)
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

    // Absent before the first throw, and read leniently: an unreadable verdict
    // costs a player the sight of the dice being taken out, which is a great
    // deal less than refusing them the match it happened in
    verdict: readResolution(value.verdict),

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
      launch: launch,
    })
  }

  return dice
}
