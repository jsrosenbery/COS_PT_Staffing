# Repeatable two-division pilot

The isolated pilot exercises synthetic Science and Arts data. It complements the hosted [staging checklist](staging-pilot-checklist.md); it does not certify institutional policy, real email delivery, or a production backup/restore procedure.

## Run it

Install dependencies with `npm ci` in both backend and frontend. Use an expendable local PostgreSQL database and set `TEST_DATABASE_URL` explicitly. The browser harness rejects non-loopback database hosts, creates a unique schema, and binds its backend to `127.0.0.1:4317`. It does not reuse `DATABASE_URL` or production credentials. The frontend production build points to that loopback backend on port 4173, with bootstrap-token access disabled. Email is console-only and fixtures contain no real people.

```sh
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/scope_test
cd backend
npm test
cd ../frontend
npx playwright install chromium
npm run test:browser
```

On Linux CI, install Chromium system dependencies with `npx playwright install --with-deps chromium`. On PowerShell, set the variable with `$env:TEST_DATABASE_URL='postgres://postgres:postgres@localhost:5432/scope_test'`.

Without `TEST_DATABASE_URL`, local browser tests run only the public-form checks using synthetic HTTP responses and explicitly skip the authenticated tests. CI requires the database and fails rather than silently skipping those checks. The browser build overwrites `frontend/dist`; run the normal production build with the intended production environment before deploying.

## Coverage and evidence

- PostgreSQL lifecycle tests use actual password login, persisted sessions, and normal route authorization for named admin, chair, dean, and faculty actors. Each division independently saves drafts, submits/resubmits, freezes preferences, records decisions, submits for dean review, returns for revision, revises, and approves. Checks also cover cross-division denials, deterministic allocation, seniority and qualification rules, concurrent writes, historical snapshots, and named audit actors.
- Browser tests sign in as all seven pilot accounts with real authentication and verify failed-logout cleanup. They check accessible names and automated WCAG A/AA rules, and verify that the tested mobile views have no page-wide horizontal scrolling. Tables remain independently scrollable by keyboard.
- Browser staffing cycles add and reorder preferences with keyboard controls, save and submit them, exercise chair confirmation and submission, cancel a dean return prompt, and approve assignments. The freeze step uses the authenticated API because the UI has no dedicated freeze control. Actual dean return/revision/resubmission is covered by the PostgreSQL lifecycle suite.
- Public entry points cover login/account request/password help, invitation activation, and reset forms at 1440, 390, and 320 pixels in both themes. Public-form network responses are synthetic. Keyboard checks cover login failure announcements, persistent labels, required fields, and focus transfer to password help.

CI retains `browser-pilot-evidence` for 14 days: HTML report, screenshots, and failure traces. These artifacts contain only synthetic fixture data and disposable session credentials. Schema cleanup runs on normal harness shutdown; the entire CI database service is disposable.

Automated axe checks are not a complete accessibility audit. Screen-reader testing, physical mobile devices, additional browsers, all dark-mode authenticated states, and uncommon dialogs remain manual follow-up. The browser tests do not send actual invitations or reset mail or complete password changes.

## Production checkpoint, September 29, 2026

Read-only checks after PR #106 merged returned `ok: true` from both `/api/health` and `/api/readiness`, with commit `943a4c4aab10488f39eed21ac3d1c6f5f5078f54` and `migrationCount: 12`. This confirms backend revision and migration readiness at that moment. Backup restoration, restricted database privileges, and real provider delivery still require hosted operational evidence.
