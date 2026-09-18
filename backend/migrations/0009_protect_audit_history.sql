CREATE OR REPLACE FUNCTION scope_reject_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'scope_audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS scope_audit_log_append_only ON scope_audit_log;
CREATE TRIGGER scope_audit_log_append_only
BEFORE UPDATE OR DELETE ON scope_audit_log
FOR EACH ROW EXECUTE FUNCTION scope_reject_audit_mutation();
