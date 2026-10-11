import {initializeAnalytics, isSupported, logEvent, setDefaultEventParameters} from 'firebase/analytics'
import type {Analytics} from 'firebase/analytics'
import {app} from '@/match/firebase'

/**
 * The game's events, as Firebase Analytics hears them.
 *
 * Every event is sent by the one browser that caused it — the player who made
 * the match, took the seat, or wrote the verdict that ended it — rather than by
 * every browser that watched it happen, which would count a table of four as
 * four matches. Nothing names a player: no name, no join code, no identifier.
 *
 * Production builds only, so that a session on the dev server is not counted
 * as a visitor. And nothing here can reach the game: Analytics starting late,
 * or never, or refusing an event, is answered with silence, because a match is
 * worth more than the record of it.
 */

/** The two screens, as the page they are reported as. */
export type Screen = 'lobby' | 'match'

/** How a seat was reached: a code typed or pasted, or a row in the open list. */
export type JoinMethod = 'code' | 'open_list'

/** Why a seat was refused, read off the sentence the join answered with. */
export type JoinRefusal = 'not_found' | 'started' | 'full' | 'other'

/** Where an error the player was shown came from. */
export type ErrorPlace =
  | 'create'
  | 'clipboard'
  | 'connection'
  | 'match_lost'
  | 'throws_feed'
  | 'throw'
  | 'verdict'
  | 'pass'
  | 'emote'
  | 'physics'

/** What a match plays by, which most of the match events carry. */
export interface MatchSetup {
  players: number // Seats, bots included
  bots: number
  groupSize: number
  flush: boolean
}

/**
 * The address each screen is reported under. The match's own carries its code,
 * which is the one thing in it that would tell one match apart from another,
 * and its query is how the lobby is handed a code — so both are left out.
 */
const SCREEN_PATHS: Record<Screen, string> = {
  lobby: '/',
  match: '/match',
}

const SCREEN_TITLES: Record<Screen, string> = {
  lobby: 'Lobby',
  match: 'Match',
}

const analytics: Promise<Analytics | null> = start()

/**
 * Starts Analytics, where there is a build and a browser to start it in.
 *
 * The automatic page view is turned off, and the address it would have sent is
 * replaced from the outset: a player opening a match's link would otherwise be
 * counted under that match's code before the router has said anything.
 * @returns Analytics, or null where it is not being run
 */
async function start(): Promise<Analytics | null> {
  if (!import.meta.env.PROD) {
    return null
  }

  try {
    if (!(await isSupported())) {
      return null
    }

    return initializeAnalytics(app, {
      config: {
        send_page_view: false,
        page_location: window.location.origin,
      },
    })
  } catch {
    return null
  }
}

/**
 * Sends one event, once Analytics is running.
 * @param name - The event's name
 * @param parameters - What it carries
 */
function send(name: string, parameters: Record<string, string | number> = {}): void {
  void analytics.then((instance) => {
    if (instance === null) {
      return
    }

    try {
      logEvent(instance, name, parameters)
    } catch {
      // Refused; the game goes on without it
    }
  })
}

function describeSetup(setup: MatchSetup): Record<string, string | number> {
  return {
    players: setup.players,
    bots: setup.bots,
    group_size: setup.groupSize,
    flush: setup.flush ? 'on' : 'off',
  }
}

/**
 * Reports a screen being opened, and reports every event after it as coming
 * from that screen's address rather than from the one in the address bar.
 * @param screen - The screen now showing
 */
export function trackScreen(screen: Screen): void {
  const location = `${window.location.origin}${SCREEN_PATHS[screen]}`

  void analytics.then((instance) => {
    if (instance === null) {
      return
    }

    try {
      setDefaultEventParameters({
        page_location: location,
        page_path: SCREEN_PATHS[screen],
        page_title: SCREEN_TITLES[screen],
      })

      logEvent(instance, 'page_view', {
        page_location: location,
        page_path: SCREEN_PATHS[screen],
        page_title: SCREEN_TITLES[screen],
      })
    } catch {
      // Refused; the game goes on without it
    }
  })
}

/**
 * Reports a match made from the lobby.
 * @param setup - What it plays by
 * @param color - The name of the colour its maker plays in
 */
export function trackMatchCreated(setup: MatchSetup, color: string): void {
  send('match_created', {
    ...describeSetup(setup),
    color: color,
  })
}

/**
 * Reports a new seat taken in somebody else's match.
 * @param method - How the seat was reached
 * @param setup - What the match plays by
 */
export function trackMatchJoined(method: JoinMethod, setup: MatchSetup): void {
  send('match_joined', {
    ...describeSetup(setup),
    method: method,
  })
}

/**
 * Reports a seat refused.
 * @param method - How the seat was reached for
 * @param reason - Why it was refused
 */
export function trackJoinFailed(method: JoinMethod, reason: JoinRefusal): void {
  send('join_failed', {
    method: method,
    reason: reason,
  })
}

/**
 * Reports a match beginning. Sent by the browser whose write began it: whoever
 * filled the last seat, or whoever made a match against bots.
 * @param setup - What it plays by
 */
export function trackMatchStarted(setup: MatchSetup): void {
  send('match_started', describeSetup(setup))
}

/**
 * Reports a match won. Sent by the browser whose verdict named the winner.
 * @param setup - What it played by
 * @param throws - How many throws it took
 * @param seconds - How long it was played for, or null when this browser did not see it begin
 * @param winnerBot - Whether the seat that won had nobody behind it
 */
export function trackMatchFinished(
  setup: MatchSetup,
  throws: number,
  seconds: number | null,
  winnerBot: boolean,
): void {
  send('match_finished', {
    ...describeSetup(setup),
    throws: throws,
    winner_bot: winnerBot ? 'yes' : 'no',
    ...(seconds === null ? {} : {
      duration_seconds: seconds,
    }),
  })
}

/**
 * Reports how a match ended for the player at this browser.
 * @param result - Whether they won it, or ran out of dice
 * @param throws - How many throws the match had seen by then
 */
export function trackMatchResult(result: 'win' | 'out', throws: number): void {
  send('match_result', {
    result: result,
    throws: throws,
  })
}

/**
 * Reports a player walking out of a match through the screen's own way out.
 * @param stage - Where the match had got to
 * @param out - Whether they had already run out of dice
 */
export function trackMatchLeft(stage: 'waiting' | 'playing' | 'finished', out: boolean): void {
  send('match_left', {
    stage: stage,
    out: out ? 'yes' : 'no',
  })
}

/**
 * Reports an emote a player sent. Never a bot's.
 * @param emote - The emote's name
 */
export function trackEmoteSent(emote: string): void {
  send('emote_sent', {
    emote: emote,
  })
}

/**
 * Reports the rules being opened.
 * @param screen - The screen they were opened from
 */
export function trackRulesOpened(screen: Screen): void {
  send('rules_opened', {
    screen: screen,
  })
}

/**
 * Reports a sound switch being turned.
 * @param kind - Which of the two switches
 * @param enabled - What it was turned to
 */
export function trackAudioToggled(kind: 'music' | 'effects', enabled: boolean): void {
  send('audio_toggled', {
    kind: kind,
    enabled: enabled ? 'on' : 'off',
  })
}

/** Reports a match's code copied from the screen that waits for players. */
export function trackCodeCopied(): void {
  send('code_copied')
}

/**
 * Reports an error the player was shown. Where it came from, and never what it
 * said: the sentence can carry whatever the store or the browser put in it.
 * @param place - Where it came from
 */
export function trackAppError(place: ErrorPlace): void {
  send('app_error', {
    place: place,
  })
}
