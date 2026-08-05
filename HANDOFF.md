# Canon web — handoff (get started → sources empty state)

## Deps

All installed. `web/package.json` is authoritative; `npm install` in `web/` is
enough. Check the current App Router + Tailwind v4 APIs before extending — per
AGENTS.md, do not write those from memory. The Next.js docs for the installed
version ship at `web/node_modules/next/dist/docs/`.

Path alias `@/*` → `web/*` in `web/tsconfig.json`.

`(console)` is a real route group on disk — the parentheses survived; the
earlier note claiming this filesystem strips them was wrong.

## What is here

| Route | File | Access | Wireframe |
|---|---|---|---|
| `/` | `app/page.tsx` | public | landing |
| `/sign-in` | `app/sign-in/[[...sign-in]]/page.tsx` | public | — |
| `/sign-up` | `app/sign-up/[[...sign-up]]/page.tsx` | public | — |
| `/get-started` | `app/get-started/page.tsx` | session | phase 0 |
| `/sources` | `app/(console)/sources/page.tsx` | session | 1b |

Server Components by default. The only client boundaries are the three `motion`
components (`get-started-hero`, `step-list`, `sources-empty-state`) and
`nav-rail` (needs `usePathname`).

## Auth

Clerk, protected-first: `proxy.ts` (Next 16's name for `middleware.ts`) makes
everything except the three public routes above require a session. An earlier
note here claimed AGENTS.md bars an auth layer — **it does not**; that clause was
never in AGENTS.md.

Two things to know before touching it:

- **The reason is the audit trail, not multi-tenancy.** `audit_log.actor` and
  `resolutions.reviewedBy` answer "who approved this?", so identity must be
  server-derived. `lib/server/auth.ts` is the only source; `reviewActionSchema`
  deliberately has no `reviewedBy` field, and it must stay that way.
- **Clerk's defaults are chromatic.** `lib/clerk-appearance.ts` maps every
  colour variable onto the gray scale — including `colorDanger`, which is ink,
  not red. It is applied once on `ClerkProvider`. A Clerk component rendered
  outside that provider would be the only hue in the app.

Signing in makes `/` dynamic rather than static: `clerkMiddleware` runs on every
matched route. That is inherent to Clerk on Next, not a misconfiguration.

Wireframes moved to `docs/wireframes/` — they were in `public/`, where Next
would have served them.

## Database

Applied. All 8 tables exist in Supabase; `npm run db:generate` reports no drift.
Two migrations, and the second is not optional — read the comment at the top of
`drizzle/0001_lock_down_data_api.sql` before adding a table, because Supabase
re-opens that hole for every new one unless the default privileges hold.

Two connection strings, same credential, different ports: `DATABASE_URL` is the
transaction pooler (6543, no prepared statements — hence `prepare: false`),
`MIGRATION_DATABASE_URL` is session mode (5432) because drizzle-kit needs them.

## Not built yet
- `/sources/new` — wireframe 1c. Both empty-state buttons link there.
- `lib/format.ts` — AGENTS.md lists it for diff-view value formatting. Nothing
  needs it until the conflict queue exists.

## Glassmorphism — where the line is
AGENTS.md § Design System forbids shadows, gradients and glows *on surfaces*.
Glass is therefore scoped to **floating chrome only**: the 240px rail veil, the
sticky page header, and the onboarding/empty-state panels. It is never applied
to a data surface — `source-table.tsx` is opaque, square, hairlines only, and
the conflict diff row must stay that way too.

It stays achromatic: translucent `--g-0`, one hairline border, no tint, no
gradient. It blurs against `field-grid` — a 40px `--g-300` hairline grid, not a
colour wash, so there is something to see through without introducing a hue.

Four utilities in `styles/tokens.css` carry the whole treatment: `glass`,
`glass-strong`, `glass-veil`, `field-grid`. Delete them and the console returns
to spec; nothing else depends on them.
