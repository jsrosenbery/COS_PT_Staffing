# Database integrity precheck

Migration `0002_security_integrity_constraints.sql` adds named PostgreSQL `CHECK` constraints for high-value identifiers, roles, divisions, and workflow statuses. They are installed as `NOT VALID`: PostgreSQL enforces them for every new or changed row, while historical rows remain untouched until an operator reviews and remediates them.

Before deploying this change against an existing database, run:

```sh
cd backend
npm ci
npm run db:integrity-report
npm run migrate
npm run migrate:status
```

The report returns a violation count and up to 20 internal row IDs for each invariant. It does not display employee or faculty data and does not modify the database. For an automated release gate, use `npm run db:integrity-precheck`; it exits with status 2 when violations exist.

Review every reported row with the appropriate data owner. Preserve historical records: correct verified values through an auditable process rather than deleting or rewriting records in bulk. This change does not invent division values or roles; accepted roles remain `admin`, `chair`, `dean`, and `faculty`, and division strings retain their institutional display form. Comparisons use normalized lowercase values without rewriting stored division labels.

After confirmed legacy violations are resolved, validate each named constraint in a separately reviewed database migration, for example:

```sql
ALTER TABLE scope_assignments
VALIDATE CONSTRAINT scope_assignments_integrity_valid;
```

Take a verified backup before remediation or constraint validation. Constraint validation has no automatic rollback for data corrections; document every correction and retain the backup until verification is complete.
