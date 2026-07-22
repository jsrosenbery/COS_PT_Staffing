# Environment configuration reference

Keep production and staging values in the hosting platform's encrypted secret/configuration store. Do not commit populated `.env` files. Restart or redeploy the affected service after changing runtime variables; rebuild the frontend after changing any `VITE_` variable.

## Backend production variables

| Variable | Class | Production guidance | Unsafe values or use |
| --- | --- | --- | --- |
| `NODE_ENV` | Required feature mode | Set exactly `production`. This activates production safety validation and secure defaults. | Empty, `development`, or `test` in an institutional deployment. |
| `DATABASE_URL` | Required secret URL | PostgreSQL connection URL for the intended environment. Use a least-privilege application/migration role according to institutional policy and store it as a secret. | A developer, CI, or production database URL in the wrong environment; committing the URL; using a superuser for routine runtime access. |
| `DATABASE_SSL` | Optional security flag | Omit or set `true` for hosted PostgreSQL; TLS remains enabled by default when `DATABASE_URL` exists. | `false` over public or untrusted networks. Use `false` only for a verified private/local PostgreSQL service without TLS, such as CI. |
| `CORS_ORIGIN` | Required URL allowlist | Comma-separated exact frontend origins, including scheme and port when non-default. Example: `https://staging.example.invalid`. | `*`, request-reflecting origins, unrelated domains, path components, or mixing staging and production unnecessarily. |
| `APP_BASE_URL` | Required public URL | Exact user-facing frontend origin used to build invitation and reset links. | Backend URL, localhost, staging URL in production, trailing route fragments, or an untrusted domain. |
| `AUTH_DISABLED` | Required security flag | Set `false`. Production startup rejects `true`. | `true` outside isolated local development; it bypasses authentication. |
| `API_TOKEN_AUTH_ENABLED` | Required bootstrap flag | Normally `false`. Temporarily set `true` only for approved bootstrap/recovery, then return it to `false` and restart. | Leaving it enabled for routine operation or using it as a shared administrator login. |
| `API_TOKEN` | Conditional secret | Required only while API-token bootstrap is enabled. Generate at least 32 random characters with an approved secret generator and distribute through a secure channel. Rotate or remove it after bootstrap. | Examples, dictionary words, reused passwords, source control, logs, tickets, email, or browser build variables. |
| `RATE_LIMIT_STORE` | Required production setting | Set `postgres` so authentication counters are persistent and shared. | `memory` in production; counters reset on restart and are not shared. |
| `RATE_LIMIT_TRUST_PROXY_HOPS` | Optional security setting | Default `0`. Change only after the hosting owner confirms the exact number of trusted proxies, from `1` through `5`. | Guessing, accepting arbitrary forwarded addresses, or enabling global Express trust proxy without topology review. |
| `EMAIL_PROVIDER` | Required feature selection | Use `sendgrid` when staging/production must deliver invitations and resets. `console` is acceptable only for isolated verification where delivery is intentionally disabled. | `console` for a live pilot expecting email delivery, or an unsupported provider name. |
| `EMAIL_FROM` | Conditional address | Required with SendGrid; use a verified institutional sender. | Unverified/spoofed sender or personal mailbox. |
| `SENDGRID_API_KEY` | Conditional secret | Required when `EMAIL_PROVIDER=sendgrid`; store only in the platform secret store and scope it to sending. | Empty, placeholder, source-controlled, browser-exposed, or broadly privileged keys. |

Production startup validates the most important combinations and refuses to start when authentication is disabled, required URLs/database settings are absent, SendGrid is incomplete, or enabled bootstrap credentials are weak.

## Backend optional runtime variables

| Variable | Default | Purpose and safe guidance |
| --- | --- | --- |
| `PORT` | `10000` | Listener port assigned by the backend platform. Prefer the platform-injected value. |
| `SESSION_DAYS` | `14` | Session lifetime in days. Use a positive institutional value; shortening it reduces exposure. |
| `INVITE_DAYS` | `7` | Invitation lifetime in days. Use a positive value and avoid unnecessarily long invitations. |
| `RESET_HOURS` | `2` | Password-reset lifetime in hours. Use a short positive value. |
| `MAX_UPLOAD_BYTES` | `5242880` | Maximum schedule upload size. Keep bounded to expected institutional exports. |
| `ALLOW_TOKEN_URLS_IN_RESPONSES` | Production default `false` | Development/debug feature flag. Keep `false` in staging and production because responses would expose invitation/reset bearer URLs. |

There are no separate migration credentials or migration feature flags. `npm run migrate`, `npm run migrate:status`, `npm run db:integrity-report`, and `npm run db:integrity-precheck` use `DATABASE_URL` and `DATABASE_SSL`.

## Bootstrap and development-only variables

`ADMIN_EMAIL`, `ADMIN_EMPLOYEE_ID`, `ADMIN_FULL_NAME`, `ADMIN_DIVISION`, and `ADMIN_PASSWORD` are consumed only by `npm run seed:logins`. Treat `ADMIN_PASSWORD` as a secret. Run the seeder deliberately, verify the named administrator can sign in, then remove all seed variables from the deployed environment. `SEED_DEMO_USERS` is a development-only feature flag: it defaults to `true` outside production and `false` in production; production rejects `true`.

`DEMO_FACULTY_*`, `DEMO_CHAIR_*`, and `DEMO_DEAN_*` variables are development/staging test fixtures only. Never configure them in production, and remove their accounts and credentials before a staging environment is promoted or copied.

`TEST_DATABASE_URL` is test-only and must identify an expendable PostgreSQL database. The integration suite creates and drops isolated schemas within it. Never point it at staging or production.

`STAGING_API_BASE_URL`, `STAGING_SESSION_TOKEN`, `STAGING_TERM_CODE`, `STAGING_ALLOWED_DIVISION`, and `STAGING_FORBIDDEN_DIVISION` are operator-only inputs to `npm run staging:verify`. Use an ephemeral scoped chair/dean session token, supply it only in the invoking shell or secret runner, and unset it immediately afterward. The script is read-only. Do not store these values in repository files or production service configuration.

## Frontend build variables

| Variable | Class | Guidance |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Required public URL | Backend API base ending in `/api`. Verify the staging build points to staging and the production build points to production. Vite embeds this value in browser assets, so it is not a secret. |
| `VITE_API_TOKEN_AUTH_ENABLED` | Build-time feature flag | Keep `false` for normal staging and production. Set `true` only for a tightly controlled bootstrap build, then rebuild and redeploy with `false`. |

Never place secrets in a `VITE_` variable; every such value is visible to browser users.
