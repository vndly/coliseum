import {Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  SphereGeometry} from 'three'
import type {Object3D, Vector3} from 'three'
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js'
import {AIM_DIE_OPACITY,
  AIM_DIE_TILT,
  AIM_DOT_COLOR,
  AIM_DOT_COUNT,
  AIM_DOT_END_SCALE,
  AIM_DOT_OPACITY,
  AIM_DOT_RADIUS,
  AIM_DOT_SEGMENTS,
  DIE_COLOR,
  DIE_CORNER_RADIUS,
  DIE_CORNER_SEGMENTS,
  DIE_ROUGHNESS,
  DIE_SIZE} from '@/scene/dimensions'

/**
 * The dotted line drawn from the launch point to the spot the die will land
 * on while a throw is being aimed, and the die standing at the launch end of
 * it.
 *
 * The same number of dots is spread over the whole line however long it is, so
 * the gaps between them are the strength of the throw: a hard throw is a long
 * line and stretches them out, a gentle one bunches them together. They taper
 * toward the landing end, which is the only thing distinguishing one end of
 * the line from the other.
 *
 * The die is what makes that end mean something. The gesture is drawn
 * backwards — the press lands where the die is to arrive and the drag pulls
 * back to where it is thrown from — so the end under the pointer is the end
 * the throw begins at, and a die held there says so without anything having to
 * be explained.
 *
 * It is deliberately not one of the dice. It carries no pips, because the only
 * value it could show is one the throw has not rolled yet, and it casts no
 * shadow, because a shadow would set it down on a table it has not been thrown
 * onto. What it takes from a real die is its size, its shape and its bone,
 * which is all it has to promise.
 *
 * The line is one instanced mesh, sized once for the longest it will ever
 * draw, so it costs a single draw call however far the throw reaches.
 */
export class AimPreview {
  private readonly group: Group // The line and the die it leaves from, under one node
  private readonly dots: InstancedMesh
  private readonly die: Mesh // The one standing at the launch end
  private readonly dotGeometry: SphereGeometry
  private readonly dotMaterial: MeshBasicMaterial
  private readonly dieGeometry: RoundedBoxGeometry
  private readonly dieMaterial: MeshPhysicalMaterial
  private readonly transform = new Matrix4() // Scratch, written once per dot

  constructor() {
    this.dotGeometry = new SphereGeometry(AIM_DOT_RADIUS, AIM_DOT_SEGMENTS, AIM_DOT_SEGMENTS / 2)

    // Unlit, so the line stays legible over the dark wood and the dark felt
    // alike. It is an instrument, not part of the scene, and it should not
    // pick up the key light as though it were.
    this.dotMaterial = new MeshBasicMaterial({
      color: AIM_DOT_COLOR,
      transparent: true,
      opacity: AIM_DOT_OPACITY,

      // Depth testing stays on, so the bowl properly hides the part of the
      // line that has gone behind its near wall. Depth writing comes off, so
      // that where two dots overlap on screen neither punches a hole in the
      // other's translucency.
      depthWrite: false,
    })

    this.dots = new InstancedMesh(this.dotGeometry, this.dotMaterial, AIM_DOT_COUNT)
    this.dots.count = 0

    // The instances are rewritten on every pointer move and the bounding
    // sphere is not, so leaving culling on would flicker the whole line away
    // whenever its stale bounds left the frustum.
    this.dots.frustumCulled = false

    // Built here rather than shared with the bowl's dice. It is the same shape
    // at the same size, and it is not one of them: a die that has not been
    // thrown has no pips to draw and nothing in the world to hold.
    this.dieGeometry = new RoundedBoxGeometry(
      DIE_SIZE,
      DIE_SIZE,
      DIE_SIZE,
      DIE_CORNER_SEGMENTS,
      DIE_CORNER_RADIUS,
    )

    // Lit, unlike the dots, because a flat shape is a silhouette and a
    // silhouette of a cube is a hexagon: the shading is the only thing that
    // makes three faces out of it. What it does not take is the die's
    // clearcoat — that coat is a highlight, and a highlight is the one thing
    // that would read as a die already sitting there.
    //
    // Depth writing comes off for the reason it does on the dots. The line
    // starts inside this die, and a translucent surface that wrote depth would
    // take the first dots of its own line away.
    this.dieMaterial = new MeshPhysicalMaterial({
      color: DIE_COLOR,
      roughness: DIE_ROUGHNESS,
      metalness: 0,
      transparent: true,
      opacity: AIM_DIE_OPACITY,
      depthWrite: false,
    })

    this.die = new Mesh(this.dieGeometry, this.dieMaterial)
    this.die.rotation.set(AIM_DIE_TILT.x, AIM_DIE_TILT.y, AIM_DIE_TILT.z)

    this.group = new Group()
    this.group.add(this.dots, this.die)
    this.group.visible = false
  }

  get object(): Object3D {
    return this.group
  }

  /**
   * Draws the line through the given points, from the launch point to wherever
   * the throw first meets something, and stands the die on the launch end.
   * @param points - The sampled trajectory, in order from the launch point, at most AIM_DOT_COUNT long
   */
  show(points: Vector3[]): void {
    const launch = points[0]

    // No first point is no launch to leave from, and no line to draw either
    if (launch === undefined) {
      this.hide()

      return
    }

    const count = Math.min(points.length, AIM_DOT_COUNT)

    for (const [
      index,
      point,
    ] of points.entries()) {
      if (index === count) {
        break
      }

      // A single dot has no far end to taper toward
      const progress = count > 1 ? index / (count - 1) : 0
      const scale = 1 - (1 - AIM_DOT_END_SCALE) * progress

      this.transform.makeScale(scale, scale, scale).setPosition(point)
      this.dots.setMatrixAt(index, this.transform)
    }

    this.dots.count = count
    this.dots.instanceMatrix.needsUpdate = true
    this.die.position.copy(launch)
    this.group.visible = true
  }

  hide(): void {
    this.group.visible = false
  }

  dispose(): void {
    this.dots.dispose()
    this.dotGeometry.dispose()
    this.dotMaterial.dispose()
    this.dieGeometry.dispose()
    this.dieMaterial.dispose()
  }
}
