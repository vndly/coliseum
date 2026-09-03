import failAudioUrl from '@/assets/audio/fail.mp3'
import flushAudioUrl from '@/assets/audio/flush.mp3'
import lostAudioUrl from '@/assets/audio/lost.mp3'
import musicAudioUrl from '@/assets/audio/music.mp3'
import pairAudioUrl from '@/assets/audio/pair.mp3'
import rollMultipleAudioUrl from '@/assets/audio/roll-multiple.mp3'
import rollSingleAudioUrl from '@/assets/audio/roll-single.mp3'
import winAudioUrl from '@/assets/audio/win.mp3'

/**
 * Owns the music and sound effects played during a match.
 *
 * Music gets one retry on the first interaction after autoplay is refused.
 * Result sounds reuse one player each, while rolls create independent voices
 * so several dice can be heard at once.
 */
export class MatchAudio {
  private readonly failAudio = new Audio(failAudioUrl)
  private readonly flushAudio = new Audio(flushAudioUrl)
  private readonly lostAudio = new Audio(lostAudioUrl)
  private readonly musicAudio = new Audio(musicAudioUrl)
  private readonly pairAudio = new Audio(pairAudioUrl)
  private readonly winAudio = new Audio(winAudioUrl)
  private readonly reusableAudio = [
    this.failAudio,
    this.flushAudio,
    this.lostAudio,
    this.musicAudio,
    this.pairAudio,
    this.winAudio,
  ]
  private readonly rollVoices = new Map<HTMLAudioElement, () => void>()
  private awaitingMusicGesture = false
  private disposed = false

  constructor() {
    this.musicAudio.loop = true
  }

  /**
   * Starts the looping match music, waiting for one interaction if autoplay is
   * refused by the browser.
   */
  startMusic(): void {
    if (this.disposed) {
      return
    }

    void this.musicAudio.play().then(() => {
      this.stopAwaitingMusicGesture()
    }).catch(() => {
      if (!this.disposed) {
        this.awaitMusicGesture()
      }
    })
  }

  /** Plays the failed-turn sound from its beginning. */
  playFail(): void {
    this.playFromStart(this.failAudio)
  }

  /** Plays the pair sound from its beginning. */
  playPair(): void {
    this.playFromStart(this.pairAudio)
  }

  /** Plays the flush sound from its beginning. */
  playFlush(): void {
    this.playFromStart(this.flushAudio)
  }

  /** Plays the victory sound from its beginning. */
  playWin(): void {
    this.playFromStart(this.winAudio)
  }

  /** Plays the defeat sound from its beginning. */
  playLost(): void {
    this.playFromStart(this.lostAudio)
  }

  /** Plays one independent single-die roll voice from its beginning. */
  playRollSingle(): void {
    this.playRoll(rollSingleAudioUrl)
  }

  /** Plays one independent multiple-dice roll voice from its beginning. */
  playRollMultiple(): void {
    this.playRoll(rollMultipleAudioUrl)
  }

  /** Stops all audio and removes every listener owned by this match. */
  dispose(): void {
    this.disposed = true
    this.stopAwaitingMusicGesture()

    for (const audio of this.reusableAudio) {
      MatchAudio.reset(audio)
    }

    this.rollVoices.forEach((onStopped, audio) => {
      audio.removeEventListener('ended', onStopped)
      audio.removeEventListener('error', onStopped)
      MatchAudio.reset(audio)
    })

    this.rollVoices.clear()
  }

  /**
   * Retries music after the first keyboard or pointer interaction.
   * Bound as a field so both listeners can remove the same function.
   */
  private readonly retryMusic = (): void => {
    this.stopAwaitingMusicGesture()

    if (this.disposed) {
      return
    }

    void this.musicAudio.play().catch(() => {})
  }

  /** Installs the two listeners that can unlock autoplay. */
  private awaitMusicGesture(): void {
    if (this.awaitingMusicGesture) {
      return
    }

    this.awaitingMusicGesture = true
    window.addEventListener('pointerdown', this.retryMusic)
    window.addEventListener('keydown', this.retryMusic)
  }

  /** Removes the autoplay-unlock listeners when either is no longer needed. */
  private stopAwaitingMusicGesture(): void {
    if (!this.awaitingMusicGesture) {
      return
    }

    this.awaitingMusicGesture = false
    window.removeEventListener('pointerdown', this.retryMusic)
    window.removeEventListener('keydown', this.retryMusic)
  }

  /**
   * Restarts a reusable result player.
   * @param audio - Player to restart
   */
  private playFromStart(audio: HTMLAudioElement): void {
    if (this.disposed) {
      return
    }

    audio.currentTime = 0
    void audio.play().catch(() => {})
  }

  /**
   * Creates and tracks a roll voice that can overlap every other roll.
   * @param source - Imported URL for the roll recording
   */
  private playRoll(source: string): void {
    if (this.disposed) {
      return
    }

    const audio = new Audio(source)
    const onStopped = (): void => {
      audio.removeEventListener('ended', onStopped)
      audio.removeEventListener('error', onStopped)
      this.rollVoices.delete(audio)
    }

    this.rollVoices.set(audio, onStopped)
    audio.addEventListener('ended', onStopped)
    audio.addEventListener('error', onStopped)
    void audio.play().catch(onStopped)
  }

  /**
   * Stops a player and returns it to its beginning.
   * @param audio - Player to reset
   */
  private static reset(audio: HTMLAudioElement): void {
    audio.pause()
    audio.currentTime = 0
  }
}
