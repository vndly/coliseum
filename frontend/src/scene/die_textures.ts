import {DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace} from 'three'
import type {Texture} from 'three'
import {DIE_CARBON_COLOR,
  DIE_CARBON_WEAVE_COLOR,
  DIE_CARBON_WEAVE_TOWS,
  DIE_MALACHITE_BAND_COLOR,
  DIE_MALACHITE_BANDS,
  DIE_MALACHITE_COLOR,
  DIE_MALACHITE_TURBULENCE,
  DIE_MAPLE_COLOR,
  DIE_MAPLE_GRAIN_COLOR,
  DIE_MAPLE_GRAIN_RINGS,
  DIE_MAPLE_GRAIN_SHARPNESS,
  DIE_MAPLE_GRAIN_WANDER,
  DIE_MARBLE_COLOR,
  DIE_MARBLE_VEIN_COLOR,
  DIE_MARBLE_VEIN_FREQUENCY,
  DIE_MARBLE_VEIN_SHARPNESS,
  DIE_MARBLE_VEIN_TURBULENCE,
  DIE_PEARL_FILM_SWIRL,
  DIE_STEEL_BRUSH_DEPTH,
  DIE_STEEL_BRUSH_FINENESS,
  DIE_STEEL_BRUSH_LENGTH,
  DIE_TEXTURE_SIZE} from '@/scene/dimensions'

/**
 * The patterns the textured finishes are cut from, drawn rather than loaded.
 *
 * Six maps in all. Four of the finishes in DIE_SKINS are a pattern rather than
 * a colour, and two more are a measurement laid over a colour: the polish
 * dragged across the steel, and the thickness of the film over the pearl. All
 * six are generated here, from the frequencies stated in dimensions.ts — which
 * is why this project ships no image files and needs no loader, and why a
 * finish is retuned by changing a number rather than by opening a paint
 * program.
 *
 * There is one path through this file: a function saying how much of the
 * second colour, or how much of the measurement, is at a point, and a filler
 * that walks it over the pixels. The noise the patterns wander by tiles, so a
 * pattern can be laid across a face without its own repeat showing. The faces
 * are not continuous with one another and are not meant to be — a rounded box
 * gives each of the six its own copy of the whole texture.
 *
 * A generated map is the die's own property and has to be released with it:
 * every function here hands back a texture the caller is expected to dispose.
 */

const CHANNELS = 4 // Red, green, blue and the alpha every one of these leaves opaque
const NOISE_OCTAVES = 3 // How many octaves every pattern's wander is built from

/**
 * A deterministic value in zero to one for a point on the noise lattice. The
 * same corner always answers the same thing, which is what makes a pattern the
 * same on every machine in the match.
 *
 * Integer arithmetic throughout, and deliberately. The usual way to write this
 * is the fractional part of a large multiple of a sine, which is both slower —
 * a sine per lattice corner, and there are millions of them — and not actually
 * the same everywhere: the language does not require Math.sin to be correctly
 * rounded, so a last-bit difference between two engines is multiplied up into
 * an entirely different value. Math.imul and the shifts below are exact on
 * every engine, which is what lets the promise above be made at all.
 * @param x - The lattice column
 * @param y - The lattice row
 * @returns The corner's value
 */
function hash(x: number, y: number): number {
  const mixed = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0
  const stirred = Math.imul(mixed ^ mixed >>> 13, 1274126177)

  // Unsigned before the divide, since the stirring leaves the sign bit set
  // half the time and a negative corner would fold the whole lattice
  return ((stirred ^ stirred >>> 16) >>> 0) / 0x100000000
}

/**
 * Brings a lattice coordinate back inside one period, so that the pattern
 * built on it repeats rather than running on forever.
 * @param value - The coordinate
 * @param period - How many cells it repeats over
 * @returns The same coordinate, inside the first period
 */
function wrap(value: number, period: number): number {
  return ((value % period) + period) % period
}

/**
 * Smooth value noise: the lattice corners, interpolated across the cell
 * between them.
 * @param x - Where across the lattice, in cells
 * @param y - Where down it, in cells
 * @param periodX - How many cells across before the pattern repeats
 * @param periodY - And how many down
 * @returns A value in zero to one
 */
function noise(x: number, y: number, periodX: number, periodY: number): number {
  const cellX = Math.floor(x)
  const cellY = Math.floor(y)
  const alongX = x - cellX
  const alongY = y - cellY

  // Smoothstep on both axes, so the lattice is not visible as a grid of
  // creases where the linear interpolations meet
  const easedX = alongX * alongX * (3 - 2 * alongX)
  const easedY = alongY * alongY * (3 - 2 * alongY)

  const left = wrap(cellX, periodX)
  const right = wrap(cellX + 1, periodX)
  const top = wrap(cellY, periodY)
  const bottom = wrap(cellY + 1, periodY)

  // Each corner asked for once and held. Written the obvious way this reads
  // the same corner twice per axis, and the corners are most of the cost of
  // every pattern in this file
  const topLeft = hash(left, top)
  const topRight = hash(right, top)
  const bottomLeft = hash(left, bottom)
  const bottomRight = hash(right, bottom)

  const above = topLeft + (topRight - topLeft) * easedX
  const below = bottomLeft + (bottomRight - bottomLeft) * easedX

  return above + (below - above) * easedY
}

/**
 * Several octaves of the noise above, each half as strong and twice as fine as
 * the last. One octave is a soft blur; this is what looks like a material.
 * @param x - Where across the lattice, in cells
 * @param y - Where down it, in cells
 * @param periodX - How many cells across before the pattern repeats
 * @param periodY - And how many down
 * @returns A value in zero to one
 */
function fbm(x: number, y: number, periodX: number, periodY: number): number {
  let total = 0
  let weight = 0
  let amplitude = 1
  let frequency = 1

  for (let octave = 0; octave < NOISE_OCTAVES; octave++) {
    total += noise(
      x * frequency,
      y * frequency,
      periodX * frequency,
      periodY * frequency,
    ) * amplitude

    weight += amplitude
    amplitude /= 2
    frequency *= 2
  }

  return total / weight
}

/**
 * Holds a value inside zero to one, for the patterns that add two figures
 * together and could land either side.
 * @param value - The figure to hold
 * @returns It, brought inside the range
 */
function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/**
 * Gives a generated map the settings every one of them wants, and hands it
 * back ready to be hung on a material.
 * @param data - The pixels, already filled
 * @param sRGB - Whether the pixels are a colour, as opposed to a measurement
 * @returns The finished texture
 */
function finish(data: Uint8Array, sRGB: boolean): Texture {
  const texture = new DataTexture(data, DIE_TEXTURE_SIZE, DIE_TEXTURE_SIZE, RGBAFormat)

  // A DataTexture arrives nearest-filtered and without mipmaps, which on a die
  // tumbling away from the camera is where the sparkle comes from
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping

  if (sRGB) {
    texture.colorSpace = SRGBColorSpace
  }

  texture.needsUpdate = true

  return texture
}

/**
 * Fills a map by mixing two colours, a pattern saying how much of the second
 * is at each point.
 * @param first - The colour where the pattern is at nothing
 * @param second - The colour where it is at everything
 * @param pattern - How much of the second colour is at a point of the face
 * @returns The finished texture
 */
function blend(
  first: number,
  second: number,
  pattern: (u: number, v: number) => number,
): Texture {
  const data = new Uint8Array(DIE_TEXTURE_SIZE * DIE_TEXTURE_SIZE * CHANNELS)

  const firstRed = (first >> 16) & 0xff
  const firstGreen = (first >> 8) & 0xff
  const firstBlue = first & 0xff
  const secondRed = (second >> 16) & 0xff
  const secondGreen = (second >> 8) & 0xff
  const secondBlue = second & 0xff

  for (let y = 0; y < DIE_TEXTURE_SIZE; y++) {
    for (let x = 0; x < DIE_TEXTURE_SIZE; x++) {
      // Sampled at the middle of the pixel rather than its corner, so a
      // pattern that is symmetric about the face stays symmetric
      const amount = clamp(pattern(
        (x + 0.5) / DIE_TEXTURE_SIZE,
        (y + 0.5) / DIE_TEXTURE_SIZE,
      ))

      const offset = (y * DIE_TEXTURE_SIZE + x) * CHANNELS

      data[offset] = firstRed + (secondRed - firstRed) * amount
      data[offset + 1] = firstGreen + (secondGreen - firstGreen) * amount
      data[offset + 2] = firstBlue + (secondBlue - firstBlue) * amount
      data[offset + 3] = 0xff
    }
  }

  return finish(data, true)
}

/**
 * Fills a map that is a measurement rather than a colour: a figure at every
 * point, which a material multiplies one of its own numbers by.
 * @param pattern - The figure at a point of the face, in zero to one
 * @returns The finished texture
 */
function measure(pattern: (u: number, v: number) => number): Texture {
  const data = new Uint8Array(DIE_TEXTURE_SIZE * DIE_TEXTURE_SIZE * CHANNELS)

  for (let y = 0; y < DIE_TEXTURE_SIZE; y++) {
    for (let x = 0; x < DIE_TEXTURE_SIZE; x++) {
      const amount = clamp(pattern(
        (x + 0.5) / DIE_TEXTURE_SIZE,
        (y + 0.5) / DIE_TEXTURE_SIZE,
      )) * 0xff

      const offset = (y * DIE_TEXTURE_SIZE + x) * CHANNELS

      data[offset] = amount
      data[offset + 1] = amount
      data[offset + 2] = amount
      data[offset + 3] = 0xff
    }
  }

  return finish(data, false)
}

/**
 * Marble: veins pulled across the face on a diagonal and dragged out of
 * straight by the noise.
 *
 * The veins are the zero crossings of the wave rather than its peaks, which is
 * what makes them lines through the stone instead of stripes of a second
 * colour.
 * @returns The map, to be disposed with the material carrying it
 */
export function marbleTexture(): Texture {
  return blend(DIE_MARBLE_COLOR, DIE_MARBLE_VEIN_COLOR, (u, v) => {
    const drift = fbm(u * 2, v * 2, 2, 2) - 0.5
    const across = u + v * 0.4 + drift * DIE_MARBLE_VEIN_TURBULENCE
    const wave = Math.sin(across * DIE_MARBLE_VEIN_FREQUENCY * Math.PI * 2)

    return Math.pow(1 - Math.abs(wave), DIE_MARBLE_VEIN_SHARPNESS)
  })
}

/**
 * Maple: growth rings running across the face, with the fine fibre of the
 * timber laid along them.
 * @returns The map, to be disposed with the material carrying it
 */
export function mapleTexture(): Texture {
  return blend(DIE_MAPLE_COLOR, DIE_MAPLE_GRAIN_COLOR, (u, v) => {
    const drift = fbm(u * 2, v * 8, 2, 8) - 0.5
    const rings = Math.sin((v + drift * DIE_MAPLE_GRAIN_WANDER) * DIE_MAPLE_GRAIN_RINGS * Math.PI * 2)

    // Long across the face and fine down it, which is a fibre rather than a
    // speckle, and it is what keeps the rings from reading as painted stripes
    const fibre = fbm(u * 2, v * 64, 2, 64) - 0.5

    return Math.pow((rings + 1) / 2, DIE_MAPLE_GRAIN_SHARPNESS) + fibre * 0.22
  })
}

/**
 * Malachite: bands ringing an eye set off the middle of the face, pushed out
 * of round by the noise.
 * @returns The map, to be disposed with the material carrying it
 */
export function malachiteTexture(): Texture {
  return blend(DIE_MALACHITE_COLOR, DIE_MALACHITE_BAND_COLOR, (u, v) => {
    const drift = fbm(u * 3, v * 3, 3, 3) - 0.5
    const distance = Math.hypot(u - 0.32, v - 0.64) + drift * DIE_MALACHITE_TURBULENCE
    const wave = Math.sin(distance * DIE_MALACHITE_BANDS * Math.PI * 2)

    return (wave + 1) / 2
  })
}

/**
 * Carbon: a plain weave, the tows passing over and under one another and
 * catching the light down the middle of each.
 * @returns The map, to be disposed with the material carrying it
 */
export function carbonTexture(): Texture {
  return blend(DIE_CARBON_COLOR, DIE_CARBON_WEAVE_COLOR, (u, v) => {
    const acrossTow = u * DIE_CARBON_WEAVE_TOWS
    const downTow = v * DIE_CARBON_WEAVE_TOWS

    // Which of the two directions is on top here. Alternating by the sum of
    // the two cells is what makes the cloth a weave and not a grid
    const overUnder = (Math.floor(acrossTow) + Math.floor(downTow)) % 2 === 0
    const along = overUnder ? downTow - Math.floor(downTow) : acrossTow - Math.floor(acrossTow)

    return Math.sin(along * Math.PI)
  })
}

/**
 * Pearl: how thick the film over the body is, point by point.
 *
 * A measurement and not a colour — the colour is what the film does to the
 * light at that thickness, which the material works out for itself. Rings
 * pushed out of round by the noise, because nacre is laid down in layers and
 * what the eye reads is the edges of them.
 * @returns The map, to be disposed with the material carrying it
 */
export function pearlFilmTexture(): Texture {
  return measure((u, v) => {
    const swirl = fbm(
      u * DIE_PEARL_FILM_SWIRL,
      v * DIE_PEARL_FILM_SWIRL,
      DIE_PEARL_FILM_SWIRL,
      DIE_PEARL_FILM_SWIRL,
    ) - 0.5

    const rings = Math.sin((Math.hypot(u - 0.5, v - 0.5) + swirl) * DIE_PEARL_FILM_SWIRL * Math.PI * 2)

    return (rings + 1) / 2
  })
}

/**
 * Steel: the brushing, as the polish the surface is taken to rather than as a
 * colour.
 *
 * The noise is sampled long in one direction and fine in the other, which is
 * the whole trick — the same noise that would be a speckle becomes a drag mark
 * once the two axes are stretched apart.
 * @returns The map, to be disposed with the material carrying it
 */
export function steelBrushTexture(): Texture {
  return measure((u, v) => {
    const streaks = fbm(
      u * DIE_STEEL_BRUSH_LENGTH,
      v * DIE_STEEL_BRUSH_FINENESS,
      DIE_STEEL_BRUSH_LENGTH,
      DIE_STEEL_BRUSH_FINENESS,
    )

    // A roughness map only ever multiplies the material's own figure down, so
    // the streaks polish the steel below its stated roughness and never above
    return 1 - streaks * DIE_STEEL_BRUSH_DEPTH
  })
}
