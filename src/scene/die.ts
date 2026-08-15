import {ColliderDesc, RigidBodyDesc} from '@dimforge/rapier3d-compat'
import type {ColliderHandle, RigidBody, World} from '@dimforge/rapier3d-compat'
import {Quaternion, Vector3} from 'three'
import type {Object3D} from 'three'
import type {DieSnapshot, ThrowLaunch} from '@/scene/die_state'
import {DIE_ANGULAR_DAMPING,
  DIE_CORNER_RADIUS,
  DIE_FRICTION,
  DIE_INERTIA,
  DIE_LINEAR_DAMPING,
  DIE_MASS,
  DIE_RESTITUTION,
  DIE_SIZE,
  DIE_VANISH_DURATION} from '@/scene/dimensions'

const AT_REST = new Vector3(0, 0, 0) // Shared, and only ever read

/**
 * One die in flight: a rigid body, and the meshes that are dragged along
 * behind it.
 *
 * The meshes are handed in rather than built here, because every die in the
 * bowl draws the same geometry and the same two materials — a die owns its
 * place in the world, not the shape it is drawn with.
 *
 * A die is built through one of the two named constructors rather than
 * directly, because there are exactly two ways one comes into existence and
 * they read as different things: thrown, which is a throw arriving from
 * whichever player made it, and resting, which is this machine being told what
 * the bowl already looks like.
 *
 * Continuous collision detection is on. A die is roughly a unit across and the
 * longest throw leaves the hand at about 145 units a second, which is more
 * than its own width per step — far enough to pass clean through the bowl's
 * wall, which is thinner than that.
 */
export class Die {
  private readonly identifier: string // Agreed with every other player
  private readonly meshes: Object3D // The visual half, positioned from the body
  private readonly body: RigidBody
  private readonly collider: ColliderHandle // Cached, so it survives the body's removal
  private outOfPlay = false // Set once the die has reached the table
  private vanished = 0 // How far through its exit the die is, from zero to one

  private constructor(
    world: World,
    meshes: Object3D,
    identifier: string,
    position: Vector3,
    rotation: Quaternion,
    velocity: Vector3,
    angularVelocity: Vector3,
  ) {
    this.identifier = identifier
    this.meshes = meshes

    this.body = world.createRigidBody(RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setAngvel(angularVelocity)
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

  /**
   * Builds a die from a throw, wherever that throw was made.
   * @param world - The world the body is created in
   * @param meshes - The visual half, already built
   * @param identifier - The name both players know this die by
   * @param launch - The throw, exactly as the thrower described it
   * @returns The die, already moving
   */
  static thrown(world: World, meshes: Object3D, identifier: string, launch: ThrowLaunch): Die {
    return new Die(
      world,
      meshes,
      identifier,
      new Vector3(...launch.origin),
      new Quaternion(...launch.orientation),
      new Vector3(...launch.velocity),
      new Vector3(...launch.angularVelocity),
    )
  }

  /**
   * Builds a die that is already still, from the match's authoritative bowl.
   * Used for the die a match opens with, for rebuilding the bowl after a
   * reload, and for a die this player never saw thrown.
   * @param world - The world the body is created in
   * @param meshes - The visual half, already built
   * @param snapshot - Where the die sits and how it is turned
   * @returns The die, at rest
   */
  static resting(world: World, meshes: Object3D, snapshot: DieSnapshot): Die {
    return new Die(
      world,
      meshes,
      snapshot.id,
      new Vector3(...snapshot.position),
      new Quaternion(...snapshot.rotation),
      AT_REST,
      AT_REST,
    )
  }

  get object(): Object3D {
    return this.meshes
  }

  /** The name this die goes by on every machine in the match. */
  get id(): string {
    return this.identifier
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

  /** Whether the die has reached the table and is on its way out of the match. */
  get isOutOfPlay(): boolean {
    return this.outOfPlay
  }

  /**
   * Whether the engine has decided the die has stopped moving. This is the
   * engine's own answer rather than a velocity threshold of our own, and it is
   * what the end of a throw is judged by.
   */
  get isAsleep(): boolean {
    return this.body.isSleeping()
  }

  /** Where the die sits and how it is turned, ready to be written to the match. */
  get snapshot(): DieSnapshot {
    const translation = this.body.translation()
    const rotation = this.body.rotation()

    return {
      id: this.identifier,
      position: [
        translation.x,
        translation.y,
        translation.z,
      ],
      rotation: [
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
      ],
    }
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
   * Puts the die exactly where the match says it is.
   *
   * This is the one place the rule stated on synchronize is deliberately set
   * aside. The body is the authority for everything inside this machine, but
   * the match is the authority above it: after a throw, every player's bowl is
   * set from the one the thrower wrote. Writing to the body rather than to the
   * meshes is what keeps the rule true either side of this call — the meshes
   * still only ever read from the body, and the next throw lands in a bowl the
   * physics agrees with rather than one only the renderer knows about.
   * @param position - Where the die is to sit
   * @param rotation - The attitude it is to sit in
   */
  teleport(position: Vector3, rotation: Quaternion): void {
    // Any exit begun here is called off. The match still holds this die, so it
    // spilled in this simulation and not in the one that counts — and a die
    // left part way through vanishing would go on shrinking and be culled,
    // taking off this screen a die every other player can still see.
    this.outOfPlay = false
    this.vanished = 0
    this.meshes.scale.setScalar(1)

    // Cleared without waking the body. A die moved while still carrying the
    // velocity it had somewhere else simply leaves again, and waking a settled
    // bowl on every reconciliation would have every die re-settle in front of
    // a player who was not watching anything move.
    this.body.setLinvel(AT_REST, false)
    this.body.setAngvel(AT_REST, false)
    this.body.setTranslation(position, false)
    this.body.setRotation(rotation, false)

    this.synchronize()
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
}
