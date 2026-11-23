import { randomBytes } from 'node:crypto';
import env from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';
import { getEmailTransporter, sendSmtpMail } from './email.service.js';
import { decryptTemporaryPassword } from '../utils/temporaryPassword.js';
import { digestInvitationRecoverySecret } from '../utils/personnelInvitationRecovery.js';
import { personnelPasswordSetupValidator } from '../validators/auth.validators.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGED_ROLES = new Set(['admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw']);
const ACCESS_EVENTS = new Set(['approved', 'reactivated', 'invitation']);
const PROFILE_COLUMNS = 'id,email,full_name,role,status';
const ACCOUNT_COLUMNS = 'account_id,approval_status,activation_requested,setup_required,setup_completed_at,must_change_password,temporary_password_expires_at,suspended_at,decision_reason';
const WORKER_ERROR_CODES = new Set([
  'PROFILE_READ_FAILED', 'ACCOUNT_READ_FAILED', 'ACCOUNT_IDENTITY_MISMATCH',
  'AUTH_USER_READ_FAILED', 'AUTH_IDENTITY_MISMATCH', 'AUTH_LINK_GENERATION_FAILED',
  'AUTH_LINK_IDENTITY_MISMATCH', 'AUTH_LINK_INVALID', 'AUTH_REDIRECT_MISMATCH',
  'SMTP_NOT_CONFIGURED', 'CLIENT_URL_NOT_CONFIGURED', 'CLIENT_URL_INVALID', 'TEMPORARY_PASSWORD_INVALID',
  'NOTIFICATION_BEGIN_FAILED', 'NOTIFICATION_RECOVERY_PROOF_FAILED', 'NOTIFICATION_LINK_PREPARE_FAILED',
]);
let activeBatch = null;
let stopCurrentWorker = null;

const failure = (code) => Object.assign(new Error(code), { code });
const emailOf = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = (value) => /^[^\s@<>,;]+@[^\s@<>,;]+$/.test(value);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const log = (logger, level, job, code) => {
  // Codes are application-owned constants; no raw provider errors or PII.
  try {
    logger[level]?.('personnel_notification', {
      notificationId: UUID.test(job?.id || '') ? job.id : null,
      accountId: UUID.test(job?.account_id || '') ? job.account_id : null,
      code,
    });
  } catch { /* Logging must not turn an accepted send into a retry. */ }
};

const emptyResult = () => ({
  claimed: 0, mailServerAccepted: 0, failed: 0, deliveryUnknown: 0,
  cancelled: 0, notStarted: 0, unfinalized: 0,
});

const clientOrigin = (config) => {
  if (!config.clientUrl) throw failure('CLIENT_URL_NOT_CONFIGURED');
  try {
    const url = new URL(config.clientUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash
      || (url.protocol === 'http:' && (!local || config.isProduction))) {
      throw failure('CLIENT_URL_INVALID');
    }
    return url.origin;
  } catch {
    throw failure('CLIENT_URL_INVALID');
  }
};

const eventStillValid = (job, account) => ACCESS_EVENTS.has(job.event_type)
  ? account.approval_status === 'approved' && !account.suspended_at
  : job.event_type === 'rejected' ? account.approval_status === 'rejected'
    : job.event_type === 'suspended' && Boolean(account.suspended_at);

const buildMail = ({ job, account, profile, origin, actionLink, needsSetup, authConfirmed, config, temporaryPassword = null }) => {
  if (temporaryPassword) {
    const loginUrl = `${origin}/login`;
    const text = [
      'KALUSAGAP',
      'COMMUNITY HEALTH MONITORING SYSTEM',
      '',
      'Your account is ready.',
      '',
      `Hello, ${profile.full_name || 'Health Personnel'}. Your KALUSAGAP account has been created and approved.`,
      '',
      `Registered email address: ${profile.email}`,
      `Temporary password: ${temporaryPassword}`,
      'To copy the password, select it and use your email client’s Copy command. Interactive copy controls are not supported by every email app.',
      '',
      `Sign in to KALUSAGAP: ${loginUrl}`,
      '',
      'Your temporary password expires in 10 minutes. After signing in, you will be required to create a new permanent password before accessing your account.',
      '',
      'KALUSAGAP – Community Health Monitoring System.',
      'Municipality of Pili, Camarines Sur.',
      'For your security, do not forward or share this email.',
    ].join('\n');
    return {
      from: config.smtpFrom,
      to: { address: profile.email.trim() },
      messageId: `<personnel-${job.id}@notifications.kalusagap.local>`,
      subject: 'Your KALUSAGAP account is ready.',
      text,
      html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;background-color:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#172b45;">
        <tr><td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #d7e0eb;">
            <tr><td style="padding:26px 28px 18px;">
              <p style="margin:0;color:#102f53;font-size:17px;font-weight:bold;letter-spacing:1px;line-height:22px;">KALUSAGAP</p>
              <p style="margin:4px 0 0;color:#64748b;font-size:10px;font-weight:bold;letter-spacing:1.2px;line-height:15px;">COMMUNITY HEALTH MONITORING SYSTEM</p>
            </td></tr>
            <tr><td style="padding:0 28px;"><div style="height:1px;background-color:#d7e0eb;font-size:1px;line-height:1px;">&nbsp;</div></td></tr>
            <tr><td style="padding:28px 28px 8px;">
              <h1 style="margin:0;color:#102f53;font-size:24px;font-weight:bold;line-height:30px;">Your account is ready.</h1>
              <p style="margin:14px 0 0;color:#34465c;font-size:15px;line-height:23px;">Hello, ${escapeHtml(profile.full_name || 'Health Personnel')}. Your KALUSAGAP account has been created and approved.</p>
            </td></tr>
            <tr><td style="padding:20px 28px 0;">
              <p style="margin:0 0 7px;color:#64748b;font-size:11px;font-weight:bold;letter-spacing:.7px;line-height:16px;text-transform:uppercase;">Registered email address</p>
              <p style="margin:0;color:#172b45;font-size:14px;line-height:21px;word-break:break-word;">${escapeHtml(profile.email)}</p>
            </td></tr>
            <tr><td style="padding:18px 28px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f3f6fa;border:1px solid #d7e0eb;">
                <tr><td style="padding:13px 15px 7px;">
                  <p style="margin:0;color:#64748b;font-size:11px;font-weight:bold;letter-spacing:.7px;line-height:16px;text-transform:uppercase;">Temporary password</p>
                </td></tr>
                <tr><td style="padding:0 15px 5px;">
                  <p style="margin:0;color:#102f53;font-family:Consolas,Menlo,monospace;font-size:20px;font-weight:bold;letter-spacing:2px;line-height:28px;">${escapeHtml(temporaryPassword)}</p>
                </td></tr>
                <tr><td style="padding:0 15px 13px;">
                  <p style="margin:0;color:#64748b;font-size:12px;line-height:18px;">To copy, select the password and use your email app’s copy command. Interactive copy buttons are not supported by all email apps.</p>
                </td></tr>
              </table>
            </td></tr>
            <tr><td align="left" style="padding:23px 28px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="center" bgcolor="#124b86" style="background-color:#124b86;">
                  <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:12px 18px;color:#ffffff;font-size:14px;font-weight:bold;line-height:20px;text-decoration:none;">Sign in to KALUSAGAP</a>
                </td></tr>
              </table>
            </td></tr>
            <tr><td style="padding:20px 28px 25px;">
              <p style="margin:0;color:#34465c;font-size:13px;line-height:20px;"><strong style="color:#102f53;">Security notice</strong><br>Your temporary password expires in 10 minutes. After signing in, you will be required to create a new permanent password before accessing your account.</p>
            </td></tr>
            <tr><td style="padding:0 28px;"><div style="height:1px;background-color:#d7e0eb;font-size:1px;line-height:1px;">&nbsp;</div></td></tr>
            <tr><td style="padding:17px 28px 21px;">
              <p style="margin:0;color:#34465c;font-size:12px;font-weight:bold;line-height:18px;">KALUSAGAP – Community Health Monitoring System</p>
              <p style="margin:3px 0 0;color:#64748b;font-size:12px;line-height:18px;">Municipality of Pili, Camarines Sur.</p>
              <p style="margin:9px 0 0;color:#64748b;font-size:11px;line-height:16px;">Keep your password private. KALUSAGAP staff will never ask you to send it by email.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>`,
    };
  }

  const titlePrefix = profile.role === 'admin' ? 'Administrative' : 'Health Personnel';
  const accountLabel = profile.role === 'admin' ? 'administrative account' : 'health personnel account';
  const titles = {
    approved: `${titlePrefix} Account Approved`,
    reactivated: `${titlePrefix} Account Reactivated`,
    invitation: `${titlePrefix} Password Setup`,
    rejected: `${titlePrefix} Account Request Rejected`,
    suspended: `${titlePrefix} Account Suspended`,
  };
  const paragraphs = [profile.full_name ? `Hello ${profile.full_name},` : 'Hello,'];
  let link = null;
  let linkLabel = null;
  if (job.event_type === 'rejected' || job.event_type === 'suspended') {
    paragraphs.push(job.event_type === 'rejected'
      ? `Your ${accountLabel} request has been rejected. This notice does not grant access to KALUSAGAP.`
      : `Your ${accountLabel} has been suspended. Access to KALUSAGAP is disabled.`);
    paragraphs.push(`Reason: ${job.reason || account.decision_reason || 'Please contact your administrator for the decision details.'}`);
  } else {
    paragraphs.push(job.event_type === 'approved' ? `Your ${accountLabel} has been approved.`
      : job.event_type === 'reactivated' ? `Your administrator has removed the suspension from your approved ${accountLabel}.`
        : `Your administrator has invited you to set up your approved ${accountLabel}.`);
    if (account.must_change_password === true && !needsSetup) {
      paragraphs.push('Your administrator has provided you with temporary login credentials.');
      paragraphs.push('For security reasons, you will be required to create your own permanent password the first time you sign in.');
      paragraphs.push('Please keep your credentials confidential. Your administrator will communicate the temporary password through an approved secure channel.');
      link = `${origin}/login`;
      linkLabel = 'Sign In';
    } else if (needsSetup) {
      paragraphs.push('Approval alone does not grant access. Your account remains inactive until you complete password setup.');
      paragraphs.push(account.activation_requested
        ? 'Activation has been requested. Complete password setup before signing in.'
        : 'Access has not been enabled by your administrator. Completing password setup does not override that decision.');
      link = actionLink;
      linkLabel = 'Set Your Password';
    } else {
      const active = account.activation_requested && profile.status === 'active' && authConfirmed;
      paragraphs.push(active
        ? 'Your account is active. Sign in using your existing credentials; they have not been changed.'
        : 'Your account is approved, but access is not currently active. Your existing credentials have not been changed. Contact your administrator about activation.');
      link = `${origin}/login`;
      linkLabel = 'Sign In';
    }
  }
  const footer = needsSetup
    ? 'This is an expiring, one-time password setup link. Its expiration is controlled by the account security policy. Do not share it. If it has expired, contact your administrator for a new invitation.'
    : 'If you did not expect this notice, contact your KALUSAGAP administrator.';
  // A fixed Message-ID is for traceability only, not SMTP idempotence.
  return {
    from: config.smtpFrom,
    to: { address: profile.email.trim() },
    messageId: `<personnel-${job.id}@notifications.kalusagap.local>`,
    subject: `KALUSAGAP ${titles[job.event_type]}`,
    text: [...paragraphs, ...(link ? [`${linkLabel}: ${link}`] : []), footer].join('\n\n'),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:18px;">${titles[job.event_type]}</h1>
      ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('\n')}
      ${link ? `<p><a href="${escapeHtml(link)}">${linkLabel}</a></p>` : ''}
      <p>${escapeHtml(footer)}</p>
    </div>`,
  };
};

const smtpFailure = (error) => {
  const rejected = error.responseCode >= 400 && error.responseCode <= 599 && error.smtpPhase !== 'after_send';
  const knownBeforeData = ['EAUTH', 'ENOAUTH', 'EOAUTH2', 'EDNS', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code)
    || ['handshake', 'envelope'].includes(error.smtpPhase)
    || (error.beforeData && error.code !== 'SMTP_ERROR' && !['data', 'after_send'].includes(error.smtpPhase));
  const socketDetail = error.code === 'ESOCKET'
    ? (error.originalCode || error.smtpPhase?.toUpperCase() || 'UNKNOWN')
    : error.code;
  return {
    status: rejected || knownBeforeData ? 'failed' : 'delivery_unknown',
    code: error.code === 'SMTP_ERROR' ? 'SMTP_OUTCOME_UNKNOWN'
      : error.code === 'ESOCKET' ? `SMTP_ESOCKET_${socketDetail}`
        : `SMTP_${error.code}`,
    providerId: null,
  };
};

const smtpResult = (info, message) => {
  const includesRecipient = (list) => Array.isArray(list)
    && list.some((recipient) => emailOf(recipient?.address || recipient) === emailOf(message.to.address));
  const accepted = includesRecipient(info?.accepted);
  const rejected = includesRecipient(info?.rejected);
  const finalReply = String(info?.response || '').trim().split(/\r?\n/).at(-1);
  const responseCode = Number(finalReply.match(/^(\d{3})(?:\s|$)/)?.[1]);
  if (accepted && !rejected && !includesRecipient(info?.pending)
    && responseCode >= 200 && responseCode <= 299 && info?.messageId === message.messageId) {
    return { status: 'sent', code: 'SMTP_ACCEPTED', providerId: info.messageId };
  }
  if (Array.isArray(info?.accepted) && info.accepted.length === 0 && rejected) {
    return { status: 'failed', code: 'SMTP_RECIPIENT_REJECTED', providerId: null };
  }
  return { status: 'delivery_unknown', code: 'SMTP_ACCEPTANCE_UNVERIFIED', providerId: null };
};

/** Service-role only. targetId is an account ID; links never leave this worker. */
export const processPersonnelNotifications = ({
  targetId = null, limit = 10, supabase, transport, config = env, logger = console,
} = {}) => {
  if (activeBatch) return Promise.resolve({ ...emptyResult(), errorCode: 'WORKER_BUSY' });
  activeBatch = (async () => {
    const result = emptyResult();
    if (!supabase && !config.isSupabaseConfigured) {
      log(logger, 'warn', null, 'SUPABASE_NOT_CONFIGURED');
      return { ...result, errorCode: 'SUPABASE_NOT_CONFIGURED' };
    }
    if (targetId !== null && !UUID.test(targetId)) {
      log(logger, 'error', null, 'NOTIFICATION_TARGET_INVALID');
      return { ...result, errorCode: 'NOTIFICATION_TARGET_INVALID' };
    }
    let client;
    let jobs;
    try {
      client = supabase || getServiceClient();
      const { data, error } = await client.rpc('claim_personnel_notifications', {
        p_limit: Math.min(100, Math.max(1, Math.floor(Number(limit) || 10))),
        p_target_id: targetId,
      });
      if (error || !Array.isArray(data)) throw failure('NOTIFICATION_CLAIM_FAILED');
      jobs = data;
    } catch {
      log(logger, 'error', null, 'NOTIFICATION_CLAIM_FAILED');
      return { ...result, errorCode: 'NOTIFICATION_CLAIM_FAILED' };
    }
    result.claimed = jobs.length;
    const seen = new Set();
    await Promise.all(jobs.map(async (job) => {
      if (!UUID.test(job?.id || '') || !UUID.test(job?.account_id || '')
        || !UUID.test(job?.claim_token || '') || job.status !== 'processing' || seen.has(job.id)) {
        result.notStarted += 1;
        log(logger, 'warn', job, 'NOTIFICATION_CLAIM_INVALID');
        return;
      }
      seen.add(job.id);
      const finish = async (status, code, providerId = null) => {
        try {
          const { data, error } = await client.rpc('finish_personnel_notification', {
            p_notification_id: job.id, p_claim_token: job.claim_token,
            p_status: status, p_error_code: status === 'sent' ? null : code,
            p_provider_id: providerId,
          });
          if (error || data !== true) throw failure('NOTIFICATION_FINALIZE_FAILED');
          if (status === 'failed') result.failed += 1;
          if (status === 'delivery_unknown') result.deliveryUnknown += 1;
          if (status === 'cancelled') result.cancelled += 1;
          log(logger, status === 'sent' || status === 'cancelled' ? 'info' : 'warn', job, code);
        } catch {
          result.unfinalized += 1;
          // In particular, NEVER turn an accepted send into a failed/retry job.
          // Stale sending leases are parked delivery_unknown by the claim RPC.
          log(logger, 'error', job, 'NOTIFICATION_FINALIZE_FAILED');
        }
      };
      let message;
      let smtp;
      try {
        const [{ data: account, error: accountError }, { data: profile, error: profileError }] = await Promise.all([
          client.from('personnel_accounts').select(ACCOUNT_COLUMNS).eq('account_id', job.account_id).maybeSingle(),
          client.from('profiles').select(PROFILE_COLUMNS).eq('id', job.account_id).maybeSingle(),
        ]);
        if (accountError) throw failure('ACCOUNT_READ_FAILED');
        if (profileError) throw failure('PROFILE_READ_FAILED');
        if (!account || !profile || !MANAGED_ROLES.has(profile.role) || !eventStillValid(job, account)) {
          await finish('cancelled', 'NOTIFICATION_LIFECYCLE_CHANGED');
          return;
        }
        if (account.account_id !== job.account_id || profile.id !== job.account_id || !validEmail(profile.email)) {
          throw failure('ACCOUNT_IDENTITY_MISMATCH');
        }
        const needsSetup = ACCESS_EVENTS.has(job.event_type) && account.setup_required === true
          && !account.setup_completed_at && (account.must_change_password !== true
            || (job.event_type === 'invitation' && account.must_change_password === true));
        if (job.event_type === 'invitation' && !needsSetup) {
          await finish('cancelled', 'NOTIFICATION_SETUP_COMPLETED');
          return;
        }
        const { data: authData, error: authError } = await client.auth.admin.getUserById(job.account_id);
        if (authError) throw failure('AUTH_USER_READ_FAILED');
        const authUser = authData?.user;
        if (authUser?.id !== job.account_id || !validEmail(authUser.email)
          || emailOf(authUser.email) !== emailOf(profile.email)) throw failure('AUTH_IDENTITY_MISMATCH');
        if (!config.smtpHost || !config.smtpFrom
          || (config.isProduction !== false && (!config.smtpUser || !config.smtpPassword))
          || (transport && typeof transport.sendMail !== 'function')) throw failure('SMTP_NOT_CONFIGURED');
        smtp = transport || getEmailTransporter();
        const origin = ACCESS_EVENTS.has(job.event_type) ? clientOrigin(config) : null;
        let temporaryPassword = null;
        if (job.temporary_password_ciphertext) {
          const expiresAt = Date.parse(account.temporary_password_expires_at || '');
          if (account.must_change_password !== true || !Number.isFinite(expiresAt)) {
            throw failure('TEMPORARY_PASSWORD_INVALID');
          }
          if (expiresAt <= Date.now()) {
            await finish('cancelled', 'TEMPORARY_PASSWORD_EXPIRED');
            return;
          }
          try {
            temporaryPassword = decryptTemporaryPassword(job.temporary_password_ciphertext, config.supabaseServiceRoleKey);
          } catch {
            throw failure('TEMPORARY_PASSWORD_INVALID');
          }
          if (temporaryPassword.length !== 9 || personnelPasswordSetupValidator({ password: temporaryPassword }).error) {
            throw failure('TEMPORARY_PASSWORD_INVALID');
          }
        }
        let actionLink = null;
        if (needsSetup) {
          const { data: prepared, error: prepareError } = await client.rpc('prepare_personnel_notification_link', {
            p_notification_id: job.id,
            p_claim_token: job.claim_token,
          });
          if (prepareError) throw failure('NOTIFICATION_LINK_PREPARE_FAILED');
          if (prepared !== true) {
            result.notStarted += 1;
            log(logger, 'info', job, 'NOTIFICATION_LINK_NOT_PREPARED');
            return;
          }
          const type = authUser.email_confirmed_at ? 'recovery' : 'invite';
          // Keep the redirect target on the already configured reset URL. The
          // token-hash email itself points to the clearer setup-password route.
          const redirectTo = `${origin}/reset-password`;
          const { data: generated, error: linkError } = await client.auth.admin.generateLink({
            type, email: authUser.email, options: { redirectTo },
          });
          if (linkError) throw failure('AUTH_LINK_GENERATION_FAILED');
          if (generated?.user?.id !== job.account_id || emailOf(generated?.user?.email) !== emailOf(authUser.email)) {
            throw failure('AUTH_LINK_IDENTITY_MISMATCH');
          }
          // Send the token hash to our app instead of the Supabase action_link.
          // Mail security scanners often pre-open action links, consuming their
          // one-time token before the recipient does. The reset page asks the
          // user to continue and only then calls verifyOtp with this hash.
          const tokenHash = generated?.properties?.hashed_token;
          if (typeof tokenHash !== 'string' || tokenHash.length < 16 || tokenHash.length > 2048) {
            throw failure('AUTH_LINK_INVALID');
          }
          const recoverySecret = job.event_type === 'invitation' && account.must_change_password === true
            ? randomBytes(32).toString('base64url') : null;
          if (job.event_type === 'invitation' && account.must_change_password === true) {
            const { data: registered, error: proofError } = await client.rpc('register_personnel_invitation_recovery', {
              p_notification_id: job.id,
              p_claim_token: job.claim_token,
              p_token_digest: digestInvitationRecoverySecret(recoverySecret),
            });
            if (proofError || registered !== true) throw failure('NOTIFICATION_RECOVERY_PROOF_FAILED');
          }
          const setupUrl = new URL('/reset-password', origin);
          setupUrl.searchParams.set('token_hash', tokenHash);
          setupUrl.searchParams.set('type', type);
          if (recoverySecret) setupUrl.searchParams.set('recovery_secret', recoverySecret);
          actionLink = setupUrl.href;
        }
        message = buildMail({
          job, account, profile, origin, actionLink, needsSetup,
          authConfirmed: Boolean(authUser.email_confirmed_at), config, temporaryPassword,
        });
        const { data: begun, error: beginError } = await client.rpc('begin_personnel_notification_send', {
          p_notification_id: job.id, p_claim_token: job.claim_token,
        });
        if (beginError) throw failure('NOTIFICATION_BEGIN_FAILED');
        if (begun !== true) {
          result.notStarted += 1;
          log(logger, 'info', job, 'NOTIFICATION_NOT_SENDABLE');
          return;
        }
      } catch (error) {
        await finish('failed', WORKER_ERROR_CODES.has(error?.code) ? error.code : 'NOTIFICATION_PREPARE_FAILED');
        return;
      }
      let outcome;
      try {
        outcome = smtpResult(await sendSmtpMail(message, { transport: smtp }), message);
      } catch (error) {
        outcome = smtpFailure(error);
      }
      if (outcome.status === 'sent') result.mailServerAccepted += 1;
      await finish(outcome.status, outcome.code, outcome.providerId);
    }));
    return result;
  })().catch(() => {
    log(logger, 'error', null, 'NOTIFICATION_WORKER_FAILED');
    return { ...emptyResult(), errorCode: 'NOTIFICATION_WORKER_FAILED' };
  }).finally(() => { activeBatch = null; });
  return activeBatch;
};

/** Called by server.js only. The returned stop function drains in-flight work. */
export const startPersonnelNotificationWorker = (options = {}) => {
  if (stopCurrentWorker) return stopCurrentWorker;
  const config = options.config || env;
  const logger = options.logger || console;
  if (!options.supabase && !config.isSupabaseConfigured) {
    log(logger, 'warn', null, 'SUPABASE_NOT_CONFIGURED');
    return async () => {};
  }
  const interval = Math.min(3_600_000, Math.max(10_000, Number(config.personnelNotificationIntervalMs) || 60_000));
  let stopped = false;
  const run = () => {
    if (!stopped && !activeBatch) void processPersonnelNotifications({ ...options, config, logger });
  };
  const timer = setInterval(run, interval);
  timer.unref();
  let stopping = null;
  const stop = () => {
    if (!stopping) {
      stopped = true;
      clearInterval(timer);
      stopping = Promise.resolve(activeBatch).finally(() => {
        if (stopCurrentWorker === stop) stopCurrentWorker = null;
      });
    }
    return stopping;
  };
  stopCurrentWorker = stop;
  run();
  return stop;
};

export default { processPersonnelNotifications, startPersonnelNotificationWorker };
