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

// ============================================
// Die
// ============================================

export const DIE_SIZE = 1.0 // One unit, by the definition at the top of this file
export const DIE_CORNER_RADIUS = 0.09 // Rounded edges, as a real die has
export const DIE_CORNER_SEGMENTS = 4 // Divisions across each rounded corner

export const DIE_COLOR = 0xf3ece0 // Bone, so it reads against both the walnut and the baize
export const DIE_ROUGHNESS = 0.42
export const DIE_CLEARCOAT = 0.5 // Polished resin, a softer coat than the bowl's lacquer
export const DIE_CLEARCOAT_ROUGHNESS = 0.25

export const DIE_PIP_COLOR = 0x18120e
export const DIE_PIP_RADIUS = 0.095
export const DIE_PIP_SEGMENTS = 10 // Around the sphere; only a shallow cap of it is ever seen
export const DIE_PIP_SPACING = 0.235 // Face centre to a corner pip, along each face axis

/**
 * How far a pip's centre sits below the face it belongs to. There are no
 * texture maps in this project and no CSG to drill with, so a pip is a small
 * sphere sunk into the face until only its cap shows — which is what a filled
 * pip looks like anyway.
 */
export const DIE_PIP_INSET = 0.07

export const DIE_DENSITY = 1.0
export const DIE_FRICTION = 0.55
export const DIE_RESTITUTION = 0.3 // Enough to bounce once or twice, not to ping about
export const DIE_LINEAR_DAMPING = 0.06
export const DIE_ANGULAR_DAMPING = 0.22 // Bleeds the launch spin off so the die settles
export const DIE_LAUNCH_SPIN = 14 // Peak random angular velocity at launch, in radians/second

/**
 * A runaway guard, not a game rule. The bowl overflows and the felt culls the
 * spill long before this, but a spammed pointer should not be able to grow the
 * body count without bound.
 */
export const DIE_LIMIT = 64

// ============================================
// Physics
// ============================================

/**
 * A casino die is 16 mm across and one unit wide here, so a metre is 62.5
 * units and gravity is that much larger than 9.81. Derived rather than typed
 * as a number so the relationship stays visible: raise the metric size for a
 * floatier, more cinematic throw, lower it for a heavier and faster one.
 */
const DIE_METRIC_SIZE = 0.016 // Metres
export const GRAVITY = -9.81 / DIE_METRIC_SIZE

export const PHYSICS_TIMESTEP = 1 / 120 // Half a render frame; a small fast body needs it
export const PHYSICS_MAX_STEPS_PER_FRAME = 8 // Cap, so a stalled tab cannot spiral on catch-up

export const BOWL_FRICTION = 0.45
export const BOWL_RESTITUTION = 0.2 // Wood, damped by its lacquer

/**
 * The felt is a sensor rather than a solid floor: a die that reaches it is out
 * of play and destroyed on the spot, so it never needs anything to rest on.
 * Made deep, so that even the hardest throw cannot cross it between two steps.
 */
export const FELT_SENSOR_DEPTH = 20

// ============================================
// Throw
// ============================================

/**
 * How high above the table a die is launched from. Above the rim, so that a
 * press over the bowl spawns the die in open air rather than inside the wall.
 */
export const THROW_LAUNCH_HEIGHT = 3.6

export const THROW_ELEVATION_ANGLE = Math.PI / 5 // 36°, held constant at every strength
export const THROW_MIN_DRAG = 0.8 // Dead zone: a bare click throws nothing at all
export const THROW_MAX_DRAG = 12 // Past this the throw is already at full strength
export const THROW_MIN_SPEED = 30 // A gentle lob, roughly three units of ground covered
export const THROW_MAX_SPEED = 115 // Clears the bowl entirely and lands well out on the felt

/**
 * How far from the bowl's axis a throw may start. Matched to the key light's
 * shadow extent so a die is never launched from ground the shadow map does not
 * cover — which also keeps a grazing camera angle from putting the launch
 * point off screen entirely.
 */
export const THROW_MAX_LAUNCH_RADIUS = KEY_LIGHT_SHADOW_EXTENT

// ============================================
// Aim preview
// ============================================

export const AIM_DOT_COUNT = 24 // Also the instance count, so it is a hard ceiling
export const AIM_DOT_RADIUS = 0.1
export const AIM_DOT_SEGMENTS = 8 // Around the sphere; these are small on screen
export const AIM_DOT_COLOR = 0xf3ece0
export const AIM_DOT_OPACITY = 0.75
export const AIM_DOT_END_SCALE = 0.35 // The arc tapers toward the point of first contact

/**
 * Seconds of flight between one dot and the next. Spacing the dots by time
 * rather than by distance is what makes the preview read as strength: a hard
 * throw spreads them out, a gentle one bunches them up.
 */
export const AIM_SAMPLE_INTERVAL = 0.014
