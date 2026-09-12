/**
 * The emotes a player can send to the table.
 *
 * A fixed set rather than free text, for the same reason a die comes in a fixed
 * palette: every glyph has to read at a glance, against the walnut, in whatever
 * the player's own platform draws it as. What crosses the network is an index
 * into this list, exactly as a colour is an index into DIE_SKINS — nothing in
 * the rules reads it, nothing in the scene ever sees it, and it is carried
 * rather than judged.
 */

export interface Emote {
  glyph: string
  name: string // What anything reading the interface out loud says instead of the glyph
}

/**
 * The six, in the order the picker lays them out: three across, two down.
 *
 * One per thing a player might want to say, and deliberately no two that
 * overlap — a table given two ways to say that a throw went badly uses them
 * interchangeably and ends up saying neither. The last of them is the one a
 * turn-based game needs most and the one nothing else on the screen can say:
 * four players, and one of them has gone quiet.
 *
 * The order is part of the stored shape rather than a presentation detail. An
 * emote travels as its position here, so an entry added to the end costs
 * nothing, while a cut renumbers every entry below it and an emote already in
 * flight arrives meaning something else. The set was cut from eight to six and
 * renumbered once, knowingly, and what that cost is bounded: an emote is only
 * ever read live — the slots a player finds waiting when they join are counted
 * and not shown — so the whole of the damage is a wrong glyph for three seconds
 * on a tab left open across the deploy, and it heals the moment that tab
 * reloads. It is not worth paying twice. From here an entry goes on the end.
 */
export const EMOTES: Emote[] = [
  {
    glyph: '😮',
    name: 'Whoa',
  },
  {
    glyph: '😂',
    name: 'Ha',
  },
  {
    glyph: '😭',
    name: 'Ruined',
  },
  {
    glyph: '👏',
    name: 'Nice',
  },
  {
    glyph: '🔥',
    name: 'On fire',
  },
  {
    glyph: '🕓',
    name: 'Hurry up',
  },
]

/**
 * The emotes by name, for the code that chooses one instead of offering all
 * six.
 *
 * Positions in the list above, written out beside it rather than looked up, so
 * every one of them has to be counted again by hand whenever that list changes.
 * That is the second reason to leave its order alone, the first being the emotes
 * already in flight.
 */
export const EMOTE = {
  whoa: 0,
  ha: 1,
  ruined: 2,
  nice: 3,
  onFire: 4,
  hurry: 5,
} as const

/** The emote a set that has lost its footing falls back to. */
const UNKNOWN: Emote = {
  glyph: '❔',
  name: 'Unknown',
}

/**
 * Whether a number names one of the emotes above.
 *
 * Asked wherever an emote arrives from outside this browser, so that everything
 * downstream of the check can index the set without asking again.
 * @param emote - The number to test
 * @returns Whether it is an emote a player can send
 */
export function isEmote(emote: number): boolean {
  return Number.isInteger(emote) && emote >= 0 && emote < EMOTES.length
}

/**
 * The emote one number names.
 * @param index - Which of the set above
 * @returns Its glyph and name, falling back to a question for a number that is not one
 */
export function emote(index: number): Emote {
  return EMOTES[index] ?? UNKNOWN
}
