# Veent HRIS — Claude Instructions

## Git commits

- **Never** add a `Co-Authored-By` line to any commit message.
- **Never** add a `Co-Author` trailer of any kind.
- Keep commit messages concise: subject line + optional body, no attribution footers.
- Do not commit `.env` — it is in `.gitignore`.

## Tech stack

- SvelteKit 2 + Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`)
- Prisma 5 + PostgreSQL 16 (Docker `veent_wifiportal-db-1`, root/mysecretpassword, db=local)
- Lucia v3 + `@lucia-auth/adapter-prisma` for session auth
- Tailwind CSS v3 with HSL design tokens (`src/app.css`)
- pnpm 10 as package manager — use `pnpm` not `npm`

## Key constraints

- No Redis — removed. Dashboard and reports query DB directly.
- Prisma `Decimal` fields must not be returned raw to the client — the transport hook in `src/hooks.ts` handles serialization globally.
- Prisma enums: `EmploymentType` values are `FULL_TIME`, `PART_TIME`, `CONTRACTUAL`, `PROBATIONARY` (not `REGULAR`). `EmploymentStatus` values are `ACTIVE`, `ON_LEAVE`, `OFFBOARDED` only.
- `{@const}` must be an immediate child of a block tag (`{#if}`, `{#each}`, `{#snippet}`, etc.) — never inside a plain HTML element.
