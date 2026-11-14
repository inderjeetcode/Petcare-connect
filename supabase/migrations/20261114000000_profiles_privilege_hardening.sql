
-- ============================================================
-- Pet Connect: Profiles Privilege Hardening
-- Date: 2026-11-14
-- Purpose:
--   1. Restrict direct profile UPDATE to safe fields.
--   2. Preserve Platform Owner SECURITY DEFINER RPC workflows.
--   3. Remove unnecessary structural privileges.
-- ============================================================

BEGIN;

-- 1. Remove table-level UPDATE permission.
REVOKE UPDATE ON TABLE public.profiles
FROM PUBLIC, anon, authenticated;

-- 2. Remove any explicit column-level UPDATE permissions.
REVOKE UPDATE (
  id,
  full_name,
  email,
  phone,
  avatar_url,
  created_at,
  updated_at,
  platform_status,
  platform_suspended_at,
  platform_suspension_reason
)
ON TABLE public.profiles
FROM PUBLIC, anon, authenticated;

-- 3. Allow authenticated users to update only their
--    editable profile fields.
GRANT UPDATE (
  full_name,
  phone,
  avatar_url
)
ON TABLE public.profiles
TO authenticated;

-- 4. Remove unnecessary structural privileges from
--    authenticated users on public tables.
REVOKE TRUNCATE, TRIGGER, REFERENCES
ON ALL TABLES IN SCHEMA public
FROM authenticated;

COMMIT;
