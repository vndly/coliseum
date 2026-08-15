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
  FELT_DEPTH,
  FELT_FRICTION,
  FELT_RESTITUTION,
  GRAVITY,
  MAX_FRAME_TIME,
  PHYSICS_TIMESTEP,
  TABLE_SIZE} from '@/scene/dimensions'

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
 */
export class PhysicsWorld {
  private simulation: World | null = null // Null until the WASM module has loaded
  private felt: Collider | null = null // The table; the one collider that reports events
  private events: EventQueue | null = null // Created with the world, and drained by hand
  private readonly landed: ColliderHandle[] = [] // Whatever first touched the felt this frame
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

    PhysicsWorld.buildBowl(simulation, bowlGeometry)

    this.felt = PhysicsWorld.buildFelt(simulation)

    // Deliberately not auto-draining. A frame runs several fixed steps, and an
    // auto-drained queue is emptied at the start of every one of them, so
    // every landing but the last would be discarded before it could be read.
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
    this.accumulatedTime += deltaTime

    // A backgrounded tab hands back one enormous frame. Capping the backlog
    // spends what it can and drops the rest, rather than stalling for seconds
    // simulating a stretch of time nobody watched.
    this.accumulatedTime = Math.min(this.accumulatedTime, MAX_FRAME_TIME)

    while (this.accumulatedTime >= PHYSICS_TIMESTEP) {
      simulation.step(events)
      this.accumulatedTime -= PHYSICS_TIMESTEP
    }

    this.collectLandings()
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
    this.events?.free()
    this.events = null
    this.simulation?.free()
    this.simulation = null
    this.felt = null

    // Handles into a world that no longer exists. Nothing reads them after
    // the loop stops, but this class is usable either side of having a world
    // and every other member of it says so.
    this.landed.length = 0
  }

  /**
   * Drains the frame's collision events into the list of colliders that have
   * just reached the felt.
   *
   * The felt is the only collider asking for events, so every event reported
   * is one of its own, and an event that ends a contact rather than starting
   * one is a die being shoved off the table by another, not a landing.
   *
   * Which half of the pair is the felt is tested rather than inferred. Reading
   * "not the felt" as "a die" would be right today and quietly wrong the moment
   * anything else in the world asked for events of its own.
   */
  private collectLandings(): void {
    const events = this.events
    const felt = this.felt

    if (events === null || felt === null) {
      return
    }

    events.drainCollisionEvents((first, second, started) => {
      if (!started) {
        return
      }

      if (first === felt.handle) {
        this.landed.push(second)
      } else if (second === felt.handle) {
        this.landed.push(first)
      }
    })
  }

  /**
   * Installs the bowl as a static triangle mesh, taken straight from the mesh
   * being rendered.
   * @param simulation - The world to add the collider to
   * @param geometry - The bowl's revolved shell
   */
  private static buildBowl(simulation: World, geometry: BufferGeometry): void {
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

    simulation.createCollider(descriptor)
  }

  /**
   * Installs the felt as a solid slab whose top face sits exactly at table
   * height. It is the only collider that reports collision events, which makes
   * every event the engine produces a die arriving at or leaving the table.
   *
   * Its restitution is asked for as the minimum of the two materials rather
   * than the average Rapier would otherwise take. A die is bouncy — it has to
   * be, or a hit between two of them does nothing — and averaging that into the
   * felt would leave a spilled die hopping across the table on its way to being
   * culled. Two colliders that disagree about the rule are resolved in the
   * fixed order average, minimum, product, maximum, so a felt asking for the
   * minimum beats a die that never asked for anything and this is the only
   * place the rule has to be stated.
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
      .setRestitutionCombineRule(CoefficientCombineRule.Min)
      .setActiveEvents(ActiveEvents.COLLISION_EVENTS)

    return simulation.createCollider(descriptor)
  }
}
