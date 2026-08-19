import {initializeApp} from 'firebase/app'
import {getAuth, onAuthStateChanged, signInAnonymously} from 'firebase/auth'
import type {Unsubscribe} from 'firebase/auth'
import {getFirestore} from 'firebase/firestore'

/**
 * The Firebase project every match is synchronised through.
 *
 * A web configuration is a set of public identifiers rather than a secret: it
 * ships in the bundle by design, and what actually guards the data is the
 * project's security rules. Analytics is deliberately left uninitialised —
 * it is a measurable amount of bundle for a game that measures nothing.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyDIF2WYLkR9jdr_yV739N_F1fzVv_HuPSU',
  authDomain: 'coliseum-game.firebaseapp.com',
  projectId: 'coliseum-game',
  storageBucket: 'coliseum-game.firebasestorage.app',
  messagingSenderId: '788973501695',
  appId: '1:788973501695:web:d851d4977b95c3cc2c20ca',
}

const app = initializeApp(firebaseConfig)

export const firestore = getFirestore(app)

/**
 * Signs this browser in and returns the identifier it plays under.
 *
 * Anonymous rather than asked for, because a name typed into the lobby is all
 * the identity this game needs and an account would be a wall in front of a
 * dice bowl. Firebase keeps the anonymous user in local storage, so calling
 * this again returns the same identifier — which is what lets a player who
 * reloads mid-match sit back down in the seat they already had.
 * @returns The player's identifier, stable for as long as the browser keeps it
 */
export async function currentPlayerId(): Promise<string> {
  const credential = await signInAnonymously(getAuth(app))

  return credential.user.uid
}

/**
 * Reports the identifier this browser already plays under, without ever
 * creating one.
 *
 * Deliberately not currentPlayerId above: signing in is what brings an account
 * into existence, and somebody who has done nothing but look at the lobby
 * should not leave one behind. Firebase restores the anonymous user from local
 * storage on its own schedule, so this answers null first and again with the
 * identifier once it is back — and answers null for good on a browser that has
 * never taken a seat anywhere.
 * @param onChange - Given the identifier, or null while there is none
 * @returns The call that stops the reporting
 */
export function watchPlayerId(onChange: (playerId: string | null) => void): Unsubscribe {
  return onAuthStateChanged(getAuth(app), (user) => {
    onChange(user?.uid ?? null)
  })
}
