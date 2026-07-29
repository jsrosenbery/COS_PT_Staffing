# Database migrations

The backend uses ordered SQL files in `backend/migrations`. Filenames must follow `NNNN_name.sql`; the numeric identifier determines deterministic execution order and must never be reused.

## How migrations run

From `backend`, run:

```sh
npm ci
npm run migrate
```

The runner takes a PostgreSQL advisory lock so only one release process migrates at a time. Each pending file runs in its own transaction. Its identifier, filename, SHA-256 checksum, and application timestamp are written to `scope_schema_migrations` in the same transaction. A failed transaction is rolled back and is not recorded. Successful migrations are skipped on future runs; changed checksums or filenames cause a hard failure.

Production server startup is intentionally separate: `npm start` does not run migrations. Run migrations once as a release or pre-deploy job before new backend code starts. Do not run them independently from every application replica.

## Existing production databases

`0001_baseline.sql` is the former idempotent schema and contains no table drops, recreation, truncation, or wholesale data rewrites. Running `npm run migrate` against an existing database safely verifies or adds the current objects and then records the baseline. Existing rows remain in place. New empty databases run the same baseline and are reproducible.

Before first adoption, take and verify a restorable database backup. Use the same database role and `DATABASE_URL` that the backend deployment targets, and confirm the role can create or alter the required objects.

## Status and verification

Run:

```sh
npm run migrate:status
```

The command lists each repository migration as `applied` or `pending`, including its checksum and application time. It fails if an applied migration no longer matches its recorded filename or checksum. Operators may also inspect `scope_schema_migrations` directly with read-only SQL.

After migration, verify that no migration is pending and complete the normal backend health check before directing traffic to the new release.

Migration `0004_staffing_windows_updated_at.sql` safely upgrades older databases whose existing
`scope_staffing_windows` table predates the `updated_at` column. It adds the column with a current-time
default and does not drop, recreate, or remove any staffing-window records.

Migration `0007_nullable_draft_submission_timestamp.sql` safely upgrades databases where
`scope_preference_submissions.submitted_at` was created with a legacy `NOT NULL` constraint.
Draft preference versions intentionally have no submission timestamp, so the migration drops that
constraint and recreates the term/faculty submission index with explicit `NULLS LAST` ordering.
It does not populate timestamps for drafts or remove any preference history.

## Backups, failures, and rollback

Always create a restorable backup before production migration and retain it through post-deploy verification. The runner stops at the first failure and rolls that migration back where PostgreSQL supports transactional DDL. Investigate the error before retrying; never insert migration-history rows manually to bypass a failure.

There is no automatic down-migration command. SQL migrations may include irreversible data or schema changes, so rollback is release-specific. Prefer a forward corrective migration. If restoration is required, stop application writes and follow the database provider's tested restore procedure using the pre-migration backup.

Never edit an applied migration. Add a new numbered migration for every subsequent schema change.
