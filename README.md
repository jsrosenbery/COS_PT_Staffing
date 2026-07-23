# SHERMAN

**Seniority & Hiring Eligibility Ranking Management for Academic Needs**

SHERMAN is the College of the Sequoias application for part-time faculty staffing.

## Development setup

Install dependencies with `npm ci` in both `frontend` and `backend`. Set `DATABASE_URL` in `backend/.env`, then initialize a new empty development database explicitly:

```sh
cd backend
npm run db:setup
npm run migrate:status
npm start
```

`npm start` never applies database schema changes. Run `npm run seed:logins` separately after migrations if development login accounts are needed.

## Database deployment

Database migrations are an explicit release step and must complete before deploying or restarting backend application instances. Back up the target database before migrating, run `cd backend && npm ci && npm run migrate`, verify with `npm run migrate:status`, and only then deploy the backend.

See [Database migrations](docs/database-migrations.md) for production adoption, verification, failure handling, and rollback limitations.

## Operational readiness

- [Environment configuration](docs/operations/environment-reference.md)
- [Controlled deployment runbook](docs/operations/deployment-runbook.md)
- [Staging pilot verification checklist](docs/operations/staging-pilot-checklist.md)
- [Production release checklist](docs/operations/production-release-checklist.md)

## Authentication rate limiting

Production uses PostgreSQL-backed authentication rate limits shared by every backend instance. Apply migrations before deploying the backend and leave `RATE_LIMIT_STORE=postgres`. If PostgreSQL is unavailable, protected authentication endpoints return `503` rather than silently falling back to process-local counters.

Local development and tests default to `RATE_LIMIT_STORE=memory`; counters then reset with the process. See [Authentication rate limiting](docs/auth-rate-limiting.md) for proxy and deployment configuration.

## Validation

Before opening a pull request, run:

```sh
cd backend && npm test
cd frontend && npm run build
```

Set `TEST_DATABASE_URL` to an expendable PostgreSQL database when running backend tests so the migration integration cases execute. CI provides an isolated PostgreSQL service automatically.

The staffing lifecycle integration suite creates a uniquely named schema inside `TEST_DATABASE_URL`, applies all migrations, starts the backend routers on an ephemeral local port, and drops the schema afterward. It never reads or writes production data and does not send email. To run it locally with the rest of the backend suite:

```sh
cd backend
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/scope_test npm test
```
