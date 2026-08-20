import type {MatchPlayer, MatchState} from '@/match/match_state'
import type {DieSnapshot, ThrowResolution} from '@/scene/die_state'

/**
 * The rules of the game, as plain functions over a match's stored state.
 *
 * Nothing here touches the database, the scene or Vue. A settled bowl and the
 * hands around it go in, and everything one throw changes comes out in a single
 * value — which is what lets the whole of it be written in one document, and
 * lets any player at the table work out the same answer when the one who threw
 * walks away before writing it.
 *
 * A die in the bowl belongs to nobody. It was thrown out of somebody's hand and
 * whoever pairs it takes it, which is why hands are counts rather than lists
 * and why the bowl carries no owner.
 */

/** How many dice each player is given at the start of a match. */
export const STARTING_POOL = 6

/**
 * The fewest and the most players a match can be made for.
 *
 * Here rather than on the screen that offers the choice, because the lobby is
 * no longer the only thing that needs them: a match read back out of the
 * database is checked against the same range before it is offered as a seat,
 * and a stored count nobody bounded reaches whatever draws the seats.
 */
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 6

/** The face that takes a die out of the match instead of into a group. */
const REMOVED_FACE = 6

/** The fewest dice showing the same value that count as a group. */
const GROUP_SIZE = 2

/** Everything one settled throw changes about the match it was made in. */
export interface ThrowOutcome {
  resolution: ThrowResolution // What happened, in the order it is to be watched
  bowl: DieSnapshot[] // What is left in the bowl once it has all happened
  pools: Record<string, number> // Every hand, with the thrower's group already in it
  turnIndex: number // Who throws next; the thrower again, if they may throw again
  winner: string | null // Set the moment only one player still has dice
}

/**
 * How many dice a player is holding.
 * @param state - The match as it currently stands
 * @param uid - The player to count
 * @returns Their hand, which is zero once they are out of the match
 */
export function poolSize(state: MatchState, uid: string): number {
  return state.pools[uid] ?? 0
}

/**
 * Whether the player to throw has to throw their whole hand.
 *
 * The bowl empties when a group is taken out of it, and the player who arrives
 * to an empty one goes all in. Judged on the turn having begun rather than on
 * the bowl alone: a player who throws again into a bowl the sixes emptied is
 * part way through a turn, and throws one die like anybody else.
 * @param state - The match as it currently stands
 * @returns Whether this turn is an all-in turn
 */
export function isAllIn(state: MatchState): boolean {
  return state.bowl.length === 0 && !state.hasThrown
}

/**
 * How many dice the next throw of this turn puts in the air.
 * @param state - The match as it currently stands
 * @param uid - The player about to throw
 * @returns Their whole hand on an all-in turn, and otherwise one die
 */
export function throwSize(state: MatchState, uid: string): number {
  const pool = poolSize(state, uid)

  return isAllIn(state) ? pool : Math.min(pool, 1)
}

/**
 * The seats of a match, in the order they are to be played in.
 *
 * Drawn in one go when the last seat is taken, rather than a seat at a time as
 * the players arrive, so that nobody watching the lobby fill can work out where
 * they are sitting before the match has started.
 * @param players - Every seat, in the order they joined
 * @returns The same seats in a random order, as a new array
 */
export function shuffledPlayers(players: MatchPlayer[]): MatchPlayer[] {
  const undrawn = [...players]
  const order: MatchPlayer[] = []

  // Taken one at a time out of what is left, which is as even as a swap in
  // place and never has to answer for an index the type checker cannot see is
  // in range
  while (undrawn.length > 0) {
    order.push(...undrawn.splice(Math.floor(Math.random() * undrawn.length), 1))
  }

  return order
}

/**
 * Who plays after a given seat, skipping everyone with nothing left to throw.
 * @param players - Every seat, in the order they play in
 * @param pools - Every hand
 * @param from - The seat being played now
 * @returns The next seat with dice in hand, or the same one if there is no other
 */
export function nextActivePlayer(
  players: MatchPlayer[],
  pools: Record<string, number>,
  from: number,
): number {
  for (let step = 1; step <= players.length; step++) {
    const index = (from + step) % players.length
    const player = players[index]

    if (player !== undefined && (pools[player.uid] ?? 0) > 0) {
      return index
    }
  }

  // Nobody else is left, which means the match is already won and the seat
  // this returns to is about to stop mattering
  return from
}

/**
 * The last player with dice in hand, if there is only one.
 * @param players - Every seat
 * @param pools - Every hand
 * @returns The winner's identifier, or null while more than one player is in
 */
export function survivingPlayer(
  players: MatchPlayer[],
  pools: Record<string, number>,
): string | null {
  let survivor: string | null = null

  for (const player of players) {
    if ((pools[player.uid] ?? 0) === 0) {
      continue
    }

    if (survivor !== null) {
      return null
    }

    survivor = player.uid
  }

  return survivor
}

/**
 * Judges a bowl that has come to rest, and works out everything that follows.
 *
 * In the order the rules are written, which is also the order they are watched
 * in and the only order that gives the right answer: the sixes leave the match
 * first, and only what is left of the bowl is looked at for groups. Two sixes
 * are therefore not a pair — they are two dice that were already gone.
 *
 * The dice that missed the bowl need no part in this. A die that reached the
 * table left play where it landed and is already absent from the bowl handed
 * in, and since a die in the bowl belongs to nobody, one that leaves the match
 * is owed to nobody either.
 * @param state - The match as it stood when the throw was made
 * @param seq - The throw being judged
 * @param atRest - The bowl the instant it stopped, from whoever is judging it
 * @returns Everything the throw changes
 */
export function resolveThrow(
  state: MatchState,
  seq: number,
  atRest: DieSnapshot[],
): ThrowOutcome {
  const thrower = state.players[state.turnIndex]
  const removed: string[] = []
  const standing: DieSnapshot[] = []

  for (const die of atRest) {
    if (die.face === REMOVED_FACE) {
      removed.push(die.id)
    } else {
      standing.push(die)
    }
  }

  const returned = groupedDice(standing)
  const bowl = standing.filter((die) => !returned.includes(die.id))

  const pools: Record<string, number> = {
    ...state.pools,
  }

  if (thrower !== undefined) {
    pools[thrower.uid] = (pools[thrower.uid] ?? 0) + returned.length
  }

  // A group ends the turn, and so does having thrown the last die in hand:
  // there is nothing left to throw again with, and the rules only offer the
  // choice to a player who still has one.
  const spent = thrower === undefined || (pools[thrower.uid] ?? 0) === 0
  const turnIndex = returned.length > 0 || spent
    ? nextActivePlayer(state.players, pools, state.turnIndex)
    : state.turnIndex

  return {
    resolution: {
      seq: seq,
      atRest: atRest,
      removed: removed,
      returned: returned,
    },
    bowl: bowl,
    pools: pools,
    turnIndex: turnIndex,
    winner: survivingPlayer(state.players, pools),
  }
}

/**
 * Every die sharing its value with at least one other.
 *
 * All the groups, not the largest one: three twos and two fives beside them are
 * five dice going back to the same hand. The bowl is small enough that counting
 * it twice is cheaper than anything cleverer would be to read.
 * @param dice - The bowl, with the sixes already taken out of it
 * @returns The identifiers of every die in a group
 */
function groupedDice(dice: DieSnapshot[]): string[] {
  const counts = new Map<number, number>()

  for (const die of dice) {
    counts.set(die.face, (counts.get(die.face) ?? 0) + 1)
  }

  const grouped: string[] = []

  for (const die of dice) {
    if ((counts.get(die.face) ?? 0) >= GROUP_SIZE) {
      grouped.push(die.id)
    }
  }

  return grouped
}
