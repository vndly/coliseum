## Project

Coliseum (Vite + Vue 3, TypeScript, Composition API with `<script setup>`, ESLint + @stylistic + type-aware typescript-eslint via @vue/eslint-config-typescript).

`src/` is layered, and the layers only ever talk downwards:

- `components/screens/` — the routed screens. `lobby_screen.vue` starts and joins matches; `match_screen.vue` owns the `<canvas>`, the scene's lifetime and the match client, and is the only place the network and the scene meet.
- `components/` — the shared presentational pieces. `die_face.vue` is the only one: a die face drawn with the same pip layout the real dice carry, used wherever the interface has to count something.
- `match/` — Firestore, as plain classes and functions. `match_client.ts` is one player's connection to one match; `match_state.ts` holds the stored shapes and reads them back out; `rules.ts` is the game itself, as pure functions over that state; `firebase.ts` initialises the app and signs in; `codes.ts` draws and normalises join codes.
- `scene/` — the Three.js scene, as plain classes. `dish_scene.ts` owns the renderer, camera, lighting and render loop; `dish.ts` and `table.ts` build the two objects; `dimensions.ts` holds every measurement and colour; `die_state.ts` holds the shapes a die crosses the network in, and the pip layout that both draws a die and reads the value off one.
- `assets/styles.css` — the global tokens and reset. Everything else is a scoped component style.
- `main.ts` creates the root `app.vue`, installs `router.ts`, and mounts.

## Reference Docs

- `docs/typescript.md` — style, naming, imports. Read when editing TypeScript files.

## Rules

- **After completing code changes**: Run `npm run lint:fix` and fix remaining errors, run `npm run build` (typechecks first) and fix any failures, then run `/delta-review` before responding.
- **No test suite**: This project has no tests by design. TypeScript and the type-aware lint rules are the safety net — do not weaken `strict` or `noUncheckedIndexedAccess`, and do not add `any` to silence an error.
- **Fonts**: Fonts come from Google Fonts, served by its CDN via a `<link>` in `index.html`. No font packages in `package.json` and no font files in the repo.
- **Images**: Import assets from `src/assets/` so Vite fingerprints them; nothing goes in `public/`.
- **TypeScript projects**: `tsconfig.json` only references `tsconfig.app.json` (browser, `src/`, extends `@vue/tsconfig/tsconfig.dom.json`) and `tsconfig.node.json` (`vite.config.ts`, extends `@tsconfig/node24`). An option the two bases don't already cover must be set in both.
- **Build output**: `npm run build` writes into `dist/`. Routing is history mode, so whatever serves the build needs a catch-all rewrite to `/index.html`.
- **3D scene**: Nothing under `src/scene/` may be reactive. Vue owns the canvas element and the scene object's lifetime; the scene owns everything inside it. Per-frame data must never pass through a `ref`.
- **Multiplayer**: The layers run `components` → `match` → `scene`. Nothing under `src/match/` may import Vue, and nothing under `src/scene/` may import from `src/match/` — the scene produces and consumes the network's shapes (`die_state.ts`) without knowing a network exists. A screen is what joins the two.
- **Match authority**: Every client is trusted; there is no server. The player whose turn it is simulates their own throw, and what they write when the dice stop is authoritative — every other player teleports their bodies onto it, which is what stops two simulations drifting apart over a match. `Die.teleport` is the one deliberate exception to the rule that only the body writes to the meshes; nothing else may write to a body from outside the scene.
- **Rules of play**: The whole ruleset lives in `src/match/rules.ts` as pure functions — add rules there, not in the client or the screen. A settled bowl is judged once, by whoever gets there first: the thrower does it as soon as their dice stop, and if they leave without managing it the next player judges it from their own simulation after a timeout. `MatchClient.submitVerdict` is that one write, and it is a transaction because more than one player can attempt it. It carries the whole outcome at once — the bowl, every hand, whose turn it is, and the winner — plus a `verdict` replay script every player animates from. `bowlVersion` still counts writes to the bowl and is what tells a client the verdict is new.
- **Hands and elimination**: A die in the bowl belongs to nobody, so hands are counts in `pools` rather than lists, and `players` stays write-once identity. A hand of zero *is* elimination and needs no flag: nothing in the game can take a hand off zero, since it only grows by its own player pairing dice, which needs their turn, which is skipped.
- **Firebase**: The web config lives in `src/match/firebase.ts` and is public by design — it is a set of identifiers, not a secret, and the security rules are the actual boundary. The project needs both Firestore created *and* the Anonymous sign-in provider enabled; without the second, every write fails with `auth/configuration-not-found`. Analytics is deliberately not initialised.
- **Scene units**: One world unit is one die width. Dice modelled at true metric scale are far below a physics engine's default tolerances, which is what makes small fast bodies jitter, sink and tunnel. Every measurement lives in `src/scene/dimensions.ts` — add new ones there rather than inline.
- **Three.js**: `three` ships no type declarations, so `@types/three` is a required devDependency and its version tracks `three`. Addons are imported from `three/addons/*` with the `.js` extension — the no-extension rule in `docs/typescript.md` applies to `@` alias imports, not to package subpaths.
- **Doc Maintenance**: After changes, check if `CLAUDE.md` and `docs/typescript.md` need updating.
