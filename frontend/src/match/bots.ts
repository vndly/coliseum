import type {MatchPlayer, MatchState} from '@/match/match_state'
import {poolSize} from '@/match/rules'
import {DIE_SKINS} from '@/scene/die_skins'

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

/**
 * The smallest bowl worth throwing another die into.
 *
 * A bowl at rest holds nothing but distinct values from one to five: every six
 * has been taken out of the match and every group has gone back to a hand, so
 * four dice is the most one can hold and a fifth would be a flush. That makes
 * one throw exactly countable. With B dice in the bowl, the die comes up a six
 * and leaves the match (one chance in six), matches one already there and
 * brings the pair back (B in six), completes a flush and brings the whole bowl
 * back (only at four, one in six), or settles in beside the others (the rest).
 * In dice to the hand that is -0.67 at one, -0.33 at two, level at three and
 * +1.17 at four.
 *
 * Three is where it stops losing, and it is worth taking rather than merely
 * even: a die that settles walks the bowl up to four, where the next throw is
 * strongly in the thrower's favour and the turn is still theirs to take it.
 */
const THROW_AGAIN_BOWL = 3

/**
 * The bowl a bot will risk its last die on.
 *
 * Throwing the last die in hand is not an ordinary throw: a hand of nothing,
 * once the throw is judged, is elimination and there is no way back off it. So
 * the only bowl worth it is the one where five outcomes in six pay — the full
 * four, where anything but a six comes back doubled or brings the flush.
 */
const LAST_DIE_BOWL = 4

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
  const unpainted = DIE_SKINS.map((_, skin) => skin).filter((skin) => skin !== color)
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

  const bowl = state.bowl.length
  const worthwhile = hand === 1 ? LAST_DIE_BOWL : THROW_AGAIN_BOWL

  return bowl >= worthwhile ? 'throw' : 'pass'
}
