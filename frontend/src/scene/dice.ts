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
import type {DieMeshes} from '@/scene/die'
import {BONE_SKIN, DIE_SKINS} from '@/scene/die_skins'
import {DIE_FACE_NORMALS} from '@/scene/die_state'
import type {DieSnapshot, ThrowLaunch} from '@/scene/die_state'
import type {PhysicsWorld} from '@/scene/physics_world'
import {DIE_CLEARCOAT,
  DIE_CLEARCOAT_ROUGHNESS,
  DIE_COLOR,
  DIE_CORNER_RADIUS,
  DIE_CORNER_SEGMENTS,
  DIE_LIMIT,
  DIE_MATCHED_COLOR,
  DIE_PIP_COLOR,
  DIE_PIP_INSET,
  DIE_PIP_RADIUS,
  DIE_PIP_SEGMENTS,
  DIE_PIP_SPACING,
  DIE_REMOVED_COLOR,
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
 * One geometry is built here and shared by every die, and one pair of
 * materials per colour a die can be painted in — so a bowl full of them costs
 * a draw call each and no memory at all, however many colours are on the
 * table.
 */
export class Dice {
  private readonly group: Group // All the dice, under one node
  private readonly bodyGeometry: RoundedBoxGeometry
  private readonly pipGeometry: BufferGeometry // All twenty-one pips, merged into one
  private readonly bodyMaterials: MeshPhysicalMaterial[] // One per skin, in palette order
  private readonly pipMaterials: MeshPhysicalMaterial[] // The same, for the pips
  private readonly boneBody: MeshPhysicalMaterial // Skin zero again, as what an unknown skin falls to
  private readonly bonePip: MeshPhysicalMaterial
  private readonly removedMaterial: MeshPhysicalMaterial // The wash a six leaves in
  private readonly matchedMaterial: MeshPhysicalMaterial // The wash a group comes back in
  private readonly washPipMaterial: MeshPhysicalMaterial // The pips under either wash
  private readonly dice: Die[] = []
  private readonly restoredPosition = new Vector3() // Scratch, to keep reconciling allocation free
  private readonly restoredRotation = new Quaternion()
  private readonly wanted = new Map<string, DieSnapshot>() // Scratch, for the same reason

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
    // the wood it lands in rather than as another turned surface. One pair per
    // colour, built once here: a table of six players wears at most six of
    // them, and building them all costs less than deciding which are needed.
    this.bodyMaterials = DIE_SKINS.map((skin) => this.buildBody(skin.body))

    this.pipMaterials = DIE_SKINS.map((skin) => new MeshPhysicalMaterial({
      color: skin.pip,
      roughness: DIE_ROUGHNESS,
      metalness: 0,
    }))

    // Named as well as indexed, so that a skin this browser has never heard of
    // has somewhere to fall without either asserting an index away or building
    // a material in the middle of a frame. Both fallbacks below are
    // unreachable — the arrays are the palette, mapped — and guarded rather
    // than asserted, as every other index in this project is.
    this.boneBody = this.bodyMaterials[BONE_SKIN] ?? this.buildBody(DIE_COLOR)

    this.bonePip = this.pipMaterials[BONE_SKIN] ?? new MeshPhysicalMaterial({
      color: DIE_PIP_COLOR,
      roughness: DIE_ROUGHNESS,
      metalness: 0,
    })

    // Shared like the rest rather than cloned per die. However many dice a
    // verdict washes, there are only ever these two colours on the table.
    this.removedMaterial = this.buildBody(DIE_REMOVED_COLOR)
    this.matchedMaterial = this.buildBody(DIE_MATCHED_COLOR)

    // Dark, and the same under both washes. A wash replaces the body outright,
    // so a claret die washed to ember would otherwise keep the light pips that
    // were chosen to read against claret — and the one thing a wash must not
    // cost is the ability to count the face it is washing.
    this.washPipMaterial = new MeshPhysicalMaterial({
      color: DIE_PIP_COLOR,
      roughness: DIE_ROUGHNESS,
      metalness: 0,
    })
  }

  get object(): Object3D {
    return this.group
  }

  /** How many dice are in the bowl, which is what DIE_LIMIT is measured against. */
  get count(): number {
    return this.dice.length
  }

  /**
   * Whether the bowl has come to rest, and a throw can be declared over.
   *
   * A die on its way out counts as still moving even once its body is asleep.
   * Its removal changes the world for anything resting against it, so a
   * snapshot taken mid-exit describes a bowl that is about to rearrange itself
   * — and it would be sent to the other player as though it were final.
   */
  get isSettled(): boolean {
    for (const die of this.dice) {
      if (die.isOutOfPlay || !die.isAsleep) {
        return false
      }
    }

    return true
  }

  /**
   * Every die in the bowl, ready to be written to the match as the result of a
   * throw. Dice on their way out are left out: they have left the match, and
   * their absence from the bowl is how the other player is told so.
   */
  get snapshot(): DieSnapshot[] {
    const bowl: DieSnapshot[] = []

    for (const die of this.dice) {
      if (!die.isOutOfPlay) {
        bowl.push(die.snapshot)
      }
    }

    return bowl
  }

  /**
   * Forces every die in the bowl to a rest none of them reached on their own.
   *
   * Only ever asked of a throw the engine never finished: what is read from
   * the bowl straight afterwards is published as the match's own account of it,
   * and a die still turning at that instant would be recorded at a value
   * nobody at the table ever saw it showing.
   */
  forceRest(): void {
    for (const die of this.dice) {
      die.settle()
    }
  }

  /**
   * Puts a new die into the world, already moving.
   *
   * A name already in the bowl is refused rather than built beside the die
   * wearing it. Identifiers are what a verdict names dice by, so a bowl
   * holding one twice pairs it with itself and pays a hand twice for one
   * physical die — and this player publishes that bowl as the match's own.
   * Refused here rather than only where the duplicates come from, because the
   * bowl is the one place every route into it has to pass.
   * @param physics - The world it is thrown into; nothing happens until it is ready
   * @param identifier - The name both players know this die by
   * @param skin - The colour it is painted in, which came with the throw
   * @param launch - The throw, exactly as the thrower described it
   */
  throw(physics: PhysicsWorld, identifier: string, skin: number, launch: ThrowLaunch): void {
    const world = physics.world

    if (world === null || this.dice.length >= DIE_LIMIT || this.holds(identifier)) {
      return
    }

    const die = Die.thrown(world, this.buildMeshes(skin), identifier, skin, launch)

    this.group.add(die.object)
    this.dice.push(die)
  }

  /**
   * Washes the dice that are leaving the match in the colour that says so.
   * @param identifiers - The dice showing a six
   */
  markRemoved(identifiers: string[]): void {
    this.paint(identifiers, this.removedMaterial)
  }

  /**
   * Washes the dice that are going back to a hand in the colour that says so.
   * @param identifiers - The dice that made a group
   */
  markReturned(identifiers: string[]): void {
    this.paint(identifiers, this.matchedMaterial)
  }

  /**
   * Sends the named dice out of the bowl.
   *
   * They leave the way a spilled die leaves — shrinking away and then being
   * culled — rather than being deleted where they stand, so a die taken by the
   * verdict and a die that missed the bowl are seen to go the same way. It also
   * holds the bowl as unsettled until the last of them has gone, which is what
   * keeps the match's own bowl from being applied over the top of the exit.
   * @param identifiers - The dice the verdict has taken
   */
  dismiss(identifiers: string[]): void {
    for (const die of this.dice) {
      if (identifiers.includes(die.id)) {
        die.markOutOfPlay()
      }
    }
  }

  /**
   * Takes the named dice straight back out of the world.
   *
   * Nothing is played out and nothing is animated: these are dice that turned
   * out never to have been thrown, rather than dice a verdict has taken, so
   * what is wanted is the bowl as it stood before them.
   * @param physics - The world their bodies live in
   * @param identifiers - The dice to withdraw
   */
  withdraw(physics: PhysicsWorld, identifiers: string[]): void {
    const world = physics.world

    if (world === null) {
      return
    }

    // Walked backwards, so that splicing a die out cannot move one that has
    // not been looked at yet past the cursor
    for (let index = this.dice.length - 1; index >= 0; index--) {
      const die = this.dice[index]

      if (die === undefined || !identifiers.includes(die.id)) {
        continue
      }

      this.group.remove(die.object)
      die.remove(world)
      this.dice.splice(index, 1)
    }
  }

  /**
   * Makes this player's bowl match the one the match holds.
   *
   * Applied as a whole state rather than as a difference: dice named in both
   * are moved, dice only the match knows about are built, and dice only this
   * player still has are taken away. That is what makes a throw the point at
   * which two players' bowls converge again, however far the two simulations
   * drifted while the dice were in the air — and it is the same path that
   * rebuilds the bowl after a reload, because a reloaded player is simply one
   * whose bowl is empty.
   * @param physics - The world the bodies live in; nothing happens until it is ready
   * @param bowl - Every die the match says is in the bowl
   */
  restore(physics: PhysicsWorld, bowl: DieSnapshot[]): void {
    const world = physics.world

    if (world === null) {
      return
    }

    // Whatever a verdict painted is painted back. A bowl arriving from the
    // match is the point every player's table converges again, appearance
    // included: a die still washed here is one this player is part way through
    // a verdict the match has already moved on from.
    this.clearWashes()

    this.wanted.clear()

    for (const snapshot of bowl) {
      this.wanted.set(snapshot.id, snapshot)
    }

    // Walked backwards, so that splicing a die out cannot move one that has
    // not been looked at yet past the cursor
    for (let index = this.dice.length - 1; index >= 0; index--) {
      const die = this.dice[index]

      if (die === undefined) {
        continue
      }

      const snapshot = this.wanted.get(die.id)

      if (snapshot === undefined) {
        this.group.remove(die.object)
        die.remove(world)
        this.dice.splice(index, 1)

        continue
      }

      this.restoredPosition.set(...snapshot.position)
      this.restoredRotation.set(...snapshot.rotation)
      die.teleport(this.restoredPosition, this.restoredRotation)

      // Taken off the list, so whatever is left is what has to be built
      this.wanted.delete(die.id)
    }

    for (const snapshot of this.wanted.values()) {
      const die = Die.resting(world, this.buildMeshes(snapshot.skin), snapshot)

      this.group.add(die.object)
      this.dice.push(die)
    }

    this.wanted.clear()
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

    // Through a set, because the bone pair is normally the first entry of each
    // array beside it rather than a material of its own
    const materials = new Set([
      ...this.bodyMaterials,
      ...this.pipMaterials,
      this.boneBody,
      this.bonePip,
    ])

    for (const material of materials) {
      material.dispose()
    }

    this.removedMaterial.dispose()
    this.matchedMaterial.dispose()
    this.washPipMaterial.dispose()
  }

  /**
   * Whether a die of this name is already in the bowl.
   * @param identifier - The name to look for
   * @returns Whether the bowl is already using it
   */
  private holds(identifier: string): boolean {
    return this.dice.some((die) => die.id === identifier)
  }

  /**
   * Puts a wash on the named dice and leaves every other die alone.
   * @param identifiers - The dice to paint
   * @param material - What to paint them with
   */
  private paint(identifiers: string[], material: MeshPhysicalMaterial): void {
    for (const die of this.dice) {
      if (identifiers.includes(die.id)) {
        die.applyMaterials(material, this.washPipMaterial)
      }
    }
  }

  /** Puts every die back in the colour it was thrown in. */
  private clearWashes(): void {
    for (const die of this.dice) {
      die.applyMaterials(this.bodyOf(die.skin), this.pipOf(die.skin))
    }
  }

  /**
   * One skin's body material.
   *
   * Falls back to bone rather than indexing blind: a skin arriving from
   * another player's document is only as trustworthy as that document, and a
   * die with no material at all is a die that is not drawn.
   * @param skin - Which of DIE_SKINS
   * @returns The material that skin's dice are drawn with
   */
  private bodyOf(skin: number): MeshPhysicalMaterial {
    return this.bodyMaterials[skin] ?? this.boneBody
  }

  /**
   * One skin's pip material, which reads light or dark according to its body.
   * @param skin - Which of DIE_SKINS
   * @returns The material that skin's pips are drawn with
   */
  private pipOf(skin: number): MeshPhysicalMaterial {
    return this.pipMaterials[skin] ?? this.bonePip
  }

  /**
   * Builds a die's body material: polished resin in whatever colour is asked
   * for, so a washed die is lit exactly as it was before.
   * @param color - The colour to build in
   * @returns The material, shared by every die drawn in it
   */
  private buildBody(color: number): MeshPhysicalMaterial {
    return new MeshPhysicalMaterial({
      color: color,
      roughness: DIE_ROUGHNESS,
      metalness: 0,
      clearcoat: DIE_CLEARCOAT,
      clearcoatRoughness: DIE_CLEARCOAT_ROUGHNESS,
    })
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
   *
   * Both halves are handed back beside the group holding them. They are what a
   * verdict's wash goes on and what it comes back off, and a die that had to
   * find them among its own children would be a die that knows how it was
   * assembled.
   * @param skin - The colour to build it in
   * @returns The die's visual half, and the two meshes within it
   */
  private buildMeshes(skin: number): DieMeshes {
    const group = new Group()
    const shell = new Mesh(this.bodyGeometry, this.bodyOf(skin))
    const pips = new Mesh(this.pipGeometry, this.pipOf(skin))

    shell.castShadow = true
    shell.receiveShadow = true
    pips.castShadow = true

    group.add(shell, pips)

    return {
      group: group,
      shell: shell,
      pips: pips,
    }
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
    const forward = new Vector3(0, 0, 1) // The face the patterns are laid out on
    const pips: SphereGeometry[] = []

    // The same normals the value of a resting die is read off. Laying the pips
    // out along one list and reading the face off another is the one way this
    // die could come to show a number it does not have.
    for (const [
      index,
      normal,
    ] of DIE_FACE_NORMALS.entries()) {
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
