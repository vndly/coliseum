import {Group,
  Mesh,
  MeshPhysicalMaterial,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3} from 'three'
import type {BufferGeometry, Object3D} from 'three'
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {Die} from '@/scene/die'
import type {PhysicsWorld} from '@/scene/physics_world'
import {DIE_CLEARCOAT,
  DIE_CLEARCOAT_ROUGHNESS,
  DIE_COLOR,
  DIE_CORNER_RADIUS,
  DIE_CORNER_SEGMENTS,
  DIE_LIMIT,
  DIE_PIP_COLOR,
  DIE_PIP_INSET,
  DIE_PIP_RADIUS,
  DIE_PIP_SEGMENTS,
  DIE_PIP_SPACING,
  DIE_ROUGHNESS,
  DIE_SIZE} from '@/scene/dimensions'

/**
 * Every die in play, and the shape they are all drawn with.
 *
 * Dice accumulate: a throw adds one, and nothing removes it until it reaches
 * the felt and settles there. Nothing bounds the pile either, because the bowl
 * does that on its own — fill it and the next throw spills, and the felt culls
 * the spill. The hard limit is a guard against a spammed pointer, not a rule
 * of the game.
 *
 * One geometry and one pair of materials are built here and shared by every
 * die, so a bowl full of them costs a draw call each and no memory at all.
 */
export class Dice {
  private readonly group: Group // All the dice, under one node
  private readonly bodyGeometry: RoundedBoxGeometry
  private readonly pipGeometry: BufferGeometry // All twenty-one pips, merged into one
  private readonly bodyMaterial: MeshPhysicalMaterial
  private readonly pipMaterial: MeshPhysicalMaterial
  private readonly dice: Die[] = []

  constructor() {
    this.group = new Group()
    this.bodyGeometry = new RoundedBoxGeometry(
      DIE_SIZE,
      DIE_SIZE,
      DIE_SIZE,
      DIE_CORNER_SEGMENTS,
      DIE_CORNER_RADIUS,
    )
    this.pipGeometry = Dice.buildPipGeometry()

    // Polished resin against the bowl's lacquer: the same clearcoat trick, but
    // a softer coat, so the die reads as a lighter and cheaper material than
    // the wood it lands in rather than as another turned surface.
    this.bodyMaterial = new MeshPhysicalMaterial({
      color: DIE_COLOR,
      roughness: DIE_ROUGHNESS,
      metalness: 0,
      clearcoat: DIE_CLEARCOAT,
      clearcoatRoughness: DIE_CLEARCOAT_ROUGHNESS,
    })

    this.pipMaterial = new MeshPhysicalMaterial({
      color: DIE_PIP_COLOR,
      roughness: DIE_ROUGHNESS,
      metalness: 0,
    })
  }

  get object(): Object3D {
    return this.group
  }

  /**
   * Puts a new die into the world, already moving.
   * @param physics - The world it is thrown into; nothing happens until it is ready
   * @param origin - Where the die comes into existence
   * @param velocity - How fast, and in which direction, it leaves
   */
  throw(physics: PhysicsWorld, origin: Vector3, velocity: Vector3): void {
    const world = physics.world

    if (world === null || this.dice.length >= DIE_LIMIT) {
      return
    }

    const die = new Die(world, this.buildMeshes(), origin, velocity)

    this.group.add(die.object)
    this.dice.push(die)
  }

  /**
   * Marks whatever has just reached the felt, drags every mesh onto its body,
   * and removes the dice that have finished leaving. Called once per rendered
   * frame, after the world has stepped.
   * @param physics - The world the dice are simulated in
   * @param deltaTime - Seconds elapsed since the previous frame
   */
  update(physics: PhysicsWorld, deltaTime: number): void {
    this.markLandings(physics)

    for (const die of this.dice) {
      die.synchronize()
      die.advanceExit(deltaTime)
    }

    this.cull(physics)
  }

  /**
   * Releases the shared geometry and materials. The bodies are not removed
   * one by one: the world is freed whole, and takes them with it.
   */
  dispose(): void {
    this.bodyGeometry.dispose()
    this.pipGeometry.dispose()
    this.bodyMaterial.dispose()
    this.pipMaterial.dispose()
  }

  /**
   * Takes every die that has just landed on the felt out of play. A die in
   * play only ever touches the bowl, so reaching the table is the whole of the
   * out-of-play test — it covers a throw that fell short, one that sailed
   * over, and one that bounced back out over the rim, without any of them
   * being special cases.
   * @param physics - The world to ask which colliders landed this frame
   */
  private markLandings(physics: PhysicsWorld): void {
    physics.forEachColliderLandedOnFelt((collider) => {
      for (const die of this.dice) {
        if (die.colliderHandle === collider) {
          die.markOutOfPlay()

          break
        }
      }
    })
  }

  /**
   * Removes the dice that have finished shrinking away.
   * @param physics - The world their bodies were created in
   */
  private cull(physics: PhysicsWorld): void {
    const world = physics.world

    if (world === null) {
      return
    }

    // Walked backwards, so that splicing a die out cannot move one that has
    // not been looked at yet past the cursor
    for (let index = this.dice.length - 1; index >= 0; index--) {
      const die = this.dice[index]

      if (die === undefined || !die.isSpent) {
        continue
      }

      this.group.remove(die.object)
      die.remove(world)
      this.dice.splice(index, 1)
    }
  }

  /**
   * Builds the meshes for one die, over the shared geometry and materials.
   * @returns The die's visual half, ready to be positioned from its body
   */
  private buildMeshes(): Object3D {
    const meshes = new Group()
    const body = new Mesh(this.bodyGeometry, this.bodyMaterial)
    const pips = new Mesh(this.pipGeometry, this.pipMaterial)

    body.castShadow = true
    body.receiveShadow = true
    pips.castShadow = true

    meshes.add(body, pips)

    return meshes
  }

  /**
   * Builds all twenty-one pips as a single geometry.
   *
   * A pip is a small sphere sunk into its face until only the cap shows.
   * There are no texture maps in this project to paint one on with, and no
   * CSG to drill one out with, and a sunken sphere is what both of those
   * would have been imitating anyway.
   * @returns The merged pip geometry, in the die's own frame
   */
  private static buildPipGeometry(): BufferGeometry {
    // One face normal per value, in value order. Opposite faces sum to seven
    // on a real die, which is what pairs one with six down the z axis, two
    // with five down x, and three with four down y.
    const normals = [
      new Vector3(0, 0, 1),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
      new Vector3(-1, 0, 0),
      new Vector3(0, 0, -1),
    ]

    const forward = new Vector3(0, 0, 1) // The face the patterns are laid out on
    const pips: SphereGeometry[] = []

    for (const [
      index,
      normal,
    ] of normals.entries()) {
      const orientation = new Quaternion().setFromUnitVectors(forward, normal)

      for (const offset of Dice.pipPattern(index + 1)) {
        const position = new Vector3(
          offset.x * DIE_PIP_SPACING,
          offset.y * DIE_PIP_SPACING,
          DIE_SIZE / 2 - DIE_PIP_INSET,
        ).applyQuaternion(orientation)

        pips.push(new SphereGeometry(DIE_PIP_RADIUS, DIE_PIP_SEGMENTS, DIE_PIP_SEGMENTS / 2)
          .translate(position.x, position.y, position.z))
      }
    }

    const merged = mergeGeometries(pips)

    for (const pip of pips) {
      pip.dispose()
    }

    return merged
  }

  /**
   * Where the pips sit on one face, in units of the corner spacing.
   *
   * The six patterns are not six separate layouts: an odd face carries a
   * centre pip, and the rest are opposing pairs added two at a time.
   * @param value - The face's value, one to six
   * @returns Offsets across the face
   */
  private static pipPattern(value: number): Vector2[] {
    const offsets: Vector2[] = []

    if (value % 2 === 1) {
      offsets.push(new Vector2(0, 0))
    }

    if (value >= 2) {
      offsets.push(new Vector2(-1, -1), new Vector2(1, 1))
    }

    if (value >= 4) {
      offsets.push(new Vector2(-1, 1), new Vector2(1, -1))
    }

    if (value >= 6) {
      offsets.push(new Vector2(-1, 0), new Vector2(1, 0))
    }

    return offsets
  }
}
