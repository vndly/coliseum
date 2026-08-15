import {InstancedMesh, Matrix4, MeshBasicMaterial, SphereGeometry} from 'three'
import type {Object3D, Vector3} from 'three'
import {AIM_DOT_COLOR,
  AIM_DOT_COUNT,
  AIM_DOT_END_SCALE,
  AIM_DOT_OPACITY,
  AIM_DOT_RADIUS,
  AIM_DOT_SEGMENTS} from '@/scene/dimensions'

/**
 * The dotted arc drawn under the pointer while a throw is being aimed.
 *
 * The dots are spaced by time rather than by distance, so the gaps between
 * them are the strength of the throw: a hard throw stretches them out, a
 * gentle one bunches them together. They taper toward the far end, which is
 * the only thing distinguishing the start of the arc from its finish.
 *
 * One instanced mesh, sized once for the largest arc it will ever draw, so
 * aiming allocates nothing and costs one draw call.
 */
export class AimPreview {
  private readonly dots: InstancedMesh
  private readonly geometry: SphereGeometry
  private readonly material: MeshBasicMaterial
  private readonly transform = new Matrix4() // Scratch, written once per dot

  constructor() {
    this.geometry = new SphereGeometry(AIM_DOT_RADIUS, AIM_DOT_SEGMENTS, AIM_DOT_SEGMENTS / 2)

    // Unlit, so the arc stays legible over the dark wood and the dark felt
    // alike. It is an instrument, not part of the scene, and it should not
    // pick up the key light as though it were.
    this.material = new MeshBasicMaterial({
      color: AIM_DOT_COLOR,
      transparent: true,
      opacity: AIM_DOT_OPACITY,

      // Depth testing stays on, so the bowl properly hides the part of the arc
      // that has gone behind its near wall. Depth writing comes off, so the
      // dots do not occlude each other where the arc overlaps itself.
      depthWrite: false,
    })

    this.dots = new InstancedMesh(this.geometry, this.material, AIM_DOT_COUNT)
    this.dots.count = 0
    this.dots.visible = false

    // The instances are rewritten on every pointer move and the bounding
    // sphere is not, so leaving culling on would flicker the whole arc away
    // whenever its stale bounds left the frustum.
    this.dots.frustumCulled = false
  }

  get object(): Object3D {
    return this.dots
  }

  /**
   * Draws the arc through the given points, from the launch point to wherever
   * the throw first meets something.
   * @param points - The sampled trajectory, in order, at most AIM_DOT_COUNT long
   */
  show(points: Vector3[]): void {
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
    this.dots.visible = count > 0
  }

  hide(): void {
    this.dots.visible = false
  }

  dispose(): void {
    this.dots.dispose()
    this.geometry.dispose()
    this.material.dispose()
  }
}
