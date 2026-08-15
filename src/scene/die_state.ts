import {Euler, Quaternion} from 'three'
import {BOWL_INTERIOR_FLOOR_HEIGHT,
  BOWL_INTERIOR_FLOOR_RADIUS,
  DIE_SIZE,
  OPENING_DIE_ID} from '@/scene/dimensions'

/**
 * The two shapes a die crosses the network in.
 *
 * They live in the scene rather than in the match layer because the scene is
 * what produces and consumes them: a throw is described here and a resting bowl
 * is described here. The match layer only carries them, which is what keeps
 * every file under scene/ free of any knowledge that a network exists at all.
 *
 * Both are plain numbers rather than Three's vector types, because they are
 * written to and read from a document store and have to survive the trip.
 */

/** A die at rest, as it is held in the match's authoritative bowl. */
export interface DieSnapshot {
  id: string // The sequence number of the throw that made it; both players agree on it
  position: [number, number, number]
  rotation: [number, number, number, number] // Quaternion, x y z w
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

  return {
    id: OPENING_DIE_ID,
    position: [
      Math.cos(angle) * radius,
      BOWL_INTERIOR_FLOOR_HEIGHT + DIE_SIZE / 2,
      Math.sin(angle) * radius,
    ],
    rotation: [
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    ],
  }
}
