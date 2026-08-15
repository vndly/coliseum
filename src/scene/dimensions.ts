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

export const BOWL_INTERIOR_FLOOR_RADIUS = 3.0 // Flat part of the inside base
export const BOWL_INTERIOR_FLOOR_HEIGHT = 0.53 // Inside base, above the table
export const BOWL_RIM_RADIUS = 5.25 // Widest point, at the outside of the bead
export const BOWL_RIM_HEIGHT = 4.2 // Top of the bead, above the table
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

export const TABLE_SIZE = 300 // Wide enough that its edge dies in the fog
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

export const FOG_NEAR = 38 // Well beyond the bowl, so the bowl is never fogged
export const FOG_FAR = 180
// Ambient image-based light. It fills the bowl's interior, but pushed much
// past this it flattens the key light out and lifts the dark wood to milk
// chocolate and the baize to mint.
export const ENVIRONMENT_INTENSITY = 0.5
export const ENVIRONMENT_BLUR = 0.04

export const KEY_LIGHT_COLOR = 0xfff0dc // Warm, to sit with the wood
export const KEY_LIGHT_INTENSITY = 2.2
export const KEY_LIGHT_POSITION = {
  x: 9,
  y: 16.5,
  z: 6,
}
export const KEY_LIGHT_SHADOW_MAP_SIZE = 2048
export const KEY_LIGHT_SHADOW_EXTENT = 12 // Half-width of the shadow frustum
export const KEY_LIGHT_SHADOW_NEAR = 1.5
export const KEY_LIGHT_SHADOW_FAR = 48
export const KEY_LIGHT_SHADOW_NORMAL_BIAS = 0.02

// ============================================
// Camera
// ============================================

export const CAMERA_FIELD_OF_VIEW = 40 // Longer lens; flatters a small object
export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 400
export const CAMERA_TARGET_HEIGHT = 1.5 // Orbit about the interior, not the foot
export const CAMERA_MIN_DISTANCE = 16.5 // Closest approach that still holds the whole rim in frame
export const CAMERA_MAX_DISTANCE = 39
export const CAMERA_START_DISTANCE = 21 // Leaves the bowl about half the frame height
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

/**
 * Polished resin on lacquer, which is a slippery pair. Rapier averages the two
 * materials in a contact, so this and BOWL_FRICTION meet at 0.175: low enough
 * that a die skids and rolls down the wall instead of grabbing it and stopping
 * where it landed. Friction is what ends a throw here rather than restitution
 * — a glancing hit on the wall turns almost all of a die's speed into spin,
 * and the spin is then eaten by whatever it is rolling on.
 */
export const DIE_FRICTION = 0.2

/**
 * Averaged with BOWL_RESTITUTION to 0.45, which returns about a fifth of the
 * energy of each bounce. Anything much below this and a die arrives, thuds
 * once and is finished; much above it and the first bounce clears the rim and
 * the bowl stops being able to hold anything.
 */
export const DIE_RESTITUTION = 0.5

// Air does almost nothing to a die over a flight this short, and a die still
// moving in the bowl should be slowed by what it is touching, not by the air
export const DIE_LINEAR_DAMPING = 0.0
export const DIE_ANGULAR_DAMPING = 0.04 // Only enough to stop a lone die spinning forever
export const DIE_LAUNCH_SPIN = 14 // Peak random angular velocity at launch, in radians/second

/**
 * How long a die that has left play takes to shrink away once it has settled.
 * Short enough not to be a wait, long enough that the die is seen to leave
 * rather than simply ceasing to exist between two frames.
 */
export const DIE_VANISH_DURATION = 0.25 // Seconds

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
 * How large a die is taken to be, which is the same thing as how strong
 * gravity is: a die is one unit across, so a metric size of a twentieth of a
 * metre makes a metre twenty units and gravity twenty times 9.81. Derived
 * rather than typed as a number so the relationship stays visible.
 *
 * This is the knob that decides how long a throw lasts, and it is deliberately
 * not the 16 mm of a real casino die. At true scale gravity is 613 units per
 * second squared, a bounce lifts a die a third of its own width, and the whole
 * throw is over in six tenths of a second — accurate, and far too quick to
 * watch. Treating the dice as the size of a paperweight is what buys the
 * tumble; raise it further for a floatier throw, lower it for a heavier one.
 */
const DIE_METRIC_SIZE = 0.05 // Metres
export const GRAVITY = -9.81 / DIE_METRIC_SIZE

export const PHYSICS_TIMESTEP = 1 / 120 // Half a render frame; a small fast body needs it
export const PHYSICS_MAX_STEPS_PER_FRAME = 8 // Cap, so a stalled tab cannot spiral on catch-up

/**
 * The longest a single frame may advance anything at all.
 *
 * A backgrounded tab hands back one enormous frame. The simulation spends this
 * much of it and drops the rest, and everything else paced in seconds has to be
 * held to the same cap — otherwise it runs on through a stretch of time the
 * world itself never simulated, and arrives at a state the bodies never reached.
 */
export const MAX_FRAME_TIME = PHYSICS_TIMESTEP * PHYSICS_MAX_STEPS_PER_FRAME

export const BOWL_FRICTION = 0.15
export const BOWL_RESTITUTION = 0.4 // Lacquer over hard wood, which is livelier than it looks

export const FELT_FRICTION = 0.6 // Cloth, and the grippiest surface in the scene
export const FELT_RESTITUTION = 0.08 // A die that reaches the table is meant to stop there

/**
 * How thick the table's collider is. It is solid rather than a sensor: a die
 * that overshoots has to come to rest before it is taken away, which means it
 * needs something to come to rest on. Made deep, so that even the hardest
 * throw cannot cross it between two steps.
 */
export const FELT_DEPTH = 20

// ============================================
// Throw
// ============================================

export const THROW_MIN_DRAG = 1.2 // Dead zone: a bare click throws nothing at all

/**
 * The angle of the drawn line, and so how high above the drag's end the die is
 * launched from. Not the angle the die actually arrives at: the flight is
 * lifted off this line by the gravity it has to give back, so it comes down
 * steeper than this — about 73° at the shortest throw and 53° at the longest.
 *
 * Fixing the angle rather than the height is what keeps the line's length
 * proportional to the drag across the table. A fixed height would make a short
 * drag a near-vertical drop — a long line, and so a fast throw, from a gesture
 * that asked for a slow one.
 *
 * It also has to be steep enough to arrive over the near rim, and that is what
 * fixes the value. A line aimed at the middle of the bowl crosses the rim 5.25
 * units short of it, where clearing the bead by a die's diagonal needs 45.8°.
 * Everything past that buys reach across the near half of the floor, which is
 * the part a straight line struggles to get at. What it costs is height: the
 * launch climbs with the tangent of this, and steep enough for the whole floor
 * would put it far off the top of the frame.
 */
export const THROW_DESCENT_ANGLE = Math.PI / 3.6 // 50°

/**
 * How high a die is launched from when the drag ends over the bowl rather than
 * beside it. The line's own angle would put the launch inside the wall there,
 * and a body that starts inside solid geometry is spat back out of it.
 */
export const THROW_CLEARANCE_HEIGHT = 5.4

/**
 * How far from the axis a drag has to end before the line's own angle is
 * allowed to set the launch height. Inside it the bowl is in the way and
 * THROW_CLEARANCE_HEIGHT applies instead — a die's width past the bead, so it
 * is the whole body that clears the bowl and not just its centre.
 */
export const THROW_CLEARANCE_RADIUS = BOWL_RIM_RADIUS + DIE_SIZE

/**
 * How long every throw spends in the air, whatever its length.
 *
 * This is the one number the throw is tuned by. Solving the launch velocity
 * from a fixed flight time rather than a fixed speed is what makes the speed
 * proportional to the line's length — a longer line is a harder throw, not a
 * slower one — and it is also what bounds how far the flight strays from the
 * straight line the preview draws. That gap is gravity times the square of
 * this, over eight: about six tenths of a die at this value. Raise it for a
 * slower, visibly curved throw; lower it for a flatter, faster one.
 */
export const THROW_FLIGHT_TIME = 0.16 // Seconds

/**
 * How far from the bowl's axis either end of the line may reach. Kept inside
 * the key light's shadow extent, so a die is never launched from or aimed at
 * ground the shadow map does not cover.
 *
 * It also bounds how high the launch can climb, though not enough to keep it
 * on screen: at the longest drag away from the camera the top of the line runs
 * off the top of the frame and the die arrives from out of shot. Lowering this
 * is the only way to stop that, and it costs the fast end of the throw — the
 * line's length is the speed — so the launch is allowed to leave the frame
 * instead. The end that matters, the one the die lands on, is under the
 * pointer and always in view.
 */
export const THROW_MAX_RADIUS = 8

// ============================================
// Aim preview
// ============================================

export const AIM_DOT_COUNT = 24 // Also the instance count, so it is a hard ceiling
export const AIM_DOT_RADIUS = 0.1
export const AIM_DOT_SEGMENTS = 8 // Around the sphere; these are small on screen
export const AIM_DOT_COLOR = 0xf3ece0
export const AIM_DOT_OPACITY = 0.75

/**
 * How small the last dot is next to the first. The line tapers toward the
 * point the die will land on, which is the only thing telling the two ends of
 * it apart — and, since the dot count is fixed, the gaps between the dots are
 * the length of the line and so the speed of the throw.
 */
export const AIM_DOT_END_SCALE = 0.35
