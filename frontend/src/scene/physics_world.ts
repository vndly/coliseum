import {ActiveEvents,
  CoefficientCombineRule,
  ColliderDesc,
  EventQueue,
  Ray,
  TriMeshFlags,
  World,
  init} from '@dimforge/rapier3d-compat'
import type {Collider, ColliderHandle} from '@dimforge/rapier3d-compat'
import {Vector3} from 'three'
import type {BufferGeometry} from 'three'
import {BOWL_FRICTION,
  BOWL_RESTITUTION,
  CONTACT_PREDICTION_DISTANCE,
  FELT_DEPTH,
  FELT_FRICTION,
  FELT_RESTITUTION,
  GRAVITY,
  LENGTH_UNIT,
  MAX_FRAME_TIME,
  PHYSICS_TIMESTEP,
  TABLE_SIZE} from '@/scene/dimensions'

export type RollImpact = 'single' | 'multiple'

/**
 * The rigid-body world the dice are thrown into.
 *
 * Rapier is a WASM module and has to be awaited before a world can exist, so
 * this class is deliberately usable before it is ready: it is constructed
 * synchronously, the scene keeps painting, and everything that needs the world
 * simply does nothing until initialize resolves. That keeps the first rendered
 * frame from waiting on the WASM decode and compile, at the cost of a press in
 * the first moments doing nothing.
 *
 * The bowl's collider is built from the very triangles the bowl is drawn from,
 * so there is only ever one description of its shape.
 *
 * Every collider in the scene — these two and the dice — asks for Rapier's
 * multiplying rule on both friction and restitution, and they all have to,
 * because a pair that disagrees is resolved by a fixed precedence rather than
 * by anything either collider meant. Multiplying is what lets the die's three
 * pairings be set apart from one another: it is bouncy against another die,
 * dull against the bowl and dead against the felt, which under an average
 * would be three demands on one number. Anything added to this world has to
 * ask for it too.
 *
 * What the rule costs is that a surface meant to grip or bounce harder than a
 * die does can only say so by giving its own figure up to 1.0, since the
 * product can never exceed either half. BOWL_FRICTION is the one that has had
 * to, and it says so where it is stated.
 */
export class PhysicsWorld {
  private simulation: World | null = null // Null until the WASM module has loaded
  private bowl: Collider | null = null // Kept so a thrown die's first impact can be named
  private felt: Collider | null = null // The table; reports every die that leaves play
  private events: EventQueue | null = null // Created with the world, and drained by hand
  private readonly landed: ColliderHandle[] = [] // Whatever first touched the felt this frame
  private readonly impacts: RollImpact[] = [] // First classified impact of each thrown die this frame
  private readonly thrown = new Set<ColliderHandle>() // Thrown dice still waiting for a first impact
  private readonly coThrown = new Set<ColliderHandle>() // The whole throw, including classified dice
  private readonly hitDice = new Set<ColliderHandle>() // Tracked dice that met an old die this step
  private readonly hitBowl = new Set<ColliderHandle>() // Tracked dice that met the bowl this step
  private readonly hitFelt = new Set<ColliderHandle>() // Tracked dice that met only the felt this step
  private accumulatedTime = 0 // Frame time left over, waiting for a whole step
  private disposed = false
  private readonly rayDirection = new Vector3() // Scratch, to keep casts allocation free

  /**
   * The world itself, for the dice to add their own bodies to. Null until
   * initialize has resolved, which is the only reason it is exposed at all.
   */
  get world(): World | null {
    return this.simulation
  }

  /**
   * Loads Rapier, builds the world and installs the static geometry.
   * @param bowlGeometry - The revolved shell, used directly as a triangle mesh collider
   */
  async initialize(bowlGeometry: BufferGeometry): Promise<void> {
    await init()

    // The scene can be torn down while the module is still loading, and a
    // world built after that would never be stepped and never be freed.
    if (this.disposed) {
      return
    }

    const simulation = new World(new Vector3(0, GRAVITY, 0))
    simulation.timestep = PHYSICS_TIMESTEP

    // Rapier sizes its own tolerances in metres, and this is what tells it how
    // long a metre is here. Almost nothing it scales matters; the one that does
    // is how far ahead the engine looks for a contact, which it puts far too
    // high and which is taken back off it on the next line.
    simulation.integrationParameters.lengthUnit = LENGTH_UNIT

    // Stated in die widths like every other measurement here, and divided back
    // out by the scale Rapier is about to multiply it by again.
    simulation.integrationParameters.normalizedPredictionDistance
      = CONTACT_PREDICTION_DISTANCE / LENGTH_UNIT

    this.bowl = PhysicsWorld.buildBowl(simulation, bowlGeometry)

    this.felt = PhysicsWorld.buildFelt(simulation)

    // Deliberately drained by hand after each fixed step. Besides preserving
    // every landing across a frame, that keeps impacts in separate time steps:
    // a die hit in one step must win over a bowl hit in the next.
    this.events = new EventQueue(false)
    this.simulation = simulation
  }

  /**
   * Advances the simulation by whole fixed steps.
   *
   * Fixed rather than frame-length steps because a die is small, fast and
   * bouncing off a curved wall: the one place where a step that varies with
   * the frame rate stops being a detail and starts changing where the die
   * lands.
   * @param deltaTime - Seconds elapsed since the previous frame
   */
  step(deltaTime: number): void {
    const simulation = this.simulation
    const events = this.events

    if (simulation === null || events === null) {
      return
    }

    this.landed.length = 0
    this.impacts.length = 0
    this.accumulatedTime += deltaTime

    // A backgrounded tab hands back one enormous frame. Capping the backlog
    // spends what it can and drops the rest, rather than stalling for seconds
    // simulating a stretch of time nobody watched.
    this.accumulatedTime = Math.min(this.accumulatedTime, MAX_FRAME_TIME)

    while (this.accumulatedTime >= PHYSICS_TIMESTEP) {
      simulation.step(events)
      this.collectCollisions()
      this.accumulatedTime -= PHYSICS_TIMESTEP
    }
  }

  /**
   * Visits every collider that reached the felt during this frame's steps,
   * which is every die that has just left play.
   * @param visit - Called once per collider that landed on the table
   */
  forEachColliderLandedOnFelt(visit: (collider: ColliderHandle) => void): void {
    for (const collider of this.landed) {
      visit(collider)
    }
  }

  /**
   * Visits the first classified impact of every die thrown this frame.
   * @param visit - Called once per die, with what it hit first
   */
  forEachRollImpact(visit: (impact: RollImpact) => void): void {
    for (const impact of this.impacts) {
      visit(impact)
    }
  }

  /**
   * Watches the dice one throw successfully put into the world.
   *
   * Only these colliders ask Rapier for collision events. Resting dice need no
   * events of their own: touching one is reported through the thrown die, and
   * the felt already reports its half of every landing.
   * @param colliders - Every die created for one throw
   */
  trackThrow(colliders: ColliderHandle[]): void {
    this.cancelTrackedThrow()

    const simulation = this.simulation

    if (simulation === null) {
      return
    }

    for (const handle of colliders) {
      simulation.getCollider(handle).setActiveEvents(ActiveEvents.COLLISION_EVENTS)
      this.thrown.add(handle)
      this.coThrown.add(handle)
    }
  }

  /** Stops waiting for impacts from the current throw, if there is one. */
  cancelTrackedThrow(): void {
    for (const handle of this.thrown) {
      this.stopTracking(handle)
    }

    this.thrown.clear()
    this.coThrown.clear()
    this.hitDice.clear()
    this.hitBowl.clear()
    this.hitFelt.clear()
  }

  /**
   * Finds where a segment first meets something solid — the bowl, the table,
   * or a die already in play.
   * @param from - Where the segment starts
   * @param to - Where the segment ends
   * @param target - Receives the point of contact, when there is one
   * @returns Whether the segment hit anything
   */
  castSegment(from: Vector3, to: Vector3, target: Vector3): boolean {
    if (this.simulation === null) {
      return false
    }

    // Casting along the un-normalised segment puts the time of impact in
    // [0, 1] over its length, so a maximum of one covers it exactly.
    const direction = this.rayDirection.subVectors(to, from)
    const hit = this.simulation.castRay(new Ray(from, direction), 1, true)

    if (hit === null) {
      return false
    }

    target.copy(direction).multiplyScalar(hit.timeOfImpact).add(from)

    return true
  }

  /**
   * Frees the world and every body in it, and stops a still-loading Rapier
   * from building one afterwards.
   */
  dispose(): void {
    this.disposed = true
    this.cancelTrackedThrow()
    this.events?.free()
    this.events = null
    this.simulation?.free()
    this.simulation = null
    this.bowl = null
    this.felt = null

    // Handles into a world that no longer exists. Nothing reads them after
    // the loop stops, but this class is usable either side of having a world
    // and every other member of it says so.
    this.landed.length = 0
    this.impacts.length = 0
  }

  /**
   * Drains one fixed step's collision events into landings and first impacts.
   *
   * Contacts are gathered before any of them is classified. Rapier does not
   * state an order for two contacts beginning within one step, so meeting an
   * old die wins over meeting the bowl there, as the audible result intended.
   *
   * A co-thrown die is ignored. It remains in coThrown after its own impact has
   * been classified so that a later sibling cannot mistake it for an old die.
   */
  private collectCollisions(): void {
    const events = this.events
    const bowl = this.bowl
    const felt = this.felt

    if (events === null || bowl === null || felt === null) {
      return
    }

    this.hitDice.clear()
    this.hitBowl.clear()
    this.hitFelt.clear()

    events.drainCollisionEvents((first, second, started) => {
      if (!started) {
        return
      }

      if (first === felt.handle) {
        this.landed.push(second)
      } else if (second === felt.handle) {
        this.landed.push(first)
      }

      this.recordCollision(first, second, bowl.handle, felt.handle)
      this.recordCollision(second, first, bowl.handle, felt.handle)
    })

    for (const collider of this.thrown) {
      if (this.hitDice.has(collider)) {
        this.finishImpact(collider, 'multiple')
      } else if (this.hitBowl.has(collider)) {
        this.finishImpact(collider, 'single')
      } else if (this.hitFelt.has(collider)) {
        // A throw that missed the bowl is already over as far as its first
        // impact is concerned, but the felt itself remains responsible for
        // taking the die out of play.
        this.finishImpact(collider, null)
      }
    }
  }

  /** Records one tracked half of a collision that began this fixed step. */
  private recordCollision(
    collider: ColliderHandle,
    other: ColliderHandle,
    bowl: ColliderHandle,
    felt: ColliderHandle,
  ): void {
    if (!this.thrown.has(collider) || this.coThrown.has(other)) {
      return
    }

    if (other === bowl) {
      this.hitBowl.add(collider)
    } else if (other === felt) {
      this.hitFelt.add(collider)
    } else {
      // Bowl, felt and dice are the whole world. With both static colliders
      // named above, the remaining collider is a die already in the bowl.
      this.hitDice.add(collider)
    }
  }

  /** Retires one thrown collider and emits its audible impact, when it has one. */
  private finishImpact(collider: ColliderHandle, impact: RollImpact | null): void {
    this.thrown.delete(collider)
    this.stopTracking(collider)

    if (impact !== null) {
      this.impacts.push(impact)
    }
  }

  /** Turns off collision events on one die without affecting felt landings. */
  private stopTracking(handle: ColliderHandle): void {
    const simulation = this.simulation

    if (simulation !== null) {
      simulation.getCollider(handle).setActiveEvents(ActiveEvents.NONE)
    }
  }

  /**
   * Installs the bowl as a static triangle mesh, taken straight from the mesh
   * being rendered.
   * @param simulation - The world to add the collider to
   * @param geometry - The bowl's revolved shell
   * @returns The bowl, kept so thrown dice can be recognised touching it
   */
  private static buildBowl(simulation: World, geometry: BufferGeometry): Collider {
    const positions = geometry.getAttribute('position')
    const index = geometry.getIndex()

    if (index === null) {
      throw new Error('The bowl geometry must be indexed to become a collider')
    }

    // Fixing internal edges is what stops a die catching on the seams between
    // triangles as it slides down the wall, and it merges the duplicated
    // vertices the lathe leaves along its seam on the way.
    const descriptor = ColliderDesc.trimesh(
      new Float32Array(positions.array),
      new Uint32Array(index.array),
      TriMeshFlags.FIX_INTERNAL_EDGES,
    )
      .setFriction(BOWL_FRICTION)
      .setRestitution(BOWL_RESTITUTION)
      .setFrictionCombineRule(CoefficientCombineRule.Multiply)
      .setRestitutionCombineRule(CoefficientCombineRule.Multiply)

    return simulation.createCollider(descriptor)
  }

  /**
   * Installs the felt as a solid slab whose top face sits exactly at table
   * height. It reports collision events permanently, which makes every event
   * involving it a die arriving at or leaving the table.
   * @param simulation - The world to add the collider to
   * @returns The felt, kept so its own events can be told from a die's
   */
  private static buildFelt(simulation: World): Collider {
    const descriptor = ColliderDesc.cuboid(
      TABLE_SIZE / 2,
      FELT_DEPTH / 2,
      TABLE_SIZE / 2,
    )
      .setTranslation(0, -FELT_DEPTH / 2, 0)
      .setFriction(FELT_FRICTION)
      .setRestitution(FELT_RESTITUTION)
      .setFrictionCombineRule(CoefficientCombineRule.Multiply)
      .setRestitutionCombineRule(CoefficientCombineRule.Multiply)
      .setActiveEvents(ActiveEvents.COLLISION_EVENTS)

    return simulation.createCollider(descriptor)
  }
}
