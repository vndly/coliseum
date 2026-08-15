import {Euler, Plane, Quaternion, Raycaster, Vector2, Vector3} from 'three'
import type {PerspectiveCamera} from 'three'
import type {AimPreview} from '@/scene/aim_preview'
import type {ThrowLaunch} from '@/scene/die_state'
import type {PhysicsWorld} from '@/scene/physics_world'
import {AIM_DOT_COUNT,
  CAMERA_FAR,
  DIE_LAUNCH_SPIN,
  GRAVITY,
  THROW_CLEARANCE_HEIGHT,
  THROW_CLEARANCE_RADIUS,
  THROW_DESCENT_ANGLE,
  THROW_FLIGHT_TIME,
  THROW_LAUNCH_CAMERA_MARGIN,
  THROW_MAX_RADIUS,
  THROW_MIN_DRAG} from '@/scene/dimensions'

/**
 * Turns a drag across the canvas into a thrown die.
 *
 * The gesture is drawn backwards from the result: the press lands on the spot
 * the die is to arrive at, and the drag pulls back to the spot it is to be
 * thrown from. The line between the two is the throw itself — its direction is
 * where the die goes, and its length is both how far the die travels and, at a
 * fixed flight time, how fast it is thrown. Both ends are projected into the
 * scene, so the gesture is drawn in the same space the die flies through and
 * the throw is independent of where the camera happens to be orbited to.
 *
 * Only the ground is dragged over; the launch itself is lifted off it at a
 * fixed angle, which is what lets the line clear the near rim and drop into
 * the bowl instead of running into the outside of it. That lift runs back
 * along the camera's ray rather than straight up, so however high it climbs
 * the line still begins exactly under the pointer.
 *
 * The press is projected onto whatever is actually under the pointer — the
 * inside of the bowl, its rim, or the felt — rather than onto the table plane,
 * because the whole promise of the gesture is that the die lands where it was
 * pointed. The release is projected onto the table plane instead: it only ever
 * supplies the ground beneath the launch, and reading it off the near rim
 * whenever the drag crossed the bowl would make the throw jump.
 *
 * A finished gesture is handed out rather than thrown directly. The die it
 * describes has to reach the other players before it exists here, so what a
 * release produces is a description of a throw and not a die — including the
 * attitude and the tumble, which are drawn here rather than where the die is
 * built precisely so that every player builds the same one.
 *
 * Listeners are bound to the canvas here rather than in the component, in the
 * same way the orbit controls bind their own. Vue owns the element and this
 * object's lifetime, and nothing more.
 */
export class ThrowController {
  private readonly canvas: HTMLCanvasElement
  private readonly camera: PerspectiveCamera
  private readonly physics: PhysicsWorld
  private readonly preview: AimPreview
  private readonly launch: (launch: ThrowLaunch) => void // Where a finished gesture goes
  private enabled = false // Off until it is this player's turn; a match starts with someone else's

  private readonly raycaster = new Raycaster()
  private readonly table = new Plane(new Vector3(0, 1, 0), 0) // The felt, at height zero
  private readonly pointer = new Vector2() // Normalised device coordinates
  private readonly targetPoint = new Vector3() // Where the die is to land
  private readonly launchGround = new Vector3() // The table under where it is thrown from
  private readonly launchOrigin = new Vector3()
  private readonly launchVelocity = new Vector3()
  private readonly rayEnd = new Vector3() // Scratch, for casting the camera's ray
  private readonly contactPoint = new Vector3() // Scratch, for clipping the line
  private readonly launchRay = new Vector3() // Scratch, for lifting the launch
  private readonly downPointers = new Set<number>() // Every pointer currently held down
  private activePointer: number | null = null // Null whenever no throw is being aimed

  constructor(
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    physics: PhysicsWorld,
    preview: AimPreview,
    launch: (launch: ThrowLaunch) => void,
  ) {
    this.canvas = canvas
    this.camera = camera
    this.physics = physics
    this.preview = preview
    this.launch = launch

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
  }

  /**
   * Opens or closes the gesture. Closing it abandons whatever was being aimed,
   * so a turn that ends mid-drag does not leave a line on screen pointing at a
   * throw that can no longer be made.
   */
  set throwEnabled(enabled: boolean) {
    this.enabled = enabled

    if (!enabled) {
      this.cancel()
    }
  }

  dispose(): void {
    this.cancel()
    this.downPointers.clear()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
  }

  /**
   * Begins aiming, at the spot the die is to land on. Bound as a field so it
   * can be added and removed as a listener without losing its receiver.
   */
  private readonly onPointerDown = (event: PointerEvent): void => {
    // Someone else's turn. Nothing is recorded, because a gesture that cannot
    // begin cannot strand anything — and the next primary pointer clears the
    // set anyway, so the turn arriving mid-touch leaves nothing behind.
    if (!this.enabled) {
      return
    }

    // A primary pointer is by definition the first of a fresh gesture, so
    // anything still recorded as down is stale — an up that never arrived.
    // Without this the set could strand an entry and refuse every later throw.
    if (event.isPrimary) {
      this.downPointers.clear()
    }

    this.downPointers.add(event.pointerId)

    // Any other button is the camera's: the right one orbits, and an aim in
    // progress has just been overtaken by it.
    if (event.button !== 0) {
      this.cancel()

      return
    }

    // More than one pointer down is a two-finger orbit, and the camera owns
    // every finger of it. Tested against what is actually down rather than
    // against the aim, because cancelling clears the aim: a third finger would
    // otherwise arrive to a clean slate, start an aim of its own, and throw a
    // die when it lifted in the middle of the gesture.
    if (this.downPointers.size > 1) {
      this.cancel()

      return
    }

    if (!this.projectToScene(event, this.targetPoint)) {
      return
    }

    // Keep the throw where the camera is looking and the shadow map reaches,
    // rather than wherever a grazing ray happened to meet the table
    this.clampToThrowRadius(this.targetPoint)

    this.activePointer = event.pointerId
    this.canvas.setPointerCapture(event.pointerId)

    // A line of no length, so the preview stays down until the drag is a throw
    this.launchGround.set(this.targetPoint.x, 0, this.targetPoint.z)
    this.updatePreview()
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) {
      return
    }

    if (!this.projectToTable(event, this.launchGround)) {
      return
    }

    this.clampToThrowRadius(this.launchGround)
    this.updatePreview()
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.downPointers.delete(event.pointerId)

    if (event.pointerId !== this.activePointer) {
      return
    }

    if (this.projectToTable(event, this.launchGround)) {
      this.clampToThrowRadius(this.launchGround)

      if (this.buildLaunch()) {
        this.launch(this.describeLaunch())
      }
    }

    this.cancel()
  }

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.downPointers.delete(event.pointerId)

    if (event.pointerId === this.activePointer) {
      this.cancel()
    }
  }

  /**
   * Abandons the throw being aimed, if there is one, and takes the line down.
   */
  private cancel(): void {
    if (this.activePointer !== null && this.canvas.hasPointerCapture(this.activePointer)) {
      this.canvas.releasePointerCapture(this.activePointer)
    }

    this.activePointer = null
    this.preview.hide()
  }

  /**
   * Points the raycaster at whatever a pointer event is over.
   * @param event - The event to aim at
   * @returns Whether the canvas has a size to measure the pointer against
   */
  private aimRaycaster(event: PointerEvent): boolean {
    const bounds = this.canvas.getBoundingClientRect()

    if (bounds.width === 0 || bounds.height === 0) {
      return false
    }

    this.pointer.set(
      (event.clientX - bounds.left) / bounds.width * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)

    return true
  }

  /**
   * Finds the surface a pointer event is over — the bowl, a die already in
   * play, or the felt.
   * @param event - The event to project
   * @param target - Receives the point on the surface
   * @returns Whether the ray met anything at all
   */
  private projectToScene(event: PointerEvent, target: Vector3): boolean {
    if (!this.aimRaycaster(event)) {
      return false
    }

    const ray = this.raycaster.ray

    this.rayEnd.copy(ray.direction).multiplyScalar(CAMERA_FAR).add(ray.origin)

    if (this.physics.castSegment(ray.origin, this.rayEnd, target)) {
      return true
    }

    // Rapier is still loading, or the pointer is off past the edge of the
    // table. The plane the table lies in is the best answer left.
    return ray.intersectPlane(this.table, target) !== null
  }

  /**
   * Finds where a pointer event lands on the table's plane, through anything
   * standing on it.
   * @param event - The event to project
   * @param target - Receives the point on the plane
   * @returns Whether the ray met the plane at all
   */
  private projectToTable(event: PointerEvent, target: Vector3): boolean {
    if (!this.aimRaycaster(event)) {
      return false
    }

    return this.raycaster.ray.intersectPlane(this.table, target) !== null
  }

  /**
   * Pulls a point back inside the radius a throw may reach.
   * @param point - The point to clamp, in place
   */
  private clampToThrowRadius(point: Vector3): void {
    const radius = Math.hypot(point.x, point.z)

    if (radius <= THROW_MAX_RADIUS) {
      return
    }

    const scale = THROW_MAX_RADIUS / radius

    point.x *= scale
    point.z *= scale
  }

  /**
   * Works out where the die would be launched from, and how fast, for the line
   * as it currently stands.
   * @returns Whether the line is long enough to be a throw at all
   */
  private buildLaunch(): boolean {
    // Measured across the ground rather than along the line, because the line
    // is never shorter than the launch height and a bare click would clear any
    // dead zone stated in three dimensions
    const dragX = this.launchGround.x - this.targetPoint.x
    const dragZ = this.launchGround.z - this.targetPoint.z
    const dragLength = Math.hypot(dragX, dragZ)

    if (dragLength < THROW_MIN_DRAG) {
      return false
    }

    this.liftLaunch(this.targetPoint.y + dragLength * Math.tan(THROW_DESCENT_ANGLE))

    // The angle's own height can leave the launch inside the bowl's wall, and
    // a body that starts inside solid geometry is spat back out of it. Tested
    // on the launch itself rather than on where the drag ended, because
    // lifting it along the ray is what carries it over the bowl in the first
    // place. Lifting again can only carry it further in, so once at the
    // clearance height — which is above every part of the bowl — it is clear
    // wherever it has ended up.
    const radius = Math.hypot(this.launchOrigin.x, this.launchOrigin.z)

    if (radius < THROW_CLEARANCE_RADIUS && this.launchOrigin.y < THROW_CLEARANCE_HEIGHT) {
      this.liftLaunch(THROW_CLEARANCE_HEIGHT)
    }

    // Solved from a fixed flight time rather than a fixed speed. That is what
    // makes the speed proportional to the line's length — a longer line is a
    // harder throw, not a longer one — and what holds the flight close to the
    // straight line the preview draws, since the only thing separating the two
    // is the gravity the second term gives back.
    this.launchVelocity
      .subVectors(this.targetPoint, this.launchOrigin)
      .divideScalar(THROW_FLIGHT_TIME)
    this.launchVelocity.y -= GRAVITY * THROW_FLIGHT_TIME / 2

    return true
  }

  /**
   * Packages the throw as it currently stands, together with the attitude and
   * the tumble it is to leave the hand with.
   *
   * Both are drawn here rather than where the die is built. Every player in the
   * match builds a die from this same description, and a random value rolled at
   * the far end is the one thing that would guarantee they built different ones.
   * @returns The throw, ready both to be sent and to be made
   */
  private describeLaunch(): ThrowLaunch {
    const orientation = ThrowController.randomOrientation()
    const spin = ThrowController.randomSpin()

    return {
      origin: [
        this.launchOrigin.x,
        this.launchOrigin.y,
        this.launchOrigin.z,
      ],
      velocity: [
        this.launchVelocity.x,
        this.launchVelocity.y,
        this.launchVelocity.z,
      ],
      orientation: [
        orientation.x,
        orientation.y,
        orientation.z,
        orientation.w,
      ],
      angularVelocity: [
        spin.x,
        spin.y,
        spin.z,
      ],
    }
  }

  /**
   * A random attitude for the die as it leaves the hand.
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

  /**
   * Puts the launch at the given height above the table, and directly under
   * the pointer on screen.
   *
   * Lifted back along the camera's own ray rather than straight up off the
   * ground the drag ended on. A raised point does not project to the same
   * place on screen as the ground beneath it, so a vertical lift draws the
   * line's tail beside the pointer rather than under it — and, since the lift
   * grows with the drag, sliding further out the longer the drag gets, which
   * reads as the line running away from the hand holding it. Backing off along
   * the ray pins the tail to the pointer at any camera angle, and costs only a
   * throw slightly steeper than the angle asked for.
   * @param height - How high above the table the launch is to sit
   */
  private liftLaunch(height: number): void {
    // Aimed at where the drag was allowed to reach rather than at the pointer
    // itself. The two are the same ray until the drag runs past the throw
    // radius and is clamped back to it, and from there they have to differ:
    // lifting along the pointer's ray from a point no longer on it walks off
    // in a direction neither of them meant, far enough on a long drag to cross
    // the axis and turn the throw around. Held at the limit instead, which is
    // where the drag itself stopped.
    const direction = this.launchRay
      .subVectors(this.launchGround, this.camera.position)
      .normalize()

    // A launch above the camera lies behind it along a ray that only descends
    const lifted = Math.min(height, this.camera.position.y - THROW_LAUNCH_CAMERA_MARGIN)

    // The camera is always above the table it is looking at, so the ray always
    // descends. Guarded all the same: a level ray divides by zero and takes
    // the launch to infinity.
    if (direction.y >= 0) {
      this.launchOrigin.set(this.launchGround.x, lifted, this.launchGround.z)

      return
    }

    // Scaling a descending direction by a positive height gives a negative
    // multiplier, which is what walks back up the ray toward the camera
    this.launchOrigin
      .copy(direction)
      .multiplyScalar(lifted / direction.y)
      .add(this.launchGround)
  }

  /**
   * Redraws the line for the current drag, or takes it down while the drag is
   * still inside the dead zone — which is the only sign that a release would
   * throw nothing.
   */
  private updatePreview(): void {
    if (!this.buildLaunch()) {
      this.preview.hide()

      return
    }

    this.preview.show(this.sampleLine())
  }

  /**
   * Samples the line the throw would follow, stopping at the first thing in
   * the way. It is the path up to that contact and deliberately no further:
   * what the die does after its first bounce is the simulation's business, not
   * something worth promising in advance.
   * @returns The line, from the launch point to the point of first contact
   */
  private sampleLine(): Vector3[] {
    const hit = this.physics.castSegment(this.launchOrigin, this.targetPoint, this.contactPoint)
    const end = hit ? this.contactPoint : this.targetPoint

    const points: Vector3[] = []

    for (let index = 0; index < AIM_DOT_COUNT; index++) {
      points.push(new Vector3().lerpVectors(
        this.launchOrigin,
        end,
        index / (AIM_DOT_COUNT - 1),
      ))
    }

    return points
  }
}
