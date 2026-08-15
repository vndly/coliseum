/**
 * A match code is short enough to read out over a call and to type from
 * memory, which is the only way anyone joins a match.
 *
 * The alphabet leaves out every character that is lost when a code is spoken
 * or squinted at: O and D against zero, I and L against one, S against five, B
 * against eight, Z against two. What is left is four characters that survive
 * being repeated down a phone line.
 */
const CODE_ALPHABET = 'ACEFGHJKMNPQRTUVWXY34679'
const CODE_LENGTH = 4

/**
 * Draws a fresh match code. Nothing here checks whether it is already taken —
 * that is decided by the write that claims it, which is the only place it can
 * be decided without a race.
 * @returns A code of CODE_LENGTH characters from the alphabet above
 */
export function createMatchCode(): string {
  let code = ''

  for (let i = 0; i < CODE_LENGTH; i++) {
    const index = Math.floor(Math.random() * CODE_ALPHABET.length)

    code += CODE_ALPHABET[index] ?? ''
  }

  return code
}

/**
 * Puts a typed code into the form the documents are keyed by, so that a code
 * read off a screen in lowercase, or with the spaces someone put in to read it
 * aloud, still finds the match.
 * @param typed - Whatever the player entered
 * @returns The code as it would have been generated
 */
export function normaliseMatchCode(typed: string): string {
  return typed.replace(/\s/gu, '').toUpperCase()
}
