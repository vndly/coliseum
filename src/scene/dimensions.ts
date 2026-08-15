/**
 * Every measurement in the 3D scene, in die widths — one unit is one die.
 *
 * Dice-relative units rather than metric ones are a physics decision, not a
 * cosmetic one. A real 16 mm die modelled at 0.016 units sits far below the
 * tolerances a physics engine tunes for by default, which is what makes small
 * fast bodies jitter, sink through floors and tunnel on a hard throw. Keeping
 * the dice at roughly unit size sidesteps all of it, at the price of gravity
 * becoming a value tuned for feel rather than the real 9.81.
 */

// ============================================
// Bowl
// ============================================

export const BOWL_INTERIOR_FLOOR_RADIUS = 2.0 // Flat part of the inside base
export const BOWL_INTERIOR_FLOOR_HEIGHT = 0.35 // Inside base, above the table
export const BOWL_RIM_RADIUS = 3.5 // Widest point, at the outside of the bead
export const BOWL_RIM_HEIGHT = 2.8 // Top of the bead, above the table
export const BOWL_RADIAL_SEGMENTS = 128 // Divisions around the axis of revolution
export const BOWL_PROFILE_DIVISIONS = 24 // Samples per curved segment of the profile

export const BOWL_COLOR = 0x2b170d // Dark walnut, seen through the lacquer
export const BOWL_ROUGHNESS = 0.35
export const BOWL_CLEARCOAT = 1.0 // The lacquer layer itself

// How sharply the lacquer mirrors its surroundings. Kept deliberately soft:
// the inside base is nearly flat and points straight up, so a tighter
// clearcoat turns it into a mirror that reflects the environment's ceiling
// light as a blown-out white disc — directly over where the dice land and
// where the result has to stay readable.
export const BOWL_CLEARCOAT_ROUGHNESS = 0.28

// ============================================
// Table
// ============================================

export const TABLE_SIZE = 200 // Wide enough that its edge dies in the fog
export const TABLE_COLOR = 0x1f4033 // Baize green
// Grazing-angle fuzz that reads as cloth. Kept low: a table seen from a raised
// camera is almost entirely grazing angle, so a strong sheen stops being a
// highlight and simply repaints the whole surface in the sheen colour.
export const TABLE_SHEEN = 0.35
export const TABLE_SHEEN_COLOR = 0x4a7a60
export const TABLE_SHEEN_ROUGHNESS = 0.8

// ============================================
// Environment
// ============================================

// Mirrored by the canvas background in home_screen.vue, so the first rendered
// frame does not arrive over a white page
export const BACKGROUND_COLOR = 0x0e1210

export const FOG_NEAR = 25 // Well beyond the bowl, so the bowl is never fogged
export const FOG_FAR = 120
// Ambient image-based light. It fills the bowl's interior, but pushed much
// past this it flattens the key light out and lifts the dark wood to milk
// chocolate and the baize to mint.
export const ENVIRONMENT_INTENSITY = 0.5
export const ENVIRONMENT_BLUR = 0.04

export const KEY_LIGHT_COLOR = 0xfff0dc // Warm, to sit with the wood
export const KEY_LIGHT_INTENSITY = 2.2
export const KEY_LIGHT_POSITION = {
  x: 6,
  y: 11,
  z: 4,
}
export const KEY_LIGHT_SHADOW_MAP_SIZE = 2048
export const KEY_LIGHT_SHADOW_EXTENT = 8 // Half-width of the shadow frustum
export const KEY_LIGHT_SHADOW_NEAR = 1
export const KEY_LIGHT_SHADOW_FAR = 32
export const KEY_LIGHT_SHADOW_NORMAL_BIAS = 0.02

// ============================================
// Camera
// ============================================

export const CAMERA_FIELD_OF_VIEW = 40 // Longer lens; flatters a small object
export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 400
export const CAMERA_TARGET_HEIGHT = 1.0 // Orbit about the interior, not the foot
export const CAMERA_MIN_DISTANCE = 11 // Closest approach that still holds the whole rim in frame
export const CAMERA_MAX_DISTANCE = 26
export const CAMERA_START_DISTANCE = 14 // Leaves the bowl about half the frame height
export const CAMERA_START_POLAR_ANGLE = Math.PI * 0.195 // ~35°, a raised three-quarter view
export const CAMERA_START_AZIMUTH_ANGLE = Math.PI * 0.15
export const CAMERA_DAMPING_FACTOR = 0.06

/**
 * Straight down. Not exactly zero — at a true polar angle of zero the azimuth
 * becomes meaningless and the orbit spins on the spot.
 */
export const CAMERA_MIN_POLAR_ANGLE = 0.1

/**
 * The shallowest sight line that still clears the near rim, measured from the
 * far edge of the interior floor up over the near lip of the bowl. Below this
 * elevation the near wall covers the floor and the dice hide behind it.
 */
const RIM_SIGHT_LINE_ELEVATION = Math.atan2(
  BOWL_RIM_HEIGHT - BOWL_INTERIOR_FLOOR_HEIGHT,
  BOWL_RIM_RADIUS + BOWL_INTERIOR_FLOOR_RADIUS,
)

/**
 * A little headroom on top of the sight line, so the floor is comfortably in
 * view at the limit rather than exactly grazing it.
 */
const RIM_SIGHT_LINE_MARGIN = Math.PI / 30 // 6°

/**
 * Three measures the polar angle down from straight up, so the lowest allowed
 * elevation becomes the largest allowed polar angle.
 */
export const CAMERA_MAX_POLAR_ANGLE = Math.PI / 2 - (RIM_SIGHT_LINE_ELEVATION + RIM_SIGHT_LINE_MARGIN)
