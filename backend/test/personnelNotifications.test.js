import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import nodemailer from 'nodemailer';

import { sendSmtpMail } from '../src/services/email.service.js';
import { processPersonnelNotifications, startPersonnelNotificationWorker } from '../src/services/personnelNotifications.service.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'private-one-time-test-token';
const EMAIL = 'nurse@example.test';
const CONFIG = {
  isSupabaseConfigured: true,
  isProduction: false,
  supabaseUrl: 'https://project.example.test',
  clientUrl: 'https://app.example.test',
  smtpHost: 'smtp.example.test', smtpPort: 587,
  smtpUser: 'test-smtp-user', smtpPassword: 'test-smtp-password',
  smtpFrom: 'KALUSAGAP <notices@example.test>',
  personnelNotificationIntervalMs: 60_000,
};
const smtpError = (code, command, responseCode) => Object.assign(
  new Error(`Provider text containing ${EMAIL} and ${TOKEN}`),
  { code, command, responseCode },
);
const accepted = (message, overrides = {}) => ({
  accepted: [message.to.address], rejected: [],
  response: '250 2.0.0 accepted by test transport', messageId: message.messageId,
  ...overrides,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// These injected clients model only the supplied RPC boundary. They are never
// selected by production code; actual SQL locking/uniqueness has separate tests.
const fixture = (options = {}) => {
  const state = {
    jobs: (options.jobs || [{ event_type: options.eventType || 'approved' }]).map((row) => ({
      id: JOB_ID, account_id: ACCOUNT_ID, event_type: 'approved',
      status: 'pending', attempts: 0, due: true, claim_token: null,
      reason: 'Administrative decision reason', ...row,
    })),
    account: {
      account_id: ACCOUNT_ID, approval_status: 'approved', activation_requested: true,
      setup_required: false, setup_completed_at: null, suspended_at: null,
      decision_reason: 'Current lifecycle reason', ...options.account,
    },
    profile: { id: ACCOUNT_ID, email: EMAIL, full_name: 'Nurse Example', role: 'phn', status: 'active', ...options.profile },
    authUser: { id: ACCOUNT_ID, email: EMAIL, email_confirmed_at: '2026-10-30T10:00:00Z', ...options.authUser },
    events: [], queries: [], rpcCalls: [], authReads: [], links: [], messages: [], logs: [],
  };
  const logger = Object.fromEntries(['info', 'warn', 'error'].map((level) => [level, (...args) => state.logs.push([level, ...args])]));
  const supabase = {
    from(table) {
      const query = { table, columns: null, filters: {} };
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters[column] = value; return builder; },
        async maybeSingle() {
          state.queries.push(query);
          state.events.push(`read:${table}`);
          return {
            data: table === 'profiles' ? state.profile : state.account,
            error: options.queryError?.[table] || null,
          };
        },
      };
      return builder;
    },
    auth: { admin: {
      async getUserById(id) {
        state.authReads.push(id);
        state.events.push('auth:read');
        return { data: { user: state.authUser }, error: options.authError || null };
      },
      async generateLink(args) {
        state.links.push(args);
        state.events.push('auth:link');
        if (options.onLink) await options.onLink(state);
        return {
          data: {
            user: options.generatedUser || state.authUser,
            properties: {
              action_link: options.actionLink || `https://project.example.test/auth/v1/verify?token=${TOKEN}&type=${args.type}&redirect_to=${encodeURIComponent(args.options.redirectTo)}`,
            },
          },
          error: options.linkError || null,
        };
      },
      createUser() { assert.fail('The notification worker must never create Auth users'); },
      updateUserById() { assert.fail('Approval must never reset an existing account credential'); },
    } },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      if (name === 'claim_personnel_notifications') {
        state.events.push('claim');
        if (options.claimError) return { data: null, error: options.claimError };
        if (options.claimRows) return { data: options.claimRows, error: null };
        const rows = state.jobs.filter((job) => ['pending', 'failed'].includes(job.status)
          && job.due && job.attempts < 8 && (!args.p_target_id || job.account_id === args.p_target_id)).slice(0, args.p_limit);
        for (const job of rows) {
          job.status = 'processing';
          job.attempts += 1;
          job.claim_token = `44444444-4444-4444-8444-${String(job.attempts).padStart(12, '0')}`;
        }
        return { data: rows.map((job) => ({ ...job })), error: null };
      }
      const job = state.jobs.find((row) => row.id === args.p_notification_id);
      if (name === 'begin_personnel_notification_send') {
        state.events.push('begin');
        if (options.onBegin) await options.onBegin(state);
        if (options.beginError) return { data: null, error: options.beginError };
        if (!job || job.status !== 'processing' || job.claim_token !== args.p_claim_token) return { data: false, error: null };
        const valid = ['approved', 'reactivated', 'invitation'].includes(job.event_type)
          ? state.account.approval_status === 'approved' && !state.account.suspended_at
          : job.event_type === 'rejected' ? state.account.approval_status === 'rejected'
            : job.event_type === 'suspended' && Boolean(state.account.suspended_at);
        if (!valid) { job.status = 'cancelled'; return { data: false, error: null }; }
        job.status = 'sending';
        return { data: true, error: null };
      }
      assert.equal(name, 'finish_personnel_notification');
      state.events.push(`finish:${args.p_status}`);
      if (options.finishError) return { data: null, error: options.finishError };
      if (!job || !['processing', 'sending'].includes(job.status) || job.claim_token !== args.p_claim_token) return { data: false, error: null };
      job.status = args.p_status;
      job.last_error_code = args.p_error_code;
      job.provider_message_id = args.p_provider_id;
      job.due = false;
      return { data: true, error: null };
    },
  };
  const transport = options.transport || {
    async sendMail(message) {
      state.events.push('smtp');
      state.messages.push(message);
      return options.send ? options.send(message, state) : accepted(message);
    },
  };
  const run = (extra = {}) => processPersonnelNotifications({ supabase, transport, config: { ...CONFIG, ...options.config }, logger, ...extra });
  return { state, supabase, transport, logger, run };
};

test('an empty committed outbox sends nothing and reads no Auth identity', async () => {
  const f = fixture({ jobs: [] });
  const result = await f.run();
  assert.equal(result.claimed, 0);
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.state.authReads.length, 0);
});

test('ordinary approved accounts keep credentials and send only after begin CAS', async () => {
  const f = fixture();
  const result = await f.run({ targetId: ACCOUNT_ID });
  assert.equal(result.mailServerAccepted, 1);
  assert.equal(f.state.jobs[0].status, 'sent');
  assert.deepEqual(f.state.authReads, [ACCOUNT_ID]);
  assert.equal(f.state.links.length, 0);
  assert.match(f.state.messages[0].text, /approved/);
  assert.match(f.state.messages[0].text, /account is active/);
  assert.match(f.state.messages[0].text, /existing credentials; they have not been changed/);
  assert.match(f.state.messages[0].text, /https:\/\/app.example.test\/login/);
  assert.doesNotMatch(f.state.messages[0].text, /reset-password|token=|Set Your Password/);
  assert(f.state.events.indexOf('begin') < f.state.events.indexOf('smtp'));
  assert.deepEqual(f.state.rpcCalls[0].args, { p_limit: 10, p_target_id: ACCOUNT_ID });
  assert.equal(f.state.jobs[0].provider_message_id, f.state.messages[0].messageId);
  assert.equal(f.state.jobs[0].last_error_code, null);
});

test('approved but inactive existing accounts do not promise access or reset passwords', async () => {
  const f = fixture({ account: { activation_requested: false }, profile: { status: 'disabled' } });
  await f.run();
  assert.match(f.state.messages[0].text, /approved, but access is not currently active/);
  assert.equal(f.state.links.length, 0);
});

test('an unconfirmed setup-required identity gets an expiring invite, never createUser', async () => {
  const f = fixture({ account: { setup_required: true }, profile: { status: 'pending_verification' }, authUser: { email_confirmed_at: null } });
  await f.run();
  assert.deepEqual(f.state.links, [{ type: 'invite', email: EMAIL, options: { redirectTo: 'https://app.example.test/reset-password' } }]);
  assert(f.state.events.indexOf('auth:read') < f.state.events.indexOf('auth:link'));
  assert(f.state.events.indexOf('auth:link') < f.state.events.indexOf('begin'));
  assert.match(f.state.messages[0].text, /account remains inactive until you complete password setup/);
  assert.match(f.state.messages[0].text, /Activation has been requested/);
  assert.match(f.state.messages[0].text, /expiring, one-time/);
  assert.doesNotMatch(f.state.messages[0].text, /\b\d+ (minutes|hours|days)|account is active/);
});

test('a confirmed new setup-required identity gets recovery only after actual Auth read', async () => {
  const f = fixture({ eventType: 'invitation', account: { setup_required: true, activation_requested: false } });
  await f.run();
  assert.equal(f.state.links[0].type, 'recovery');
  assert.match(f.state.messages[0].text, /Access has not been enabled/);
  assert.doesNotMatch(f.state.messages[0].text, /account is active/);
});

test('general administrative accounts using the same lifecycle receive their secure setup invitation', async () => {
  const f = fixture({ eventType: 'invitation', profile: { role: 'admin', status: 'disabled' }, account: { setup_required: true }, authUser: { email_confirmed_at: null } });
  const result = await f.run();
  assert.equal(result.mailServerAccepted, 1);
  assert.equal(f.state.jobs[0].status, 'sent');
  assert.equal(f.state.links[0].type, 'invite');
  assert.match(f.state.messages[0].subject, /Administrative Password Setup/);
  assert.match(f.state.messages[0].text, /administrative account/);
  assert.doesNotMatch(f.state.messages[0].text, /health personnel|account is active/i);
});

test('resident identities never receive personnel lifecycle notifications', async () => {
  const f = fixture({ profile: { role: 'resident' } });
  await f.run();
  assert.equal(f.state.jobs[0].status, 'cancelled');
  assert.equal(f.state.authReads.length, 0);
  assert.equal(f.state.messages.length, 0);
});

test('completed setup cancels an old invitation instead of changing credentials', async () => {
  const f = fixture({ eventType: 'invitation', account: { setup_required: true, setup_completed_at: '2026-10-31T01:00:00Z' } });
  await f.run();
  assert.equal(f.state.jobs[0].status, 'cancelled');
  assert.equal(f.state.authReads.length, 0);
  assert.equal(f.state.links.length, 0);
  assert.equal(f.state.messages.length, 0);
});

for (const eventType of ['rejected', 'suspended']) {
  test(`${eventType} notices include an escaped reason and no access/password link`, async () => {
    const reason = '<img src=x onerror="bad()"> Decision details';
    const f = fixture({
      eventType, config: { clientUrl: '' },
      jobs: [{ event_type: eventType, reason }],
      account: { approval_status: eventType === 'rejected' ? 'rejected' : 'approved', suspended_at: eventType === 'suspended' ? '2026-10-31T00:00:00Z' : null, setup_required: true },
      profile: { status: 'disabled' },
    });
    await f.run();
    assert.equal(f.state.jobs[0].status, 'sent');
    assert.equal(f.state.links.length, 0);
    assert.match(f.state.messages[0].text, /Decision details/);
    assert.match(f.state.messages[0].html, /&lt;img/);
    assert.doesNotMatch(f.state.messages[0].html, /<img|href=|reset-password|token=/);
    assert.doesNotMatch(f.state.messages[0].text, /https?:|Set Your Password|Sign In:/);
  });
}

for (const change of [{ approval_status: 'rejected' }, { suspended_at: '2026-10-31T00:00:00Z' }]) {
  test(`stale approved/invitation jobs are cancelled for ${Object.keys(change)[0]}`, async () => {
    const f = fixture({ account: { setup_required: true, ...change } });
    await f.run();
    assert.equal(f.state.jobs[0].status, 'cancelled');
    assert.equal(f.state.links.length, 0);
    assert.equal(f.state.messages.length, 0);
  });
}

test('a suspension after link preparation is caught by begin CAS before SMTP', async () => {
  const f = fixture({ account: { setup_required: true }, onBegin: (state) => { state.account.suspended_at = '2026-10-31T00:00:00Z'; } });
  const result = await f.run();
  assert.equal(f.state.links.length, 1);
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.state.jobs[0].status, 'cancelled');
  assert.equal(result.notStarted, 1);
});

test('sent, sending, processing, unknown and exhausted failures are never reset by the worker', async () => {
  for (const status of ['sent', 'sending', 'processing', 'delivery_unknown', 'cancelled']) {
    const f = fixture({ jobs: [{ status }] });
    await f.run();
    assert.equal(f.state.messages.length, 0);
    assert.equal(f.state.jobs[0].status, status);
    assert.equal(f.state.rpcCalls.length, 1);
  }
  const f = fixture({ jobs: [{ status: 'failed', attempts: 8 }] });
  await f.run();
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.state.jobs[0].attempts, 8);
});

test('re-running a successfully sent job cannot generate another link or notification', async () => {
  const f = fixture({ account: { setup_required: true } });
  await f.run();
  await f.run();
  assert.equal(f.state.messages.length, 1);
  assert.equal(f.state.links.length, 1);
  assert.equal(f.state.jobs[0].attempts, 1);
});

test('a duplicate claim result cannot regenerate an accepted setup link', async () => {
  const claimed = { id: JOB_ID, account_id: ACCOUNT_ID, event_type: 'invitation', status: 'processing', claim_token: OTHER_ID };
  const f = fixture({ account: { setup_required: true }, jobs: [{ ...claimed }], claimRows: [{ ...claimed }, { ...claimed }] });
  await f.run();
  assert.equal(f.state.links.length, 1);
  assert.equal(f.state.messages.length, 1);
});

test('an unexpected sent row returned by claim is not processed', async () => {
  const f = fixture({ claimRows: [{ id: JOB_ID, account_id: ACCOUNT_ID, claim_token: OTHER_ID, status: 'sent' }] });
  const result = await f.run();
  assert.equal(result.notStarted, 1);
  assert.equal(f.state.messages.length, 0);
  assert.equal(f.state.authReads.length, 0);
});

for (const authUser of [{ id: OTHER_ID }, { email: 'different@example.test' }]) {
  test(`Auth ${Object.keys(authUser)[0]} mismatch fails before link generation`, async () => {
    const f = fixture({ authUser, account: { setup_required: true } });
    await f.run();
    assert.equal(f.state.jobs[0].status, 'failed');
    assert.equal(f.state.jobs[0].last_error_code, 'AUTH_IDENTITY_MISMATCH');
    assert.equal(f.state.links.length, 0);
    assert.equal(f.state.messages.length, 0);
  });
}

for (const generatedUser of [{ id: OTHER_ID, email: EMAIL }, { id: ACCOUNT_ID, email: 'different@example.test' }]) {
  test(`generated invitation ${generatedUser.id === OTHER_ID ? 'id' : 'email'} must match the existing identity`, async () => {
    const f = fixture({ generatedUser, account: { setup_required: true } });
    await f.run();
    assert.equal(f.state.jobs[0].last_error_code, 'AUTH_LINK_IDENTITY_MISMATCH');
    assert.equal(f.state.messages.length, 0);
    assert(!f.state.events.includes('begin'));
  });
}

test('Supabase silently falling back to a different redirect fails transparently', async () => {
  const f = fixture({ account: { setup_required: true }, actionLink: `https://project.example.test/auth/v1/verify?token=${TOKEN}&type=recovery&redirect_to=https%3A%2F%2Fapp.example.test%2F` });
  await f.run();
  assert.equal(f.state.jobs[0].last_error_code, 'AUTH_REDIRECT_MISMATCH');
  assert.equal(f.state.messages.length, 0);
});

test('invalid generated links are never sent', async () => {
  for (const actionLink of ['javascript:alert(1)', 'https://project.example.test/?redirect_to=https%3A%2F%2Fapp.example.test%2Freset-password']) {
    const f = fixture({ account: { setup_required: true }, actionLink });
    await f.run();
    assert.equal(f.state.jobs[0].last_error_code, 'AUTH_LINK_INVALID');
    assert.equal(f.state.messages.length, 0);
  }
});

test('missing SMTP persists a diagnostic without generating a link or simulating acceptance', async () => {
  const f = fixture({ config: { smtpHost: '' }, account: { setup_required: true } });
  const result = await f.run();
  assert.equal(result.failed, 1);
  assert.equal(result.mailServerAccepted, 0);
  assert.equal(f.state.jobs[0].last_error_code, 'SMTP_NOT_CONFIGURED');
  assert.equal(f.state.links.length, 0);
  assert.equal(f.state.messages.length, 0);
  assert.match(JSON.stringify(f.state.logs), /SMTP_NOT_CONFIGURED/);
});

test('missing configured CLIENT_URL does not use implicit development CORS origins', async () => {
  const f = fixture({ config: { clientUrl: '', clientUrls: ['http://localhost:5173'] }, account: { setup_required: true } });
  await f.run();
  assert.equal(f.state.jobs[0].last_error_code, 'CLIENT_URL_NOT_CONFIGURED');
  assert.equal(f.state.links.length, 0);
  assert.equal(f.state.messages.length, 0);
});

test('insecure or noncanonical configured client redirects fail without sending', async () => {
  for (const clientUrl of ['http://app.example.test', 'https://user:secret@app.example.test', 'https://app.example.test/reset-password']) {
    const f = fixture({ config: { clientUrl } });
    await f.run();
    assert.equal(f.state.jobs[0].last_error_code, 'CLIENT_URL_INVALID');
    assert.equal(f.state.messages.length, 0);
  }
});

test('missing Supabase never opens a transport or provides a mock success', async () => {
  const logs = [];
  const result = await processPersonnelNotifications({ config: { ...CONFIG, isSupabaseConfigured: false }, logger: { warn: (...args) => logs.push(args) } });
  assert.equal(result.errorCode, 'SUPABASE_NOT_CONFIGURED');
  assert.equal(result.mailServerAccepted, 0);
  assert.match(JSON.stringify(logs), /SUPABASE_NOT_CONFIGURED/);
});

test('definitive SMTP auth rejection retries only when the database claims it due', async () => {
  let fail = true;
  const f = fixture({ send: (message) => {
    if (fail) { fail = false; throw smtpError('EAUTH', 'AUTH LOGIN', 535); }
    return accepted(message);
  } });
  assert.equal((await f.run()).failed, 1);
  assert.equal(f.state.jobs[0].last_error_code, 'SMTP_EAUTH');
  await f.run();
  assert.equal(f.state.messages.length, 1);
  f.state.jobs[0].due = true;
  assert.equal((await f.run()).mailServerAccepted, 1);
  assert.equal(f.state.messages.length, 2);
  assert.equal(f.state.jobs[0].attempts, 2);
  assert.equal(f.state.messages[0].messageId, f.state.messages[1].messageId);
});

test('a monitored pre-DATA connection failure is definitively unsent and retryable', async () => {
  const f = fixture({ send: (message) => {
    message.personnelSmtpProgress.monitored = true;
    throw smtpError('ESOCKET', 'CONN');
  } });
  await f.run();
  assert.equal(f.state.jobs[0].status, 'failed');
  assert.equal(f.state.jobs[0].last_error_code, 'SMTP_ESOCKET');
});

for (const code of ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET']) {
  test(`a ${code} disconnect after body start is unknown and never automatically retried`, async () => {
    const f = fixture({ account: { setup_required: true }, send: (message) => {
      message.personnelSmtpProgress.monitored = true;
      message.personnelSmtpProgress.bodyStarted = true;
      throw smtpError(code, 'CONN');
    } });
    await f.run();
    await f.run();
    assert.equal(f.state.jobs[0].status, 'delivery_unknown');
    assert.equal(f.state.messages.length, 1);
    assert.equal(f.state.links.length, 1);
    assert.equal(f.state.jobs[0].provider_message_id, null);
  });
}

test('CONN without trustworthy body tracking is not treated as pre-DATA', async () => {
  const f = fixture({ send: () => { throw smtpError('ECONNECTION', 'CONN'); } });
  await f.run();
  assert.equal(f.state.jobs[0].status, 'delivery_unknown');
});

test('unknown thrown provider errors are parked even with a pre-body marker', async () => {
  const f = fixture({ send: (message) => {
    message.personnelSmtpProgress.monitored = true;
    throw new Error(`${EMAIL}: ${TOKEN}`);
  } });
  await f.run();
  assert.equal(f.state.jobs[0].status, 'delivery_unknown');
  assert.equal(f.state.jobs[0].last_error_code, 'SMTP_OUTCOME_UNKNOWN');
});

for (const responseCode of [451, 550]) {
  test(`explicit ${responseCode} rejection after DATA is definitive unsent, not unknown`, async () => {
    const f = fixture({ send: (message) => {
      message.personnelSmtpProgress.monitored = true;
      message.personnelSmtpProgress.bodyStarted = true;
      throw smtpError('EMESSAGE', 'DATA', responseCode);
    } });
    await f.run();
    assert.equal(f.state.jobs[0].status, 'failed');
  });
}

test('a returned empty accepted list with the recipient rejected is a failed send', async () => {
  const f = fixture({ send: (message) => accepted(message, { accepted: [], rejected: [EMAIL], response: '550 rejected' }) });
  await f.run();
  assert.equal(f.state.jobs[0].status, 'failed');
  assert.equal(f.state.jobs[0].last_error_code, 'SMTP_RECIPIENT_REJECTED');
});

for (const [label, overrides] of [
  ['wrong recipient', { accepted: ['other@example.test'] }],
  ['missing acceptance', { accepted: undefined }],
  ['missing acknowledgment', { response: undefined }],
  ['missing transport Message-ID', { messageId: undefined }],
  ['unexpected transport Message-ID', { messageId: '<different@example.test>' }],
  ['contradictory rejection', { rejected: [EMAIL] }],
  ['pending recipient', { pending: [EMAIL] }],
]) {
  test(`${label} is not labeled sent and is not automatically retried`, async () => {
    const f = fixture({ send: (message) => accepted(message, overrides) });
    const result = await f.run();
    assert.equal(result.mailServerAccepted, 0);
    assert.equal(f.state.jobs[0].status, 'delivery_unknown');
    await f.run();
    assert.equal(f.state.messages.length, 1);
  });
}

test('recipient acceptance is case-insensitive but still bound to the intended identity', async () => {
  const f = fixture({ send: (message) => accepted(message, { accepted: [{ address: ` ${EMAIL.toUpperCase()} ` }] }) });
  assert.equal((await f.run()).mailServerAccepted, 1);
});

test('a multiline SMTP acknowledgment uses its final successful reply', async () => {
  const f = fixture({ send: (message) => accepted(message, { response: '250-first acknowledgment line\r\n250 2.0.0 mail-server accepted' }) });
  assert.equal((await f.run()).mailServerAccepted, 1);
});

test('an ambiguous post-send failure is not retried even if its command reports rejection', async () => {
  const f = fixture({ send: () => { throw smtpError('EPROTOCOL', 'QUIT', 500); } });
  await f.run();
  assert.equal(f.state.jobs[0].status, 'delivery_unknown');
});

test('reactivation notices accurately retain credentials and separate inactive access', async () => {
  const f = fixture({ eventType: 'reactivated', account: { activation_requested: false }, profile: { status: 'disabled' } });
  await f.run();
  assert.match(f.state.messages[0].subject, /Reactivated/);
  assert.match(f.state.messages[0].text, /removed the suspension/);
  assert.match(f.state.messages[0].text, /access is not currently active/);
  assert.equal(f.state.links.length, 0);
});

test('accepted SMTP plus lost DB finalization leaves sending and never resets it for retry', async () => {
  const f = fixture({ finishError: { message: `${TOKEN} ${EMAIL}` } });
  const result = await f.run();
  assert.equal(result.mailServerAccepted, 1);
  assert.equal(result.unfinalized, 1);
  assert.equal(f.state.jobs[0].status, 'sending');
  await f.run();
  assert.equal(f.state.messages.length, 1);
  assert.deepEqual(f.state.rpcCalls.filter((call) => call.name === 'finish_personnel_notification').map((call) => call.args.p_status), ['sent']);
  // SQL's stale-sending recovery parks this status; the worker never resets it.
  f.state.jobs[0].status = 'delivery_unknown';
  await f.run();
  assert.equal(f.state.messages.length, 1);
});

test('DB/Auth/provider errors and generated links do not enter logs, RPC metadata or return values', async () => {
  for (const options of [
    { account: { setup_required: true } },
    { account: { setup_required: true }, linkError: { message: `${TOKEN} ${EMAIL}` } },
    { authError: { message: `${TOKEN} ${EMAIL}` } },
    { claimError: { message: `${TOKEN} ${EMAIL}` } },
    { send: () => { throw smtpError('EAUTH', `AUTH ${TOKEN} ${EMAIL}`, 535); } },
  ]) {
    const f = fixture(options);
    const result = await f.run();
    const metadata = JSON.stringify({ result, logs: f.state.logs, rpc: f.state.rpcCalls });
    assert(!metadata.includes(TOKEN));
    assert(!metadata.includes(EMAIL));
    assert(!metadata.includes('Nurse Example'));
    assert(!metadata.includes('action_link'));
    assert(!metadata.includes('html'));
    assert(f.state.queries.every((query) => !query.columns.includes('*')));
    assert(f.state.queries.every((query) => Object.values(query.filters).every((value) => value === ACCOUNT_ID)));
  }
});

test('Nodemailer stream tracking distinguishes connection failure before body consumption', async () => {
  const transport = nodemailer.createTransport({ name: 'isolated-test', version: '1', send: (_mail, callback) => callback(smtpError('ESOCKET', 'CONN')) });
  await assert.rejects(sendSmtpMail({ from: CONFIG.smtpFrom, to: EMAIL, text: 'Private test body' }, { transport }), (error) => {
    assert.equal(error.beforeData, true);
    assert.equal(error.code, 'ESOCKET');
    assert.doesNotMatch(error.message, /nurse|private-one-time/);
    assert.equal(error.command, undefined);
    assert.equal(error.response, undefined);
    return true;
  });
});

test('Nodemailer stream tracking recognizes CONN timeout during body consumption', async () => {
  const transport = nodemailer.createTransport({ name: 'isolated-test', version: '1', send: (mail, callback) => {
    const stream = mail.message.createReadStream();
    stream.once('data', () => callback(smtpError('ETIMEDOUT', 'CONN')));
    stream.resume();
  } });
  await assert.rejects(sendSmtpMail({ from: CONFIG.smtpFrom, to: EMAIL, text: 'Private test body' }, { transport }), (error) => error.beforeData === false && error.code === 'ETIMEDOUT');
});

test('overlapping process calls do not claim or send a duplicate batch', async () => {
  const started = deferred();
  const release = deferred();
  const f = fixture({ send: async (message) => { started.resolve(); await release.promise; return accepted(message); } });
  const first = f.run();
  await started.promise;
  const overlap = await f.run();
  assert.equal(overlap.errorCode, 'WORKER_BUSY');
  assert.equal(f.state.rpcCalls.filter((call) => call.name === 'claim_personnel_notifications').length, 1);
  release.resolve();
  await first;
  assert.equal(f.state.messages.length, 1);
});

test('worker timer is bounded, unrefed, singleton and drained on stop', async (t) => {
  let tick;
  let interval;
  let unrefs = 0;
  let clears = 0;
  t.mock.method(globalThis, 'setInterval', (callback, milliseconds) => {
    tick = callback; interval = milliseconds;
    return { unref: () => { unrefs += 1; } };
  });
  t.mock.method(globalThis, 'clearInterval', () => { clears += 1; });
  const started = deferred();
  const release = deferred();
  const f = fixture({ send: async (message) => { started.resolve(); await release.promise; return accepted(message); } });
  const options = { supabase: f.supabase, transport: f.transport, logger: f.logger, config: { ...CONFIG, personnelNotificationIntervalMs: 1 } };
  const stop = startPersonnelNotificationWorker(options);
  try {
    assert.equal(startPersonnelNotificationWorker(options), stop);
    assert.equal(interval, 10_000);
    assert.equal(unrefs, 1);
    await started.promise;
    tick();
    let drained = false;
    const stopping = stop().then(() => { drained = true; });
    await Promise.resolve();
    assert.equal(drained, false);
    release.resolve();
    await stopping;
    assert.equal(stop(), stop());
    await stop();
    tick();
    assert.equal(clears, 1);
    assert.equal(f.state.messages.length, 1);
    assert.equal(f.state.rpcCalls.filter((call) => call.name === 'claim_personnel_notifications').length, 1);
  } finally {
    release.resolve();
    await stop();
  }
});

test('worker startup with no Supabase creates no timer', async (t) => {
  t.mock.method(globalThis, 'setInterval', () => assert.fail('No DB configuration must not start a worker timer'));
  const stop = startPersonnelNotificationWorker({ config: { ...CONFIG, isSupabaseConfigured: false }, logger: { warn: () => {} } });
  await stop();
});

test('worker is started only by the server entry point, not app imports', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /startPersonnelNotificationWorker/);
  assert.match(server, /stopNotificationWorker = startPersonnelNotificationWorker\(\)/);
  assert.match(server, /await workerStopped/);
});

test('worker interval env defaults and bounds are explicit without a fallback mail redirect', () => {
  for (const [value, milliseconds] of [['', 60_000], ['bad', 60_000], ['1', 10_000], ['9000', 3_600_000]]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import('./src/config/env.js').then(({default:e}) => console.log(JSON.stringify({interval:e.personnelNotificationIntervalMs,url:e.clientUrl})))`], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', CLIENT_URL: '', CORS_ORIGIN: '', PERSONNEL_NOTIFICATION_INTERVAL_SECONDS: value },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { interval: milliseconds, url: '' });
  }
});
