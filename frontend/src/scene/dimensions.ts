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

export const BOWL_INTERIOR_FLOOR_RADIUS = 4.1 // Flat part of the inside base
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

// The fog is stated with the camera below rather than here: where it begins is
// measured against how far the orbit can be pulled back, and it can only be
// written once that distance exists.

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
// Both distances are stated for a frame at least as wide as the reference
// aspect below. A narrower one is answered by opening the lens rather than by
// moving these, so that what a landscape frame sees is exactly what it always
// saw.
export const CAMERA_MIN_DISTANCE = 16.5 // Closest approach that still holds the whole rim in frame
export const CAMERA_MAX_DISTANCE = 39
export const CAMERA_START_DISTANCE = 21 // Leaves the bowl about two thirds of the frame height
export const CAMERA_START_AZIMUTH_ANGLE = Math.PI * 0.15
export const CAMERA_DAMPING_FACTOR = 0.06

/**
 * Where the fog begins, and where it is total.
 *
 * Fog is depth from the camera, so the bowl is only clear of it while the
 * furthest the orbit can be pulled back, plus the bowl's own reach past the
 * point it orbits, still falls in front of the near plane. Written as that sum
 * rather than as a figure that happens to clear it, because the two were
 * unrelated before and the orbit had already grown past the fog — the bowl was
 * being washed toward the background at full zoom-out, which is exactly what
 * this is here to prevent.
 */
export const FOG_NEAR = CAMERA_MAX_DISTANCE + BOWL_RIM_RADIUS
export const FOG_FAR = 180

/**
 * The frame the camera distances above are written for.
 *
 * The field of view is vertical, so a narrow frame sees less of the bowl across
 * than a wide one at the same distance — and every distance above was chosen by
 * eye on a landscape frame. Below this the lens is opened up to hold the same
 * width, rather than leaving a phone held upright looking at a bowl with its
 * sides cut off.
 */
export const CAMERA_REFERENCE_ASPECT = 0.9

/**
 * The widest the lens is opened to hold that frame.
 *
 * A very tall frame would ask for a fisheye, which costs more in distortion
 * than the cropping it buys back. Past this the bowl is allowed to overrun the
 * sides again.
 */
export const CAMERA_MAX_FIELD_OF_VIEW = 65

/**
 * Straight down. Not exactly zero — at a true polar angle of zero the azimuth
 * becomes meaningless and the orbit spins on the spot.
 */
export const CAMERA_MIN_POLAR_ANGLE = 0.1

/**
 * The scene opens straight overhead. The whole of the floor is in view at once
 * from there, no die is hidden behind another, and every one of them is read
 * the same way round — which is what the bowl is for. Orbiting down to a
 * three-quarter view, where the bowl is an object rather than a circle, is the
 * player's to do.
 */
export const CAMERA_START_POLAR_ANGLE = CAMERA_MIN_POLAR_ANGLE

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

/**
 * The two colours a die is washed with while a settled bowl is being judged.
 *
 * The bone is replaced outright rather than shaded, because the wash carries
 * the whole of the explanation: a die gone red is leaving the match, a die gone
 * green is going back to a hand, and neither is a state the player has anywhere
 * else to read it from. The red is the same ember the interface answers a
 * mistake in; the green is the baize lifted far enough to still read as a wash
 * over bone rather than as a die turned dark.
 */
export const DIE_REMOVED_COLOR = 0xe06a52 // Sixes, out of the match
export const DIE_MATCHED_COLOR = 0x6fbf87 // A group, back to the thrower

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

export const DIE_MASS = 1.0 // Every die is the same, so only the ratio to DIE_INERTIA matters

/**
 * The die's moment of inertia about each of its own axes: a solid cube's, which
 * is its mass times the square of its size over six.
 *
 * Stated rather than left to the shape and a density only because a die's mass
 * is stated, and the two have to be set together.
 *
 * Lightening it below the truthful figure looks like it should make a struck
 * die easier to tip, and does the opposite. What turns a struck die is friction
 * under its own base, and a lighter inertia holds less of the angular momentum
 * that friction can put into it: the die spins up fast, spends the spin against
 * the floor and stops flat. Halving this costs six percentage points of hits
 * ending on a new face, and scatters the bowl further while doing it.
 */
export const DIE_INERTIA = DIE_MASS * DIE_SIZE * DIE_SIZE / 6

/**
 * Polished resin. Every collider in the scene asks for Rapier's multiplying
 * rule, so what a pair of surfaces actually grips at is the product of the two
 * — this squared is 0.30, which is what one die meets another with and the
 * loosest pairing anywhere in the scene.
 *
 * Low deliberately, and low only between dice. Two dice that grip each other
 * hard trade the arriving die's direction for spin at the instant they touch,
 * and the throw is spent on the die it happened to clip rather than carried
 * into the bowl. It costs the struck die to raise it, which reads backwards
 * and is not: at 0.45 between dice, and again at 0.55, fewer hits end on a new
 * face than at this, because a die that is gripped is a die pushed away rather
 * than driven down into the floor that could turn it over.
 *
 * The floor is what turns it. See BOWL_FRICTION, which carries that number.
 */
export const DIE_FRICTION = 0.55

/**
 * How much of an impact a die gives back, as its own material rather than as
 * anything about a particular collision. Multiplied by whatever it hits: 0.79
 * against another die, 0.30 against the bowl, and 0.07 against the felt.
 *
 * Multiplying rather than averaging is what lets those three be set apart from
 * one another at all. Under the average Rapier reaches for by default this
 * number and the bowl's are a single shared quantity — a die bouncy enough to
 * rearrange the bowl when it lands on another die drags the bowl's own figure
 * up with it, and the bowl could only be held down by pushing this up, which
 * put both wrong. The product leaves each surface stating one honest thing
 * about itself and every pairing falling out of the two.
 *
 * The 0.79 against another die is the one that has to stay high. A die on the
 * floor is pinned there by a gravity twenty times the real one and cannot roll
 * without lifting its own centre of mass against it, so bouncing the two apart
 * hard enough to get the struck one off the floor for a moment is what gives
 * it room to turn at all. It is set to what the old averaging rule happened to
 * arrive at: taking it back down to the 0.71 this file briefly ran at costs a
 * sixth of the hits that end on a new face.
 */
export const DIE_RESTITUTION = 0.89

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
 * How many dice the bowl holds before it refuses another throw.
 *
 * Began as a runaway guard against a spammed pointer and is now a rule of the
 * match as well: a throw into a full bowl is rejected rather than queued, and
 * both players are looking at the same bowl, so both agree on when it is full.
 */
export const DIE_LIMIT = 64

/**
 * The identifier carried by the die a match opens with.
 *
 * Every other die is named for the throw that made it, and throws are numbered
 * from one, so nothing else can ever claim this.
 */
export const OPENING_DIE_ID = '0'

/**
 * The shortest a throw may run before the bowl is even tested for rest.
 *
 * Covers the moment between a body being created and the first step running
 * it, where the new die has not moved yet and every die already in the bowl is
 * still asleep — which reads as a bowl at rest, one frame after a throw.
 */
export const SETTLE_MINIMUM = 0.5 // Seconds

/**
 * The longest a throw may run before its result is written anyway.
 *
 * A die wedged against the rim can jitter for as long as it likes, and the
 * whole match blocks on this: nobody else's bowl is reconciled and nobody's
 * turn advances until the throw is declared over. A slightly early snapshot
 * beats a match that never continues.
 */
export const SETTLE_TIMEOUT = 10 // Seconds

/**
 * How long each of the two verdict washes is held.
 *
 * Paid on every throw that has anything to show and twice on one that has both,
 * so it sets the pace of the whole game. Long enough to look over a bowl of six
 * and find the group in it; short enough that a turn is not mostly waiting.
 *
 * The two are held one after the other rather than together, and that ordering
 * is the rule made visible: the sixes are gone before anything is paired, which
 * is why two sixes in the bowl are not a pair.
 */
export const RESOLUTION_BEAT = 1.5 // Seconds

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

/**
 * How many world units make a metre — the same statement of scale GRAVITY is
 * derived from, handed to Rapier so that it can size its own tolerances by it.
 *
 * What it is worth is narrower than it looks, which is worth stating because
 * the tolerances it scales sound like they should matter and do not. Raising
 * how far two bodies may overlap before Rapier corrects them changes nothing
 * measurable: a settled die sits within a quarter of a percent of its own
 * width of the floor either way. Nor does the sleep threshold, which it also
 * scales — dice here stop dead rather than creep, and no die in the bowl comes
 * to rest anywhere it would not have without it. Sleeping itself is not spare,
 * though: it is the engine's own answer to whether a throw is over, and the
 * only thing Dice.isSettled asks.
 *
 * The one it does move is the distance at which a contact is predicted rather
 * than found by overlap, and that one has to be taken straight back off it.
 * See CONTACT_PREDICTION_DISTANCE.
 */
export const LENGTH_UNIT = 1 / DIE_METRIC_SIZE

/**
 * How far apart two surfaces may still be and be given a contact to solve.
 *
 * Rapier states this in metres and multiplies it by LENGTH_UNIT, which at its
 * own default lands it at two fifths of a die width — far enough that dice
 * sitting in the bowl are being solved against each other before they touch,
 * and a thrown die arrives into a set of contacts that have already bled its
 * impact away. That is what a bowl of dead dice was: an arriving die still
 * shoved whatever it landed on, but a quarter of the hits that should have
 * turned a die over no longer did.
 *
 * Twice Rapier's own default rather than the default itself. The larger
 * distance is genuinely worth something to the die in flight, which crosses
 * most of its own width in a step and would otherwise meet the bowl out of an
 * overlap it should never have been in. It stops being worth it long before
 * two fifths.
 */
export const CONTACT_PREDICTION_DISTANCE = 0.04

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

/**
 * A die grips the bowl at 0.55, nearly twice what it grips another die with.
 *
 * This is the number that decides whether a struck die rolls or skates, and it
 * is the only thing in the scene with any torque to tip one over: the floor
 * holds the bottom of a die while the top keeps going, and the die goes over
 * its leading edge. Taken down to the 0.30 the dice use between themselves, a
 * square hit still shoves the struck die — it moves about a sixth of its own
 * width — but it slides rather than turns, and only a third as many hits end
 * on a new face.
 *
 * Stated as 1.0 because the multiplying rule leaves nowhere else to put it.
 * The pairing is this times DIE_FRICTION, so a floor meant to grip harder than
 * a die does can only say so by giving up its own figure entirely, and this is
 * the one place the rule's honesty runs out. Higher than lacquer over hard
 * wood would really give, as it has always been, and for the same reason.
 */
export const BOWL_FRICTION = 1.0

/**
 * Lacquer over hard wood, giving 0.30 against a die — restitution is a ratio
 * of speeds rather than of energies, so that is about a tenth of the energy
 * returned per bounce, and it is the figure the throw is tuned around.
 *
 * It is the number the arriving die is most visibly judged by, because it sets
 * how high the first bounce goes. Much above this and a die lands, rises past
 * its own height and comes down somewhere unrelated to where it was aimed;
 * much below it and a die arrives, thuds once and is finished. At 0.30 the
 * first bounce lifts it about four tenths of its own width, which is enough to
 * see and not enough to lose the throw in.
 *
 * The pairing is what is fixed here, not this: it is whatever holds the
 * product with DIE_RESTITUTION at 0.30, and it moves whenever that does.
 */
export const BOWL_RESTITUTION = 0.34

/**
 * Cloth. Multiplied by the die's own 0.55 rather than averaged with it, which
 * is what puts a die on the felt at the 0.52 it has always slid to a stop
 * against.
 *
 * No longer the grippiest pairing in the scene — the bowl's floor passed it
 * when it took over the work of turning a struck die — but it does not have to
 * be. All it has to do is stop a die that has left the bowl, and against the
 * 0.30 the dice grip each other with there is no danger of one skating away.
 */
export const FELT_FRICTION = 0.95

/**
 * A die that reaches the table is meant to stop there, and 0.07 against a die
 * is what stops it. Like the bowl's, this is whatever holds that product where
 * it belongs rather than a figure the felt states about itself.
 *
 * It needs no special case now, unlike under the old averaging rule: averaged
 * with a die's own figure this came out at 0.44, and the felt had to ask for
 * the smaller of the two materials instead to keep a spilled die from hopping
 * away across the table.
 */
export const FELT_RESTITUTION = 0.075

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
 * How high the die is launched from, as an angle over the length of the drag.
 *
 * Not quite the angle of the drawn line: the launch is lifted back along the
 * camera's own ray rather than straight up, so the line comes out a little
 * steeper than this. Nor the angle the die arrives at: the flight is lifted
 * off the line by the gravity it has to give back, so it comes down steeper
 * again — about 79° at the shortest throw and 56° at the longest.
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
 * How high a die is launched from when the launch lands over the bowl rather
 * than beside it. The line's own angle would put it inside the wall there, and
 * a body that starts inside solid geometry is spat back out of it. Clear of
 * the bead by more than a die's width, so at this height there is no bowl left
 * anywhere for a die to start inside of.
 */
export const THROW_CLEARANCE_HEIGHT = 5.4

/**
 * How far from the axis the launch has to be before the line's own angle is
 * allowed to set its height. Inside it the bowl is in the way and
 * THROW_CLEARANCE_HEIGHT applies instead — a die's width past the bead, so it
 * is the whole body that clears the bowl and not just its centre.
 */
export const THROW_CLEARANCE_RADIUS = BOWL_RIM_RADIUS + DIE_SIZE

/**
 * How far below the camera the launch is held.
 *
 * The launch climbs with the length of the drag, and a long drag seen from a
 * low camera asks for one above the camera itself — which, along a ray that
 * only ever descends, is behind the viewer. The throw is flattened rather than
 * allowed to get there: it comes out harder and shallower than the angle asked
 * for, which is the least bad answer to a gesture that has run out of room.
 */
export const THROW_LAUNCH_CAMERA_MARGIN = 2

/**
 * How long every throw spends in the air, whatever its length.
 *
 * This is the one number the throw is tuned by. Solving the launch velocity
 * from a fixed flight time rather than a fixed speed is what makes the speed
 * proportional to the line's length — a longer line is a harder throw, not a
 * slower one — and it is also what bounds how far the flight strays from the
 * straight line the preview draws. That gap is gravity times the square of
 * this, over eight: about one and a fifth die widths at this value. Raise it
 * for a slower, visibly curved throw; lower it for a flatter, faster one.
 *
 * It is longer than it looks like it should be, and that is the point. The
 * same line thrown over a longer flight is thrown more slowly, and the speed
 * the die arrives at is what decides whether it lands or merely rebounds: at
 * 0.16 a throw came in hard enough that the bounce was larger than anything
 * left of the throw's own direction, and where the die ended up had more to do
 * with which corner it landed on than with where it was aimed. The die still
 * lands exactly where the line ends — that is what the solve guarantees — but
 * it now arrives slowly enough to stay there.
 */
export const THROW_FLIGHT_TIME = 0.22 // Seconds

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

/**
 * The least distance a fan leaves between the centres of two of its dice.
 *
 * A whole hand leaves on one gesture, and bodies created at the same point are
 * bodies overlapping — which a solver answers by firing them apart. This is the
 * figure the ring below is sized to hold, and it is stated as a separation
 * rather than as a radius because the radius that achieves it depends on how
 * many dice are being spread around it.
 *
 * Measured centre to centre as a chord, not along the arc: the arc is longer
 * than the gap actually between two dice, and reading the ring off it is what
 * makes a ring look roomier than it is.
 */
export const THROW_FAN_SPACING = DIE_SIZE * 1.2

/**
 * How far from the bowl's axis a throw nobody aimed may land.
 *
 * Well inside the flat part of the inside base rather than the whole of it. A
 * die that arrives near the edge of the floor is a die whose first bounce is
 * into the rising wall, and the wall is what throws it back out over the bead;
 * one that lands centrally spends the same bounce on the floor and the far
 * side. The aim still varies within this, so a table of them does not stack
 * every die in one spot — it is a hand that throws well, not one that throws
 * the same throw twice.
 */
export const UNAIMED_TARGET_RADIUS = BOWL_INTERIOR_FLOOR_RADIUS * 0.45

/**
 * How long the line behind a throw nobody aimed is, at its shortest and its
 * longest.
 *
 * The line's length is the speed of the throw, so this is the range of force
 * one comes out with. Kept well clear of THROW_MIN_DRAG at the bottom, so no
 * draw of it ever falls inside the dead zone and throws nothing, and short of
 * the hardest a hand can throw at the top: the harder a die arrives the
 * further it climbs the wall on the bounce, and the whole point of an aim
 * nobody is watching is that it keeps its dice in the bowl.
 */
export const UNAIMED_DRAG_MINIMUM = 3
export const UNAIMED_DRAG_MAXIMUM = 4.5

/**
 * How far off the far side of the bowl a throw nobody aimed may be drawn from.
 *
 * The bearing is not free, because the launch is lifted back along the
 * camera's own ray: a line drawn from the camera's side of the bowl is pushed
 * further out as it climbs, and arrives flatter than the angle it asked for —
 * flat enough, with the camera orbited low, to meet the outside of the near
 * wall rather than clear the bead. Drawn from the far side the same lift
 * shortens the line and steepens the drop, so the die comes down into the
 * bowl. This is how much of the circle either side of straight-away is still
 * allowed, which is enough that no two throws come from the same place and
 * little enough that none of them comes from behind the camera.
 */
export const UNAIMED_BEARING_SPREAD = Math.PI / 3 // 60° either way

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

/**
 * How solid the die at the launch end of the line is.
 *
 * Lower than the dots, which are small enough on screen to be read at any
 * weight. This is a whole die's worth of surface, and carried much past this
 * it stops reading as a die about to be thrown and starts reading as one
 * already on the table.
 */
export const AIM_DIE_OPACITY = 0.4

/**
 * How the die at the launch end is turned.
 *
 * Square to the world it would be a square seen from straight overhead, which
 * is where the camera opens. Turned off all three axes instead, so three of
 * its faces are in view from anywhere the camera can be orbited to and the
 * thing at the end of the line is unmistakably a die.
 *
 * Fixed rather than the attitude the throw will actually leave with: that one
 * is not drawn until the gesture is released, and a die tumbling under the
 * pointer would be movement in the one place the aim is meant to be still.
 */
export const AIM_DIE_TILT = {
  x: Math.PI / 7, // 26°
  y: Math.PI / 5, // 36°
  z: Math.PI / 9, // 20°
}
