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
 * The eight, in the order the picker lays them out: four across, two down.
 *
 * One per thing a player might want to say, and deliberately no two that
 * overlap — a table given two ways to say that a throw went badly uses them
 * interchangeably and ends up saying neither. The last of them is the one a
 * turn-based game needs most and the one nothing else on the screen can say:
 * four players, and one of them has gone quiet.
 *
 * The order is part of the stored shape rather than a presentation detail. An
 * emote travels as its position here, so an entry may be added to the end and
 * none may ever be reordered — an emote already in flight would arrive meaning
 * something else.
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
    glyph: '👏',
    name: 'Nice',
  },
  {
    glyph: '🔥',
    name: 'On fire',
  },
  {
    glyph: '💀',
    name: 'Brutal',
  },
  {
    glyph: '😭',
    name: 'Ruined',
  },
  {
    glyph: '🙏',
    name: 'Please',
  },
  {
    glyph: '⏳',
    name: 'Hurry up',
  },
]

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
