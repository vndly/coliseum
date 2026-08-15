import {Mesh, MeshPhysicalMaterial, PlaneGeometry} from 'three'
import type {Object3D} from 'three'
import {TABLE_COLOR,
  TABLE_SHEEN,
  TABLE_SHEEN_COLOR,
  TABLE_SHEEN_ROUGHNESS,
  TABLE_SIZE} from '@/scene/dimensions'

/**
 * The baize surface the bowl stands on, and the only thing that catches its
 * shadow.
 *
 * Sheen is what separates cloth from flat green paint: it adds the soft
 * highlight fabric picks up at grazing angles, which a smooth dielectric does
 * not have. It is the cheapest way to make an untextured plane read as felt.
 *
 * The plane runs far past anything the camera can reach, so its edge is lost
 * in the fog rather than sitting on screen as a horizon line.
 */
export class Table {
  private readonly surface: Mesh // Single plane, laid flat at height zero
  private readonly geometry: PlaneGeometry
  private readonly material: MeshPhysicalMaterial

  constructor() {
    this.geometry = new PlaneGeometry(TABLE_SIZE, TABLE_SIZE)

    this.material = new MeshPhysicalMaterial({
      color: TABLE_COLOR,
      roughness: 1,
      metalness: 0,
      sheen: TABLE_SHEEN,
      sheenColor: TABLE_SHEEN_COLOR,
      sheenRoughness: TABLE_SHEEN_ROUGHNESS,
    })

    this.surface = new Mesh(this.geometry, this.material)
    this.surface.rotation.x = -Math.PI / 2 // Planes are born upright
    this.surface.receiveShadow = true
  }

  get object(): Object3D {
    return this.surface
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
