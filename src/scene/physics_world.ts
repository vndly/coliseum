import {ActiveEvents,
  ColliderDesc,
  QueryFilterFlags,
  Ray,
  TriMeshFlags,
  World,
  init} from '@dimforge/rapier3d-compat'
import type {Collider} from '@dimforge/rapier3d-compat'
import {Vector3} from 'three'
import type {BufferGeometry} from 'three'
import {BOWL_FRICTION,
  BOWL_RESTITUTION,
  FELT_SENSOR_DEPTH,
  GRAVITY,
  PHYSICS_MAX_STEPS_PER_FRAME,
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
  private felt: Collider | null = null // Sensor; anything reaching it is out of play
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

    if (simulation === null) {
      return
    }

    this.accumulatedTime += deltaTime

    // A backgrounded tab hands back one enormous frame. Capping the backlog
    // spends what it can and drops the rest, rather than stalling for seconds
    // simulating a stretch of time nobody watched.
    this.accumulatedTime = Math.min(
      this.accumulatedTime,
      PHYSICS_TIMESTEP * PHYSICS_MAX_STEPS_PER_FRAME,
    )

    while (this.accumulatedTime >= PHYSICS_TIMESTEP) {
      simulation.step()
      this.accumulatedTime -= PHYSICS_TIMESTEP
    }
  }

  /**
   * Visits every collider currently touching the felt, which is every die that
   * has left play.
   * @param visit - Called once per collider intersecting the felt sensor
   */
  forEachColliderOnFelt(visit: (collider: Collider) => void): void {
    if (this.simulation === null || this.felt === null) {
      return
    }

    this.simulation.intersectionPairsWith(this.felt, visit)
  }

  /**
   * Finds where a segment first meets something solid — the bowl, or a die
   * already in it. The felt is excluded, being a sensor: the aim preview stops
   * itself at the table.
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
    const hit = this.simulation.castRay(
      new Ray(from, direction),
      1,
      true,
      QueryFilterFlags.EXCLUDE_SENSORS,
    )

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
    this.simulation?.free()
    this.simulation = null
    this.felt = null
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
   * Installs the felt as a sensor whose top face sits exactly at table height.
   * @param simulation - The world to add the collider to
   * @returns The sensor, kept so it can be polled for what is touching it
   */
  private static buildFelt(simulation: World): Collider {
    const descriptor = ColliderDesc.cuboid(
      TABLE_SIZE / 2,
      FELT_SENSOR_DEPTH / 2,
      TABLE_SIZE / 2,
    )
      .setTranslation(0, -FELT_SENSOR_DEPTH / 2, 0)
      .setSensor(true)
      .setActiveEvents(ActiveEvents.COLLISION_EVENTS)

    return simulation.createCollider(descriptor)
  }
}
