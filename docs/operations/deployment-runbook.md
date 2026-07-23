# Controlled deployment runbook

This runbook deploys **SHERMAN — Seniority & Hiring Eligibility Ranking Management for Academic Needs**, the College's part-time faculty staffing application.

Use this sequence for staging first and production only after staging approval. Record the operator, release commit, database target, backup identifier, timestamps, and outcomes in the institution's change record.

## 1. Preflight and backup

1. Confirm the release commit is merged into `main` and its CI backend and frontend jobs passed.
2. Review [environment configuration](environment-reference.md). Confirm the frontend and backend belong to the same environment and no test credentials are present.
3. Identify the release operator, database owner, rollback owner, and decision authority.
4. Stop scheduled imports and other nonessential writes during the migration window.
5. Create a provider-native, transactionally consistent backup or snapshot of the target PostgreSQL database. Record its identifier and retention expiration.
6. Verify restore permissions and perform a restore drill into a separate disposable database before production release. A backup is not considered verified merely because creation reported success.

## 2. Install, inspect, and migrate

Use the exact commit being deployed:

```sh
cd backend
npm ci
npm run db:integrity-report
npm run db:integrity-precheck
npm run migrate:status
npm run migrate
npm run migrate:status
```

The strict integrity precheck must be reviewed; do not guess corrections for institutional identifiers or statuses. The migration command takes an advisory lock, applies each pending migration transactionally, and records its identifier, filename, checksum, and applied time. It stops on failure. Never edit migration history manually or modify an applied migration.

If migration fails, do not deploy application code. Preserve logs, determine whether PostgreSQL rolled back the failed transaction, confirm status, and obtain database-owner approval before retrying.

## 3. Authentication bootstrap

Preferred path: use `npm run seed:logins` once with securely supplied `ADMIN_*` values to create a named administrator. Do not create demo users in production.

With `NODE_ENV=production`, the command requires `ADMIN_EMAIL` and `ADMIN_PASSWORD`, seeds only that administrator, rejects `SEED_DEMO_USERS=true`, and does not print the password. Demo faculty/chair/dean identities remain available for local development only.

If API-token bootstrap is institutionally approved:

1. Generate and securely store a strong random `API_TOKEN`.
2. Set `API_TOKEN_AUTH_ENABLED=true` only for the bootstrap window and restart the backend.
3. Create or verify a named administrator account and test its login.
4. Set `API_TOKEN_AUTH_ENABLED=false`, remove/rotate `API_TOKEN`, and restart again.
5. Verify API-token requests are rejected and the named administrator still works.
6. Build the normal frontend with `VITE_API_TOKEN_AUTH_ENABLED=false`.

Never leave bootstrap access enabled as an emergency convenience. Recovery enablement requires a new approved change window.

## 4. Email and CORS verification

For SendGrid, verify the sender identity, least-privilege key, delivery to approved staging recipients, invitation link origin, reset link origin, and absence of bearer URLs in API responses. Keep `ALLOW_TOKEN_URLS_IN_RESPONSES=false`.

Set `CORS_ORIGIN` to exact approved frontend origins. Test an allowed browser request and a request from an unapproved origin. Do not use wildcard CORS with authenticated endpoints.

## 5. Start and verify services

Deploy the backend only after migrations succeed. `npm start` does not run migrations. Verify:

```sh
curl --fail --show-error https://backend.example.invalid/api/health
```

Expected response is HTTP 200 with `{"ok":true}`. A failure indicates the service or database is unavailable and must block traffic promotion.

Deploy the frontend built with the intended `VITE_API_BASE_URL`. In browser developer tools, confirm API requests go only to the intended backend and CORS succeeds.

## Logging, audit, and correlation

The backend returns an effective `X-Request-ID` and includes validated request identifiers in structured error/audit context. Supply only identifiers matching the documented conservative format; invalid values are replaced. Capture application stdout/stderr in the hosting platform, restrict log access, set institutional retention, and alert on repeated authentication failures, `RATE_LIMIT_UNAVAILABLE`, migration failures, and health-check failures.

Application logs are operational evidence, not a replacement for `scope_audit_log`. During smoke testing, verify audit events identify the authenticated actor, division, term, staffing unit, action, and server-controlled request ID where applicable. Never log passwords, API tokens, sessions, invitation tokens, reset tokens, or database URLs.

## Rollback

1. Stop traffic promotion and pause writes. Name the rollback decision-maker and operator.
2. If application code is incompatible but migrations are backward-compatible, redeploy the previously approved commit and repeat health/smoke checks.
3. There is no automatic down-migration command. Prefer an approved forward corrective migration.
4. If database restoration is required, stop all application instances and writers, preserve the failed database for investigation, restore the verified pre-migration backup into the target according to provider procedure, and validate migration status and row counts before restarting.
5. Rebuild/redeploy the previous frontend if its API contract or backend URL changed.
6. Record data-loss boundaries, incident timeline, restored backup identifier, verification results, and authorization to reopen traffic.

Do not restore a database while application instances can still write to it, and do not combine a newer database with application code that has not been compatibility-reviewed.
