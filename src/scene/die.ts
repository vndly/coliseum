import {ColliderDesc, RigidBodyDesc} from '@dimforge/rapier3d-compat'
import type {ColliderHandle, RigidBody, World} from '@dimforge/rapier3d-compat'
import {Euler, Quaternion, Vector3} from 'three'
import type {Object3D} from 'three'
import {DIE_ANGULAR_DAMPING,
  DIE_CORNER_RADIUS,
  DIE_FRICTION,
  DIE_INERTIA,
  DIE_LAUNCH_SPIN,
  DIE_LINEAR_DAMPING,
  DIE_MASS,
  DIE_RESTITUTION,
  DIE_SIZE,
  DIE_VANISH_DURATION} from '@/scene/dimensions'

/**
 * One die in flight: a rigid body, and the meshes that are dragged along
 * behind it.
 *
 * The meshes are handed in rather than built here, because every die in the
 * bowl draws the same geometry and the same two materials — a die owns its
 * place in the world, not the shape it is drawn with.
 *
 * Continuous collision detection is on. A die is roughly a unit across and the
 * longest throw leaves the hand at about 145 units a second, which is more
 * than its own width per step — far enough to pass clean through the bowl's
 * wall, which is thinner than that.
 */
export class Die {
  private readonly meshes: Object3D // The visual half, positioned from the body
  private readonly body: RigidBody
  private readonly collider: ColliderHandle // Cached, so it survives the body's removal
  private outOfPlay = false // Set once the die has reached the table
  private vanished = 0 // How far through its exit the die is, from zero to one

  constructor(world: World, meshes: Object3D, origin: Vector3, velocity: Vector3) {
    this.meshes = meshes

    this.body = world.createRigidBody(RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setRotation(Die.randomOrientation())
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setAngvel(Die.randomSpin())
      .setLinearDamping(DIE_LINEAR_DAMPING)
      .setAngularDamping(DIE_ANGULAR_DAMPING)
      .setCcdEnabled(true))

    // A round cuboid, so the collider has the same rounded edges the mesh is
    // drawn with. The half extents describe the inner box the rounding is
    // grown from, which is why the corner radius comes off them.
    const halfExtent = DIE_SIZE / 2 - DIE_CORNER_RADIUS

    this.collider = world.createCollider(
      ColliderDesc.roundCuboid(halfExtent, halfExtent, halfExtent, DIE_CORNER_RADIUS)

        // Stated rather than left to the shape and a density. Both figures are
        // a solid cube's, so Rapier would arrive at the same place on its own;
        // saying them out loud is what keeps the mass and the inertia in one
        // file with everything else the throw is tuned by.
        .setMassProperties(
          DIE_MASS,
          new Vector3(0, 0, 0), // Centre of mass, at the die's own centre
          new Vector3(DIE_INERTIA, DIE_INERTIA, DIE_INERTIA), // Equal about all three axes, as a cube's is
          new Quaternion(), // The inertia's own frame, square to the die
        )
        .setFriction(DIE_FRICTION)
        .setRestitution(DIE_RESTITUTION),
      this.body,
    ).handle

    this.synchronize()
  }

  get object(): Object3D {
    return this.meshes
  }

  /**
   * The die's collider, which is how it is recognised among the colliders
   * reported as touching the felt.
   */
  get colliderHandle(): ColliderHandle {
    return this.collider
  }

  /**
   * Whether nothing of the die is left to draw, and it can be taken out of the
   * world.
   */
  get isSpent(): boolean {
    return this.vanished >= 1
  }

  /**
   * Records that the die has landed on the table and is no longer in play. It
   * keeps being simulated all the same: it is only taken away once it has come
   * to rest, and being shoved about by the next die to land is part of that.
   */
  markOutOfPlay(): void {
    this.outOfPlay = true
  }

  /**
   * Copies the simulated transform onto the meshes. The body is the authority;
   * nothing ever writes back the other way.
   */
  synchronize(): void {
    const translation = this.body.translation()
    const rotation = this.body.rotation()

    this.meshes.position.set(translation.x, translation.y, translation.z)
    this.meshes.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
  }

  /**
   * Advances the die's exit, if it has one to make.
   *
   * A die that has left play waits for the engine to put its body to sleep,
   * which is the engine's own answer to the question of whether it has stopped
   * moving, and then shrinks away. Once the shrinking has begun it finishes,
   * even if another die arrives and wakes the body up again — an exit that
   * could be interrupted would let a busy corner of the table keep a die
   * flickering back into existence.
   * @param deltaTime - Seconds elapsed since the previous frame
   */
  advanceExit(deltaTime: number): void {
    if (!this.outOfPlay || (this.vanished === 0 && !this.body.isSleeping())) {
      return
    }

    this.vanished = Math.min(this.vanished + deltaTime / DIE_VANISH_DURATION, 1)

    // Squared, so the die holds its size for a moment and then goes quickly.
    // A die shrinking at a constant rate reads as deflating rather than as
    // being taken off the table.
    this.meshes.scale.setScalar(1 - this.vanished * this.vanished)
  }

  /**
   * Takes the die out of the simulation. Its collider goes with the body.
   * @param world - The world the body was created in
   */
  remove(world: World): void {
    world.removeRigidBody(this.body)
  }

  /**
   * A random resting attitude for the die as it leaves the hand.
   *
   * Random Euler angles are not a uniform distribution over orientations, and
   * do not need to be: nothing here reads the face that lands upwards, so this
   * only has to stop every throw starting square to the camera.
   * @returns The starting rotation
   */
  private static randomOrientation(): Quaternion {
    return new Quaternion().setFromEuler(new Euler(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    ))
  }

  /**
   * The tumble the die is thrown with. Without it a die launched flat stays
   * flat, arrives face down and slides rather than rolls.
   * @returns The starting angular velocity, in radians per second
   */
  private static randomSpin(): Vector3 {
    return new Vector3(
      (Math.random() * 2 - 1) * DIE_LAUNCH_SPIN,
      (Math.random() * 2 - 1) * DIE_LAUNCH_SPIN,
      (Math.random() * 2 - 1) * DIE_LAUNCH_SPIN,
    )
  }
}
