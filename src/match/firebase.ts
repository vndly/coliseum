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
  apiKey: 'AIzaSyBbB_8eQFJx2Ah4YBKcB6roM8gqRb9Z_Lw',
  authDomain: 'atomic-prototype.firebaseapp.com',
  projectId: 'atomic-prototype',
  storageBucket: 'atomic-prototype.firebasestorage.app',
  messagingSenderId: '1079322227234',
  appId: '1:1079322227234:web:3a79e55e7d553f5abed07b',
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
