import {Plane, Raycaster, Vector2, Vector3} from 'three'
import type {PerspectiveCamera} from 'three'
import type {AimPreview} from '@/scene/aim_preview'
import type {Dice} from '@/scene/dice'
import type {PhysicsWorld} from '@/scene/physics_world'
import {AIM_DOT_COUNT,
  AIM_SAMPLE_INTERVAL,
  GRAVITY,
  THROW_ELEVATION_ANGLE,
  THROW_LAUNCH_HEIGHT,
  THROW_MAX_DRAG,
  THROW_MAX_LAUNCH_RADIUS,
  THROW_MAX_SPEED,
  THROW_MIN_DRAG,
  THROW_MIN_SPEED} from '@/scene/dimensions'

/**
 * Turns a drag across the canvas into a thrown die.
 *
 * Both ends of the drag are projected onto the table, so the gesture is drawn
 * in the same space the die flies through: the die is launched from above
 * where the drag began, along the drag, and the length of the drag is its
 * strength. That makes the throw independent of where the camera happens to be
 * orbited to, for free.
 *
 * Strength is linear in the drag and deliberately not calibrated so that the
 * die lands where the pointer was released. The drag is a strength stick, not
 * a target; the arc is what says where the die will go.
 *
 * Listeners are bound to the canvas here rather than in the component, in the
 * same way the orbit controls bind their own. Vue owns the element and this
 * object's lifetime, and nothing more.
 */
export class ThrowController {
  private readonly canvas: HTMLCanvasElement
  private readonly camera: PerspectiveCamera
  private readonly physics: PhysicsWorld
  private readonly dice: Dice
  private readonly preview: AimPreview

  private readonly raycaster = new Raycaster()
  private readonly table = new Plane(new Vector3(0, 1, 0), 0) // The felt, at height zero
  private readonly pointer = new Vector2() // Normalised device coordinates
  private readonly pressPoint = new Vector3() // Where the drag began, on the table
  private readonly dragPoint = new Vector3() // Where it has reached, on the table
  private readonly launchOrigin = new Vector3()
  private readonly launchVelocity = new Vector3()
  private readonly contactPoint = new Vector3() // Scratch, for clipping the arc
  private readonly downPointers = new Set<number>() // Every pointer currently held down
  private activePointer: number | null = null // Null whenever no throw is being aimed

  constructor(
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    physics: PhysicsWorld,
    dice: Dice,
    preview: AimPreview,
  ) {
    this.canvas = canvas
    this.camera = camera
    this.physics = physics
    this.dice = dice
    this.preview = preview

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
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
   * Begins aiming. Bound as a field so it can be added and removed as a
   * listener without losing its receiver.
   */
  private readonly onPointerDown = (event: PointerEvent): void => {
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

    if (!this.projectToTable(event, this.pressPoint)) {
      return
    }

    // Keep the launch where the camera is looking and the shadow map reaches,
    // rather than wherever a grazing ray happened to meet the table
    this.clampToLaunchRadius(this.pressPoint)

    this.activePointer = event.pointerId
    this.canvas.setPointerCapture(event.pointerId)
    this.dragPoint.copy(this.pressPoint)
    this.updatePreview()
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) {
      return
    }

    if (!this.projectToTable(event, this.dragPoint)) {
      return
    }

    this.updatePreview()
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.downPointers.delete(event.pointerId)

    if (event.pointerId !== this.activePointer) {
      return
    }

    if (this.projectToTable(event, this.dragPoint) && this.buildLaunch()) {
      this.dice.throw(this.physics, this.launchOrigin, this.launchVelocity)
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
   * Abandons the throw being aimed, if there is one, and takes the arc down.
   */
  private cancel(): void {
    if (this.activePointer !== null && this.canvas.hasPointerCapture(this.activePointer)) {
      this.canvas.releasePointerCapture(this.activePointer)
    }

    this.activePointer = null
    this.preview.hide()
  }

  /**
   * Finds where a pointer event lands on the table.
   * @param event - The event to project
   * @param target - Receives the point on the table
   * @returns Whether the ray met the table at all
   */
  private projectToTable(event: PointerEvent, target: Vector3): boolean {
    const bounds = this.canvas.getBoundingClientRect()

    if (bounds.width === 0 || bounds.height === 0) {
      return false
    }

    this.pointer.set(
      (event.clientX - bounds.left) / bounds.width * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)

    return this.raycaster.ray.intersectPlane(this.table, target) !== null
  }

  /**
   * Pulls a point back inside the radius a throw may start from.
   * @param point - The point to clamp, in place
   */
  private clampToLaunchRadius(point: Vector3): void {
    const radius = Math.hypot(point.x, point.z)

    if (radius <= THROW_MAX_LAUNCH_RADIUS) {
      return
    }

    const scale = THROW_MAX_LAUNCH_RADIUS / radius

    point.x *= scale
    point.z *= scale
  }

  /**
   * Works out where the die would be launched from, and how fast, for the drag
   * as it currently stands.
   * @returns Whether the drag is long enough to be a throw at all
   */
  private buildLaunch(): boolean {
    const dragX = this.dragPoint.x - this.pressPoint.x
    const dragZ = this.dragPoint.z - this.pressPoint.z
    const dragLength = Math.hypot(dragX, dragZ)

    if (dragLength < THROW_MIN_DRAG) {
      return false
    }

    const strength = Math.min(
      (dragLength - THROW_MIN_DRAG) / (THROW_MAX_DRAG - THROW_MIN_DRAG),
      1,
    )
    const speed = THROW_MIN_SPEED + (THROW_MAX_SPEED - THROW_MIN_SPEED) * strength

    // The elevation is fixed at every strength, so the drag only ever has to
    // supply a direction and a scale. Dividing by the drag's length is what
    // normalises it into one.
    const horizontal = Math.cos(THROW_ELEVATION_ANGLE) * speed / dragLength

    this.launchOrigin.set(this.pressPoint.x, THROW_LAUNCH_HEIGHT, this.pressPoint.z)
    this.launchVelocity.set(
      dragX * horizontal,
      Math.sin(THROW_ELEVATION_ANGLE) * speed,
      dragZ * horizontal,
    )

    return true
  }

  /**
   * Redraws the arc for the current drag, or takes it down while the drag is
   * still inside the dead zone — which is the only sign that a release would
   * throw nothing.
   */
  private updatePreview(): void {
    if (!this.buildLaunch()) {
      this.preview.hide()

      return
    }

    this.preview.show(this.sampleArc())
  }

  /**
   * Samples the trajectory the throw would follow, stopping at the first thing
   * it meets. It is the true path up to that contact and deliberately no
   * further: what the die does after its first bounce is the simulation's
   * business, not something worth promising in advance.
   * @returns The arc, from the launch point to the point of first contact
   */
  private sampleArc(): Vector3[] {
    const points: Vector3[] = [this.launchOrigin.clone()]
    const previous = this.launchOrigin.clone()

    for (let index = 1; index < AIM_DOT_COUNT; index++) {
      const time = index * AIM_SAMPLE_INTERVAL
      const point = new Vector3(
        this.launchOrigin.x + this.launchVelocity.x * time,
        this.launchOrigin.y + this.launchVelocity.y * time + GRAVITY * time * time / 2,
        this.launchOrigin.z + this.launchVelocity.z * time,
      )

      // The felt is a sensor and stops no ray, so the table is the one surface
      // clipped against by hand. Everything solid is left to the cast below.
      if (point.y <= 0) {
        const fraction = previous.y / (previous.y - point.y)

        points.push(previous.clone().lerp(point, fraction))

        break
      }

      if (this.physics.castSegment(previous, point, this.contactPoint)) {
        points.push(this.contactPoint.clone())

        break
      }

      points.push(point)
      previous.copy(point)
    }

    return points
  }
}
