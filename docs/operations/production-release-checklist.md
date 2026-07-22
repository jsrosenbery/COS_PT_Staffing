# Production release checklist

Release identifier/commit: __________  Change record: __________  Scheduled time: __________

Release operator: __________  Database owner: __________  Rollback owner: __________

- [ ] The release branch is narrowly scoped, reviewed, and CI is passing for backend tests and frontend production build.
- [ ] Staging pilot verification is complete with no unresolved severity-one or severity-two findings.
- [ ] Production secrets and URLs were verified in the platform store; none appear in source, frontend variables, logs, or the change record.
- [ ] `AUTH_DISABLED=false`, `API_TOKEN_AUTH_ENABLED=false`, `RATE_LIMIT_STORE=postgres`, and `VITE_API_TOKEN_AUTH_ENABLED=false` are confirmed.
- [ ] A restorable pre-migration backup is complete; backup identifier and retention are recorded; restore permission and procedure were verified.
- [ ] `npm run db:integrity-precheck` passed or every exception has written data-owner approval.
- [ ] `npm run migrate` succeeded and `npm run migrate:status` reports every repository migration applied with no checksum mismatch.
- [ ] The production frontend build succeeded with the intended production `VITE_API_BASE_URL`.
- [ ] The backend `/api/health` check succeeded after deployment.
- [ ] The production smoke test succeeded: named login, scoped read, safe representative workflow/read-only checks, email link origin, audit entry, and correlation ID.
- [ ] CORS permits only approved production frontend origins.
- [ ] Bootstrap authentication is disabled and the bootstrap token is removed or rotated.
- [ ] The rollback owner is available and has the previous release identifier plus verified backup identifier.
- [ ] The approved branch was merged directly into `main`; deployment uses that exact merged commit.
- [ ] Post-deployment monitoring and audit review completed for the observation period.
- [ ] The temporary task branch was deleted after merge and release evidence was attached to the change record.

Do not release with an unchecked item. Record an approved exception in the institutional change system rather than annotating this file with secrets or personal information.
