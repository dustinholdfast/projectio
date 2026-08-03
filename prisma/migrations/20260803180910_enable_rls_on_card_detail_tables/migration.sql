-- Enable RLS on the tables added after the original lockdown migration.
--
-- `20260803163600_enable_rls` enabled row-level security on the six tables that
-- existed at the time. ChecklistItem and CardBlock were created later, by
-- `20260803173035_add_card_details`, and so were never covered.
--
-- They were not *exposed*: that earlier migration also ran
-- ALTER DEFAULT PRIVILEGES ... REVOKE, so anon and authenticated received no
-- grants on the new tables and PostgREST answers 42501 for both. But that left
-- one lock rather than two — a single later GRANT would have exposed these two
-- tables while the original six stayed protected.
--
-- The lesson generalises: any migration that adds a table has to enable RLS on
-- it. `npm run db:check-rls` now fails when one does not, so this is caught
-- before it ships rather than found by inspection afterwards.

ALTER TABLE "ChecklistItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CardBlock" ENABLE ROW LEVEL SECURITY;
