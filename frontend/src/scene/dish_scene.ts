import {ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  MOUSE,
  MathUtils,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TOUCH,
  Timer,
  WebGLRenderer} from 'three'
import type {WebGLRenderTarget} from 'three'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js'
import {AimPreview} from '@/scene/aim_preview'
import {Dice} from '@/scene/dice'
import type {DieSnapshot, ThrowLaunch, ThrowResolution, ThrownDie} from '@/scene/die_state'
import {Dish} from '@/scene/dish'
import {PhysicsWorld} from '@/scene/physics_world'
import {Table} from '@/scene/table'
import {ThrowController} from '@/scene/throw_controller'
import {BACKGROUND_COLOR,
  CAMERA_DAMPING_FACTOR,
  CAMERA_FAR,
  CAMERA_FIELD_OF_VIEW,
  CAMERA_MAX_DISTANCE,
  CAMERA_MAX_FIELD_OF_VIEW,
  CAMERA_MAX_POLAR_ANGLE,
  CAMERA_MIN_DISTANCE,
  CAMERA_MIN_POLAR_ANGLE,
  CAMERA_NEAR,
  CAMERA_REFERENCE_ASPECT,
  CAMERA_START_AZIMUTH_ANGLE,
  CAMERA_START_DISTANCE,
  CAMERA_START_POLAR_ANGLE,
  CAMERA_TARGET_HEIGHT,
  ENVIRONMENT_BLUR,
  ENVIRONMENT_INTENSITY,
  FOG_FAR,
  FOG_NEAR,
  KEY_LIGHT_COLOR,
  KEY_LIGHT_INTENSITY,
  KEY_LIGHT_POSITION,
  KEY_LIGHT_SHADOW_EXTENT,
  KEY_LIGHT_SHADOW_FAR,
  KEY_LIGHT_SHADOW_MAP_SIZE,
  KEY_LIGHT_SHADOW_NEAR,
  KEY_LIGHT_SHADOW_NORMAL_BIAS,
  MAX_FRAME_TIME,
  RESOLUTION_BEAT,
  SETTLE_MINIMUM,
  SETTLE_TIMEOUT} from '@/scene/dimensions'

const MAX_PIXEL_RATIO = 2 // Past this, cost climbs and nobody can see the difference

/**
 * Owns the renderer, camera, lighting and render loop for the dice bowl.
 *
 * Nothing here is reactive, deliberately. Transforms in this class change every
 * frame, and routing per-frame data through Vue's reactivity would put the
 * dependency tracker in the 60 fps path to no purpose. Vue owns the canvas
 * element and this object's lifetime; it does not own what happens inside.
 */
export class DishScene {
  private readonly renderer: WebGLRenderer
  private readonly scene: Scene
  private readonly camera: PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly dish: Dish
  private readonly table: Table
  private readonly physics: PhysicsWorld
  private readonly dice: Dice
  private readonly aimPreview: AimPreview
  private readonly throwController: ThrowController
  private readonly keyLight: DirectionalLight // Held only so its shadow map can be released
  private readonly environment: WebGLRenderTarget // Image-based light, generated not loaded
  private readonly resizeObserver: ResizeObserver
  /**
   * Drives the simulation's fixed steps.
   *
   * Deliberately not connected to the document. Its Page Visibility support
   * forces the delta to zero whenever the page is hidden, which silently
   * freezes the simulation on any frame that still runs while the tab reports
   * itself hidden. The animation loop already stops in a hidden tab, and the
   * backlog cap in PhysicsWorld already handles the catch-up on the way back.
   */
  private readonly timer = new Timer()

  private throwing: number | null = null // Seconds since a throw began here, null between throws
  private pending: DieSnapshot[] | null = null // A bowl from the match, waiting for this one to stop
  private pendingElapsed = 0
  private resolution: ThrowResolution | null = null // A verdict waiting to be played, or playing
  private resolutionStage: 'waiting' | 'removing' | 'returning' = 'waiting'
  private resolutionElapsed = 0
  private announceResolved = false // Whether the bowl still to be applied ends a verdict
  private deferred: ThrownDie[] = [] // Throws that arrived while the table was still catching up

  /**
   * Called when a gesture on this canvas finishes as a throw.
   *
   * The throw is deliberately not made here. It has to reach the other players
   * before it can happen, and it comes back through applyThrow like anyone
   * else's — which is what keeps one path through this class for every throw in
   * the match, whoever made it.
   */
  onLaunch: ((launches: ThrowLaunch[]) => void) | null = null

  /**
   * Called once when the bowl comes to rest after a throw, or when it has been
   * given long enough and is declared at rest regardless.
   */
  onSettled: (() => void) | null = null

  /**
   * Called once a verdict has finished playing and the bowl it leaves behind is
   * on the table. Until then the next player is looking at dice that are still
   * being taken away, and must not be able to throw into them.
   */
  onResolved: (() => void) | null = null

  /**
   * Called once the physics world has started, which is the moment this scene
   * can carry a throw at all.
   *
   * Rapier arrives a moment after the first frame does, and until it has there
   * is nowhere to build a die. A throw made into that gap is charged to a hand
   * and written to the match by the screen, and then never happens here — no
   * die is built, so nothing ever settles, and the turn it was meant to be part
   * of never ends. The screen holds its own controls shut until it hears this.
   */
  onPhysicsStarted: (() => void) | null = null

  /**
   * Called with the reason if the physics world never starts at all.
   *
   * A WebAssembly module that will not instantiate is not a slow load; it is a
   * scene that can never hold a die. Told rather than logged, because the
   * player is otherwise left looking at an empty bowl that answers nothing they
   * press, with nothing on screen saying why.
   */
  onPhysicsFailed: ((reason: unknown) => void) | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas: canvas,
      antialias: true,
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true

    // PCFSoftShadowMap is deprecated in this version of three and silently
    // falls back to this anyway. The only softer option left is VSM, which
    // bleeds light where a large dark object meets a lighter plane — exactly
    // the bowl sitting on the felt. A generous shadow map does more good here.
    this.renderer.shadowMap.type = PCFShadowMap

    this.scene = new Scene()
    this.scene.background = new Color(BACKGROUND_COLOR)

    // The table runs far past the camera, so its edge is dissolved rather than
    // drawn as a horizon. The near plane sits well beyond the bowl, which
    // keeps the bowl itself entirely unfogged.
    this.scene.fog = new Fog(BACKGROUND_COLOR, FOG_NEAR, FOG_FAR)

    this.camera = new PerspectiveCamera(CAMERA_FIELD_OF_VIEW, 1, CAMERA_NEAR, CAMERA_FAR)

    this.dish = new Dish()
    this.table = new Table()
    this.dice = new Dice()
    this.aimPreview = new AimPreview()
    this.scene.add(
      this.dish.object,
      this.table.object,
      this.dice.object,
      this.aimPreview.object,
    )

    this.environment = DishScene.buildEnvironment(this.renderer)
    this.scene.environment = this.environment.texture
    this.scene.environmentIntensity = ENVIRONMENT_INTENSITY

    this.keyLight = DishScene.buildKeyLight()
    this.scene.add(this.keyLight)

    this.controls = this.buildControls(canvas)

    this.physics = new PhysicsWorld()
    this.throwController = new ThrowController(
      canvas,
      this.camera,
      this.physics,
      this.aimPreview,
      this.emitLaunch,
    )

    // Deliberately not awaited. Rapier is a WASM module and takes a moment to
    // arrive; the bowl paints on the first frame either way, and a press that
    // lands before physics does simply throws nothing.
    this.physics.initialize(this.dish.shell).then(() => {
      this.onPhysicsStarted?.()
    }).catch((error: unknown) => {
      console.error('The physics world failed to start; dice cannot be thrown', error)
      this.onPhysicsFailed?.(error)
    })

    this.resizeObserver = new ResizeObserver(() => {
      this.resize()
    })
    this.resizeObserver.observe(canvas)
    this.resize()
  }

  /**
   * Begins rendering. Safe to call once; the loop runs until dispose.
   */
  start(): void {
    this.renderer.setAnimationLoop(this.render)
  }

  /**
   * Opens or closes the throw gesture, which is how a turn is enforced on the
   * canvas itself rather than only on the controls beside it.
   */
  set throwEnabled(enabled: boolean) {
    this.throwController.throwEnabled = enabled
  }

  /**
   * How many dice the next gesture on this canvas puts in the air. One on an
   * ordinary turn, and the player's whole hand on a turn that begins with an
   * empty bowl.
   */
  set throwCount(count: number) {
    this.throwController.throwCount = count
  }

  /**
   * Throws for a seat nobody is aiming for, drawing the gesture rather than
   * being given one.
   *
   * It leaves by the same door a gesture does: the throw is described here,
   * handed up through onLaunch, and only made once it comes back — which is
   * what keeps one path through this class for every throw in the match,
   * whoever or whatever made it.
   * @param count - How many dice the throw puts in the air
   */
  throwUnaimed(count: number): void {
    this.throwController.throwUnaimed(count)
  }

  /** How many dice are in the bowl, which is what DIE_LIMIT is measured against. */
  get dieCount(): number {
    return this.dice.count
  }

  /** Every die in the bowl, as the match is to record it. */
  get bowlSnapshot(): DieSnapshot[] {
    return this.dice.snapshot
  }

  /**
   * Whether there is a simulation behind the bowl at all.
   *
   * A scene whose physics never started holds no dice and reports an empty
   * bowl, which is indistinguishable from a bowl that has genuinely been
   * emptied. Anyone about to publish this player's bowl as the match's own has
   * to tell those two apart first.
   */
  get isSimulating(): boolean {
    return this.physics.world !== null
  }

  /**
   * Makes a throw, whoever made it.
   *
   * The local player's own throw comes through here too, and immediately
   * rather than after the round trip: the hand that threw it should not be
   * waiting on a database to see it leave.
   * @param dice - Every die of the throw, as its thrower described them
   */
  applyThrow(dice: ThrownDie[]): void {
    if (dice.length === 0) {
      return
    }

    // A verdict still playing, or a bowl still waiting to go on, is a whole
    // state described before this throw existed — and both are applied by
    // taking every die they do not name back out of the world. Dice built now
    // would be deleted by the very next one. Held instead, and thrown the
    // moment the table has caught up — or forgotten where a newer bowl reaches
    // holdBowl first, having already accounted for them.
    if (this.resolution !== null || this.pending !== null) {
      this.deferred.push(...dice)

      return
    }

    const before = this.dice.count

    for (const die of dice) {
      this.dice.throw(this.physics, die.id, die.skin, die.launch)
    }

    // Only a throw that actually put a die in the world is a throw to wait on.
    // A world that never started drops every die it is given, and a settle
    // clock armed over that comes to rest on a bowl this throw never reached —
    // which is then published as the match's own.
    if (this.dice.count > before) {
      this.throwing = 0
    }
  }

  /**
   * Takes a throw back out again, for a throw that turned out never to have
   * been made.
   *
   * The local player's own throw is shown before it is written, so that the
   * hand that made it does not wait on a database. A write that is then refused
   * leaves those dice standing in a bowl the match has never heard of, and the
   * retry the error line invites is given the same sequence number and so the
   * same identifiers — a bowl holding every die of the throw twice, which pays
   * the thrower twice for each of them.
   *
   * The settle clock goes with them. It was armed for this throw and there is
   * now nothing for it to come to rest on; left running it would declare a bowl
   * at rest that this player would publish as the match's own.
   * @param dice - The throw to withdraw, exactly as it was applied
   */
  withdrawThrow(dice: ThrownDie[]): void {
    const identifiers = dice.map((die) => die.id)

    this.deferred = this.deferred.filter((die) => !identifiers.includes(die.id))
    this.dice.withdraw(this.physics, identifiers)
    this.throwing = null
  }

  /**
   * Takes a settled throw's verdict and plays it out.
   *
   * The bowl is set to where the dice actually stopped first, so that every
   * player is looking at the same faces before any of them is called a six; the
   * two washes are then held in turn, and the bowl the match holds is applied
   * once the dice they took have finished leaving.
   *
   * Deferred on arrival for the same reason a bowl is: the thrower's simulation
   * finished first, which is why theirs is the one that counts, and it usually
   * lands here while these dice are still in the air.
   * @param resolution - What the throw came to, and in what order to show it
   * @param bowl - The bowl the match holds once the verdict has been played
   */
  applyVerdict(resolution: ThrowResolution, bowl: DieSnapshot[]): void {
    this.resolution = resolution
    this.resolutionStage = 'waiting'
    this.resolutionElapsed = 0
    this.announceResolved = true
    this.holdBowl(bowl)
  }

  /**
   * Takes the bowl the match holds as authoritative, and applies it as soon as
   * this player's own dice have stopped moving.
   *
   * Deferred rather than applied on arrival, because it usually arrives while
   * the dice are still in the air here — the thrower's simulation finished
   * first, which is the whole reason theirs is the one that counts. Snapping
   * on arrival would take the throw away from anyone still watching it.
   * @param bowl - Every die the match says is in the bowl
   */
  reconcileBowl(bowl: DieSnapshot[]): void {
    this.holdBowl(bowl)
  }

  /**
   * Holds a bowl from the match until this table has stopped moving.
   *
   * Whatever throws were being held are forgotten as it arrives, and that is
   * the whole reason holding one is safe. A bowl says where every die ended up
   * and it was written after those throws were made, so their dice are already
   * named in it and restoring it is what builds them. Thrown again on top of
   * that they would be built a second time under identifiers the bowl is
   * already using — and a bowl holding one die twice is a bowl that pairs it
   * with itself, in a verdict this player would then publish as the match's.
   * @param bowl - Every die the match says is in the bowl
   */
  private holdBowl(bowl: DieSnapshot[]): void {
    this.pending = bowl
    this.pendingElapsed = 0
    this.deferred.length = 0
  }

  /**
   * Stops the loop and releases every GPU resource this scene created.
   */
  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.throwController.dispose()
    this.controls.dispose()
    this.dish.dispose()
    this.table.dispose()
    this.dice.dispose()
    this.aimPreview.dispose()
    this.physics.dispose()

    // The renderer's own dispose clears its internal caches only; a light's
    // shadow map is a render target the light owns, and it stays allocated
    // unless it is released here.
    this.keyLight.shadow.dispose()

    this.environment.dispose()
    this.renderer.dispose()
  }

  /**
   * Draws one frame. Bound as a field so it can be handed to the renderer's
   * animation loop without losing its receiver.
   */
  private readonly render = (): void => {
    // Damping eases the camera after the pointer stops, which means the
    // controls keep moving on frames with no input and must be updated every
    // frame rather than only on events.
    this.controls.update()

    // Step first, then drag the meshes onto the bodies, so that what is drawn
    // is the state that was just simulated rather than the one before it.
    this.timer.update()

    // Capped before it is handed out rather than inside the simulation alone,
    // so that the dice age by exactly as much time as the world just advanced.
    // The frame that arrives on returning to a backgrounded tab is seconds
    // long, and a die part way through leaving would otherwise finish leaving
    // and be culled within it — vanishing between two frames, which is the one
    // thing its exit exists to avoid.
    const deltaTime = Math.min(this.timer.getDelta(), MAX_FRAME_TIME)

    this.physics.step(deltaTime)
    this.dice.update(this.physics, deltaTime)
    this.advanceMatch(deltaTime)

    this.renderer.render(this.scene, this.camera)
  }

  /**
   * Hands a finished gesture upwards. Bound as a field so it can be given to
   * the throw controller without losing its receiver.
   */
  private readonly emitLaunch = (launches: ThrowLaunch[]): void => {
    this.onLaunch?.(launches)
  }

  /**
   * Advances the three things the match waits on: a throw made here coming to
   * rest, a verdict being played out over it, and a bowl from the match waiting
   * for somewhere still to land in.
   * @param deltaTime - Seconds elapsed since the previous frame
   */
  private advanceMatch(deltaTime: number): void {
    if (this.throwing !== null) {
      this.throwing += deltaTime

      // The minimum covers the frames between a body being created and the
      // step that first moves it. Nothing has moved yet and every other die is
      // still asleep, which is indistinguishable from a bowl at rest.
      const atRest = this.throwing >= SETTLE_MINIMUM && this.dice.isSettled

      if (atRest || this.throwing >= SETTLE_TIMEOUT) {
        this.throwing = null
        this.onSettled?.()
      }
    }

    // The bowl a verdict ends at is the one waiting behind it, so it is held
    // until the verdict has finished with the dice it is about to take.
    //
    // Played out whether or not the world ever started, and so above the test
    // for one: a verdict is what hands the interface to the next turn, and a
    // scene with no physics can still show nothing for the right length of
    // time. Everything this stage calls holds its own peace without a world.
    if (this.resolution !== null) {
      this.advanceResolution(deltaTime)

      return
    }

    if (this.pending === null) {
      this.throwDeferred()

      return
    }

    this.pendingElapsed += deltaTime

    // Rapier is still loading, or never started. The bowl is held rather than
    // dropped: the first one a player is given is the match's opening state,
    // and arriving before the world does is the normal case rather than the
    // unlucky one. What is not held with it is the announcement — a verdict
    // that has finished playing has to let the interface go whether or not
    // there was ever a world to play it in, or the match is over for this
    // player without anything having ended it.
    if (this.physics.world === null) {
      this.announceResolution()

      return
    }

    if (!this.dice.isSettled && this.pendingElapsed < SETTLE_TIMEOUT) {
      return
    }

    const bowl = this.pending

    // Taken off before it is applied, so a bowl cannot be applied twice
    this.pending = null
    this.dice.restore(this.physics, bowl)
    this.announceResolution()
    this.throwDeferred()
  }

  /**
   * Says that a verdict has finished, once, to whoever is waiting to hear it.
   */
  private announceResolution(): void {
    if (this.announceResolved) {
      this.announceResolved = false
      this.onResolved?.()
    }
  }

  /**
   * Makes the throws that arrived while the table was still catching up.
   *
   * Only ever called with nothing queued in front of them, so the dice they
   * build are safe from the next whole-state apply, and what they make is an
   * ordinary throw — settle clock and all.
   */
  private throwDeferred(): void {
    if (this.deferred.length === 0) {
      return
    }

    const held = this.deferred

    // Taken off before they are made, so applyThrow cannot queue them again
    this.deferred = []
    this.applyThrow(held)
  }

  /**
   * Plays the verdict a frame at a time: the landing, then the sixes, then the
   * group.
   *
   * Paced on the render clock rather than on timers, so the washes are held for
   * as much time as the scene itself advanced through. A backgrounded tab hands
   * back one enormous frame, and a verdict measured in wall clock would be over
   * before the player looking at it had seen a single frame of it.
   * @param deltaTime - Seconds elapsed since the previous frame
   */
  private advanceResolution(deltaTime: number): void {
    const resolution = this.resolution

    if (resolution === null) {
      return
    }

    this.resolutionElapsed += deltaTime

    // The dice here are still in the air, or still spilling off the rim. What
    // the verdict has to show happens to the bowl the thrower saw, so it waits
    // for this one to be finished with.
    if (this.resolutionStage === 'waiting') {
      if (!this.dice.isSettled && this.resolutionElapsed < SETTLE_TIMEOUT) {
        return
      }

      this.dice.restore(this.physics, resolution.atRest)
      this.beginBeat('removing', resolution.removed)

      return
    }

    if (this.resolutionElapsed < RESOLUTION_BEAT) {
      return
    }

    if (this.resolutionStage === 'removing') {
      this.dice.dismiss(resolution.removed)
      this.beginBeat('returning', resolution.returned)

      return
    }

    this.dice.dismiss(resolution.returned)
    this.resolution = null
  }

  /**
   * Starts the next wash, or skips straight past it when it has nothing to
   * show. A throw where nobody rolled a six and nothing paired costs no time at
   * all, which is most of them.
   * @param stage - The wash to begin
   * @param identifiers - The dice it would be shown on
   */
  private beginBeat(stage: 'removing' | 'returning', identifiers: string[]): void {
    this.resolutionElapsed = 0
    this.resolutionStage = stage

    if (identifiers.length === 0) {
      // Nothing to hold on, so the beat is over before it began. The next frame
      // moves on to whatever comes after it.
      this.resolutionElapsed = RESOLUTION_BEAT

      return
    }

    if (stage === 'removing') {
      this.dice.markRemoved(identifiers)
    } else {
      this.dice.markReturned(identifiers)
    }
  }

  /**
   * Matches the drawing buffer and the camera's aspect to the canvas's current
   * layout size.
   */
  private resize(): void {
    const canvas = this.renderer.domElement
    const width = canvas.clientWidth
    const height = canvas.clientHeight

    if (width === 0 || height === 0) {
      return
    }

    // Re-read on every resize rather than only at construction: dragging the
    // window to a display of a different density changes the ratio, and the
    // buffer would otherwise stay sized for the old one and render soft.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))

    // Third argument off: CSS owns the element's size, so the renderer must
    // resize the drawing buffer without writing inline styles back onto it.
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.fov = DishScene.fieldOfView(this.camera.aspect)
    this.camera.updateProjectionMatrix()
  }

  /**
   * The vertical field of view a given frame is looked at through.
   *
   * Three states the angle vertically, so the same lens on a taller, narrower
   * frame sees less of the bowl across it — and a phone held upright is narrow
   * enough to cut the rim off on both sides at the opening distance. Below the
   * frame the distances were chosen for, the lens is opened up by exactly the
   * amount that holds the width it would have had, which leaves every landscape
   * frame looking at precisely what it looked at before.
   * @param aspect - The frame's width over its height
   * @returns The angle to look through, in degrees
   */
  private static fieldOfView(aspect: number): number {
    if (aspect >= CAMERA_REFERENCE_ASPECT) {
      return CAMERA_FIELD_OF_VIEW
    }

    // Half-angles, because the tangent identity that carries the width across
    // is stated about the half-angle and not the whole one
    const half = MathUtils.degToRad(CAMERA_FIELD_OF_VIEW) / 2
    const widened = Math.atan(Math.tan(half) * CAMERA_REFERENCE_ASPECT / aspect)

    return Math.min(MathUtils.radToDeg(widened) * 2, CAMERA_MAX_FIELD_OF_VIEW)
  }

  /**
   * Configures the orbit camera.
   * @param canvas - The element the controls listen on
   * @returns The configured controls, already at their opening framing
   */
  private buildControls(canvas: HTMLCanvasElement): OrbitControls {
    const controls = new OrbitControls(this.camera, canvas)

    // The left button belongs to the throw gesture, which binds its own
    // listeners to this same canvas.
    controls.mouseButtons = {
      LEFT: null,
      MIDDLE: null,
      RIGHT: MOUSE.ROTATE,
    }

    // The same division on touch, where there is no second button to orbit
    // with: one finger throws and two orbit. Throwing is the primary gesture,
    // so it gets the primary one, at the price of a two-finger orbit that
    // nothing on screen advertises.
    controls.touches = {
      ONE: null,
      TWO: TOUCH.DOLLY_ROTATE,
    }

    // Panning would let the bowl leave the frame with no way back, and would
    // mean nothing downstream could assume what is on screen.
    controls.enablePan = false

    controls.enableDamping = true
    controls.dampingFactor = CAMERA_DAMPING_FACTOR
    controls.minDistance = CAMERA_MIN_DISTANCE
    controls.maxDistance = CAMERA_MAX_DISTANCE
    controls.minPolarAngle = CAMERA_MIN_POLAR_ANGLE
    controls.maxPolarAngle = CAMERA_MAX_POLAR_ANGLE
    controls.target.set(0, CAMERA_TARGET_HEIGHT, 0)

    // Place the camera by the same spherical coordinates the controls use, so
    // the opening framing and everything the player does afterwards are
    // described in one vocabulary.
    this.camera.position.setFromSphericalCoords(
      CAMERA_START_DISTANCE,
      CAMERA_START_POLAR_ANGLE,
      CAMERA_START_AZIMUTH_ANGLE,
    ).add(controls.target)

    controls.update()

    return controls
  }

  /**
   * Renders a soft interior lighting environment into a cube map, which lights
   * the scene ambiently and gives the lacquer something to reflect.
   *
   * Generated in code rather than loaded from an HDRI file, so the scene keeps
   * its promise of shipping no binary assets.
   * @param renderer - The renderer the target is created against
   * @returns The prefiltered environment map
   */
  private static buildEnvironment(renderer: WebGLRenderer): WebGLRenderTarget {
    const generator = new PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const environment = generator.fromScene(room, ENVIRONMENT_BLUR)

    room.dispose()
    generator.dispose()

    return environment
  }

  /**
   * Builds the single shadow-casting light. The environment map supplies the
   * fill, so one key is enough and a second would only muddy the contact
   * shadow under the foot.
   * @returns The configured light
   */
  private static buildKeyLight(): DirectionalLight {
    const light = new DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY)
    light.position.set(KEY_LIGHT_POSITION.x, KEY_LIGHT_POSITION.y, KEY_LIGHT_POSITION.z)
    light.castShadow = true

    // A directional light's shadow frustum is orthographic and covers the
    // whole scene by default. Cropping it to just the bowl and the felt around
    // it spends the entire shadow map where the shadow actually falls.
    light.shadow.mapSize.setScalar(KEY_LIGHT_SHADOW_MAP_SIZE)
    light.shadow.camera.left = -KEY_LIGHT_SHADOW_EXTENT
    light.shadow.camera.right = KEY_LIGHT_SHADOW_EXTENT
    light.shadow.camera.top = KEY_LIGHT_SHADOW_EXTENT
    light.shadow.camera.bottom = -KEY_LIGHT_SHADOW_EXTENT
    light.shadow.camera.near = KEY_LIGHT_SHADOW_NEAR
    light.shadow.camera.far = KEY_LIGHT_SHADOW_FAR

    // Offsetting along the surface normal rather than along the light beats
    // shadow acne on curved surfaces without detaching the contact shadow.
    light.shadow.normalBias = KEY_LIGHT_SHADOW_NORMAL_BIAS

    return light
  }
}
