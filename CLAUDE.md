## Project

Coliseum (Vite + Vue 3, TypeScript, Composition API with `<script setup>`, ESLint + @stylistic + type-aware typescript-eslint via @vue/eslint-config-typescript).

`src/` is layered, and the layers only ever talk downwards:

- `components/screens/` — the routed screens. `home_screen.vue` is currently the only one, and it is blank.
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
- **Doc Maintenance**: After changes, check if `CLAUDE.md` and `docs/typescript.md` need updating.
