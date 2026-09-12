import {EMOTE} from '@/match/emotes'
import type {MatchPlayer, MatchState} from '@/match/match_state'
import {FLUSH_FACES, poolSize, returnedDiceKind} from '@/match/rules'
import {PAINTED_SKINS} from '@/scene/die_skins'
import type {ThrowResolution} from '@/scene/die_state'

/**
 * The players nobody is sitting behind: how they are drawn up, and how they
 * decide what to do with a turn.
 *
 * A bot is not a second kind of player. It takes a seat in an ordinary match,
 * holds dice in the ordinary pools, and is judged by the ordinary rules — the
 * only thing that separates it from anybody else is that its turns are played
 * by the browser that started the match rather than by one of its own. Nothing
 * here writes to the database or touches the scene; this is the deciding, and
 * the screen does the acting.
 */

/**
 * The names a bot is given, drawn from without replacement.
 *
 * Short and plain, so a rail of them reads as a table of people rather than as
 * a list of machines. Six of them for the five seats a match can have besides
 * the player's own, with one to spare for the name they are already using.
 */
const BOT_NAMES = [
  'Tom',
  'Joe',
  'Ray',
  'Ana',
  'Kim',
  'Mia',
]

/**
 * What every bot's identifier begins with.
 *
 * Bots are seated by the same browser that seats the player, so their
 * identifiers are made up here rather than handed out by anyone. A prefix no
 * anonymous sign-in produces is what keeps them from ever colliding with one.
 */
const BOT_UID_PREFIX = 'bot-'

/** How many ways one die can land, and so the denominator of every count below. */
const DIE_FACES = 6

/** How many of those take the die out of the match rather than into the bowl. */
const REMOVING_FACES = 1

/**
 * How often a bot says each of the things it has to say, when it has the chance.
 *
 * Rising with how much just happened. A flush is the rarest thing this table
 * produces and nearly always gets a word; an ordinary group mostly passes
 * without one, because a bot that remarked on every throw it had an opinion
 * about would remark on almost all of them. None of these is tuned against
 * anything — they are the odds at which a table of bots reads as talkative
 * rather than as noisy.
 */
const BOT_EMOTE_ODDS = {
  matchOver: 0.9,
  flush: 0.8,
  elimination: 0.7,
  lastDie: 0.5,
  ownGroup: 0.35,
  otherGroup: 0.3,
  ownLoss: 0.3,
  otherLoss: 0.2,
} as const

/** What a bot does with a turn it is already part way through. */
export type BotMove = 'throw' | 'pass'

/**
 * Draws up the seats a bot match is played against.
 *
 * Names and colours are both drawn without replacement, so no two bots share
 * either, and the player's own are taken out of both draws first — two Kims at
 * one table is a rail nobody can read, and two clarets in one bowl is worse.
 * There are always enough left of each: six names and eight colours against
 * the five bots a match can seat.
 *
 * Colours, and only colours: the draw is over the painted half of the palette,
 * never the materials. See PAINTED_SKINS for why the half a player picks from
 * is wider than the half a bot is dealt.
 *
 * Colours are drawn apart here and left to collide between people, which is
 * not an inconsistency. A player chose theirs and can see what they chose;
 * nobody chose a bot's, so the only thing that can make a table of them
 * readable is the draw.
 * @param count - How many bots the match needs, which is every seat but the player's
 * @param without - The name the player is sitting under, so no bot takes it too
 * @param color - The colour they are playing in, so no bot takes that either
 * @returns The bots, ready to be seated
 */
export function createBots(count: number, without: string, color: number): MatchPlayer[] {
  const taken = without.trim().toLowerCase()
  const undrawn = BOT_NAMES.filter((name) => name.toLowerCase() !== taken)
  const unpainted = PAINTED_SKINS.filter((skin) => skin !== color)
  const bots: MatchPlayer[] = []

  while (bots.length < count) {
    const [name] = undrawn.splice(Math.floor(Math.random() * undrawn.length), 1)
    const [skin] = unpainted.splice(Math.floor(Math.random() * unpainted.length), 1)

    // Unreachable: both pools are larger than the most bots a match can hold.
    // Guarded rather than asserted away, since indexing yields a possible
    // undefined and this project does not argue with that.
    if (name === undefined || skin === undefined) {
      break
    }

    bots.push({
      uid: `${BOT_UID_PREFIX}${bots.length + 1}`,
      name: name,
      color: skin,
      bot: true,
    })
  }

  return bots
}

/**
 * What a bot does with the turn it is holding.
 *
 * The first throw of a turn is not a decision at all — a player may only pass
 * once they have thrown, so a turn that has just arrived is thrown into
 * whatever is there. Everything below is the choice that follows a throw which
 * paired nothing and left the turn where it was.
 * @param state - The match as it currently stands
 * @param uid - The bot whose turn it is
 * @returns Whether it throws again or ends its turn
 */
export function nextBotMove(state: MatchState, uid: string): BotMove {
  const hand = poolSize(state, uid)

  // Nothing to throw, whether or not the turn has had a throw yet. Asked first
  // rather than after the forced opening throw below, because a hand of
  // nothing is the one state that makes throwing meaningless rather than
  // merely unwise. The rules skip an empty hand when they hand the turn on, so
  // this is only ever the moment before that write arrives.
  if (hand <= 0) {
    return 'pass'
  }

  if (!state.hasThrown) {
    return 'throw'
  }

  const paying = payingFaces(state)

  // A hand of one is not an ordinary throw: a hand of nothing, once the throw
  // is judged, is elimination and there is no way back off it. So the last die
  // is risked only on a bowl where every face but the six pays, rather than on
  // one that merely pays on average.
  if (hand === 1) {
    const pays = paying.completing + paying.flushing

    return pays >= DIE_FACES - REMOVING_FACES ? 'throw' : 'pass'
  }

  // Level is taken rather than declined: a die that settles instead walks the
  // bowl nearer a group, where the next throw is in the thrower's favour and
  // the turn is still theirs to take it.
  return throwValue(paying, state.groupSize) >= 0 ? 'throw' : 'pass'
}

/**
 * What the bot in one seat says about the throw that has just been judged, or
 * null for a throw not worth remarking on — which is most of them.
 *
 * Asked of the bowl rather than of a clock. A bot that spoke on a timer would be
 * talking to itself, and the whole of an emote is that it is about something the
 * table has just watched happen.
 *
 * Two of the answers are about a hand rather than about the bowl, and both are
 * measured against the seat that threw. A hand only ever shrinks on its own
 * player's throw, so the thrower is the only seat a verdict can have emptied or
 * brought down to its last die — which is what lets the change be read straight
 * off the match as it now stands, with no memory of how it stood before.
 *
 * Choosing is the whole of what happens here. The pacing that stops one bot
 * saying two things in a breath belongs to the screen, beside the pause it draws
 * before a move, for the same reason: this is the deciding, and the screen does
 * the acting.
 * @param state - The match as it stands, with this verdict already in it
 * @param bot - The seat being asked
 * @param resolution - What the throw came to
 * @param thrower - The seat that made it
 * @returns Which of EMOTES to say, or null to stay quiet
 */
export function nextBotEmote(
  state: MatchState,
  bot: string,
  resolution: ThrowResolution,
  thrower: string,
): number | null {
  // A throw whose seat cannot be named is a throw there is nothing to say about.
  // Everything below reads a hand off the thrower, and a hand nobody is holding
  // is an empty one — which is elimination to every question that asks.
  if (!state.players.some((player) => player.uid === thrower)) {
    return null
  }

  const mine = thrower === bot

  // The match being over outranks whatever else the throw did, and is the one
  // thing here a bot answers for itself rather than about somebody
  if (state.winner !== null) {
    if (!chance(BOT_EMOTE_ODDS.matchOver)) {
      return null
    }

    return state.winner === bot ? EMOTE.onFire : EMOTE.nice
  }

  // Somebody has just thrown their last die away
  if (!mine && poolSize(state, thrower) === 0) {
    return chance(BOT_EMOTE_ODDS.elimination) ? EMOTE.whoa : null
  }

  // The same reading of the same hand, one die earlier, about its own
  if (mine && poolSize(state, bot) === 1) {
    return chance(BOT_EMOTE_ODDS.lastDie) ? EMOTE.ruined : null
  }

  const kind = returnedDiceKind(resolution)

  if (kind === 'flush') {
    return chance(BOT_EMOTE_ODDS.flush) ? EMOTE.whoa : null
  }

  if (kind === 'pair') {
    if (!chance(mine ? BOT_EMOTE_ODDS.ownGroup : BOT_EMOTE_ODDS.otherGroup)) {
      return null
    }

    return mine ? EMOTE.onFire : EMOTE.nice
  }

  // Sixes left the match and nothing came back, which is the only throw at this
  // table that costs a hand dice and pays nobody
  if (resolution.removed.length > 0) {
    if (!chance(mine ? BOT_EMOTE_ODDS.ownLoss : BOT_EMOTE_ODDS.otherLoss)) {
      return null
    }

    return mine ? EMOTE.ruined : EMOTE.ha
  }

  // A die that simply settled into the bowl, which is most throws and is not
  // something anybody at a table would remark on
  return null
}

/** The faces of the die about to be thrown that would bring dice back. */
interface PayingFaces {
  completing: number // Values the bowl holds one short of a group
  flushing: number // The value missing from a flush, when the bowl is one off one
}

/**
 * How many of a die's six faces would bring dice back to the hand that threw it.
 *
 * Two ways that happens, and they can never be the same face: a value the bowl
 * already holds one short of a group completes it, and — only in a match that
 * plays the flush, and only when the bowl is one die short of one with no value
 * repeated in it — the one value missing from it brings the whole bowl back.
 * @param state - The match as it currently stands
 * @returns The paying faces, counted apart because the two pay different amounts
 */
function payingFaces(state: MatchState): PayingFaces {
  const counts = new Map<number, number>()

  for (const die of state.bowl) {
    counts.set(die.face, (counts.get(die.face) ?? 0) + 1)
  }

  let completing = 0

  for (const count of counts.values()) {
    if (count === state.groupSize - 1) {
      completing++
    }
  }

  // A flush is the whole bowl holding one of every value a die keeps, so the
  // throw before one goes into a bowl of four with no value repeated in it.
  // A match that does not play it never pays for one, and its bowl goes a die
  // further than a flush would ever have let it.
  const flushing = state.flush
    && state.bowl.length === FLUSH_FACES.length - 1
    && counts.size === state.bowl.length

  return {
    completing: completing,
    flushing: flushing ? 1 : 0,
  }
}

/**
 * What one more throw is worth to the hand making it, in dice.
 *
 * One throw is exactly countable, because the bowl in front of it is: every six
 * has left the match and every group has gone back to a hand, so no value sits
 * in the bowl having already made one. Of the six faces the die can land on,
 * one takes it out of the match, some number of them complete a group and bring
 * it back whole, one may complete a flush and bring the entire bowl back, and
 * the rest leave the die in the bowl — which costs the hand that die just as
 * surely, until somebody wins it.
 *
 * At a group of two that is -0.67 against a bowl of one, -0.33 against two,
 * level against three and +1.17 against four. At a group of three the bowl is
 * larger and a group pays more, and the throw comes level once two values are
 * sitting doubled in it. Without the flush the same count holds and the bowl
 * simply goes one die further: five distinct values pay +0.67, since the only
 * face left that does not is the six.
 * @param paying - The faces of the throw that would bring dice back
 * @param groupSize - How many dice of one value this match counts as a group
 * @returns The dice the throw is expected to gain, which is negative when it loses
 */
function throwValue(paying: PayingFaces, groupSize: number): number {
  const settling = DIE_FACES - REMOVING_FACES - paying.completing - paying.flushing

  // A group pays its whole size for the one die thrown, and a flush the whole
  // bowl it completes; every other face costs the hand the die it threw
  const gained = paying.completing * (groupSize - 1)
    + paying.flushing * (FLUSH_FACES.length - 1)

  return (gained - REMOVING_FACES - settling) / DIE_FACES
}

/**
 * Whether a draw came in.
 * @param likelihood - How often it should, between never and always
 * @returns Whether this is one of those times
 */
function chance(likelihood: number): boolean {
  return Math.random() < likelihood
}
