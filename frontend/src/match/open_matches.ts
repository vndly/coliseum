import {Timestamp,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where} from 'firebase/firestore'
import type {Unsubscribe} from 'firebase/firestore'
import {firestore} from '@/match/firebase'
import {parseMatchState} from '@/match/match_state'
import {MAX_PLAYERS, MIN_PLAYERS} from '@/match/rules'

const MATCHES = 'matches'
const OPEN_LIMIT = 20 // How many are asked for at once, however many are open
const REFRESH_MILLISECONDS = 15 * 1000 // How often the offered matches are aged

/**
 * How long a match is offered for after it is made.
 *
 * Counted on the browser's own clock, against a stamp written on the server's.
 * Firestore hands out no offset between the two to correct for — the realtime
 * database does, and its absence here is deliberate on Google's part rather
 * than an oversight — so a browser whose clock is wrong is simply wrong about
 * this window: minutes fast and it narrows, more than this fast and the card
 * never appears at all, slow and matches go on being offered long after
 * everybody has left them. Left standing because every cure costs a round trip
 * per lobby to learn the time, and what is at stake is only the card: a code
 * typed into the field below never touches this query.
 */
const OPEN_WINDOW_MILLISECONDS = 5 * 60 * 1000

/**
 * One match with a seat still free, as the lobby offers it.
 *
 * A reduction of the stored match rather than the match itself: a lobby has no
 * use for a bowl, and a list of them would be carrying every die in every
 * waiting match around for the sake of a name and a count.
 */
export interface OpenMatch {
  code: string
  host: string // Whoever made it, who is always the first seat
  seatsTaken: number
  seatsTotal: number
  uids: string[] // Everyone already sitting in it, so a player can be shown their own match
  createdAt: number // Milliseconds, for judging the match still recent
}

/**
 * Follows every match anybody could still take a seat in.
 *
 * Two things make a match one of those, and only one of them can be asked of
 * the database. Having a seat free is the phase, whole: the transaction that
 * fills the last one starts the match in the same write, so a match still in
 * the lobby always has room. Being recent is the other half, and it has to be
 * asked twice — a listener's cutoff is fixed at the moment its query is built,
 * so matches age into the results and never back out of them. Without the
 * timer below, a lobby left open for an hour would still be offering the match
 * somebody walked away from fifty minutes ago.
 * @param onChange - Given every open match, newest first, whenever the set changes
 * @returns The call that stops following
 */
export function watchOpenMatches(onChange: (matches: OpenMatch[]) => void): Unsubscribe {
  let received: OpenMatch[] = []

  // Everything the query has handed over, less whatever has gone stale since
  const publish = (): void => {
    const cutoff = Date.now() - OPEN_WINDOW_MILLISECONDS

    onChange(received.filter((match) => match.createdAt >= cutoff))
  }

  const open = query(
    collection(firestore, MATCHES),
    where('phase', '==', 'lobby'),
    where('createdAt', '>=', Timestamp.fromMillis(Date.now() - OPEN_WINDOW_MILLISECONDS)),
    orderBy('createdAt', 'desc'),
    limit(OPEN_LIMIT),
  )

  const stop = onSnapshot(open, (snapshot) => {
    received = []

    for (const entry of snapshot.docs) {
      const match = readOpenMatch(entry.id, entry.data())

      if (match !== null) {
        received.push(match)
      }
    }

    publish()
  })

  const ageing = window.setInterval(publish, REFRESH_MILLISECONDS)

  return () => {
    window.clearInterval(ageing)
    stop()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads one offered match out of its document.
 *
 * The match goes through the same reader every other client uses, so nothing
 * unplayable is ever offered as a seat. The stamp is read here rather than
 * added to that reader on purpose: a server timestamp is null in the writer's
 * own cache until the server sets it, and a match that would not parse without
 * one is a match its own creator could not read for the moment after making it.
 * @param code - The document's name, which is the match's code
 * @param value - The document's fields
 * @returns The match, or null if it is unreadable, unstamped, or has no seat left
 */
function readOpenMatch(code: string, value: unknown): OpenMatch | null {
  const state = parseMatchState(code, value)

  if (state === null || !isRecord(value)) {
    return null
  }

  const host = state.players[0]
  const createdAt = value.createdAt

  if (host === undefined || !(createdAt instanceof Timestamp)) {
    return null
  }

  // Bounded, and not merely compared against the seats already taken, because
  // this count is what draws the seats: it is handed straight to the renderer
  // as a length, so a stored 2.5 is an invalid array length that takes the
  // whole lobby down with it, and a stored million builds a million dice.
  // Nothing this game writes is outside the range, so what this refuses is a
  // document written by something that is not this game.
  const seats = state.playerCount

  if (!Number.isInteger(seats) || seats < MIN_PLAYERS || seats > MAX_PLAYERS) {
    return null
  }

  if (state.players.length >= seats) {
    return null
  }

  return {
    code: code,
    host: host.name,
    seatsTaken: state.players.length,
    seatsTotal: seats,
    uids: state.players.map((player) => player.uid),
    createdAt: createdAt.toMillis(),
  }
}
