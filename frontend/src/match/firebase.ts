import {initializeApp} from 'firebase/app'
import {getAuth, signInAnonymously} from 'firebase/auth'
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
