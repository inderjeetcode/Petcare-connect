-- ==============================================================================
-- PET CONNECT — MANUAL ONE-TIME PLATFORM OWNER BOOTSTRAP (DO NOT AUTO-RUN)
-- Target Staging Project: PetConnect-Staging (xvlgavjbunishoedcned)
-- Canonical Developer Email: inderjeetcode@gmail.com
-- ==============================================================================
-- PREREQUISITES BEFORE EXECUTION:
-- 1. Ensure migration 20261113140000_phase1_single_platform_owner.sql is applied.
-- 2. Inspect Step 1 below first in Supabase Dashboard SQL Editor (postgres role)
--    to verify the Auth UUID, email_confirmed_at, profile, and existing rows.
-- 3. Only if Step 1 confirms zero active platform_admins and a verified
--    inderjeetcode@gmail.com account, run Step 2.
-- ==============================================================================

-- STEP 1: READ-ONLY VERIFICATION QUERY (Run first)
SELECT
  au.id AS auth_user_id,
  au.email,
  au.email_confirmed_at,
  au.banned_until,
  au.deleted_at,
  pr.platform_status AS profile_platform_status,
  (SELECT count(*) FROM public.platform_admins pa WHERE pa.is_active = true) AS active_platform_owners_count,
  (SELECT count(*) FROM public.organization_memberships om WHERE om.user_id = au.id AND om.status = 'active') AS active_org_memberships_count
FROM auth.users au
LEFT JOIN public.profiles pr ON pr.id = au.id
WHERE lower(au.email) = 'inderjeetcode@gmail.com';

-- STEP 2: CONTROLLED ONE-TIME BOOTSTRAP (Run ONLY after reviewing Step 1)
-- Wraps execution in a transaction so any failure rolls back cleanly.
-- Re-running this statement a second time will safely fail with SQLSTATE 23505.
/*
BEGIN;
SELECT app.bootstrap_single_platform_owner(
  'inderjeetcode@gmail.com',
  'Manual verified Phase 1 sole Platform Owner bootstrap'
);
COMMIT;
*/

-- STEP 3: POST-BOOTSTRAP VERIFICATION (Run after Step 2)
/*
SELECT pa.user_id, pr.email, pa.is_active, pa.granted_at, pa.notes
FROM public.platform_admins pa
JOIN public.profiles pr ON pr.id = pa.user_id;

SELECT action, entity_type, entity_id, details, created_at
FROM public.audit_logs
WHERE action = 'BOOTSTRAP_PLATFORM_OWNER'
ORDER BY created_at DESC
LIMIT 5;
*/
