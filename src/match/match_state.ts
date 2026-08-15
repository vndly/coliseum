import type {DieSnapshot, ThrowLaunch} from '@/scene/die_state'

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

/** Whether the match is still filling its seats, or being played. */
export type MatchPhase = 'lobby' | 'playing'

export interface MatchPlayer {
  uid: string
  name: string
}

export interface MatchState {
  code: string
  playerCount: number
  phase: MatchPhase
  players: MatchPlayer[] // In the order they joined, which is the order they play in
  turnIndex: number // Into players
  hasThrown: boolean // Whether the player whose turn it is may pass yet
  bowl: DieSnapshot[] // Authoritative; every player's bowl is set from this
  throwSeq: number // The last throw made, and the name of the die it produced

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

/** One throw, as the player who made it described it. */
export interface ThrowRecord {
  seq: number
  uid: string
  dieId: string
  launch: ThrowLaunch
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

function readDieSnapshot(value: unknown): DieSnapshot | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const position = readTriple(value.position)
  const rotation = readQuadruple(value.rotation)

  if (id === null || position === null || rotation === null) {
    return null
  }

  return {
    id: id,
    position: position,
    rotation: rotation,
  }
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
  const turnIndex = readNumber(value.turnIndex)
  const bowl = readBowl(value.bowl)
  const throwSeq = readNumber(value.throwSeq)
  const bowlVersion = readNumber(value.bowlVersion)

  if (playerCount === null || players === null || turnIndex === null) {
    return null
  }

  if (bowl === null || throwSeq === null || bowlVersion === null) {
    return null
  }

  if (phase !== 'lobby' && phase !== 'playing') {
    return null
  }

  return {
    code: code,
    playerCount: playerCount,
    phase: phase,
    players: players,
    turnIndex: turnIndex,
    hasThrown: value.hasThrown === true,
    bowl: bowl,
    throwSeq: throwSeq,
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
  const dieId = readString(value.dieId)
  const launch = readLaunch(value)

  if (seq === null || uid === null || dieId === null || launch === null) {
    return null
  }

  return {
    seq: seq,
    uid: uid,
    dieId: dieId,
    launch: launch,
  }
}
