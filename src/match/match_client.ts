import {collection,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch} from 'firebase/firestore'
import type {DocumentReference, Unsubscribe} from 'firebase/firestore'
import {createMatchCode} from '@/match/codes'
import {currentPlayerId, firestore} from '@/match/firebase'
import {parseMatchState, parseThrowRecord} from '@/match/match_state'
import type {MatchState, ThrowRecord} from '@/match/match_state'
import {createOpeningDie} from '@/scene/die_state'
import type {DieSnapshot, ThrowLaunch} from '@/scene/die_state'

const MATCHES = 'matches'
const THROWS = 'throws'
const CODE_ATTEMPTS = 8 // Before giving up on finding a code nobody is using

/**
 * One player's connection to one match.
 *
 * The match document holds the whole live state — who is playing, whose turn it
 * is, and the bowl every player's dice are set from. The throws beneath it are
 * the record of how the bowl got that way, and the only reason they are read
 * live is so that a player who did not throw still watches the die fly rather
 * than watching it appear.
 *
 * Every client here is trusted. There is no server and no rule enforced above
 * this class, so a turn is something the interface declines to offer rather
 * than something the database refuses. That is a deliberate trade for a game
 * played between people who know each other.
 */
export class MatchClient {
  private readonly code: string
  private readonly playerId: string
  private readonly reference: DocumentReference
  private readonly unsubscribers: Unsubscribe[] = []
  private appliedThrow = 0 // The last throw handed to the scene, by sequence number
  private primed = false // Whether the throws already in the match have been skipped past

  private constructor(code: string, playerId: string) {
    this.code = code
    this.playerId = playerId
    this.reference = doc(firestore, MATCHES, code)
  }

  /** The identifier this browser plays under. */
  get uid(): string {
    return this.playerId
  }

  /**
   * Opens a match this player has already joined.
   * @param code - The match's code, which is also its document's name
   * @returns A client, not yet listening
   */
  static async open(code: string): Promise<MatchClient> {
    const playerId = await currentPlayerId()

    return new MatchClient(code, playerId)
  }

  /**
   * Starts a match with this player in the first seat, and therefore first to
   * throw.
   *
   * The code is drawn and then claimed by a write that refuses to overwrite,
   * rather than searched for and then taken — between a search and a write,
   * somebody else can have taken it.
   * @param name - What to call this player
   * @param playerCount - How many seats the match has, including this one
   * @returns The code the match can be joined by
   */
  static async create(name: string, playerCount: number): Promise<string> {
    const playerId = await currentPlayerId()

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = createMatchCode()
      const reference = doc(firestore, MATCHES, code)

      const claimed = await runTransaction(firestore, async (transaction) => {
        const existing = await transaction.get(reference)

        if (existing.exists()) {
          return false
        }

        transaction.set(reference, {
          playerCount: playerCount,
          phase: 'lobby',
          players: [
            {
              uid: playerId,
              name: name,
            },
          ],
          turnIndex: 0,
          hasThrown: false,
          bowl: [],
          throwSeq: 0,
          bowlVersion: 0,
          createdAt: serverTimestamp(),
        })

        return true
      })

      if (claimed) {
        return code
      }
    }

    throw new Error('Could not find a free match code. Try again.')
  }

  /**
   * Reads a match without joining it, so a player can be shown what they are
   * about to walk into before they commit to a seat. A code is four characters
   * and guessable, and a mistyped one that happens to exist is somebody else's
   * game.
   * @param code - The code as it was typed, already normalised
   * @returns The match, or null if there is none
   */
  static async peek(code: string): Promise<MatchState | null> {
    const snapshot = await getDoc(doc(firestore, MATCHES, code))

    return parseMatchState(code, snapshot.data())
  }

  /**
   * Takes a seat, and starts the match if it was the last one.
   *
   * Both happen in a single transaction. Starting the match anywhere else would
   * need somebody to be watching for the moment the seats filled, and the
   * player who fills the last seat is the only one guaranteed to be there.
   * @param code - The match to join
   * @param name - What to call this player
   */
  static async join(code: string, name: string): Promise<void> {
    const playerId = await currentPlayerId()
    const reference = doc(firestore, MATCHES, code)

    await runTransaction(firestore, async (transaction) => {
      const snapshot = await transaction.get(reference)
      const state = parseMatchState(code, snapshot.data())

      if (state === null) {
        throw new Error('No match with that code.')
      }

      // Already seated. A reload, or a retry after a write that did land.
      if (state.players.some((player) => player.uid === playerId)) {
        return
      }

      if (state.phase !== 'lobby') {
        throw new Error('That match has already started.')
      }

      if (state.players.length >= state.playerCount) {
        throw new Error('That match is full.')
      }

      const players = [
        ...state.players,
        {
          uid: playerId,
          name: name,
        },
      ]

      const update: Record<string, unknown> = {
        players: players,
      }

      if (players.length === state.playerCount) {
        update.phase = 'playing'
        update.bowl = [createOpeningDie()]

        // Counted like any other write to the bowl. Without this the players
        // already sitting in the lobby see a bowl whose version never moved,
        // and go on showing an empty one for the whole first turn.
        update.bowlVersion = state.bowlVersion + 1
      }

      transaction.update(reference, update)
    })
  }

  /**
   * Begins following the match. The state callback fires for every change to
   * the match itself; the throw callback fires only for throws made by somebody
   * else, since this player's own are already running by the time they are
   * written.
   * The state callback is told whether the read was confirmed by the server.
   * Firestore answers a fresh listener from its local cache first, and a cache
   * that has not caught up with a transaction this player just committed still
   * describes the match as it was beforehand. Anything that would throw a
   * player out on what it reads has to wait for the server to agree.
   * @param onState - Given the match every time it changes, and whether the server confirmed it
   * @param onThrow - Given another player's throw, once, as it is made
   */
  listen(
    onState: (state: MatchState, confirmed: boolean) => void,
    onThrow: (record: ThrowRecord) => void,
  ): void {
    this.unsubscribers.push(onSnapshot(this.reference, (snapshot) => {
      const state = parseMatchState(this.code, snapshot.data())

      if (state !== null) {
        onState(state, !snapshot.metadata.fromCache)
      }
    }))

    // Only ever the newest throw. The ones before it are history, and their
    // outcome is already in the bowl this player was handed on arrival.
    const newest = query(
      collection(this.reference, THROWS),
      orderBy('seq', 'desc'),
      limit(1),
    )

    this.unsubscribers.push(onSnapshot(newest, (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') {
          continue
        }

        const record = parseThrowRecord(change.doc.data())

        // A modification is the thrower writing the result onto their own
        // throw, which arrives through the bowl rather than through here
        if (record === null || record.seq <= this.appliedThrow) {
          continue
        }

        this.appliedThrow = record.seq

        if (this.primed && record.uid !== this.playerId) {
          onThrow(record)
        }
      }

      // Whatever the first delivery held had already happened before this
      // player was watching, so it is noted and not played. Counted only once
      // the server has answered: a cache-only first delivery can be empty
      // while the match already has throws, and priming on it would replay the
      // last one as though it had just been made.
      if (!snapshot.metadata.fromCache) {
        this.primed = true
      }
    }))
  }

  /**
   * Records a throw, and marks the turn as having had one.
   *
   * Written after the die is already flying here rather than before. The
   * thrower is the authority on what happens next, so there is nothing to wait
   * for, and waiting would put a database round trip between a hand and a die.
   * @param seq - This throw's number, which is also the die's name
   * @param launch - The throw as it was made
   */
  async submitThrow(seq: number, launch: ThrowLaunch): Promise<void> {
    const batch = writeBatch(firestore)

    batch.set(doc(this.reference, THROWS, String(seq)), {
      seq: seq,
      uid: this.playerId,
      dieId: String(seq),
      origin: launch.origin,
      velocity: launch.velocity,
      orientation: launch.orientation,
      angularVelocity: launch.angularVelocity,
      result: null,
    })

    batch.update(this.reference, {
      throwSeq: seq,
      hasThrown: true,
    })

    await batch.commit()
  }

  /**
   * Publishes where the dice came to rest.
   *
   * The bowl goes onto the match and onto the throw in one batch. Split apart,
   * a player could read a match whose throw is finished but whose bowl is still
   * the one from before it — a torn state that every other player would then
   * set their own dice from.
   * @param seq - The throw that has just finished
   * @param bowl - Every die in the bowl, as it now stands
   */
  async submitResult(seq: number, bowl: DieSnapshot[]): Promise<void> {
    const batch = writeBatch(firestore)

    batch.update(doc(this.reference, THROWS, String(seq)), {
      result: bowl,
    })
    batch.update(this.reference, {
      bowl: bowl,
      bowlVersion: increment(1),
    })

    await batch.commit()
  }

  /**
   * Ends this player's turn and hands it on in joining order.
   * @param state - The match as it currently stands
   */
  async pass(state: MatchState): Promise<void> {
    await updateDoc(this.reference, {
      turnIndex: (state.turnIndex + 1) % state.players.length,
      hasThrown: false,
    })
  }

  /** Stops following the match. */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe()
    }

    this.unsubscribers.length = 0
  }
}
