-- Lock down the tables against Supabase's auto-generated REST API.
--
-- Supabase exposes every table in the `public` schema through PostgREST, reachable
-- with the project's `anon` key — a key that is *designed* to be public and ships
-- in browser bundles. Whether Prisma's tables are actually readable that way
-- depends on the grants in effect when they were created, which is not something
-- to leave to chance: `User` holds email addresses and bcrypt hashes.
--
-- This is defence in depth, not the app's authorisation model. Project/IO does
-- all authorisation in server actions, which verify ownership before every write
-- (see lib/actions/board.ts). The point here is that a second, unintended door
-- exists in Supabase specifically, and it should be shut.
--
-- Two independent locks, because either alone can be undone by a later change:
--
--   1. REVOKE — removes the grants PostgREST needs at all. Also revokes future
--      grants via ALTER DEFAULT PRIVILEGES, so a table added later is not
--      silently exposed.
--   2. ENABLE ROW LEVEL SECURITY — with no policies attached, RLS denies every
--      row to every non-owning role even if a grant reappears.
--
-- Safe for the app: the migration/runtime role owns these tables, and PostgreSQL
-- exempts table owners from RLS unless FORCE ROW LEVEL SECURITY is set (it is
-- not). Nothing in the application's own queries changes.
--
-- Written to be re-runnable and to work on plain Postgres too, where the anon
-- and authenticated roles do not exist — hence the guards. Local development and
-- CI run the same migration list as production, so it must not fail there.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    -- Supabase Auth is not used here: nobody is ever "authenticated" in its
    -- sense, so this role should reach nothing either.
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
  END IF;
END
$$;

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Board" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Column" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Card" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
