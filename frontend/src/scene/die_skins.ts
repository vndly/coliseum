import {DIE_COLOR, DIE_PIP_COLOR} from '@/scene/dimensions'

/**
 * The colours a die can be painted in, and the one number that names one.
 *
 * A skin is paint and nothing else: it says who put a die into the game, not
 * who holds it now. A player's six start in the colour they chose and keep it
 * for the whole match, through every hand they pass into — which is why a die
 * carries its own skin across the network rather than being coloured from
 * whoever last threw it.
 *
 * Fixed rather than free, because every colour here has three things to answer
 * for. It has to read against the walnut of the bowl and the baize of the
 * table; it has to stay clear of the two colours a verdict washes a die in, or
 * the wash would say nothing on a die already wearing it; and it has to carry
 * a pip colour of its own, since the pips are what a face is counted by and
 * black on a dark body is a die nobody can read. Answering all three at the
 * point a colour is picked is what keeps any of it out of the render loop.
 *
 * Marigold is the one that answers the second only partly. It sits between
 * Amber and the ember a six washes a die in, so a marigold die leaving the
 * match says it more quietly than any other colour here does. It is in the
 * palette because it was asked for, and this is where that is written down
 * rather than rediscovered.
 *
 * Eight of them: six for the largest table, so a match of bots can seat every
 * player in a colour of their own, and two spare so the choice is a choice.
 */
export interface DieSkin {
  name: string // Shown where the colour is offered, and read out where it is not
  body: number // The die itself
  pip: number // The pips sunk into it, light or dark according to the body
}

/** The pip colour a light body carries, which is the bone die's own. */
const DARK_PIP = DIE_PIP_COLOR

/** The pip colour a dark body carries, which is the bone die's own body. */
const LIGHT_PIP = DIE_COLOR

/**
 * The bone die itself, named so that the fallback below has something to be
 * rather than an index that has to be defended a second time.
 */
const BONE: DieSkin = {
  name: 'Bone',
  body: DIE_COLOR,
  pip: DARK_PIP,
}

/**
 * The bone die, which is skin zero.
 *
 * It is both the colour a player is given before they have chosen one and the
 * colour of the die the match opens with — the one nobody threw. The two are
 * deliberately the same rather than kept apart by a reserved value: a player
 * throwing bone dice is holding the same paint the house put down, and since
 * nothing in the rules can tell the two apart, nothing in the scene has to
 * either.
 */
export const BONE_SKIN = 0

export const DIE_SKINS: DieSkin[] = [
  BONE,
  {
    name: 'Claret',
    body: 0x9c2b3f,
    pip: LIGHT_PIP,
  },
  {
    name: 'Amber',
    body: 0xe0a13c,
    pip: DARK_PIP,
  },
  {
    name: 'Marigold',
    body: 0xec7f14,
    pip: DARK_PIP,
  },
  {
    name: 'Lapis',
    body: 0x35569f,
    pip: LIGHT_PIP,
  },
  {
    name: 'Amethyst',
    body: 0x7d4b9e,
    pip: LIGHT_PIP,
  },
  {
    name: 'Onyx',
    body: 0x191b21,
    pip: LIGHT_PIP,
  },
  {
    name: 'Fern',
    body: 0x4f9c2e,
    pip: DARK_PIP,
  },
]

/**
 * Whether a number names one of the colours above.
 *
 * Asked wherever a skin arrives from outside this browser — out of the
 * database, or off a stored preference — so that everything downstream of the
 * check can index the palette without asking again.
 * @param skin - The number to test
 * @returns Whether it is a skin a die can be painted in
 */
export function isDieSkin(skin: number): boolean {
  return Number.isInteger(skin) && skin >= 0 && skin < DIE_SKINS.length
}

/**
 * The colours one skin is drawn in.
 * @param skin - Which of the palette above
 * @returns Its body and pip colours, falling back to bone for a skin that is not one
 */
export function dieSkin(skin: number): DieSkin {
  return DIE_SKINS[skin] ?? BONE
}

/**
 * The same colours, written the way a stylesheet reads them.
 *
 * Here rather than in the interface so that the dice on the table and the
 * swatches that chose them are one list and not two. Three parses these back
 * to the same numbers it started from, which is why the palette is kept as
 * numbers and turned into text at the one edge that needs text.
 * @param skin - Which of the palette above
 * @returns Its body and pip colours as CSS hex
 */
export function dieSkinCss(skin: number): {body: string,
  pip: string} {
  const colors = dieSkin(skin)

  return {
    body: `#${colors.body.toString(16).padStart(6, '0')}`,
    pip: `#${colors.pip.toString(16).padStart(6, '0')}`,
  }
}
