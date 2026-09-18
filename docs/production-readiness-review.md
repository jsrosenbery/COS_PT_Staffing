# Final production-readiness review

Review date: 2026-09-18
Reviewed baseline: `main` at `fa264f9` with the remediation branch applied
Recommendation: **production-ready with conditions**

> This document has been refreshed after the production-readiness remediation. Earlier findings concerning division scope, raw database errors, TLS verification defaults, browser token persistence, audit immutability, legacy constraint validation, migration-aware readiness, CSV formulas, and dependency scanning are now addressed in code. Production promotion still requires the PostgreSQL-backed CI suite, a restored-data migration rehearsal, provider TLS validation, and the manual staging scenarios below.

## Executive summary

The repository is ready for a controlled institutional staging pilot, but it is not yet evidence-backed for production. The core staffing lifecycle has deterministic domain logic, scoped authorization, versioned and frozen preferences, contractual-exception enforcement, optimistic concurrency, unique active assignments, server-authored audit events, frozen decision snapshots, formal migrations, shared production rate limiting, CI, and an operational runbook. No blocking application defect was found.

One narrowly scoped production bootstrap defect was fixed during this review: `npm run seed:logins` previously created demo faculty/chair/dean accounts even in production and could display generated credentials. Production now requires an explicitly configured administrator, rejects demo seeding, and suppresses the password from output.

Production promotion remains conditional on completing the manual staging scenarios below. Authentication credentials are now memory-only in the browser and therefore require users to sign in again after a page reload; this deliberately trades persistence for reduced token exposure until an institutionally reviewed HttpOnly-cookie deployment is introduced.

## Verification performed

- Backend and frontend command results must be taken from the current remediation pull request and CI run; historical counts have intentionally been removed from this living review.
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
- **Allocation rules:** [`backend/domain/allocationAnalysis.js`](../backend/domain/allocationAnalysis.js) implements deterministic seniority ordering, missing-seniority outcomes, qualifications, seniority-first slate filling, pass-down, and configurable one-assignment-per-pass/load/assignment limits without changing institutional policy data.
- **Chair/dean workflow:** [`backend/domain/chairDecision.js`](../backend/domain/chairDecision.js) separates recommendations from decisions and requires recognized contractual exceptions plus explanations. [`backend/routes/workflow.js`](../backend/routes/workflow.js) handles chair submission, dean return, resubmission, approval, stale-version rejection, and transactional assignment uniqueness.
- **Audit and history:** [`backend/audit.js`](../backend/audit.js) derives actor and validated request ID server-side. [`backend/domain/decisionExplanation.js`](../backend/domain/decisionExplanation.js) reads frozen snapshots. No generic client audit-append route exists.
- **Rate limiting:** [`backend/rateLimit.js`](../backend/rateLimit.js) provides memory and PostgreSQL stores, endpoint-specific namespaces, hashed key material, trusted-hop-aware IP handling, expiry, and fail-closed production store errors.
- **Operations:** [`docs/operations/deployment-runbook.md`](operations/deployment-runbook.md), [`docs/operations/staging-pilot-checklist.md`](operations/staging-pilot-checklist.md), and [`docs/operations/production-release-checklist.md`](operations/production-release-checklist.md) cover backup/restore, migration, bootstrap shutdown, email, CORS, health, smoke checks, rollback, and release evidence.

## Blocking findings

None verified.

## Remediated findings

- Database TLS now verifies the server certificate by default. `DATABASE_SSL_REJECT_UNAUTHORIZED=false` is an explicit, documented compatibility exception rather than the default.
- Browser session and bootstrap bearer credentials are memory-only and are cleared on reload instead of being persisted in web storage.
- Migration `0009_protect_audit_history.sql` makes audit rows append-only with a database trigger.
- Migration `0010_validate_integrity_constraints.sql` validates adopted constraints after the mandatory integrity precheck and stops without destructive cleanup if legacy data is invalid.
- `/api/readiness` verifies database access and migration currency separately from liveness.
- Unexpected route failures use logged internal details and public correlation-ID responses.
- The stale duplicate database module was removed.
- CI performs production-dependency audits, frontend utility tests, and Dependabot monitors npm and GitHub Actions dependencies.

## Medium-priority findings

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
| Migrations; invariants; assignment uniqueness | Transactional/checksummed runner, validated constraints, append-only audit trigger, and partial unique index verified; restored-data rehearsal remains required. |
| Authentication; public endpoints; headers; rate limiting; secrets | Strong baseline verified in `auth.js`, `security.js`, `rateLimit.js`, environment docs, strict TLS defaults, and memory-only browser credentials. |
| Authorization; division isolation; faculty ownership | Middleware, SQL scoping, and authorization tests verified. |
| Draft/submit/version/freeze/reopen/correction | Version tables, locks, policies, routes, and race tests verified. |
| Determinism; seniority; qualifications; pass/load limits | Domain tests and real-PostgreSQL lifecycle test cover required outcomes. |
| Recommendation/decision; exceptions; dean workflow | Separation, explanation requirements, return/resubmit/approve, and snapshots verified. |
| Optimistic concurrency; audit; history | Row locks/version checks, server audit creation, no generic append route, and frozen explanations verified. |
| Error handling; dependencies; maintainability | Correlation-ID errors and automated dependency checks are present; the large workflow modules remain a maintainability risk, but no broad refactor is recommended for launch remediation. |
| Accessibility/workflow; ten-day operations | No obvious build-blocking UI defect found by source/build review; M5 and the manual load/accessibility scenarios remain. |
| Backups, rollback, deployment | Documentation is explicit; execution evidence must be produced in staging. |

## Production launch recommendation

**Production-ready with conditions.** Merge only after the PostgreSQL-backed CI job passes. Production launch additionally requires a successful integrity precheck and migration rehearsal on a restored production-shaped copy, provider TLS verification, the manual staging scenarios with named evidence, and a fully signed production release checklist. No finding supports bypassing the existing staffing governance or changing core staffing rules.
