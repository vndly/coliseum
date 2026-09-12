import {DIE_CARBON_COLOR,
  DIE_CARBON_WEAVE_COLOR,
  DIE_COLOR,
  DIE_GLASS_COLOR,
  DIE_ICE_COLOR,
  DIE_MALACHITE_BAND_COLOR,
  DIE_MALACHITE_COLOR,
  DIE_MAPLE_COLOR,
  DIE_MAPLE_GRAIN_COLOR,
  DIE_MARBLE_COLOR,
  DIE_MARBLE_VEIN_COLOR,
  DIE_PEARL_COLOR,
  DIE_PIP_COLOR,
  DIE_STEEL_COLOR} from '@/scene/dimensions'

/**
 * The colours and materials a die can be made in, and the one number that
 * names one.
 *
 * A skin is the die's appearance and nothing else: it says who put a die into
 * the game, not who holds it now. A player's six start in the skin they chose
 * and keep it for the whole match, through every hand they pass into — which
 * is why a die carries its own skin across the network rather than being
 * painted from whoever last threw it.
 *
 * Fixed rather than free, because every skin here has three things to answer
 * for. It has to read against the walnut of the bowl and the baize of the
 * table; it has to stay clear of the two colours a verdict washes a die in, or
 * the wash would say nothing on a die already wearing it; and it has to carry
 * a pip colour of its own, since the pips are what a face is counted by and
 * black on a dark body is a die nobody can read. Answering all three at the
 * point a skin is picked is what keeps any of it out of the render loop.
 *
 * Marigold is the one that answers the second only partly. It sits between
 * Amber and the ember a six washes a die in, so a marigold die leaving the
 * match says it more quietly than any other skin here does. It is in the
 * palette because it was asked for, and this is where that is written down
 * rather than rediscovered.
 *
 * Sixteen of them, in two halves. The first eight are paint: one colour, on
 * the same polished resin, and six of them would seat the largest table with
 * two spare so the choice is a choice. The eight after them are materials
 * instead — stone, metal, timber, glass — and each is built from the figures
 * in dimensions.ts and, where it has a pattern, from a map drawn in
 * die_textures.ts. They cost more to draw than paint does and are worth it in
 * exactly one place: a rail where two people have picked something pale is far
 * easier to read when one of them is marble and the other is bone.
 */
export interface DieSkin {
  name: string // Shown where the skin is offered, and read out where it is not
  body: number // The die itself, or the ground a pattern is laid over
  pip: number // The pips sunk into it, light or dark according to the body
  finish: DieFinish // What the body is made of, which is what draws it
}

/**
 * What a die's body is made of.
 *
 * Paint is the original palette and the only finish that is a colour alone;
 * every other name here is a material, and stands for a set of figures in
 * dimensions.ts and, for four of them, a pattern in die_textures.ts. It is
 * spelt out as a union rather than left as a number so that the one switch
 * that builds a material is checked against this list, and adding a finish
 * without teaching that switch about it is a build failure rather than a die
 * that comes out bone.
 */
export type DieFinish
  = | 'paint'
    | 'marble'
    | 'steel'
    | 'maple'
    | 'ice'
    | 'malachite'
    | 'glass'
    | 'pearl'
    | 'carbon'

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
  finish: 'paint',
}

/**
 * The bone die, which is skin zero.
 *
 * It is both the skin a player is given before they have chosen one and the
 * skin of the die the match opens with — the one nobody threw. The two are
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
    finish: 'paint',
  },
  {
    name: 'Amber',
    body: 0xe0a13c,
    pip: DARK_PIP,
    finish: 'paint',
  },
  {
    name: 'Marigold',
    body: 0xec7f14,
    pip: DARK_PIP,
    finish: 'paint',
  },
  {
    name: 'Lapis',
    body: 0x35569f,
    pip: LIGHT_PIP,
    finish: 'paint',
  },
  {
    name: 'Amethyst',
    body: 0x7d4b9e,
    pip: LIGHT_PIP,
    finish: 'paint',
  },
  {
    name: 'Onyx',
    body: 0x191b21,
    pip: LIGHT_PIP,
    finish: 'paint',
  },
  {
    name: 'Fern',
    body: 0x4f9c2e,
    pip: DARK_PIP,
    finish: 'paint',
  },
  {
    name: 'Marble',
    body: DIE_MARBLE_COLOR,
    pip: DARK_PIP,
    finish: 'marble',
  },
  {
    name: 'Steel',
    body: DIE_STEEL_COLOR,
    pip: DARK_PIP,
    finish: 'steel',
  },
  {
    name: 'Maple',
    body: DIE_MAPLE_COLOR,
    pip: DARK_PIP,
    finish: 'maple',
  },
  {
    name: 'Ice',
    body: DIE_ICE_COLOR,
    pip: DARK_PIP,
    finish: 'ice',
  },
  {
    name: 'Malachite',
    body: DIE_MALACHITE_COLOR,
    pip: LIGHT_PIP,
    finish: 'malachite',
  },
  {
    name: 'Glass',
    body: DIE_GLASS_COLOR,
    pip: DARK_PIP,
    finish: 'glass',
  },
  {
    name: 'Pearl',
    body: DIE_PEARL_COLOR,
    pip: DARK_PIP,
    finish: 'pearl',
  },
  {
    name: 'Carbon',
    body: DIE_CARBON_COLOR,
    pip: LIGHT_PIP,
    finish: 'carbon',
  },
]

/**
 * The skins that are paint alone, which is what a bot is drawn from.
 *
 * Bots are held to the first half of the palette on purpose. Nobody chose a
 * bot's appearance, and the materials are what a player picked out for
 * themselves — a table of bots in glass and marble would spend the expensive
 * half of the palette on the seats that did not ask for it, and take two
 * transmission passes onto a screen whose owner chose paint.
 */
export const PAINTED_SKINS: number[] = DIE_SKINS
  .map((_, skin) => skin)
  .filter((skin) => DIE_SKINS[skin]?.finish === 'paint')

/**
 * Whether a number names one of the skins above.
 *
 * Asked wherever a skin arrives from outside this browser — out of the
 * database, or off a stored preference — so that everything downstream of the
 * check can index the palette without asking again.
 * @param skin - The number to test
 * @returns Whether it is a skin a die can be made in
 */
export function isDieSkin(skin: number): boolean {
  return Number.isInteger(skin) && skin >= 0 && skin < DIE_SKINS.length
}

/**
 * The skin one number names.
 * @param skin - Which of the palette above
 * @returns Its colours and finish, falling back to bone for a skin that is not one
 */
export function dieSkin(skin: number): DieSkin {
  return DIE_SKINS[skin] ?? BONE
}

/**
 * One colour, written the way a stylesheet reads it.
 * @param color - The colour, as the palette holds it
 * @returns The same colour as CSS hex
 */
function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/**
 * A skin as the one CSS background that stands for it.
 *
 * Here rather than in each component so that the dice on the table and the
 * swatches that chose them are one list and not two, and here rather than in a
 * stylesheet because the interface shows a skin in two places — the lobby's
 * palette and the match's rail — and a second copy of these recipes is a
 * second place for them to drift from the material.
 *
 * They are impressions and not renders: a gradient cannot refract, so what the
 * glass swatch shows is a body dark enough to see the card through and a
 * highlight across it. What each one has to do is be told apart from the
 * fifteen beside it at two centimetres, which is the size the palette is
 * actually read at.
 * @param skin - The skin to draw
 * @returns A CSS background value, which for paint is simply its colour
 */
function surfaceCss(skin: DieSkin): string {
  const body = css(skin.body)

  switch (skin.finish) {
    case 'marble':
      return [
        `linear-gradient(118deg, transparent 37%, ${css(DIE_MARBLE_VEIN_COLOR)}40 43%, ${css(DIE_MARBLE_VEIN_COLOR)}b3 46%, ${css(DIE_MARBLE_VEIN_COLOR)}40 49%, transparent 55%)`,
        `linear-gradient(103deg, transparent 60%, ${css(DIE_MARBLE_VEIN_COLOR)}59 68%, transparent 76%)`,
        `linear-gradient(126deg, transparent 10%, ${css(DIE_MARBLE_VEIN_COLOR)}33 17%, transparent 24%)`,
        body,
      ].join(', ')

    case 'steel':
      return `linear-gradient(147deg, #ffffff00 0%, #ffffff59 17%, #00000026 35%, #ffffff4d 54%, #00000033 73%, #ffffff26 100%), ${body}`

    case 'maple':
      return `repeating-linear-gradient(96deg, ${css(DIE_MAPLE_GRAIN_COLOR)}00 0 4px, ${css(DIE_MAPLE_GRAIN_COLOR)}80 4px 5px, ${css(DIE_MAPLE_GRAIN_COLOR)}00 5px 11px), ${body}`

    case 'ice':
      return [
        'radial-gradient(circle at 32% 26%, #ffffffe0 0 18%, #ffffff00 62%)',
        `linear-gradient(153deg, ${body} 0%, #b7d6e0 100%)`,
      ].join(', ')

    case 'malachite':
      return `repeating-radial-gradient(circle at 32% 68%, ${body} 0 2px, ${css(DIE_MALACHITE_BAND_COLOR)} 4px, ${body} 6px)`

    case 'glass':
      return [
        'linear-gradient(126deg, #ffffff00 0 33%, #ffffffb3 38% 44%, #ffffff00 49%)',
        `linear-gradient(160deg, ${body}66 0%, ${body}1f 60%, ${body}59 100%)`,
      ].join(', ')

    case 'pearl':
      return `linear-gradient(132deg, #ffe8f3 0%, ${body} 25%, #e4f1ff 47%, #e8fbef 68%, #fff2dd 87%, ${body} 100%)`

    case 'carbon':
      return [
        `repeating-linear-gradient(45deg, ${css(DIE_CARBON_WEAVE_COLOR)}00 0 2px, ${css(DIE_CARBON_WEAVE_COLOR)} 2px 4px, ${css(DIE_CARBON_WEAVE_COLOR)}00 4px 6px)`,
        `repeating-linear-gradient(-45deg, ${css(DIE_CARBON_WEAVE_COLOR)}00 0 2px, ${css(DIE_CARBON_WEAVE_COLOR)}80 2px 4px, ${css(DIE_CARBON_WEAVE_COLOR)}00 4px 6px)`,
        body,
      ].join(', ')

    case 'paint':
      return body
  }
}

/**
 * The same skin, written the way a stylesheet reads it.
 *
 * Three parses the body colour back to the same number it started from, which
 * is why the palette is kept as numbers and turned into text at the one edge
 * that needs text. The body is the flat colour the skin reads as — what an
 * edge or a border is drawn in — and the surface is the whole of it, pattern
 * and all.
 * @param skin - Which of the palette above
 * @returns Its flat colour, its pip colour, and the background it is shown as
 */
export function dieSkinCss(skin: number): {body: string,
  pip: string,
  surface: string} {
  const colors = dieSkin(skin)

  return {
    body: css(colors.body),
    pip: css(colors.pip),
    surface: surfaceCss(colors),
  }
}
