import {ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  MOUSE,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer} from 'three'
import type {WebGLRenderTarget} from 'three'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js'
import {Dish} from '@/scene/dish'
import {Table} from '@/scene/table'
import {BACKGROUND_COLOR,
  CAMERA_DAMPING_FACTOR,
  CAMERA_FAR,
  CAMERA_FIELD_OF_VIEW,
  CAMERA_MAX_DISTANCE,
  CAMERA_MAX_POLAR_ANGLE,
  CAMERA_MIN_DISTANCE,
  CAMERA_MIN_POLAR_ANGLE,
  CAMERA_NEAR,
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
  KEY_LIGHT_SHADOW_NORMAL_BIAS} from '@/scene/dimensions'

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
  private readonly keyLight: DirectionalLight // Held only so its shadow map can be released
  private readonly environment: WebGLRenderTarget // Image-based light, generated not loaded
  private readonly resizeObserver: ResizeObserver

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
    this.scene.add(this.dish.object, this.table.object)

    this.environment = DishScene.buildEnvironment(this.renderer)
    this.scene.environment = this.environment.texture
    this.scene.environmentIntensity = ENVIRONMENT_INTENSITY

    this.keyLight = DishScene.buildKeyLight()
    this.scene.add(this.keyLight)

    this.controls = this.buildControls(canvas)

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
   * Stops the loop and releases every GPU resource this scene created.
   */
  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.dish.dispose()
    this.table.dispose()

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
    this.renderer.render(this.scene, this.camera)
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
    this.camera.updateProjectionMatrix()
  }

  /**
   * Configures the orbit camera.
   * @param canvas - The element the controls listen on
   * @returns The configured controls, already at their opening framing
   */
  private buildControls(canvas: HTMLCanvasElement): OrbitControls {
    const controls = new OrbitControls(this.camera, canvas)

    // The left button is deliberately left unbound. A drag-to-throw gesture is
    // the obvious next thing this scene needs, and it should not have to take
    // the button back off the camera later.
    controls.mouseButtons = {
      LEFT: null,
      MIDDLE: null,
      RIGHT: MOUSE.ROTATE,
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
