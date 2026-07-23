# Production Authentication Hardening

S.C.O.P.E. keeps the current user-account workflow: account requests, admin approval, invitation setup links, login, password reset, and server-issued sessions.

## Bootstrap API Token

`API_TOKEN` is a bootstrap-only administrative credential. It exists to help initialize or recover the system before normal admin accounts are usable.

- `API_TOKEN_AUTH_ENABLED=false` disables API-token authentication.
- Production defaults API-token authentication to disabled.
- If API-token authentication is enabled, `API_TOKEN` must be a long random secret.
- The normal production frontend hides API-token entry unless `VITE_API_TOKEN_AUTH_ENABLED=true` is set at build time.

Do not use `API_TOKEN` as a routine operator login. Use named user accounts so audit entries have accountable actor identity.

## Required Production Configuration

Production startup fails when:

- `AUTH_DISABLED=true`;
- `CORS_ORIGIN` is missing;
- `DATABASE_URL` is missing;
- `APP_BASE_URL` is missing;
- `EMAIL_PROVIDER=sendgrid` but `SENDGRID_API_KEY` or `EMAIL_FROM` is missing/weak;
- `EMAIL_PROVIDER=brevo` but `BREVO_API_KEY` or `EMAIL_FROM` is missing/weak;
- API-token auth is enabled with a missing or weak `API_TOKEN`.

## Reset And Invite Links

Invite and password-reset URLs are emailed to users. Production API responses do not return bearer URLs unless `ALLOW_TOKEN_URLS_IN_RESPONSES=true` is explicitly set for debugging outside production.

After a successful invite acceptance, all outstanding invites for that user are marked accepted. After a successful password reset, all outstanding reset tokens for that user are marked used. Password changes revoke other active sessions after the new session is issued.

## Session Storage

Current browser sessions are bearer tokens stored in `sessionStorage`. This keeps implementation risk low while the account workflow is still settling, but it is not the final institutional posture.

Recommended next step: move session transport to secure, HTTP-only, same-site cookies with CSRF protection and integration tests for login, logout, password reset, invite acceptance, role changes, and cross-origin deployment. That rewrite should land only after test coverage proves existing user flows still work.

## Cleanup

The backend removes expired or already-used sessions, password-reset tokens, and invites at startup and then hourly while the server is running.
