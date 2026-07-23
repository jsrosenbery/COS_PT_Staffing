# Staging pilot verification checklist

Use synthetic or specifically approved staging data. Record evidence and the responsible person for every item; do not mark an item complete based on assumption.

## Platform and data preparation

- [ ] Create a dedicated staging PostgreSQL database with restricted network access, encryption in transit, backups, monitoring, and credentials distinct from production and development.
- [ ] Configure backend staging variables using [the environment reference](environment-reference.md), including `NODE_ENV=production`, the staging URLs, `AUTH_DISABLED=false`, `RATE_LIMIT_STORE=postgres`, and appropriate `DATABASE_SSL`.
- [ ] Create and verify a database backup/restore point before migration.
- [ ] Run `npm ci`, `npm run db:integrity-report`, `npm run db:integrity-precheck`, `npm run migrate`, and `npm run migrate:status`; attach output showing all migrations applied.
- [ ] Restore the backup into a separate disposable database, run `npm run migrate:status`, and verify representative row counts. Delete the disposable restore only after evidence is retained.

## Identity and security

- [ ] Bootstrap one named administrator with securely supplied `ADMIN_*` variables or a time-limited approved API token.
- [ ] Sign in as that administrator, then set `API_TOKEN_AUTH_ENABLED=false`, remove/rotate `API_TOKEN`, restart the backend, and prove API-token access fails.
- [ ] Create named chair, dean, and faculty accounts through the normal invitation/account workflow. Verify invitations and password resets use the staging frontend origin.
- [ ] Assign the chair and dean only their approved divisions. Confirm an ordinary faculty account can manage only its own preferences.
- [ ] Attempt an authenticated cross-division read and mutation and retain the expected `403` evidence.
- [ ] Confirm `ALLOW_TOKEN_URLS_IN_RESPONSES=false`, `AUTH_DISABLED=false`, and `VITE_API_TOKEN_AUTH_ENABLED=false`.

## Representative staffing lifecycle

- [ ] Create/import a staging term and representative divisions, faculty seniority/qualification data, sections, and staffing units. Use no production employee data unless explicitly approved.
- [ ] Open a preference window and verify its division, opening state, and deadline.
- [ ] Save a faculty draft, submit ranked preferences, and resubmit while the window permits it.
- [ ] Freeze/close the window and prove ordinary faculty can no longer alter the frozen submission.
- [ ] Run allocation analysis twice and verify deterministic results, seniority order, qualifications, pass-down, assignment/load limits, missing-seniority treatment, and division isolation.
- [ ] As chair, accept one recommendation and create one approved contractual override with the required written explanation.
- [ ] Finalize/submit chair staffing for dean review.
- [ ] As dean, return staffing with a revision reason; as chair, revise and resubmit; as dean, approve.
- [ ] Retrieve historical decision explanations after changing a current nonhistorical fixture and verify explanations still use frozen decision/recommendation snapshots.
- [ ] Review audit records for preference, freeze, decision, submission, return, revision, and approval actions. Verify named actors and correlation/request IDs; confirm no generic client audit append is available.

## Services and release evidence

- [ ] Verify backend `/api/health` returns HTTP 200 and the database remains healthy during the pilot.
- [ ] With an ephemeral scoped chair/dean session, run the read-only smoke script and retain its output:

  ```sh
  cd backend
  STAGING_API_BASE_URL=https://staging-api.example.invalid/api \
  STAGING_SESSION_TOKEN='<ephemeral-session-token>' \
  STAGING_TERM_CODE='<staging-term>' \
  STAGING_ALLOWED_DIVISION='<allowed-division>' \
  STAGING_FORBIDDEN_DIVISION='<different-division>' \
  npm run staging:verify
  ```

  Unset the session token afterward. The script must report health, minimal public terms, named session, allowed division read, and cross-division `403` as passing.
- [ ] Verify rate limiting persists across a backend restart or multiple instances; a store outage must fail protected authentication requests closed rather than silently disabling protection.
- [ ] Verify Brevo or SendGrid delivery, sender, invite/reset links, and suppression of tokens in API responses, or record that email is intentionally console-only for an isolated pilot.
- [ ] Verify allowed CORS succeeds and an unapproved origin fails.
- [ ] Verify the production-candidate frontend build's `VITE_API_BASE_URL` points to the intended staging backend before pilot testing; repeat with the intended production backend before release.
- [ ] Run the documented smoke test and attach results, relevant request IDs, CI run, frontend build output, migration status, and backup/restore evidence.
- [ ] Remove all demo/test accounts, seed passwords, temporary bootstrap credentials, uploaded test files, and disposable restore databases. Confirm no test credentials remain in hosting variables or secret stores.
