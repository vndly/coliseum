<!-- The rules of the game, over whatever was on the screen.

     The same sheet in the lobby and in a match, which is the whole reason it
     reads nothing off either. A match settles how large a group is and whether
     the flush is played, and a sheet that named this match's answer would be a
     different sheet in each of the two places it is opened from — so the two
     rules that vary are named as choices a match is made with, and everything
     else is the game.

     Prose rather than anything derived from `rules.ts`: nothing here is a
     figure the code owns, so nothing here is imported. What that costs is that
     a change to the ruleset has to be answered in this file as well.

     The order the bowl is read in is the one part of it that really is a
     sequence, so it is the one part set out as one — counted by the dice rather
     than by figures beside them, since the dice are what each step is about. -->
<script setup lang="ts">
import {onBeforeUnmount, onMounted, useTemplateRef} from 'vue'
import DieFace from '@/components/die_face.vue'

const emit = defineEmits<{close: []}>()

const closeButton = useTemplateRef<HTMLButtonElement>('closeButton')

/**
 * The dice each step of the reading is drawn with.
 *
 * Lit where the dice are leaving the bowl and unlit where they are staying in
 * it, which is the same pair of states the lobby counts seats with. The group
 * is drawn at three rather than at two because three dice of one value are a
 * group whichever size the match was made at, and a run of two would read as
 * the answer to a question this sheet has deliberately not asked.
 */
const REMOVED_RUN = [6]
const FLUSH_RUN = [
  1,
  2,
  3,
  4,
  5,
]
const GROUP_RUN = [
  3,
  3,
  3,
]
const KEPT_RUN = [
  2,
  4,
]

/**
 * Closes the sheet on Esc, wherever the keyboard happens to be.
 *
 * Bound on the window rather than on the layer, because a press anywhere inside
 * the card that is not the close button — a line of it, the heading, a die,
 * the scrollbar — leaves focus on the document, and a keydown there never
 * passes through the element a handler would be on. The card is mostly prose,
 * so that is the ordinary way to read it rather than an edge of one.
 * @param event - The key pressed, wherever it landed
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close')
  }
}

// The sheet is opened by a press and closed by one, so the press that closes it
// is where the keyboard is put down.
onMounted(() => {
  closeButton.value?.focus()
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="sheet" @click.self="emit('close')">
    <div
      class="sheet__card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-heading"
    >
      <h2 id="rules-heading" class="sheet__title">How to play</h2>

      <p class="sheet__line">
        Everyone starts with six dice in the colour they chose. Run out and you
        are out — the last player still holding dice wins.
      </p>

      <p class="sheet__line">
        Throw one die into the bowl. Arrive at an empty bowl and you throw your
        whole hand instead. Once you have thrown, throw again or pass.
      </p>

      <p class="label">When the dice stop</p>

      <ol class="steps">
        <li class="steps__step">
          <span class="steps__dice">
            <DieFace v-for="(face, index) in REMOVED_RUN" :key="index" :value="face" lit />
          </span>
          <span class="steps__line">Every six leaves the match for good.</span>
        </li>

        <li class="steps__step">
          <span class="steps__dice">
            <DieFace v-for="(face, index) in FLUSH_RUN" :key="index" :value="face" lit />
          </span>
          <span class="steps__line">
            One of each of the other five values and nothing else is a flush, and
            the whole bowl goes to your hand. Some matches are played without it.
          </span>
        </li>

        <li class="steps__step">
          <span class="steps__dice">
            <DieFace v-for="(face, index) in GROUP_RUN" :key="index" :value="face" lit />
          </span>
          <span class="steps__line">
            Dice of one value — two of them, or three, depending on how the match
            was made — go to your hand and end your turn.
          </span>
        </li>

        <li class="steps__step">
          <span class="steps__dice">
            <DieFace v-for="(face, index) in KEPT_RUN" :key="index" :value="face" />
          </span>
          <span class="steps__line">
            Anything else stays in the bowl for whoever groups it next.
          </span>
        </li>
      </ol>

      <p class="sheet__line">
        A die that misses the bowl leaves the match. A die in the bowl belongs to
        nobody until somebody groups it, and it keeps the colour of whoever threw
        it.
      </p>

      <button
        ref="closeButton"
        type="button"
        class="sheet__close"
        @click="emit('close')"
      >
        Close
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Fixed rather than absolute, because the two screens that open this are built
   differently underneath: one is a positioned table and the other is a column
   of cards that scrolls. What both have is the viewport. */
.sheet {
    position: fixed;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;

    /* The heavier of the two scrims this game draws. The cards over a match
       leave the bowl visible because the bowl is what they are about; this one
       is a page to be read, and there is nothing behind it worth keeping. */
    background: rgb(14 18 16 / 82%);
}

/* The same raised surface both screens are already built from. Given a ceiling
   and its own scroll rather than a height, so the whole sheet is reachable on a
   phone held the short way without the page behind it moving. */
.sheet__card {
    width: 100%;
    max-width: 26rem;
    max-height: calc(100dvh - 2.5rem);
    overflow-y: auto;
    padding: 1.75rem;
    border: 1px solid var(--brass-edge);
    border-radius: 0.75rem;
    background: var(--panel);
    scrollbar-width: thin;
    scrollbar-color: rgb(200 164 104 / 20%) transparent;
    box-shadow:
        inset 0 1px 0 rgb(200 164 104 / 18%),
        0 1.5rem 3rem rgb(0 0 0 / 45%);

    /* Answers the press that opened it, and nothing else here moves */
    animation: sheet-opened 160ms ease-out;
}

@keyframes sheet-opened {
    from {
        transform: translateY(0.5rem);
        opacity: 0;
    }

    to {
        transform: none;
        opacity: 1;
    }
}

.sheet__title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--brass);
}

.sheet__line {
    margin-top: 0.875rem;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--bone-dim);
}

/* What the dice have just done is a paragraph about the game rather than a
   fifth step, so it is held off the list the way the list is held off the
   prose above it */
.steps + .sheet__line {
    margin-top: 1.5rem;
}

.label {
    margin-top: 1.5rem;
    font: var(--plate);
    letter-spacing: var(--plate-tracking);
    text-transform: uppercase;
    color: var(--bone-faint);
}

/* Two columns, and the dice are the left one: every run starts on the same
   line so the four of them read down the sheet as one column of dice. The
   subgrid is what holds that column to the widest run — the flush, at five —
   without a width being written down and kept in step by hand. */
.steps {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.875rem;
    margin-top: 0.75rem;
    list-style: none;
}

.steps__step {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: start;
}

/* Packed against the text rather than away from it, so a run of one is beside
   the line it is about instead of stranded at the far side of a gutter the
   flush is the only step wide enough to fill.

   Set down on the first line of that text rather than on the box that holds it:
   a die is shorter than a line of type, and centred on one it reads as having
   slipped. */
.steps__dice {
    display: flex;
    justify-content: flex-end;
    gap: 0.25rem;
    padding-top: 0.1875rem;
}

.steps__dice .die-face {
    --size: 1.125rem;
}

/* Lit against the prose around it. The sheet is read once and the reading of a
   bowl is what it was opened for. */
.steps__line {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--bone);
}

/* Narrower than the two columns need, the dice stand over the line they belong
   to instead of squeezing it to three words apiece */
@media (width < 26rem) {
    .steps,
    .steps__step {
        display: flex;
        flex-direction: column;
    }

    /* One step has to read as further from the next than its own dice are from
       its own line, which two columns said by putting them side by side */
    .steps {
        gap: 1.25rem;
    }

    .steps__step {
        gap: 0.5rem;
    }

    /* Nothing to be held off any more once the run is over its own line */
    .steps__dice {
        justify-content: flex-start;
    }
}

/* The quiet treatment both screens give a second answer, because this sheet
   asks nothing: it is closed when it has been read, and a brass button would
   be calling for a press that decides something. */
.sheet__close {
    width: 100%;
    margin-top: 1.75rem;
    padding: 0.75rem;
    border: 0;
    border-radius: 0.5rem;
    background: var(--well);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--bone-dim);
    cursor: pointer;
    box-shadow: inset 0 0 0 1px var(--brass-edge);
    transition: color 160ms ease;
}

.sheet__close:hover {
    color: var(--bone);
}
</style>
