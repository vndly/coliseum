import {collection,
  doc,
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
import {STARTING_POOL, nextActivePlayer, resolveThrow, shuffledPlayers} from '@/match/rules'
import {createOpeningDie} from '@/scene/die_state'
import type {DieSnapshot, ThrownDie} from '@/scene/die_state'

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
   * Starts a match with this player in the first seat, which is where the
   * lobby seats them rather than where they will play: the order of play is
   * drawn when the last seat is taken.
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
          pools: {
            [playerId]: STARTING_POOL,
          },
          turnIndex: 0,
          hasThrown: false,
          bowl: [],
          throwSeq: 0,
          verdict: null,
          winner: null,
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
   * Takes a seat, and starts the match if it was the last one.
   *
   * Both happen in a single transaction. Starting the match anywhere else would
   * need somebody to be watching for the moment the seats filled, and the
   * player who fills the last seat is the only one guaranteed to be there. The
   * same write draws the order of play, so the last player to arrive draws it
   * for everybody — which is the same authority every other player is trusted
   * with on their own turn.
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
        pools: {
          ...state.pools,
          [playerId]: STARTING_POOL,
        },
      }

      if (players.length === state.playerCount) {
        update.phase = 'playing'
        update.bowl = [createOpeningDie()]

        // The seats are drawn now rather than as each was taken, so that a
        // player watching the lobby fill cannot tell where they are sitting
        // until the whole table finds out at once
        update.players = shuffledPlayers(players)

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
   * Records a throw, takes its dice out of this player's hand, and marks the
   * turn as having had one.
   *
   * Written after the dice are already flying here rather than before. The
   * thrower is the authority on what happens next, so there is nothing to wait
   * for, and waiting would put a database round trip between a hand and a die.
   *
   * The hand is charged here rather than when the throw is judged, so that
   * everyone watching sees the count drop as the dice leave rather than four
   * seconds later. What comes back from a group is added when the verdict is
   * written, on top of a hand this has already emptied.
   * @param seq - This throw's number, which every die of it is named after
   * @param dice - Every die of the throw, as this player described them
   */
  async submitThrow(seq: number, dice: ThrownDie[]): Promise<void> {
    const batch = writeBatch(firestore)

    batch.set(doc(this.reference, THROWS, String(seq)), {
      seq: seq,
      uid: this.playerId,
      dice: dice.map((die) => ({
        id: die.id,
        origin: die.launch.origin,
        velocity: die.launch.velocity,
        orientation: die.launch.orientation,
        angularVelocity: die.launch.angularVelocity,
      })),
    })

    batch.update(this.reference, {
      throwSeq: seq,
      hasThrown: true,
      [`pools.${this.playerId}`]: increment(-dice.length),
    })

    await batch.commit()
  }

  /**
   * Judges a bowl that has come to rest and publishes everything that follows
   * from it: what leaves, what goes back to a hand, whose turn it is, and
   * whether the match is over.
   *
   * All of it in one transaction, and all of it in one write. Split apart, a
   * player could read a match whose bowl has been emptied but whose hands have
   * not been paid — a torn state every other player would then set their own
   * dice from. A transaction rather than a batch because the same throw can be
   * judged by more than one player: whoever threw it does so as soon as their
   * dice stop, and if they leave without ever managing it, the next player at
   * the table does it from their own simulation instead. The first to arrive is
   * the one that counts, and the rest find the work already done.
   * @param seq - The throw that has just finished
   * @param atRest - Every die in the bowl as it stopped, from this player's own table
   */
  async submitVerdict(seq: number, atRest: DieSnapshot[]): Promise<void> {
    await runTransaction(firestore, async (transaction) => {
      const snapshot = await transaction.get(this.reference)
      const state = parseMatchState(this.code, snapshot.data())

      if (state === null || state.phase !== 'playing') {
        return
      }

      // Already judged, by the thrower or by whoever stepped in first
      if (state.throwSeq !== seq || (state.verdict !== null && state.verdict.seq >= seq)) {
        return
      }

      const outcome = resolveThrow(state, seq, atRest)

      // Judging somebody else's throw means they never managed it themselves,
      // which is the whole reason this path exists. The rules would leave the
      // turn with a player who paired nothing so they can choose to throw
      // again — but a player who has left the table cannot choose, and only
      // they could pass. The turn is handed on for them, or the bowl is rescued
      // and the match still never moves.
      const thrower = state.players[state.turnIndex]
      const contested = thrower === undefined || thrower.uid !== this.playerId
      const turnIndex = contested && outcome.turnIndex === state.turnIndex
        ? nextActivePlayer(state.players, outcome.pools, state.turnIndex)
        : outcome.turnIndex

      transaction.update(this.reference, {
        bowl: outcome.bowl,
        pools: outcome.pools,
        turnIndex: turnIndex,

        // The turn only stays with a player who threw without pairing anything,
        // and they are the only player the Pass button is ever offered to
        hasThrown: turnIndex === state.turnIndex,

        verdict: outcome.resolution,
        winner: outcome.winner,
        phase: outcome.winner === null ? 'playing' : 'finished',

        // Read in this same transaction, so it is counted rather than incremented
        bowlVersion: state.bowlVersion + 1,
      })
    })
  }

  /**
   * Ends this player's turn and hands it on, over anyone with nothing left to
   * throw.
   * @param state - The match as it currently stands
   */
  async pass(state: MatchState): Promise<void> {
    await updateDoc(this.reference, {
      turnIndex: nextActivePlayer(state.players, state.pools, state.turnIndex),
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
