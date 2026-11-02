-- Run only AFTER authorized metadata observation confirms this relation and
-- version column exist AND the operator already has SELECT privilege.
-- First verify trusted Supabase-managed ownership, ordinaryTable=true,
-- rowSecurity=false and versionBuiltinText=true in ledgerReadShape.
-- Never run against a view/foreign table, custom version type or unreviewed RLS:
-- their SELECT/cast/policy paths could invoke user-defined code.
-- Absence/denial is BLOCKED, never a reason to create/repair a ledger.
-- No name/statements/checksums or user rows are exported.
select version::text as version
from supabase_migrations.schema_migrations
order by version;
