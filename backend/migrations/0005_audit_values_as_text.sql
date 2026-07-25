ALTER TABLE scope_audit_log
ALTER COLUMN old_value TYPE TEXT USING old_value::text;

ALTER TABLE scope_audit_log
ALTER COLUMN new_value TYPE TEXT USING new_value::text;
