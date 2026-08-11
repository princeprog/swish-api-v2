# Division Compliance Implementation Plan

> **For agentic workers:** Use the subagent-driven workflow and review each task before continuing.

**Goal:** Add team-level division requirements, private Cloudinary evidence submissions, organizer review, team clearance, and game-start enforcement.

**Architecture:** Compliance is a separate NestJS domain from roster and scoring. PostgreSQL stores immutable submission history and a transactional clearance projection. Cloudinary stores private evidence behind server-issued authenticated delivery URLs.

**Tech Stack:** NestJS 11, Kysely 0.29, PostgreSQL, pnpm, Next.js 16, React Query, Cloudinary Upload API.

## Global Constraints

- Requirements apply to teams, not individual players, in this release.
- Existing divisions remain unaffected until an organizer publishes a requirement set.
- Teams may be scheduled while pending; `game.start` is blocked unless both teams are cleared or an active waiver satisfies the missing item.
- Supported response types are `file`, `short_text`, `long_text`, `url`, and `acknowledgement`.
- Files are private, limited to PDF/JPEG/PNG, 10 MB per file, and five files per file requirement.
- File upload uses Cloudinary with signed server-side upload parameters; no public URLs or client secrets.
- All reviewer notes, waivers, file metadata, and submission history remain private.
- User-facing messages must be plain language and explain the next action.
- API and app remain separate repositories.
- Every task ends with focused tests and a separate commit.

## Tasks

### Task 1: Database schema and generated types

Add a reversible Kysely migration for division compliance settings, requirements, team submissions, immutable attempts, private file metadata, events, scan jobs, and clearance projections. Add indexes, check constraints, and migration regression tests. Apply the migration and regenerate `src/database/db.d.ts`.

### Task 2: Compliance domain API

Create a focused compliance module with DTOs, policy functions, requirement configuration, publish/archive behavior, team draft/submission lifecycle, reviewer decisions, waivers, history, pagination, authorization, and transactional clearance recalculation.

### Task 3: Cloudinary evidence storage

Add a Cloudinary adapter with signed upload parameters, completion verification, private/authenticated delivery URLs, MIME/size/checksum policy, status transitions, and a scan-job abstraction. Keep scanning provider-agnostic; reject unverified files and provide retryable state.

### Task 4: Notifications and scoring gate

Extend existing notification events and reminder jobs for compliance. Enforce clearance in the scoring `game.start` transaction with stable internal error code and safe user-facing text. Add regression tests for concurrency and authorization.

### Task 5: Organizer frontend

Add typed services/hooks, division requirement configuration and publish flow, team review queue, item review history, file preview, waiver/reopen actions, responsive states, accessibility, and clear confirmation/error copy.

### Task 6: Team-manager frontend and integration verification

Add manager navigation and requirements workspace with all response types, draft saving, Cloudinary upload progress, scan/retry states, submission history, clearance summary, notifications, responsive layouts, and end-to-end verification across API and app.
