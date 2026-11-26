// backend/src/utils/personnelInvitationRecovery.js
import { createHash, createHmac } from 'node:crypto';

export const digestInvitationRecoverySecret = (secret) => {
  if (typeof secret !== 'string' || secret.length < 16 || secret.length > 2048) {
    throw new TypeError('A valid invitation recovery secret is required.');
  }
  return createHash('sha256').update(secret, 'utf8').digest('hex');
};

export const digestInvitationRecoveryPassword = (accountId, tokenDigest, password, secret) => {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('Invitation recovery is not configured.');
  }
  return createHmac('sha256', secret)
    .update(`kalusagap:personnel-invitation-recovery:v1:${accountId}:${tokenDigest}:${password}`)
    .digest('hex');
};

export const digestTemporaryPasswordChange = (accountId, password, secret) => {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('Temporary password protection is not configured.');
  }
  return createHmac('sha256', secret)
    .update(`kalusagap:personnel-temporary-password-change:v1:${accountId}:${password}`)
    .digest('hex');
};
