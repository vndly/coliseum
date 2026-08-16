# TypeScript Rules

## Style

- Do not use semicolons
- One class per file
- Unused parameters: use `_`, `__`, `___`, etc.

## Naming

- Files: `snake_case`
- Classes, interfaces, type aliases: `PascalCase`
- Functions: `camelCase`
- Variables: full descriptive names, avoid abbreviations
  - Allowed: `i`, `j` (loop counters), `x`, `y` (coordinates), `dx`, `dy` (deltas), `ctx` (canvas context)
  - Avoid: `p` (player), `u` (unit), `el` (element), `m` (missile), etc.

## Types

- `strict` and `noUncheckedIndexedAccess` are on and stay on. Do not add `any` to silence an error — this project has no test suite, so the type checker and the type-aware lint rules are the only automated safety net.
- Indexing a `Record` or array yields `T | undefined`. Handle the miss (`?? fallback`) rather than asserting it away with `!`.
- Use `import type` for type-only imports (enforced by `@typescript-eslint/consistent-type-imports` and required by `verbatimModuleSyntax`).

## Imports

Always use the `@` path alias (mapped to `src/`). No relative paths (`./`, `../`). No file extensions.

## Getters

Prefer getters over methods for parameterless functions that only read instance state and return a computed value (no side effects).

## Comment Conventions

**Class Level** — JSDoc block describing purpose:

```typescript
/**
 * Brief description of class purpose.
 * Additional context about its role in the architecture.
 */
class ClassName {
```

**Function Level** — JSDoc with parameters and return description (no types; TypeScript already declares them):

```typescript
/**
 * Brief description of what the method does.
 * @param paramName - Description
 * @returns Description
 */
methodName(paramName: string): number {
```

**Field Level** — Inline end-of-line comment on first declaration:

```typescript
this.x = 0; // Current X position
this.speed = config.speed; // Movement speed in units/second
```

**Code Block Level** — Plain comments for complex logic:

```typescript
// Interpolate toward the authoritative position
```
