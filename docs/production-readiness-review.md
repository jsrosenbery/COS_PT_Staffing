# Final production-readiness review

Review date: 2026-07-22  
Reviewed baseline: `main` at `af0d9682e203c9851152c72b040597a688e65c1f`  
Recommendation: **staging-ready**

## Executive summary

The repository is ready for a controlled institutional staging pilot, but it is not yet evidence-backed for production. The core staffing lifecycle has deterministic domain logic, scoped authorization, versioned and frozen preferences, contractual-exception enforcement, optimistic concurrency, unique active assignments, server-authored audit events, frozen decision snapshots, formal migrations, shared production rate limiting, CI, and an operational runbook. No blocking application defect was found.

One narrowly scoped production bootstrap defect was fixed during this review: `npm run seed:logins` previously created demo faculty/chair/dean accounts even in production and could display generated credentials. Production now requires an explicitly configured administrator, rejects demo seeding, and suppresses the password from output.

Production promotion remains conditional on completing the manual staging scenarios below and resolving or formally accepting the high-priority risks: PostgreSQL TLS certificate verification, browser bearer-token storage, database-role/audit immutability, and validation of adopted legacy constraints. These are verified repository limitations; whether compensating hosting controls already address them is an assumption requiring deployment evidence.

## Verification performed

- Backend unit/domain/security suite: **81 passed, 0 failed, 8 skipped, 89 total** using `node --test --experimental-test-isolation=none`. The skips are the PostgreSQL integration cases because `TEST_DATABASE_URL` was not available locally.
- Frontend production build: **passed** with Vite 8.1.5; 21 modules transformed and production assets emitted to ignored `frontend/dist`.
- PostgreSQL coverage in CI: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), component `backend-test`, provisions PostgreSQL 17 and runs `npm test` for pull requests and pushes to `main`. The current review PR must pass that job before merge; local skips are not presented as PostgreSQL validation.
- Repository hygiene: the branch was created directly from the recorded `origin/main` commit. Root [`.gitignore`](../.gitignore) ignores dependency directories, build output, and environment files; no tracked `node_modules`, `dist`, private key, or `.env` file was found.
- Dependency audit limitation: a registry-backed `npm audit` was not run locally because this execution environment provides Node but not the npm CLI. Lockfile installation and the actual test/build commands are exercised by CI. This is an explicitly unresolved verification gap, not a claim that dependencies are vulnerability-free.

## Verified strengths

- **CI and branch controls:** [`AGENTS.md`](../AGENTS.md) records the required branch/PR discipline. [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) uses least-privilege `contents: read`, lockfile-backed `npm ci`, Node 24, separate fail-fast build/test jobs, and PostgreSQL 17.
- **Migration safety:** [`backend/migrations.js`](../backend/migrations.js), component `runMigrations`, orders numbered files, checks SHA-256 checksums, takes an advisory lock, applies each migration in a transaction, and records success only after the SQL succeeds. [`backend/server.js`](../backend/server.js) does not run migrations at startup.
- **Authentication and public surface:** [`backend/auth.js`](../backend/auth.js) stores hashes rather than raw session/invite/reset tokens. [`backend/security.js`](../backend/security.js), components `isPublicApiRequest`, `correlationId`, and `securityHeaders`, exposes only health, minimal terms, and intended authentication paths; rejects unsafe request IDs; and sets baseline browser security headers.
- **Authorization, division isolation, and ownership:** [`backend/permissions.js`](../backend/permissions.js) normalizes roles/divisions, requires explicit division scope, and derives faculty ownership from the authenticated employee ID. [`backend/test/authorizationIsolation.test.js`](../backend/test/authorizationIsolation.test.js) exercises omitted scope, multi-division access, indirect assignment scope, and faculty self-ownership.
- **Preference lifecycle:** [`backend/domain/preferenceSubmissionPolicy.js`](../backend/domain/preferenceSubmissionPolicy.js) and [`backend/routes/workflow.js`](../backend/routes/workflow.js), components `createPreferenceSubmission` and `freezeLatestSubmittedVersions`, preserve draft/submitted/superseded/frozen versions, reject duplicate rank/section data, lock freeze races, and allow explicit audited correction/reopening paths.
- **Allocation rules:** [`backend/domain/allocationAnalysis.js`](../backend/domain/allocationAnalysis.js) implements deterministic seniority ordering, missing-seniority outcomes, qualifications, one-assignment-per-pass behavior, pass-down, and configurable load/assignment limits without changing institutional policy data.
- **Chair/dean workflow:** [`backend/domain/chairDecision.js`](../backend/domain/chairDecision.js) separates recommendations from decisions and requires recognized contractual exceptions plus explanations. [`backend/routes/workflow.js`](../backend/routes/workflow.js) handles chair submission, dean return, resubmission, approval, stale-version rejection, and transactional assignment uniqueness.
- **Audit and history:** [`backend/audit.js`](../backend/audit.js) derives actor and validated request ID server-side. [`backend/domain/decisionExplanation.js`](../backend/domain/decisionExplanation.js) reads frozen snapshots. No generic client audit-append route exists.
- **Rate limiting:** [`backend/rateLimit.js`](../backend/rateLimit.js) provides memory and PostgreSQL stores, endpoint-specific namespaces, hashed key material, trusted-hop-aware IP handling, expiry, and fail-closed production store errors.
- **Operations:** [`docs/operations/deployment-runbook.md`](operations/deployment-runbook.md), [`docs/operations/staging-pilot-checklist.md`](operations/staging-pilot-checklist.md), and [`docs/operations/production-release-checklist.md`](operations/production-release-checklist.md) cover backup/restore, migration, bootstrap shutdown, email, CORS, health, smoke checks, rollback, and release evidence.

## Blocking findings

None verified.

## High-priority findings

### H1 — Database TLS does not authenticate the server certificate

- **Evidence / fact:** [`backend/db.js`](../backend/db.js), component `databaseSslConfig`, enables TLS with `rejectUnauthorized: false` whenever `DATABASE_SSL` is enabled or inferred from `DATABASE_URL`.
- **Consequence:** traffic is encrypted but a client cannot prove it reached the intended PostgreSQL server; a capable network attacker or DNS/routing compromise could impersonate the database endpoint.
- **Smallest remediation:** add a strict production mode that accepts a provider CA bundle or uses platform-verified TLS, default production to certificate verification, and reserve `DATABASE_SSL=false` for explicitly trusted local/service networks.
- **Assumption to verify:** a hosting provider may supply a private authenticated network that reduces this exposure; no such topology is committed in this repository.

### H2 — Browser sessions are readable by JavaScript

- **Evidence / fact:** [`frontend/src/apiClient.js`](../frontend/src/apiClient.js), components `getSessionToken` and `setSession`, stores bearer sessions in `sessionStorage`; [`docs/auth-production-hardening.md`](auth-production-hardening.md) already labels this as an interim posture.
- **Consequence:** any successful same-origin script injection can read and exfiltrate an active session. CSP reduces exposure but does not make JavaScript-readable bearer tokens equivalent to `HttpOnly` cookies.
- **Smallest remediation:** move named-user sessions to `Secure`, `HttpOnly`, `SameSite` cookies and add CSRF protection before broad production use. Keep the existing bearer flow only for an explicitly risk-accepted limited pilot.
- **Assumption to verify:** deployment headers may add a stronger nonce/hash CSP and monitoring; that configuration was not available in the repository.

### H3 — Audit immutability depends on external database privileges

- **Evidence / fact:** [`backend/migrations/0001_baseline.sql`](../backend/migrations/0001_baseline.sql), table `scope_audit_log`, has no database trigger or privilege policy preventing update/delete. [`backend/db.js`](../backend/db.js) uses one `DATABASE_URL` for normal writes, while migrations and runtime are not separated by code-level roles.
- **Consequence:** compromise or misuse of the runtime database credential could alter or erase audit evidence even though HTTP clients cannot append generic audit events.
- **Smallest remediation:** deploy with distinct migration-owner and runtime roles; grant runtime only required operations and make audit rows append-only through privileges or a reviewed trigger. Export/retain audit evidence outside the application database according to policy.
- **Assumption to verify:** the production provider may already enforce separate roles or immutable log export; repository configuration does not prove it.

### H4 — Legacy integrity constraints remain unvalidated until an operator completes remediation

- **Evidence / fact:** [`backend/migrations/0002_security_integrity_constraints.sql`](../backend/migrations/0002_security_integrity_constraints.sql) deliberately uses `NOT VALID`. New writes are checked, but pre-existing invalid rows remain possible. [`backend/scripts/data-integrity-report.js`](../backend/scripts/data-integrity-report.js) reports them; no later migration validates the constraints.
- **Consequence:** adopted production data can violate identifiers/status invariants and produce authorization, allocation, or reporting anomalies despite clean new writes.
- **Smallest remediation:** run and archive the strict integrity report, resolve only data-owner-approved exceptions, then add a separately reviewed migration containing `VALIDATE CONSTRAINT` statements.
- **Assumption to verify:** no actual legacy violation count was available because this review did not access production data.

## Medium-priority findings

### M1 — Health does not prove migration readiness

- **Evidence / fact:** [`backend/server.js`](../backend/server.js), `GET /api/health`, runs only `SELECT 1`.
- **Consequence:** an instance can report healthy while migrations are pending or required tables/columns are absent, allowing traffic to reach a partially deployable release.
- **Smallest remediation:** keep liveness simple, add a readiness check that verifies the latest migration identifier/checksum, and gate traffic promotion on readiness.
- **Assumption to verify:** the hosting platform may already run `npm run migrate:status` as a release gate; this is documented but not encoded in deployment configuration.

### M2 — Internal database errors are returned by many authenticated routes

- **Evidence / fact:** [`backend/routes/persistence.js`](../backend/routes/persistence.js) and [`backend/routes/workflow.js`](../backend/routes/workflow.js) contain multiple 500 responses using `error.message`; authentication routes more consistently use public errors.
- **Consequence:** authorized users may receive constraint names, SQL details, or internal state useful for reconnaissance, while error formats remain inconsistent.
- **Smallest remediation:** route unexpected failures through `logError` plus a stable correlation-ID response, retaining explicit 4xx domain messages.
- **Assumption to verify:** PostgreSQL error text varies by failure; no exploit was demonstrated in this review.

### M3 — A stale duplicate database module can bypass current TLS controls

- **Evidence / fact:** [`backend/db/db.js`](../backend/db/db.js) is a CommonJS duplicate that accepts `POSTGRES_URL` and always disables certificate verification. Repository search found no current import of it.
- **Consequence:** a future maintainer may import the wrong module and silently bypass the documented `DATABASE_SSL` policy.
- **Smallest remediation:** remove the unused duplicate in a dedicated cleanup or replace it with an explicit re-export of the canonical module.
- **Assumption to verify:** external tooling outside this repository might still import the path; confirm before deletion.

### M4 — Dependency security scanning is not automated

- **Evidence / fact:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) installs and tests locked dependencies but has no dependency-review, audit, or update workflow. [`backend/package.json`](../backend/package.json) still uses the Multer 1.x LTS line.
- **Consequence:** a build can pass while a newly disclosed dependency vulnerability remains unnoticed.
- **Smallest remediation:** enable GitHub dependency review/Dependabot and add a policy-calibrated audit job; upgrade Multer after compatibility tests rather than bundling it into this review.
- **Assumption to verify:** organization-level Dependabot may already be enabled; repository files do not show it.

### M5 — Accessibility has no automated regression gate

- **Evidence / fact:** the large workflow UI in [`frontend/src/pt-faculty-staffing-mvp.jsx`](../frontend/src/pt-faculty-staffing-mvp.jsx) uses many controls and visual status indicators, while [`frontend/package.json`](../frontend/package.json) has no frontend test or accessibility script. Source inspection found labels in key forms but cannot establish keyboard, focus, contrast, or screen-reader behavior.
- **Consequence:** an obvious keyboard/focus or announcement failure could block a faculty or reviewer during the short staffing window.
- **Smallest remediation:** complete the manual accessibility scenarios below, then add focused component/browser checks for login, preference ranking, chair override, dean return, and error focus.
- **Assumption to verify:** no automated browser or assistive-technology run was performed; this is a verification gap, not a confirmed WCAG violation.

## Low-priority findings

### L1 — Expired shared rate-limit rows require operational cleanup

- **Evidence / fact:** [`backend/migrations/0003_shared_auth_rate_limits.sql`](../backend/migrations/0003_shared_auth_rate_limits.sql) indexes `expires_at`; [`backend/rateLimit.js`](../backend/rateLimit.js) expires counters logically but provides no scheduled purge command.
- **Consequence:** the table can grow over repeated authentication traffic, although the ten-day pilot volume is unlikely to be material.
- **Smallest remediation:** document and schedule a bounded `DELETE WHERE expires_at < NOW()` maintenance task with monitoring.
- **Assumption to verify:** provider autovacuum/storage limits and expected authentication volume were not available.

### L2 — Operational logs are console-only and monitoring is platform-dependent

- **Evidence / fact:** [`backend/security.js`](../backend/security.js), `logError`, and [`backend/server.js`](../backend/server.js) write structured objects to console; alert and retention requirements exist only in documentation.
- **Consequence:** incident detection and correlation during concurrent staffing depend on correct platform log ingestion and alert setup.
- **Smallest remediation:** configure and exercise alerts for authentication failures, rate-limit-store errors, health failures, and migration failures during staging.
- **Assumption to verify:** no hosted logging configuration was supplied to the review.

### L3 — Allocation policy documentation retains obsolete “current implementation” caveats

- **Evidence / fact:** [`docs/allocation-model.md`](allocation-model.md), section `Current implementation gaps`, describes destructive current-state preferences and missing structured exception enforcement, while current migrations/routes implement versioned submissions and structured chair decisions.
- **Consequence:** operators and future developers may misunderstand the audited behavior or reopen already-remediated work.
- **Smallest remediation:** reconcile that section against the current workflow in a documentation-only follow-up, preserving genuine policy questions.
- **Assumption to verify:** some caveats may intentionally describe legacy `scope_preferences` compatibility behavior; policy ownership should decide what historical text remains.

## Manual staging scenarios still required

These scenarios are required before production and should retain screenshots/logs, request IDs, database evidence, and named sign-off:

1. Run all migrations and `migrate:status` against a restored production-shaped copy; run the strict integrity precheck and record every legacy exception.
2. Restore the pre-migration backup into a disposable database and verify row counts, migration state, representative snapshots, and login recovery.
3. Verify provider-authenticated PostgreSQL TLS, restricted network access, separate migration/runtime privileges, and audit retention/export.
4. Bootstrap exactly one named administrator in production mode, prove no demo accounts exist and no password appears in logs, then remove all seed variables.
5. Exercise named faculty, chair, dean, and administrator authentication; disable API-token bootstrap; test invitation/reset email origin, delivery, expiry, replay rejection, and session revocation.
6. Verify allowed and denied CORS origins, exact trusted-proxy hop behavior, shared rate limiting across restart/instances, and fail-closed behavior during a store outage.
7. Execute the complete two-division staffing lifecycle in [`docs/operations/staging-pilot-checklist.md`](operations/staging-pilot-checklist.md), including draft/correction/freeze/reopen, deterministic allocation, ambiguous/missing seniority, qualifications, pass/load limits, exception explanation, stale writes, dean return/resubmit/approve, frozen explanations, and server audit records.
8. Load/concurrency-test the approximately ten-day workflow with representative users: simultaneous faculty submissions, freeze/submission races, two-chair conflicts, stale clients, large imports, and database connection-pool saturation.
9. Test keyboard-only navigation, visible focus, logical focus after errors/dialogs, screen-reader labels/status announcements, zoom/reflow, contrast, and mobile-width workflow completion.
10. Verify the built frontend targets the intended backend, health/readiness gates traffic, dashboards/alerts are active, rollback ownership is present, and no test account, token, URL, or credential remains.

## Coverage of requested review areas

| Areas | Result and primary evidence |
| --- | --- |
| Repository/branch hygiene; Actions; build/tests | Verified controls and local results above; CI PostgreSQL result required on this PR. |
| Migrations; invariants; assignment uniqueness | Transactional/checksummed runner and partial unique index verified; legacy constraint validation remains H4. |
| Authentication; public endpoints; headers; rate limiting; secrets | Strong baseline verified in `auth.js`, `security.js`, `rateLimit.js`, environment docs; H1–H3 and M2 remain. |
| Authorization; division isolation; faculty ownership | Middleware, SQL scoping, and authorization tests verified. |
| Draft/submit/version/freeze/reopen/correction | Version tables, locks, policies, routes, and race tests verified. |
| Determinism; seniority; qualifications; pass/load limits | Domain tests and real-PostgreSQL lifecycle test cover required outcomes. |
| Recommendation/decision; exceptions; dean workflow | Separation, explanation requirements, return/resubmit/approve, and snapshots verified. |
| Optimistic concurrency; audit; history | Row locks/version checks, server audit creation, no generic append route, and frozen explanations verified. |
| Error handling; dependencies; maintainability | M2–M4 and L3 remain; no broad refactor recommended. |
| Accessibility/workflow; ten-day operations | No obvious build-blocking UI defect found by source/build review; M5 and the manual load/accessibility scenarios remain. |
| Backups, rollback, deployment | Documentation is explicit; execution evidence must be produced in staging. |

## Production launch recommendation

**Staging-ready.** Proceed with a controlled, synthetic-data staging pilot. Do not classify the system as production-ready until the PostgreSQL-backed CI job passes on the final review PR, all manual staging scenarios have named evidence, H1–H4 are remediated or formally risk-accepted with compensating controls, and the production release checklist is fully signed off. No finding supports bypassing the existing staffing governance or changing core staffing rules.
