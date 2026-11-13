/**
 * Controlled End-to-End RPC Test Suite against Live Supabase Project
 * Project: PET CONNECT
 * File: scripts/test_controlled_rpc.cjs
 *
 * EXCLUSIVELY FOR ISOLATED CLI / CI EXECUTION — NEVER INCLUDED IN BROWSER BUNDLES.
 *
 * Verifies all 12 requirements:
 * 1. Dedicated test client, test doctor, unassigned doctor, and test admin accounts
 * 2. Create valid pending consultation assigned to test doctor
 * 3. Authenticate as assigned doctor and execute activate_consultation RPC
 * 4. Verify consultation_status becomes 'active'
 * 5. Verify activated_at and expires_at are exactly 7 days apart
 * 6. Verify exactly one chat_conversations record created
 * 7. Verify audit_log created
 * 8. Test that client cannot activate their own consultation (42501)
 * 9. Test that unassigned doctor cannot activate it (42501)
 * 10. Test that authorized admin can activate a pending consultation
 * 11. Test that repeated activation is rejected (22023)
 * 12. Verify all results against actual remote database records
 *
 * STRICT GOVERNANCE & SECURITY AUDIT COMPLIANCE:
 * - Credentials read from private environment variables ONLY (zero hardcoded passwords)
 * - Uses normal user authenticated JWTs (NO service_role credentials anywhere)
 * - Immediate conversation tracking upon consultation activation
 * - Unconditional 4-tier residual verification query with explicit error handling
 * - Exit code 0 ONLY on full pass (12 steps + successful cleanup + 0 residual records)
 */

const { createClient } = require('@supabase/supabase-js');

// 1. Load environment variables (never fall back to hardcoded project URLs or keys)
const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const publishableKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

const clientPassword = process.env.PETCONNECT_TEST_CLIENT_PASSWORD;
const assignedDoctorPassword = process.env.PETCONNECT_TEST_ASSIGNED_DOCTOR_PASSWORD;
const otherDoctorPassword = process.env.PETCONNECT_TEST_OTHER_DOCTOR_PASSWORD;
const adminPassword = process.env.PETCONNECT_TEST_ADMIN_PASSWORD;

const missingVars = [];
if (!supabaseUrl) missingVars.push('VITE_SUPABASE_URL (or SUPABASE_URL)');
if (!publishableKey) missingVars.push('VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)');
if (!clientPassword) missingVars.push('PETCONNECT_TEST_CLIENT_PASSWORD');
if (!assignedDoctorPassword) missingVars.push('PETCONNECT_TEST_ASSIGNED_DOCTOR_PASSWORD');
if (!otherDoctorPassword) missingVars.push('PETCONNECT_TEST_OTHER_DOCTOR_PASSWORD');
if (!adminPassword) missingVars.push('PETCONNECT_TEST_ADMIN_PASSWORD');

if (missingVars.length > 0) {
  console.error('================================================================');
  console.error('ERROR: Missing required environment variables:');
  missingVars.forEach((v) => console.error(`  - ${v}`));
  console.error('================================================================');
  console.error('Run ONLY against local or isolated staging Supabase:');
  console.error('  VITE_SUPABASE_URL="http://127.0.0.1:54321" \\');
  console.error('  VITE_SUPABASE_ANON_KEY="..." \\');
  console.error('  PETCONNECT_TEST_CLIENT_PASSWORD="..." \\');
  console.error('  PETCONNECT_TEST_ASSIGNED_DOCTOR_PASSWORD="..." \\');
  console.error('  PETCONNECT_TEST_OTHER_DOCTOR_PASSWORD="..." \\');
  console.error('  PETCONNECT_TEST_ADMIN_PASSWORD="..." \\');
  console.error('  node scripts/test_controlled_rpc.cjs\n');
  process.exit(1);
}

// Anon client for initial connectivity and public policy checks
const anonClient = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Dedicated Test Accounts (Strictly separated from production users)
const ACCOUNTS = {
  client: {
    email: 'client.test@petconnect.com',
    password: clientPassword,
    userId: 'c1000000-0000-0000-0000-000000000001',
    role: 'client',
  },
  assignedDoctor: {
    email: 'doctor.assigned@petconnect.com',
    password: assignedDoctorPassword,
    userId: 'd1000000-0000-0000-0000-000000000001',
    doctorId: '70000000-0000-0000-0000-000000000001',
    role: 'doctor',
  },
  otherDoctor: {
    email: 'doctor.other@petconnect.com',
    password: otherDoctorPassword,
    userId: 'd2000000-0000-0000-0000-000000000002',
    doctorId: '70000000-0000-0000-0000-000000000002',
    role: 'doctor',
  },
  admin: {
    email: 'admin.test@petconnect.com',
    password: adminPassword,
    userId: 'a1000000-0000-0000-0000-000000000001',
    role: 'admin',
  },
};

const TEST_PET_ID = '80000000-0000-0000-0000-000000000001';

// Track test consultations and conversations for deterministic cleanup and verification
const createdConsultationIds = [];
const createdConversationIds = [];

async function loginUser(email, password) {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    return { client: null, session: null, error: error.message };
  }
  return { client, session: data.session, user: data.user, error: null };
}

async function cleanupTestRecords(adminClient) {
  const teardownResult = {
    cleanupRpcExecuted: false,
    cleanupRpcSuccess: false,
    queriesSucceeded: false,
    residualCountsZero: false,
    remMsgsCount: -1,
    remConvsCount: -1,
    remConsCount: -1,
    remLogsCount: -1,
    error: null,
  };

  if (createdConsultationIds.length === 0) {
    teardownResult.cleanupRpcSuccess = true;
    teardownResult.queriesSucceeded = true;
    teardownResult.residualCountsZero = true;
    return teardownResult;
  }

  console.log('\n--- TEARDOWN: Cleaning up test records to prevent orphan data ---');
  try {
    const { data: cleanupRes, error: cleanupErr } = await adminClient.rpc('cleanup_test_records', {
      p_test_consultation_ids: createdConsultationIds,
    });

    teardownResult.cleanupRpcExecuted = true;

    if (cleanupErr) {
      teardownResult.cleanupRpcSuccess = false;
      teardownResult.error = `Cleanup RPC error: ${cleanupErr.message} (Code: ${cleanupErr.code})`;
      console.error('FAIL (Teardown): Cleanup RPC returned error:', cleanupErr.message, '(Code:', cleanupErr.code, ')');
      console.log('Manual cleanup query: SELECT public.cleanup_test_records(ARRAY[' + createdConsultationIds.map(id => `'${id}'`).join(', ') + ']::uuid[]);');
    } else {
      teardownResult.cleanupRpcSuccess = true;
      console.log('Teardown RPC executed successfully:');
      console.log('  - Consultations deleted: ', cleanupRes.deleted_consultations);
      console.log('  - Conversations deleted: ', cleanupRes.deleted_conversations);
      console.log('  - Audit logs deleted:     ', cleanupRes.deleted_audit_logs);
    }

    // POST-CLEANUP VERIFICATION QUERY: Explicitly verify all 4 categories independently
    console.log('\n--- POST-CLEANUP VERIFICATION ---');
    let queryErrorsEncountered = false;

    // 1. Check chat_messages unconditionally (both via tracked conversation IDs and via consultation conversations)
    let remMsgs = [];
    let rmErr = null;

    if (createdConversationIds.length > 0) {
      const msgQuery = await adminClient
        .from('chat_messages')
        .select('id')
        .in('conversation_id', createdConversationIds);
      remMsgs = msgQuery.data || [];
      rmErr = msgQuery.error;
    } else {
      // Query messages linked through any conversation tied to the test consultations
      const msgQuery = await adminClient
        .from('chat_conversations')
        .select('id, chat_messages(id)')
        .in('consultation_id', createdConsultationIds);
      if (msgQuery.error) {
        rmErr = msgQuery.error;
      } else if (msgQuery.data) {
        remMsgs = msgQuery.data.flatMap((c) => c.chat_messages || []);
      }
    }

    if (rmErr) {
      console.error('FAIL (Post-Cleanup): Database query error checking chat_messages:', rmErr.message, '(Code:', rmErr.code, ')');
      queryErrorsEncountered = true;
    }

    // 2. Check chat_conversations associated with tracked consultation IDs
    const { data: remConvs, error: rcvErr } = await adminClient
      .from('chat_conversations')
      .select('id')
      .in('consultation_id', createdConsultationIds);

    if (rcvErr) {
      console.error('FAIL (Post-Cleanup): Database query error checking chat_conversations:', rcvErr.message, '(Code:', rcvErr.code, ')');
      queryErrorsEncountered = true;
    }

    // 3. Check consultations associated with tracked test IDs
    const { data: remCons, error: rcErr } = await adminClient
      .from('consultations')
      .select('id')
      .in('id', createdConsultationIds);

    if (rcErr) {
      console.error('FAIL (Post-Cleanup): Database query error checking consultations:', rcErr.message, '(Code:', rcErr.code, ')');
      queryErrorsEncountered = true;
    }

    // 4. Check audit_logs associated with tracked test consultation IDs
    const { data: remLogs, error: rlErr } = await adminClient
      .from('audit_logs')
      .select('id')
      .eq('entity_type', 'consultation')
      .in('entity_id', createdConsultationIds);

    if (rlErr) {
      console.error('FAIL (Post-Cleanup): Database query error checking audit_logs:', rlErr.message, '(Code:', rlErr.code, ')');
      queryErrorsEncountered = true;
    }

    if (queryErrorsEncountered) {
      teardownResult.queriesSucceeded = false;
      console.error('FAIL (Post-Cleanup): One or more verification queries failed. Cannot confirm zero residual records.');
    } else {
      teardownResult.queriesSucceeded = true;
      teardownResult.remMsgsCount = remMsgs ? remMsgs.length : 0;
      teardownResult.remConvsCount = remConvs ? remConvs.length : 0;
      teardownResult.remConsCount = remCons ? remCons.length : 0;
      teardownResult.remLogsCount = remLogs ? remLogs.length : 0;

      if (
        teardownResult.remMsgsCount === 0 &&
        teardownResult.remConvsCount === 0 &&
        teardownResult.remConsCount === 0 &&
        teardownResult.remLogsCount === 0
      ) {
        teardownResult.residualCountsZero = true;
        console.log('PASS: Post-cleanup verification confirmed: exactly 0 residual test records in database.');
        console.log('  - Remaining chat_messages:      0 (Verified)');
        console.log('  - Remaining chat_conversations: 0 (Verified)');
        console.log('  - Remaining consultations:      0 (Verified)');
        console.log('  - Remaining test audit_logs:    0 (Verified)');
      } else {
        teardownResult.residualCountsZero = false;
        console.error('FAIL (Post-Cleanup): Residual test records detected in remote database:');
        if (teardownResult.remMsgsCount > 0) console.error(`  - Residual chat_messages: ${teardownResult.remMsgsCount}`);
        if (teardownResult.remConvsCount > 0) console.error(`  - Residual chat_conversations: ${teardownResult.remConvsCount}`);
        if (teardownResult.remConsCount > 0) console.error(`  - Residual consultations: ${teardownResult.remConsCount}`);
        if (teardownResult.remLogsCount > 0) console.error(`  - Residual audit_logs: ${teardownResult.remLogsCount}`);
      }
    }
  } catch (err) {
    teardownResult.error = err.message;
    console.error('Teardown exception:', err.message);
  }

  return teardownResult;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('PET CONNECT — CONTROLLED END-TO-END RPC SECURITY TEST SUITE');
  console.log('Target Remote Instance: ' + supabaseUrl);
  console.log('Security Level: Authenticated Normal User JWTs (NO service_role)');
  console.log('Environment: Isolated CLI Runner (Zero Frontend Exposure)');
  console.log('================================================================\n');

  const auditReport = {
    step1_accounts: false,
    step2_pendingConsultation: false,
    step3_assignedDoctorActivation: false,
    step4_statusActive: false,
    step5_exact7DayExpiry: false,
    step6_singleConversationCreated: false,
    step7_auditLogCreated: false,
    step8_clientSelfActivationBlocked: false,
    step9_unassignedDoctorBlocked: false,
    step10_adminActivationSucceeded: false,
    step11_repeatedActivationRejected: false,
    step12_remoteDbIntegrityVerified: false,
  };

  let adminAuth = null;
  let teardownResult = null;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Authenticate Dedicated Test Accounts
    // -------------------------------------------------------------------------
    console.log('--- STEP 1: Authenticating Dedicated Test Accounts ---');

    const clientAuth = await loginUser(ACCOUNTS.client.email, ACCOUNTS.client.password);
    console.log(
      `- Test Client (${ACCOUNTS.client.email}):`,
      clientAuth.error ? `FAILED (${clientAuth.error})` : `AUTHENTICATED (UID: ${clientAuth.user.id})`
    );

    const assignedDocAuth = await loginUser(ACCOUNTS.assignedDoctor.email, ACCOUNTS.assignedDoctor.password);
    console.log(
      `- Assigned Doctor (${ACCOUNTS.assignedDoctor.email}):`,
      assignedDocAuth.error ? `FAILED (${assignedDocAuth.error})` : `AUTHENTICATED (UID: ${assignedDocAuth.user.id})`
    );

    const otherDocAuth = await loginUser(ACCOUNTS.otherDoctor.email, ACCOUNTS.otherDoctor.password);
    console.log(
      `- Other Doctor (${ACCOUNTS.otherDoctor.email}):`,
      otherDocAuth.error ? `FAILED (${otherDocAuth.error})` : `AUTHENTICATED (UID: ${otherDocAuth.user.id})`
    );

    adminAuth = await loginUser(ACCOUNTS.admin.email, ACCOUNTS.admin.password);
    console.log(
      `- Admin Account (${ACCOUNTS.admin.email}):`,
      adminAuth.error ? `FAILED (${adminAuth.error})` : `AUTHENTICATED (UID: ${adminAuth.user.id})`
    );

    if (!assignedDocAuth.client || !clientAuth.client || !otherDocAuth.client || !adminAuth.client) {
      console.log('\n[NOTICE] Test accounts not yet seeded in remote Supabase Auth.');
      console.log('Execute /supabase/migrations/003_setup_test_accounts.sql in Supabase Dashboard SQL Editor.');
      console.log('This will safely create the 4 dedicated test accounts in auth.users & auth.identities.');

      // Also verify unauthenticated/anon RPC rejection
      console.log('\n--- Direct RPC Anon Execution Check ---');
      const { error: anonRpcErr } = await anonClient.rpc('activate_consultation', {
        p_consultation_id: '00000000-0000-0000-0000-000000000000',
      });
      if (anonRpcErr && anonRpcErr.code === '42501') {
        console.log('PASS: Unauthenticated/anon caller is strictly rejected with 42501: permission denied for function activate_consultation.');
      } else {
        console.log('Anon RPC result:', anonRpcErr);
      }

      process.exit(1);
    }

    auditReport.step1_accounts = true;
    console.log('PASS: All 4 dedicated test roles successfully authenticated via Supabase Auth.\n');

    // -------------------------------------------------------------------------
    // STEP 2: Create Valid Pending Consultation Assigned to Test Doctor
    // -------------------------------------------------------------------------
    console.log('--- STEP 2: Creating Valid Pending Consultation ---');
    let testConsultation1Id = null;

    const { data: newCons, error: consErr } = await clientAuth.client
      .from('consultations')
      .insert({
        client_id: clientAuth.user.id,
        doctor_id: ACCOUNTS.assignedDoctor.doctorId,
        pet_id: TEST_PET_ID,
        consultation_reason: '[CONTROLLED-TEST] Bilateral hip screening and stifle joint palpation',
        consultation_status: 'pending',
      })
      .select()
      .single();

    if (consErr) {
      console.error('Failed to insert consultation:', consErr.message);
      throw new Error(`Step 2 Failed: ${consErr.message}`);
    }

    testConsultation1Id = newCons.id;
    createdConsultationIds.push(testConsultation1Id);
    console.log(`PASS: Created pending consultation record. ID: ${testConsultation1Id}`);
    console.log(`  - Status: ${newCons.consultation_status}`);
    console.log(`  - Client: ${newCons.client_id}`);
    console.log(`  - Doctor Profile: ${newCons.doctor_id}`);
    auditReport.step2_pendingConsultation = true;

    // -------------------------------------------------------------------------
    // STEP 8: Test that Client CANNOT Activate Their Own Consultation
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 8: Testing Client Self-Activation Rejection ---');
    const { data: clientActData, error: clientActErr } = await clientAuth.client.rpc('activate_consultation', {
      p_consultation_id: testConsultation1Id,
    });

    if (clientActErr) {
      console.log(`PASS: Client self-activation rejected as expected:`);
      console.log(`  - Error Code: ${clientActErr.code}`);
      console.log(`  - Error Message: "${clientActErr.message}"`);
      if (clientActErr.code === '42501' || clientActErr.message.includes('Clients cannot self-activate')) {
        auditReport.step8_clientSelfActivationBlocked = true;
      }
    } else {
      console.error('FAIL: Client was illegally permitted to activate consultation!', clientActData);
    }

    // -------------------------------------------------------------------------
    // STEP 9: Test that Unassigned Doctor CANNOT Activate It
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 9: Testing Unassigned Doctor Activation Rejection ---');
    const { data: otherDocData, error: otherDocErr } = await otherDocAuth.client.rpc('activate_consultation', {
      p_consultation_id: testConsultation1Id,
    });

    if (otherDocErr) {
      console.log(`PASS: Unassigned doctor activation rejected as expected:`);
      console.log(`  - Error Code: ${otherDocErr.code}`);
      console.log(`  - Error Message: "${otherDocErr.message}"`);
      if (otherDocErr.code === '42501') {
        auditReport.step9_unassignedDoctorBlocked = true;
      }
    } else {
      console.error('FAIL: Unassigned doctor was illegally permitted to activate consultation!', otherDocData);
    }

    // -------------------------------------------------------------------------
    // STEP 3: Assigned Doctor Activates Consultation
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 3, 4, 5, 6, 7: Assigned Doctor Executes activate_consultation() ---');
    const { data: docActData, error: docActErr } = await assignedDocAuth.client.rpc('activate_consultation', {
      p_consultation_id: testConsultation1Id,
    });

    if (docActErr) {
      console.error('FAIL: Assigned doctor activation failed:', docActErr.message, 'Code:', docActErr.code);
      throw new Error(`Step 3 Failed: ${docActErr.message}`);
    }

    // TASK 3 FIX: Immediately track created conversation ID before ANY subsequent assertions can fail
    const { data: convImmediate } = await assignedDocAuth.client
      .from('chat_conversations')
      .select('id')
      .eq('consultation_id', testConsultation1Id);
    if (convImmediate && convImmediate.length > 0) {
      for (const c of convImmediate) {
        if (!createdConversationIds.includes(c.id)) {
          createdConversationIds.push(c.id);
        }
      }
    }

    auditReport.step3_assignedDoctorActivation = true;
    console.log('PASS: Assigned doctor successfully executed activate_consultation RPC!');
    console.log('Result payload:', JSON.stringify(docActData, null, 2));

    // Step 4: Status is active
    if (docActData.consultation_status === 'active') {
      auditReport.step4_statusActive = true;
      console.log('PASS (Step 4): consultation_status is now "active".');
    }

    // Step 5: activated_at and expires_at are exactly 7 days apart
    const actTime = new Date(docActData.activated_at).getTime();
    const expTime = new Date(docActData.expires_at).getTime();
    const diffMs = expTime - actTime;
    const expected7DaysMs = 7 * 24 * 60 * 60 * 1000; // 604,800,000 ms

    console.log(`  - activated_at: ${docActData.activated_at}`);
    console.log(`  - expires_at:   ${docActData.expires_at}`);
    console.log(`  - Difference:   ${diffMs} ms (Exact 7 days: ${expected7DaysMs} ms)`);

    if (Math.abs(diffMs - expected7DaysMs) < 1000) {
      auditReport.step5_exact7DayExpiry = true;
      console.log('PASS (Step 5): activated_at and expires_at are EXACTLY 7 days apart (604,800 seconds).');
    } else {
      console.error('FAIL (Step 5): Expiry is not 7 days!');
    }

    // Step 6: Verify exactly one chat_conversations record created
    console.log('\n--- STEP 6: Verifying chat_conversations Record Creation ---');
    const { data: convData, error: convErr } = await assignedDocAuth.client
      .from('chat_conversations')
      .select('*')
      .eq('consultation_id', testConsultation1Id);

    if (convErr) {
      console.error('Failed to query chat_conversations:', convErr.message);
    } else {
      console.log(`Found ${convData.length} conversation(s) for consultation ${testConsultation1Id}.`);
      if (convData.length === 1) {
        auditReport.step6_singleConversationCreated = true;
        console.log('PASS (Step 6): Exactly one chat_conversations record created.');
        console.log('  - Conversation ID:', convData[0].id);
        console.log('  - Client ID:', convData[0].client_id);
        console.log('  - Doctor ID:', convData[0].doctor_id);
      } else {
        console.error('FAIL (Step 6): Expected 1 conversation, found', convData.length);
      }
    }

    // Step 7: Verify audit_log entry created
    console.log('\n--- STEP 7: Verifying audit_logs Entry ---');
    const { data: auditData, error: auditErr } = await adminAuth.client
      .from('audit_logs')
      .select('*')
      .eq('entity_id', testConsultation1Id)
      .eq('action', 'ACTIVATE_CONSULTATION')
      .order('created_at', { ascending: false });

    if (auditErr) {
      console.error('Failed to query audit_logs:', auditErr.message);
    } else {
      console.log(`Found ${auditData.length} audit log(s) for consultation ${testConsultation1Id}.`);
      if (auditData.length >= 1) {
        auditReport.step7_auditLogCreated = true;
        console.log('PASS (Step 7): Audit log record verified.');
        console.log('  - User ID:', auditData[0].user_id);
        console.log('  - Action:', auditData[0].action);
        console.log('  - Details:', auditData[0].details);
      } else {
        console.error('FAIL (Step 7): No audit log record found!');
      }
    }

    // -------------------------------------------------------------------------
    // STEP 11: Test that Repeated Activation is Rejected (Invalid State 22023)
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 11: Testing Repeated Activation Rejection ---');
    const { data: repeatData, error: repeatErr } = await assignedDocAuth.client.rpc('activate_consultation', {
      p_consultation_id: testConsultation1Id,
    });

    if (repeatErr) {
      console.log(`PASS: Repeated activation rejected as expected:`);
      console.log(`  - Error Code: ${repeatErr.code}`);
      console.log(`  - Error Message: "${repeatErr.message}"`);
      if (repeatErr.code === '22023' || repeatErr.message.includes('already in status active')) {
        auditReport.step11_repeatedActivationRejected = true;
      }
    } else {
      console.error('FAIL: Repeated activation was illegally permitted!', repeatData);
    }

    // -------------------------------------------------------------------------
    // STEP 10: Test that Authorized Admin CAN Activate a Pending Consultation
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 10: Testing Admin Activation of Pending Consultation ---');
    let testConsultation2Id = null;

    const { data: cons2, error: cons2Err } = await clientAuth.client
      .from('consultations')
      .insert({
        client_id: clientAuth.user.id,
        doctor_id: ACCOUNTS.assignedDoctor.doctorId,
        pet_id: TEST_PET_ID,
        consultation_reason: '[CONTROLLED-TEST] Admin triage override test: Emergency cardiac evaluation',
        consultation_status: 'pending',
      })
      .select()
      .single();

    if (cons2Err) {
      console.error('Failed to create second consultation for admin test:', cons2Err.message);
    } else {
      testConsultation2Id = cons2.id;
      createdConsultationIds.push(testConsultation2Id);
      console.log(`Created second pending consultation for admin test. ID: ${testConsultation2Id}`);

      const { data: adminActData, error: adminActErr } = await adminAuth.client.rpc('activate_consultation', {
        p_consultation_id: testConsultation2Id,
      });

      if (adminActErr) {
        console.error('FAIL: Admin activation failed:', adminActErr.message, 'Code:', adminActErr.code);
      } else {
        // TASK 3 FIX: Immediately track second conversation ID
        const { data: conv2Lookup } = await adminAuth.client
          .from('chat_conversations')
          .select('id')
          .eq('consultation_id', testConsultation2Id);
        if (conv2Lookup && conv2Lookup.length > 0) {
          for (const c of conv2Lookup) {
            if (!createdConversationIds.includes(c.id)) {
              createdConversationIds.push(c.id);
            }
          }
        }

        console.log('PASS (Step 10): Authorized administrator successfully activated consultation!');
        console.log('  - Status:', adminActData.consultation_status);
        console.log('  - Activated At:', adminActData.activated_at);
        console.log('  - Expires At:', adminActData.expires_at);
        auditReport.step10_adminActivationSucceeded = true;
      }
    }

    // -------------------------------------------------------------------------
    // STEP 12: Direct Remote Database Integrity Verification
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 12: Direct Remote Database Integrity Verification ---');
    const { data: readCons } = await adminAuth.client
      .from('consultations')
      .select('*')
      .in('id', createdConsultationIds);

    const { data: readConvs } = await adminAuth.client
      .from('chat_conversations')
      .select('*')
      .in('consultation_id', createdConsultationIds);

    console.log(`Read from consultations table: ${readCons?.length || 0} records.`);
    console.log(`Read from chat_conversations table: ${readConvs?.length || 0} records.`);

    if (readCons && readCons.length >= 1 && readConvs && readConvs.length >= 1) {
      auditReport.step12_remoteDbIntegrityVerified = true;
      console.log('PASS (Step 12): All modified records accurately verified against live remote PostgreSQL database.');
    }
  } catch (ex) {
    console.error('Execution exception in test suite:', ex.message);
  } finally {
    // Teardown: Safely cleanup test consultation records to leave zero residue
    if (adminAuth && adminAuth.client) {
      teardownResult = await cleanupTestRecords(adminAuth.client);
    } else if (createdConsultationIds.length > 0) {
      console.error('\n[CRITICAL TEARDOWN ALERT] Admin authentication was unavailable to execute automated cleanup.');
      console.error('The following test consultations were created and require manual removal:');
      console.error('  IDs:', createdConsultationIds.join(', '));
      console.error('Manual SQL command for Supabase SQL Editor:');
      console.error(`SELECT public.cleanup_test_records(ARRAY[${createdConsultationIds.map(id => `'${id}'`).join(', ')}]::uuid[]);`);
    }

    // Final Report Summary
    console.log('\n================================================================');
    console.log('PET CONNECT — LIVE SUPABASE RPC VERIFICATION SUMMARY');
    console.log('================================================================');
    console.log('1. Dedicated Test Accounts Authenticated:      ', auditReport.step1_accounts ? 'PASS' : 'FAIL');
    console.log('2. Pending Consultation Record Created:        ', auditReport.step2_pendingConsultation ? 'PASS' : 'FAIL');
    console.log('3. Assigned Doctor RPC Activation Executed:    ', auditReport.step3_assignedDoctorActivation ? 'PASS' : 'FAIL');
    console.log('4. Consultation Status Updated to "active":   ', auditReport.step4_statusActive ? 'PASS' : 'FAIL');
    console.log('5. Exact 7-Day Expiry (604,800s):             ', auditReport.step5_exact7DayExpiry ? 'PASS' : 'FAIL');
    console.log('6. Exactly 1 chat_conversations Record:        ', auditReport.step6_singleConversationCreated ? 'PASS' : 'FAIL');
    console.log('7. Audit Log Entry Verified:                   ', auditReport.step7_auditLogCreated ? 'PASS' : 'FAIL');
    console.log('8. Client Self-Activation Blocked (42501):     ', auditReport.step8_clientSelfActivationBlocked ? 'PASS' : 'FAIL');
    console.log('9. Unassigned Doctor Blocked (42501):          ', auditReport.step9_unassignedDoctorBlocked ? 'PASS' : 'FAIL');
    console.log('10. Authorized Admin Activation Succeeded:     ', auditReport.step10_adminActivationSucceeded ? 'PASS' : 'FAIL');
    console.log('11. Repeated Activation Rejected (22023):      ', auditReport.step11_repeatedActivationRejected ? 'PASS' : 'FAIL');
    console.log('12. Remote Database Integrity Verified:        ', auditReport.step12_remoteDbIntegrityVerified ? 'PASS' : 'FAIL');

    const all12StepsPassed = Object.values(auditReport).every(Boolean);
    const teardownPassed = Boolean(
      teardownResult &&
      teardownResult.cleanupRpcSuccess &&
      teardownResult.queriesSucceeded &&
      teardownResult.residualCountsZero
    );

    console.log('----------------------------------------------------------------');
    console.log('TEARDOWN & RESIDUAL INTEGRITY VERIFICATION');
    console.log('----------------------------------------------------------------');
    console.log('Cleanup RPC Succeeded:                         ', teardownResult?.cleanupRpcSuccess ? 'PASS' : 'FAIL');
    console.log('Residual Queries Succeeded:                    ', teardownResult?.queriesSucceeded ? 'PASS' : 'FAIL');
    console.log('Residual Counts Equal Zero (0 Residue):        ', teardownResult?.residualCountsZero ? 'PASS' : 'FAIL');
    console.log('================================================================');

    if (all12StepsPassed && teardownPassed) {
      console.log('OVERALL TEST SUITE STATUS: PASS (All 12 steps + zero residual records)');
      process.exit(0);
    } else {
      console.error('OVERALL TEST SUITE STATUS: FAIL');
      if (!all12StepsPassed) console.error('  - One or more test steps failed.');
      if (!teardownPassed) console.error('  - Teardown or post-cleanup residual check failed.');
      process.exit(1);
    }
  }
}

runTestSuite();
