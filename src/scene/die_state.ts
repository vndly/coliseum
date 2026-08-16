import {Euler, Quaternion, Vector3} from 'three'
import {BOWL_INTERIOR_FLOOR_HEIGHT,
  BOWL_INTERIOR_FLOOR_RADIUS,
  DIE_SIZE,
  OPENING_DIE_ID} from '@/scene/dimensions'

/**
 * The shapes a die crosses the network in.
 *
 * They live in the scene rather than in the match layer because the scene is
 * what produces and consumes them: a throw is described here and a resting bowl
 * is described here. The match layer only carries them, which is what keeps
 * every file under scene/ free of any knowledge that a network exists at all.
 *
 * Everything here is plain numbers and strings rather than Three's own types,
 * because it is written to and read from a document store and has to survive
 * the trip.
 */

/**
 * One face normal per value, in value order. Opposite faces sum to seven on a
 * real die, which is what pairs one with six down the z axis, two with five
 * down x, and three with four down y.
 *
 * It is two things at once, and deliberately only stated here: the pips are
 * laid out along these, and the value a resting die is showing is whichever of
 * them its own attitude has turned upwards.
 */
export const DIE_FACE_NORMALS: Vector3[] = [
  new Vector3(0, 0, 1),
  new Vector3(1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 0, -1),
]

/** A die at rest, as it is held in the match's authoritative bowl. */
export interface DieSnapshot {
  id: string // The sequence number of the throw that made it; both players agree on it
  position: [number, number, number]
  rotation: [number, number, number, number] // Quaternion, x y z w
  face: number // The value showing, read off the rotation beside it every time one is taken
}

/**
 * Everything needed to reproduce one throw on another machine.
 *
 * The attitude the die leaves the hand in and the tumble it carries are part of
 * the throw rather than rolled where it lands, which is the whole reason both
 * players watch the same die rather than two different ones.
 */
export interface ThrowLaunch {
  origin: [number, number, number]
  velocity: [number, number, number]
  orientation: [number, number, number, number]
  angularVelocity: [number, number, number]
}

/**
 * One die of a throw. A throw is a list of these rather than a single die
 * because a hand with nothing in front of it goes all in and leaves in one
 * gesture — and a throw is still one throw, one settle and one verdict however
 * many dice it put in the air.
 */
export interface ThrownDie {
  id: string
  launch: ThrowLaunch
}

/**
 * What a settled throw came to, as every player is to watch it happen.
 *
 * It describes a sequence rather than a state: the bowl is set to where the
 * dice actually stopped, the sixes are shown and taken out, and then whatever
 * is left in a group is shown and handed back. The match's bowl already holds
 * the state this ends at, so nothing here is needed to know what the bowl is —
 * only to know how it got that way, which is the part worth watching.
 */
export interface ThrowResolution {
  seq: number // The throw this judges
  atRest: DieSnapshot[] // The bowl the instant it stopped, before anything is taken out
  removed: string[] // Dice showing a six, leaving the match
  returned: string[] // Dice in a group, going back to the thrower's hand
}

/**
 * Which value a die at a given attitude is showing.
 *
 * Every face normal is turned by the die's own rotation, and the one left
 * pointing most nearly upwards wins. A die at rest has one of them within a
 * rounding error of straight up, so the comparison is never close — which is
 * also why this is only ever asked of a bowl that has stopped moving.
 * @param rotation - The die's attitude, as a quaternion
 * @returns The value on the upward face, one to six
 */
export function readDieFace(rotation: [number, number, number, number]): number {
  const attitude = new Quaternion(...rotation)
  const turned = new Vector3()

  let value = 1
  let highest = Number.NEGATIVE_INFINITY

  for (const [
    index,
    normal,
  ] of DIE_FACE_NORMALS.entries()) {
    const height = turned.copy(normal).applyQuaternion(attitude).y

    if (height > highest) {
      highest = height
      value = index + 1
    }
  }

  return value
}

/**
 * The die the bowl opens with, placed rather than thrown.
 *
 * Placed at a resting transform directly: somewhere on the flat interior floor,
 * far enough in that no part of it meets the wall, and square to the axes so
 * that one face is genuinely upwards. A fully random attitude would be one no
 * die can actually rest in, and the first thing the physics would do is drop it
 * onto a face — which is the same result, arrived at with a visible lurch.
 * @returns The opening die, ready to be written into a new match
 */
export function createOpeningDie(): DieSnapshot {
  // The die's own width comes off the floor's radius so the whole body clears
  // the wall, not just the point at its centre
  const reach = BOWL_INTERIOR_FLOOR_RADIUS - DIE_SIZE
  const angle = Math.random() * Math.PI * 2

  // Square rooted, which spreads the placement evenly over the floor's area.
  // A bare random radius crowds the middle, where a bowl already gathers dice.
  const radius = Math.sqrt(Math.random()) * reach

  // Three random quarter turns. That is more combinations than a cube has
  // distinct attitudes, so some are drawn twice as often as others, and it does
  // not matter: every one of them is a face-up rest, which is all this promises.
  const rotation = new Quaternion().setFromEuler(new Euler(
    Math.floor(Math.random() * 4) * Math.PI / 2,
    Math.floor(Math.random() * 4) * Math.PI / 2,
    Math.floor(Math.random() * 4) * Math.PI / 2,
  ))

  const attitude: [number, number, number, number] = [
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
  ]

  return {
    id: OPENING_DIE_ID,
    position: [
      Math.cos(angle) * radius,
      BOWL_INTERIOR_FLOOR_HEIGHT + DIE_SIZE / 2,
      Math.sin(angle) * radius,
    ],
    rotation: attitude,
    face: readDieFace(attitude),
  }
}
