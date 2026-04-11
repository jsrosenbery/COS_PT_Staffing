S.C.O.P.E. backend rebuild patch

This patch rebuilds the missing backend route layer expected by the frontend:
- terms
- subject mapping
- schedule preview/upload
- available sections
- division statuses
- chair workflow
- assignments
- preferences
- decision logs

After applying:
1. Redeploy the backend
2. Confirm /api/health returns OK
3. Confirm the frontend is pointing to the actual backend service URL
4. Re-test:
   - chair/dean persistence
   - schedule preview
   - schedule upload
