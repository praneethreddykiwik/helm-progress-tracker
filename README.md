# Helm Track

A responsive issue-reporting workspace with real persistence, invitation-based authentication, private screenshots, an audited retest lifecycle, and n8n notification integration.

## Run locally

Requires Node.js 22.12+ (tested with 22.23.1).

```sh
npm ci
cp .env.example .env
npm run seed
npm run dev
```

Open http://localhost:5173. Local demo accounts:

| Role | Email | Password |
|---|---|---|
| Administrator | admin@helm.local | Helm-local-2026! |
| Tester | tester@helm.local | Helm-local-2026! |
| Other tester | other@helm.local | Helm-local-2026! |

Demo seeding is refused in production. SQLite data and protected screenshots persist in `.data/`. Seed never overwrites an existing database. This is a real local backend, not a browser mock. Local notification records stay queued until n8n is configured. Demo addresses cannot receive real mail.

```sh
npm test
npm run build
npm run worker
```

The development UI proxies `/api` to port 3001. In production, the server serves the compiled frontend and API together. Configure `APP_URL` to exactly match the browser's origin; the development default is `http://localhost:5173`.

## Architecture

- React + Vite + TypeScript frontend, with bundled fonts and responsive views.
- Express server; Zod request validation; Knex migrations.
- Supabase Postgres (or standard PostgreSQL) in production; SQLite locally.
- Server-owned invitation auth, scrypt password hashes, hashed opaque sessions, HttpOnly/SameSite cookies. Supabase Auth is **not** used. Do not configure frontend Supabase API keys.
- Supabase's S3-compatible **private** storage, or private local storage in development.
- Transactional outbox stores each business event and notification alongside the issue change.
- Separate worker dispatches expiring, delivery-scoped capabilities to n8n. n8n claims a current notification, sends through Resend with a stable idempotency key, then reports the result.
- n8n schedules reminder/digest eligibility checks; business rules remain on the server.

## What is included

Admin/tester dashboards, search, filters, pagination, Kanban, project creation and invitations, tester enable/disable, public comments, private internal notes, status history, approval summaries, retest cycles, reopen/verify controls, severity separate from priority, assignments, duplicate/archive handling, private image validation/storage, signed attachment viewing, notification logs, retries, timezone-aware digests, two reminders maximum per cycle.

See [deployment setup](docs/SETUP.md), [n8n setup](docs/N8N.md), [security and reliability](docs/SECURITY.md), and [verification record](docs/VERIFICATION.md).

## Workflow files

- `n8n/notification-delivery.json`: A–D share a single reliable delivery pipeline; per-event email content comes from the application's transactional outbox.
- `n8n/reminders-and-digest.json`: E–F scheduled eligibility checks.
- `n8n/contract-checks.json`: safe validation tests; no HTTP calls or emails.

Regenerate exports after editing the source helpers:

```sh
node --import tsx scripts/generate-workflows.ts
```

Exports contain no real secrets and start inactive. Production origins are intentionally blank and fail closed until configured. Live services are not declared tested merely because JSON imports successfully.
