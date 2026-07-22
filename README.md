# COS Part-Time Faculty Staffing

This repository contains the S.C.O.P.E. frontend and backend for part-time faculty staffing.

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

## Validation

Before opening a pull request, run:

```sh
cd backend && npm test
cd frontend && npm run build
```

Set `TEST_DATABASE_URL` to an expendable PostgreSQL database when running backend tests so the migration integration cases execute. CI provides an isolated PostgreSQL service automatically.
