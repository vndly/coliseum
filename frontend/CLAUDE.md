## Project

Coliseum (Vite + Vue 3, TypeScript, Composition API with `<script setup>`, ESLint + @stylistic + type-aware typescript-eslint via @vue/eslint-config-typescript).

`src/` is layered, and the layers only ever talk downwards:

- `components/screens/` — the routed screens. `lobby_screen.vue` starts and joins matches; `match_screen.vue` owns the `<canvas>`, the scene's lifetime and the match client, and is the only place the network and the scene meet.
- `components/` — the shared presentational pieces. `die_face.vue` is the only one: a die face drawn with the same pip layout the real dice carry, used wherever the interface has to count something.
- `match/` — Firestore, as plain classes and functions. `match_client.ts` is one player's connection to one match; `match_state.ts` holds the stored shapes and reads them back out; `rules.ts` is the game itself, as pure functions over that state; `firebase.ts` initialises the app and signs in; `codes.ts` draws and normalises join codes; `open_matches.ts` follows the matches the lobby offers a seat in.
- `scene/` — the Three.js scene, as plain classes. `dish_scene.ts` owns the renderer, camera, lighting and render loop; `dish.ts` and `table.ts` build the two objects; `dimensions.ts` holds every measurement and colour; `die_state.ts` holds the shapes a die crosses the network in, and the pip layout that both draws a die and reads the value off one.
- `assets/styles.css` — the global tokens and reset. Everything else is a scoped component style.
- `main.ts` creates the root `app.vue`, installs `router.ts`, and mounts.

## Reference Docs

- `docs/rules.md` — the rules this project works under: tooling, layering, match authority, physics, deployment. Read before making changes. If a change alters one of those rules, or adds one, update that file in the same change — it is the only place they live.
- `docs/typescript.md` — style, naming, imports. Read when editing TypeScript files.
