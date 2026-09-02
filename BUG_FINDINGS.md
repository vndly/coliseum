# Bug Findings

## Medium

### [a/logic-errors/throw-fan/fixed-ring-overlaps-a-large-hand] An all-in throw of eight or more dice spawns its bodies interpenetrating

- **Location:** `frontend/src/scene/dimensions.ts:535` (primary); `frontend/src/scene/throw_controller.ts:540-552`, `:493-527`; `frontend/src/match/rules.ts:147`
- **Severity:** Medium
- **Confidence:** Medium
- **Defect:** `THROW_FAN_RADIUS` is a fixed `DIE_SIZE * 1.2`, and `fanOffset` spreads however many dice a throw holds evenly around that one ring. Adjacent centres therefore sit `2 × 1.2 × sin(π / count)` apart, which shrinks as the hand grows: 1.200 at six dice, 0.918 at eight, 0.679 at eleven, 0.621 at twelve. A die is a full unit across, so from eight upward the bodies are closer than one die width and overlap at the moment they are created — the exact condition the constant's own comment says the ring exists to prevent. The comment reasons only about six ("six bodies created at the same point are six bodies overlapping … at six of them that is a circumference of over seven die widths"), and it measures arc length against a die's width rather than chord length against the collider's real extent. `describeLaunches` also gives every die a `randomOrientation()`, and the round-cuboid collider reaches `0.41 × √3 + 0.09 ≈ 0.80` from its centre, so guaranteed separation needs about 1.60 — which even the six-dice case does not have.
- **Trigger:** Any all-in turn with a hand of eight or more. `throwSize` returns the whole pool when the bowl is empty at the start of a turn, and `resolveThrow` grows a pool by concatenation — a won pair takes a starting hand to eight, a flush takes it to eleven. The next player to arrive at the emptied bowl throws all of it on one gesture.
- **Evidence / verification:** Traced `isAllIn`/`throwSize` (`rules.ts:137-151`) → `handToThrow` → `scene.throwCount` → `describeLaunches(count)` → `fanOffset(index, count)`, which applies the constant unscaled for every `count`. Recomputed the chord spacing directly. Refutation attempted: (a) a cap on the fanned count — none exists; `throwCount`'s setter only does `Math.max(count, 1)`; (b) a vertical or temporal stagger that would separate them anyway — `fanOffset` returns `y = 0` and every die of the fan carries the identical launch height and velocity; (c) a desync risk that would mean the case were already known and handled — there is none, because the launches are described once and replayed identically on every client, so the consequence is scatter rather than divergence. Remaining assumption, and the reason this is Medium rather than High confidence: the geometry is certain, but how violently Rapier's penetration recovery answers it was not measured, so the size of the resulting scatter is inferred rather than observed.
- **Suggested fix:** Size the ring from the count rather than fixing it — a radius of roughly `DIE_SIZE * 0.8 / sin(π / count)` keeps the collider's real extents clear at any hand — and carry the same figure into `buildLaunch`'s clearance test, which currently adds the fixed `THROW_FAN_RADIUS`. A ring that large for eleven dice is nearly the width of the interior floor, so the alternative worth weighing is a second, inner ring, or a small vertical stagger, either of which keeps the fan's footprint inside the bowl. This is a design choice about how an eleven-dice throw should look, which is why it is stated rather than applied.

## Low

### [b/contract-mismatches/camera/vertical-fov-crops-a-portrait-viewport] The camera's framing constants hold only in landscape, and crop the bowl on a phone

- **Location:** `frontend/src/scene/dimensions.ts:80` (primary); `:84`, `:86`; `frontend/src/scene/dish_scene.ts:595`
- **Severity:** Low
- **Confidence:** High
- **Defect:** `CAMERA_FIELD_OF_VIEW = 40` is Three's *vertical* field of view, and `resize()` updates `camera.aspect` and nothing else. The visible half-width at the target's depth is therefore `distance × tan(20°) × aspect`, so holding the whole of `BOWL_RIM_RADIUS = 5.25` needs an aspect of at least 0.874 at `CAMERA_MIN_DISTANCE` and 0.687 at `CAMERA_START_DISTANCE`. A 390×844 phone in portrait gives 0.462. At the opening framing the visible half-width is about 3.5 units against a bowl of radius 5.25, so roughly a third of the rim is off-screen on each side and the player has to dolly most of the way out before the bowl fits. That contradicts both constants' own comments — "Closest approach that still holds the whole rim in frame" and "Leaves the bowl about two thirds of the frame height".
- **Trigger:** Open a match on a phone held in portrait. `.match__canvas` is `width: 100%; height: 100%` with no orientation handling anywhere in the project.
- **Evidence / verification:** Recomputed the horizontal extent at all three distances. Refutation attempted: (a) an orientation lock or a portrait media query — grepping `@media` and `orientation` across `match_screen.vue`, `assets/styles.css` and `index.html` finds only `prefers-reduced-motion`; (b) the FOV being adapted on resize — `resize()` sets `aspect` and calls `updateProjectionMatrix()`, nothing more; (c) the project being desktop-only, which would make portrait irrelevant — refuted by `controls.touches`, `touch-action: none`, and the explicitly mobile reasoning in `runCopy`'s comment about a phone on plain http. The throw gesture itself is unaffected, since `THROW_MAX_RADIUS` is clamped in world space; this is framing alone.
- **Suggested fix:** Derive the effective field of view from the aspect when the viewport is narrower than the framing assumes — widening the vertical FOV, or pushing the start and minimum distances out, so the rim stays in frame — and state in `dimensions.ts` which orientation the bare constants describe.

### [b/contract-mismatches/scene-fog/near-plane-inside-the-orbit-limit] The bowl is fogged at full zoom-out, which two comments say cannot happen

- **Location:** `frontend/src/scene/dimensions.ts:55` (primary); `:85`; `frontend/src/scene/dish_scene.ts:141`
- **Severity:** Low
- **Confidence:** High
- **Defect:** `FOG_NEAR = 38` sits inside `CAMERA_MAX_DISTANCE = 39`. `OrbitControls.maxDistance` is the radius from `controls.target`, and the camera looks at that target, so at full zoom-out the bowl's centre is already a unit past the fog's near plane and the far rim reaches about 44. The fog is linear, so the bowl blends toward `BACKGROUND_COLOR` by roughly 0.7% at its centre and 4% at the far rim. `FOG_NEAR`'s own comment says "Well beyond the bowl, so the bowl is never fogged", and `dish_scene.ts:141` says the setting "keeps the bowl itself entirely unfogged".
- **Trigger:** Scroll or pinch out to the orbit distance limit.
- **Evidence / verification:** Refutation attempted: (a) fog disabled on the bowl's material — `MeshPhysicalMaterial.fog` defaults to true and `Dish` never overrides it; (b) the distance being unreachable — 39 is `controls.maxDistance` verbatim; (c) fog measured from the near plane rather than the camera — Three's `vFogDepth` is view-space depth from the camera, so the bowl really is past it. The visible effect is very small; what makes it worth stating is that the two constants are unrelated in the file, so any future increase to `CAMERA_MAX_DISTANCE` widens the contradiction silently.
- **Suggested fix:** Derive `FOG_NEAR` from `CAMERA_MAX_DISTANCE` plus the bowl's own radius rather than stating it independently, so the invariant the comments claim is enforced by the arithmetic instead of by coincidence.

### [c/api-or-library-misuse/colour-picker/focus-lost-when-the-palette-closes] Closing the colour palette drops focus to the document body

- **Location:** `frontend/src/components/screens/lobby_screen.vue:540` (primary); `:151-154`, `:531`
- **Severity:** Low
- **Confidence:** Medium
- **Defect:** The palette is a `v-if` list, and `onPickColor` sets `picking = false`, unmounting the `<ul>` that contains `document.activeElement`. Nothing restores focus to the picker button that opened it, so focus falls to `<body>`: the next Tab restarts from the top of the document, and a screen-reader user loses their place with no announcement that the popup closed. The `@keydown.esc` handler on the `<ul>` has the same effect, and it can only ever fire while focus is inside the palette. Separately, `aria-haspopup="true"` at `:531` is synonymous with `menu`, but the popup is a list of `aria-pressed` buttons with no menu roles or menu key handling, so assistive technology announces a widget the control does not implement.
- **Trigger:** Open the palette with the keyboard (Tab to the picker button, Enter), move to a swatch and activate it — or press Escape with focus inside the palette. Also reachable with a mouse on the platforms where a button takes focus on click.
- **Evidence / verification:** Grepped `src/` for `focus()` — the only four calls are at `lobby_screen.vue:237`, `:239`, `:358` and `:466`, all targeting the name or code field, and no file anywhere handles `activeElement`. Refutation attempted: (a) the browser reassigning focus to the nearest focusable ancestor when the active element is removed — it does not; focus goes to `<body>`; (b) the palette being pointer-only, which would make the keyboard path unreachable — it is fully keyboard-operable both to open and to pick. Remaining assumption: the focus behaviour is taken from the specification and from consistent engine behaviour rather than reproduced in a browser here, which is what holds this at Medium confidence.
- **Suggested fix:** Return focus to the picker button whenever the palette closes, by either path, and either drop `aria-haspopup` or give it a value matching what the popup actually is.

## Summary

Findings by severity: Critical 0, High 0, Medium 1, Low 3 — four in total.

Findings by confidence: High 2, Medium 2, Low 0.

| Severity | High | Medium | Low |
| --- | --- | --- | --- |
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 0 | 1 | 0 |
| Low | 2 | 1 | 0 |
