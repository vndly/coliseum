import {ColliderDesc, RigidBodyDesc} from '@dimforge/rapier3d-compat'
import type {ColliderHandle, RigidBody, World} from '@dimforge/rapier3d-compat'
import {Euler, Quaternion, Vector3} from 'three'
import type {Object3D} from 'three'
import {DIE_ANGULAR_DAMPING,
  DIE_CORNER_RADIUS,
  DIE_DENSITY,
  DIE_FRICTION,
  DIE_LAUNCH_SPIN,
  DIE_LINEAR_DAMPING,
  DIE_RESTITUTION,
  DIE_SIZE} from '@/scene/dimensions'

/**
 * One die in flight: a rigid body, and the meshes that are dragged along
 * behind it.
 *
 * The meshes are handed in rather than built here, because every die in the
 * bowl draws the same geometry and the same two materials — a die owns its
 * place in the world, not the shape it is drawn with.
 *
 * Continuous collision detection is on. A die is roughly a unit across and
 * leaves the hand at up to a hundred units a second, which is far enough per
 * step to pass clean through the bowl's wall without it.
 */
export class Die {
  private readonly meshes: Object3D // The visual half, positioned from the body
  private readonly body: RigidBody
  private readonly collider: ColliderHandle // Cached, so it survives the body's removal

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
        .setDensity(DIE_DENSITY)
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
