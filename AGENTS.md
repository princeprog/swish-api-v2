# swish-api-v2 Agent Context

Read `../AGENTS.md` first for the full Basketball League OS product context.

This project is the separate NestJS API for Basketball League OS.

## Boundaries

- Do not add frontend routes or shadcn components here.
- Do not place API implementation inside `../swish-app`.
- Keep backend work organized by domain modules: admin, competition, scoring, public portal, and access control.

## Current State

This is currently a fresh Nest starter. Product-specific modules have not been implemented yet.

## Commands

```bash
pnpm install
pnpm run start:dev
pnpm run build
pnpm run test
pnpm run test:e2e
pnpm run lint
```

## Backend Priorities

- Centralized role and permission checks.
- Append-only scoring event log.
- Correction events instead of silent score edits.
- Finalized games as the source for official standings.
- Explainable tiebreakers and manual admin decisions for unresolved ties.
- Public read models that do not expose private or audit data.
