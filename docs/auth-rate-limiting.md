# Authentication rate limiting

The five public authentication operations - login, account request, password-reset request, password-reset completion, and invitation acceptance - retain separate limits and windows. Limiter keys are SHA-256 digests of the limiter name, client address, and normalized account identifier or bearer token. Passwords are never included, and raw reset or invitation tokens are never stored.

## Storage policy

- Production defaults to and requires `RATE_LIMIT_STORE=postgres`. The `scope_rate_limits` table is created by migration `0003_shared_auth_rate_limits.sql`, and atomic PostgreSQL upserts make counters persistent and shared across backend instances.
- Development and tests default to `RATE_LIMIT_STORE=memory`. This is intentionally process-local and resets on restart.
- If the `scope_rate_limits` table is missing, the limiter creates that small table/index and retries once so public authentication flows do not go unavailable because a release migration was missed.
- Other PostgreSQL limiter errors fail closed for the affected authentication request with HTTP `503` and code `RATE_LIMIT_UNAVAILABLE`. There is no automatic in-memory production fallback because that would weaken protection during a database outage.

Run `npm run migrate` as a release step before starting the new backend version. No separate service or vendor credential is required; the limiter uses the existing `DATABASE_URL` connection.

The repository declares Vercel hosting only for the frontend; it does not codify the backend proxy topology. Configure the backend platform with `NODE_ENV=production`, `RATE_LIMIT_STORE=postgres`, and its existing secret `DATABASE_URL`. Do not add database credentials to source control.

## Trusted client addresses

The backend does not globally enable Express `trust proxy`. By default, `RATE_LIMIT_TRUST_PROXY_HOPS=0` uses the direct socket peer and ignores `X-Forwarded-For`, preventing callers from choosing their limiter address.

Only set `RATE_LIMIT_TRUST_PROXY_HOPS` after confirming the backend's exact reverse-proxy topology. Set it to the number of trusted proxy hops between the client and Node (maximum 5). For example, use `1` only when every backend request is received from one trusted proxy that appends the client address. A wrong value can group unrelated users or trust a caller-controlled address.

## Operations

Expired rows no longer affect limits and can be removed periodically with:

```sql
DELETE FROM scope_rate_limits WHERE expires_at <= NOW();
```

This cleanup is optional for correctness and can be scheduled as routine database maintenance. Do not delete unexpired rows unless intentionally resetting active limits.
