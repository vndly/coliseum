<!-- The way into a match: start one, or take a seat in one that exists.

     Joining is two steps rather than one. A code is four characters and
     therefore guessable, so the code is read and the match shown before a seat
     is taken — a mistyped code that happens to exist is a stranger's game, and
     the seats are what make that obvious. -->
<script setup lang="ts">
import {computed, onMounted, ref, shallowRef} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import DieFace from '@/components/die_face.vue'
import {normaliseMatchCode} from '@/match/codes'
import {MatchClient} from '@/match/match_client'
import type {MatchState} from '@/match/match_state'

const MIN_PLAYERS = 2
const MAX_PLAYERS = 6
const CODE_LENGTH = 4
const NAME_LIMIT = 16

const route = useRoute()
const router = useRouter()

const mode = ref<'create' | 'join'>('create')
const playerName = ref('')
const playerCount = ref(MIN_PLAYERS)
const code = ref('')
const busy = ref(false)
const error = ref('')

// The match being considered, once a code has been looked up. Shallow because
// nothing inside it is edited — it is replaced whole or not at all.
const found = shallowRef<MatchState | null>(null)

const seatCounts = computed<number[]>(() => {
  const counts: number[] = []

  for (let count = MIN_PLAYERS; count <= MAX_PLAYERS; count++) {
    counts.push(count)
  }

  return counts
})

const trimmedName = computed<string>(() => playerName.value.trim())
const canCreate = computed<boolean>(() => trimmedName.value.length > 0 && !busy.value)

const canFind = computed<boolean>(
  () => trimmedName.value.length > 0
    && normaliseMatchCode(code.value).length === CODE_LENGTH
    && !busy.value,
)

// A player arriving from a match they turned out not to be in, with the code
// carried over so they only have to say who they are
onMounted(() => {
  const carried = route.query.code

  if (typeof carried === 'string') {
    code.value = carried
    mode.value = 'join'
  }
})

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Try again.'
}

function seatedName(seat: number): string {
  return found.value?.players[seat - 1]?.name ?? 'Open seat'
}

function chooseMode(next: 'create' | 'join'): void {
  mode.value = next
  error.value = ''
  found.value = null
}

async function runCreate(): Promise<void> {
  busy.value = true
  error.value = ''

  try {
    const created = await MatchClient.create(trimmedName.value, playerCount.value)

    await router.push({
      name: 'match',
      params: {
        code: created,
      },
    })
  } catch (reason: unknown) {
    error.value = describe(reason)
    busy.value = false
  }
}

async function runFind(): Promise<void> {
  busy.value = true
  error.value = ''

  try {
    const match = await MatchClient.peek(normaliseMatchCode(code.value))

    if (match === null) {
      error.value = 'No match with that code.'
    } else {
      found.value = match
    }
  } catch (reason: unknown) {
    error.value = describe(reason)
  } finally {
    busy.value = false
  }
}

async function runJoin(): Promise<void> {
  const match = found.value

  if (match === null) {
    return
  }

  busy.value = true
  error.value = ''

  try {
    await MatchClient.join(match.code, trimmedName.value)

    await router.push({
      name: 'match',
      params: {
        code: match.code,
      },
    })
  } catch (reason: unknown) {
    error.value = describe(reason)
    busy.value = false
  }
}

function onCreate(): void {
  void runCreate()
}

function onFind(): void {
  void runFind()
}

function onJoin(): void {
  void runJoin()
}
</script>

<template>
  <main class="lobby">
    <header class="lobby__head">
      <h1 class="lobby__wordmark">Coliseum</h1>
      <p class="lobby__line">Two to six players, one bowl.</p>
    </header>

    <section class="card">
      <div class="switch" role="group" aria-label="Start or join">
        <button
          type="button"
          class="switch__option"
          :class="{'switch__option--on': mode === 'create'}"
          :aria-pressed="mode === 'create'"
          @click="chooseMode('create')"
        >
          New match
        </button>
        <button
          type="button"
          class="switch__option"
          :class="{'switch__option--on': mode === 'join'}"
          :aria-pressed="mode === 'join'"
          @click="chooseMode('join')"
        >
          Join a match
        </button>
      </div>

      <form class="form" @submit.prevent>
        <label class="field">
          <span class="field__label">Your name</span>
          <input
            v-model="playerName"
            class="field__input"
            type="text"
            :maxlength="NAME_LIMIT"
            autocomplete="nickname"
            placeholder="Ana"
          >
        </label>

        <template v-if="mode === 'create'">
          <!-- A group rather than a fieldset: a legend is taken out of its
               parent's flex flow, and lands on top of the dice -->
          <div class="field" role="group" aria-label="Players">
            <span class="field__label" aria-hidden="true">Players</span>
            <div class="counts">
              <button
                v-for="count in seatCounts"
                :key="count"
                type="button"
                class="counts__option"
                :class="{'counts__option--on': playerCount === count}"
                :aria-pressed="playerCount === count"
                :aria-label="`${count} players`"
                @click="playerCount = count"
              >
                <DieFace :value="count" :lit="playerCount === count" />
              </button>
            </div>
          </div>

          <button
            type="submit"
            class="action"
            :disabled="!canCreate"
            @click="onCreate"
          >
            {{ busy ? 'Starting…' : 'Start the match' }}
          </button>
        </template>

        <template v-else-if="found === null">
          <label class="field">
            <span class="field__label">Match code</span>
            <input
              v-model="code"
              class="field__input field__input--code"
              type="text"
              :maxlength="CODE_LENGTH"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck="false"
              placeholder="K7QM"
            >
          </label>

          <button
            type="submit"
            class="action"
            :disabled="!canFind"
            @click="onFind"
          >
            {{ busy ? 'Looking…' : 'Find the match' }}
          </button>
        </template>

        <template v-else>
          <div class="found">
            <p class="found__code">{{ found.code }}</p>
            <ul class="seats">
              <li v-for="seat in found.playerCount" :key="seat" class="seats__seat">
                <DieFace :value="seat" :lit="seat <= found.players.length" />
                <span
                  class="seats__name"
                  :class="{'seats__name--open': seat > found.players.length}"
                >{{ seatedName(seat) }}</span>
              </li>
            </ul>
          </div>

          <button
            type="submit"
            class="action"
            :disabled="busy"
            @click="onJoin"
          >
            {{ busy ? 'Taking a seat…' : 'Take a seat' }}
          </button>

          <button type="button" class="quiet" @click="found = null">Try another code</button>
        </template>

        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </form>
    </section>
  </main>
</template>

<style scoped>
.lobby {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2.5rem;
    min-height: 100%;
    padding: 2rem 1.25rem;

    /* A pool of warmth behind the card, as though the one lamp over the table
       in the scene reached this screen too */
    background:
        radial-gradient(120% 90% at 50% 12%, rgb(74 122 96 / 8%), transparent 60%),
        var(--ground);
}

.lobby__head {
    text-align: center;
}

.lobby__wordmark {
    font-size: 0.9375rem;
    font-weight: 700;
    letter-spacing: 0.42em;
    text-indent: 0.42em; /* Puts the tracking back inside the centred line */
    text-transform: uppercase;
    color: var(--brass);
}

.lobby__line {
    margin-top: 0.75rem;
    font-size: 0.9375rem;
    color: var(--bone-dim);
}

.card {
    width: 100%;
    max-width: 24rem;
    padding: 1.5rem;
    border: 1px solid var(--brass-edge);
    border-radius: 0.75rem;
    background: var(--panel);

    /* Two shadows: the bead of light along the top edge that a turned lip
       catches, and the weight of the card on the ground beneath it */
    box-shadow:
        inset 0 1px 0 rgb(200 164 104 / 18%),
        0 1.5rem 3rem rgb(0 0 0 / 45%);
}

.switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem;
    padding: 0.25rem;
    border-radius: 0.5rem;
    background: var(--well);
}

.switch__option {
    padding: 0.5rem;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--bone-dim);
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease;
}

.switch__option--on {
    background: var(--walnut);
    color: var(--bone);
}

.form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    margin-top: 1.5rem;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border: 0;
}

.field__label {
    font: var(--plate);
    letter-spacing: var(--plate-tracking);
    text-transform: uppercase;
    color: var(--bone-faint);
}

.field__input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--brass-edge);
    border-radius: 0.5rem;
    background: var(--well);
    font-size: 1rem;
    transition: border-color 160ms ease;
}

.field__input::placeholder {
    color: var(--bone-faint);
}

.field__input:hover {
    border-color: var(--brass);
}

.field__input--code {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: 0.3em;
    text-align: center;
    text-transform: uppercase;
    text-indent: 0.3em;
}

.counts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.counts__option {
    padding: 0;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    cursor: pointer;
}

.counts__option--on {
    box-shadow: 0 0 0 2px var(--brass);
}

.action {
    padding: 0.8125rem;
    border: 0;
    border-radius: 0.5rem;
    background: var(--brass);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--pip);
    cursor: pointer;
    transition: filter 160ms ease;
}

.action:hover:not(:disabled) {
    filter: brightness(1.12);
}

.action:disabled {
    background: var(--brass-glow);
    color: var(--bone-faint);
    cursor: not-allowed;
}

.quiet {
    padding: 0;
    border: 0;
    background: transparent;
    font-size: 0.8125rem;
    color: var(--bone-dim);
    text-decoration: underline;
    text-underline-offset: 0.25em;
    cursor: pointer;
}

.quiet:hover {
    color: var(--bone);
}

.found {
    padding: 1.25rem;
    border: 1px solid var(--brass-edge);
    border-radius: 0.5rem;
    background: var(--well);
    text-align: center;
}

.found__code {
    font-family: var(--font-mono);
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: 0.3em;
    text-indent: 0.3em;
    color: var(--brass);
}

.seats {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    margin-top: 1.25rem;
    list-style: none;
    text-align: left;
}

.seats__seat {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.seats__seat .die-face {
    --size: 1.5rem;
}

.seats__name {
    font-size: 0.9375rem;
}

.seats__name--open {
    color: var(--bone-faint);
}

.error {
    font-size: 0.875rem;
    color: var(--brass);
}
</style>
