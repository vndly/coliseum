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
 * whoever pairs it takes it, which is why the bowl carries no owner. What a
 * hand does carry is the colour of every die in it: the paint outlives the
 * hand, so a die won in a pair arrives in the colour whoever threw it painted
 * it. Nothing below reads that colour — it is carried, counted and handed on,
 * and never judged.
 */

/** How many dice each player is given at the start of a match. */
export const STARTING_POOL = 6

/**
 * The hand a player sits down with: their whole allowance, every die of it in
 * the colour they chose.
 *
 * The only place in the game a colour is minted. Everything after this moves
 * paint that already exists between hands and the bowl, so a colour a player
 * never chose can only reach their hand by their winning it.
 * @param color - The skin the player is playing in
 * @returns Their opening hand
 */
export function startingHand(color: number): number[] {
  return new Array<number>(STARTING_POOL).fill(color)
}

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

/**
 * The values a flush is made of: one of each and nothing else in the bowl.
 *
 * Every value a die keeps, which is to say every face but the six. A bowl
 * holding one of each is holding as many different values as it can, and the
 * whole of it goes back to the hand that completed it.
 */
const FLUSH_FACES = [
  1,
  2,
  3,
  4,
  5,
]

/** Everything one settled throw changes about the match it was made in. */
export interface ThrowOutcome {
  resolution: ThrowResolution // What happened, in the order it is to be watched
  bowl: DieSnapshot[] // What is left in the bowl once it has all happened
  pools: Record<string, number[]> // Every hand, with the thrower's group already in it
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
  return handOf(state, uid).length
}

/**
 * What a player is holding, die by die, in the order they will be thrown.
 * @param state - The match as it currently stands
 * @param uid - The player to look at
 * @returns The colour of every die in their hand, oldest first
 */
export function handOf(state: MatchState, uid: string): number[] {
  return state.pools[uid] ?? []
}

/**
 * Takes the next throw out of a hand, and says what is left.
 *
 * A hand is a queue: the dice a player started with are at the front, and
 * anything they win goes to the back. Which die goes into the bowl is a purely
 * cosmetic question — no rule anywhere reads a colour — so it is answered by
 * the plainest order there is rather than by asking the player to pick paint
 * mid-turn.
 * @param state - The match as it currently stands
 * @param uid - The player about to throw
 * @param count - How many dice the throw puts in the air
 * @returns The colours going into the bowl, and the hand left behind
 */
export function drawFromHand(
  state: MatchState,
  uid: string,
  count: number,
): {thrown: number[],
  kept: number[]} {
  const hand = handOf(state, uid)

  return {
    thrown: hand.slice(0, count),
    kept: hand.slice(count),
  }
}

/**
 * Whether the player to throw has to throw their whole hand.
 *
 * The bowl empties when a group or a flush is taken out of it — a flush always,
 * since it is the whole bowl — and the player who arrives to an empty one goes
 * all in. Judged on the turn having begun rather than on the bowl alone: a
 * player who throws again into a bowl the sixes emptied is part way through a
 * turn, and throws one die like anybody else.
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
  pools: Record<string, number[]>,
  from: number,
): number {
  for (let step = 1; step <= players.length; step++) {
    const index = (from + step) % players.length
    const player = players[index]

    if (player !== undefined && (pools[player.uid] ?? []).length > 0) {
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
  pools: Record<string, number[]>,
): string | null {
  let survivor: string | null = null

  for (const player of players) {
    if ((pools[player.uid] ?? []).length === 0) {
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
 * first, and only what is left of the bowl is looked at for a flush and then
 * for groups. Two sixes are therefore not a pair — they are two dice that were
 * already gone — and a bowl of one to five beside a six is still a flush, since
 * by the time the bowl is judged the six is not in it.
 *
 * The flush and the groups are asked in turn but can never both answer: five
 * different values are five dice with nothing shared between them. Either way
 * what comes back is dice going to the thrower's hand, and everything after
 * this reads them the same.
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

  const flushed = flushDice(standing)
  const returned = flushed.length > 0 ? flushed : groupedDice(standing)
  const bowl = standing.filter((die) => !returned.includes(die.id))

  const pools: Record<string, number[]> = {
    ...state.pools,
  }

  // The dice go back in the paint they were thrown in, whoever threw them, and
  // to the back of the hand they are going to. A pair won off somebody else is
  // the only way a hand comes to hold a colour its player never chose.
  if (thrower !== undefined) {
    const won = atRest.filter((die) => returned.includes(die.id)).map((die) => die.skin)

    pools[thrower.uid] = [
      ...pools[thrower.uid] ?? [],
      ...won,
    ]
  }

  // A group ends the turn, a flush ends it the same way, and so does having
  // thrown the last die in hand:
  // there is nothing left to throw again with, and the rules only offer the
  // choice to a player who still has one.
  const spent = thrower === undefined || (pools[thrower.uid] ?? []).length === 0
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
 * What made the dice named as returned go back to the thrower's hand.
 *
 * A verdict stores a flush and a group in the same `returned` field because
 * both have the same effect. Their faces still distinguish them for the
 * presentation that accompanies that return: a flush is exactly one through
 * five, while even five grouped dice contain a repeated face.
 * @param resolution - The verdict whose returned dice are being shown
 * @returns Their reason for returning, or null when none returned
 */
export function returnedDiceKind(resolution: ThrowResolution): 'pair' | 'flush' | null {
  if (resolution.returned.length === 0) {
    return null
  }

  const identifiers = new Set(resolution.returned)
  const returned = resolution.atRest.filter((die) => identifiers.has(die.id))
  const isFlush = identifiers.size === resolution.returned.length
    && returned.length === resolution.returned.length
    && flushDice(returned).length > 0

  return isFlush ? 'flush' : 'pair'
}

/**
 * The whole bowl, when it is holding one of every value a die keeps.
 *
 * Nothing else in it and nothing missing from it: five dice reading one, two,
 * three, four and five. Counted by the values present rather than by sorting
 * them, since a bowl of exactly five dice covering five different values has
 * no room to repeat one.
 * @param dice - The bowl, with the sixes already taken out of it
 * @returns The identifiers of every die in the bowl, or none if it is no flush
 */
function flushDice(dice: DieSnapshot[]): string[] {
  if (dice.length !== FLUSH_FACES.length) {
    return []
  }

  const faces = new Set(dice.map((die) => die.face))

  if (!FLUSH_FACES.every((face) => faces.has(face))) {
    return []
  }

  return dice.map((die) => die.id)
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
