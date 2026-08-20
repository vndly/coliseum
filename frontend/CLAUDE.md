## Project

Coliseum (Vite + Vue 3, TypeScript, Composition API with `<script setup>`, ESLint + @stylistic + type-aware typescript-eslint via @vue/eslint-config-typescript).

`src/` is layered, and the layers only ever talk downwards:

- `components/screens/` — the routed screens. `lobby_screen.vue` starts and joins matches; `match_screen.vue` owns the `<canvas>`, the scene's lifetime and the match client, and is the only place the network and the scene meet.
- `components/` — the shared presentational pieces. `die_face.vue` is the only one: a die face drawn with the same pip layout the real dice carry, used wherever the interface has to count something.
- `match/` — Firestore, as plain classes and functions. `match_client.ts` is one player's connection to one match; `match_state.ts` holds the stored shapes and reads them back out; `rules.ts` is the game itself, as pure functions over that state; `firebase.ts` initialises the app and signs in; `codes.ts` draws and normalises join codes; `open_matches.ts` follows the matches the lobby offers a seat in.
- `scene/` — the Three.js scene, as plain classes. `dish_scene.ts` owns the renderer, camera, lighting and render loop; `dish.ts` and `table.ts` build the two objects; `dimensions.ts` holds every measurement and colour; `die_state.ts` holds the shapes a die crosses the network in, and the pip layout that both draws a die and reads the value off one.
- `assets/styles.css` — the global tokens and reset. Everything else is a scoped component style.
- `main.ts` creates the root `app.vue`, installs `router.ts`, and mounts.

## Layering

- **Multiplayer**: The layers run `components` → `match` → `scene`. Nothing under `src/match/` may import Vue, and nothing under `src/scene/` may import from `src/match/` — the scene produces and consumes the network's shapes (`die_state.ts`) without knowing a network exists. A screen is what joins the two.
- **3D scene**: Nothing under `src/scene/` may be reactive. Vue owns the canvas element and the scene object's lifetime; the scene owns everything inside it. Per-frame data must never pass through a `ref`.

## Reference Docs

- `docs/game.md` — match authority, the ruleset, the lobby, physics tuning. Read before editing `src/match/` or `src/scene/`.
- `docs/typescript.md` — style, naming, imports. Read when editing TypeScript files.

## Workflow

- **After completing code changes**: Run `npm run lint:fix` and fix remaining errors, run `npm run build` (typechecks first) and fix any failures, then run `/delta-review` before responding.
- **No test suite**: This project has no tests by design. TypeScript and the type-aware lint rules are the safety net — do not weaken `strict` or `noUncheckedIndexedAccess`, and do not add `any` to silence an error.
- **Doc Maintenance**: After changes, check if `CLAUDE.md`, `docs/game.md` and `docs/typescript.md` need updating. A rule that changes, or a new one, goes in the file that already holds its section: workflow, layering, tooling and deployment here, match and physics in `docs/game.md`.

## Tooling

- **TypeScript projects**: `tsconfig.json` only references `tsconfig.app.json` (browser, `src/`, extends `@vue/tsconfig/tsconfig.dom.json`) and `tsconfig.node.json` (`vite.config.ts`, extends `@tsconfig/node24`). An option the two bases don't already cover must be set in both.
- **Three.js**: `three` ships no type declarations, so `@types/three` is a required devDependency and its version tracks `three`. Addons are imported from `three/addons/*` with the `.js` extension — the no-extension rule in `docs/typescript.md` applies to `@` alias imports, not to package subpaths.
- **Fonts**: Fonts come from Google Fonts, served by its CDN via a `<link>` in `index.html`. No font packages in `package.json` and no font files in the repo.
- **Images**: Import assets from `src/assets/` so Vite fingerprints them; nothing goes in `public/`.

## Deployment

- **Build output**: `npm run build` writes into `../backend/public`, the directory Firebase Hosting serves, and empties it first. Routing is history mode, which relies on the catch-all rewrite in `../backend/firebase.json`. `npm run deploy` builds and then deploys that directory to the project's default Hosting site. Neither deploy script touches Firestore — both pass `--only hosting` — so an index added to `firestore.indexes.json` reaches the project only through `firebase deploy --only firestore:indexes`, run from `../backend`. A bare `firebase deploy` now carries the indexes along with the site, which it did not before the `firestore` block existed.
- **Firebase**: The web config lives in `src/match/firebase.ts` and is public by design — it is a set of identifiers, not a secret, and the security rules are the actual boundary. The project needs both Firestore created *and* the Anonymous sign-in provider enabled; without the second, every write fails with `auth/configuration-not-found`. Analytics is deliberately not initialised.
