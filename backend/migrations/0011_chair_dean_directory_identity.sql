-- Directory contacts are not login accounts. Chairs/deans may temporarily lack
-- an employee ID when they have a usable email address and a division.
-- No identities, login permissions, or historical records are rewritten.
ALTER TABLE scope_roles DROP CONSTRAINT scope_roles_identity_valid;
ALTER TABLE scope_roles ADD CONSTRAINT scope_roles_identity_valid CHECK (
  BTRIM(division) <> ''
  AND role = LOWER(BTRIM(role))
  AND role IN ('admin', 'chair', 'dean', 'faculty')
  AND (
    BTRIM(employee_id) <> ''
    OR (role IN ('chair', 'dean') AND BTRIM(email) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
  )
) NOT VALID;
ALTER TABLE scope_roles VALIDATE CONSTRAINT scope_roles_identity_valid;
