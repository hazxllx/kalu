const isLoopbackIpv4 = (hostname) => {
  const octets = hostname.split('.').map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && octets[0] === 127;
};

export const isLoopbackHostname = (hostname) => {
  const normalized = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  const mappedIpv4 = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  const mappedLoopback = mappedIpv4 && (Number.parseInt(mappedIpv4[1], 16) & 0xff00) === 0x7f00;
  return normalized === 'localhost' || normalized.endsWith('.localhost')
    || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1'
    || Boolean(mappedLoopback)
    || isLoopbackIpv4(normalized);
};

/** Validate and normalize the single browser origin used by authentication emails. */
export const normalizeClientUrl = (value, { nodeEnv = 'development' } = {}) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('CLIENT_URL is required as the canonical frontend origin.');
  }

  let url;
  try { url = new URL(value.trim()); } catch {
    throw new Error('CLIENT_URL must be an absolute HTTP(S) origin.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('CLIENT_URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  }

  if (nodeEnv === 'production' && (url.protocol !== 'https:' || isLoopbackHostname(url.hostname))) {
    throw new Error('Production CLIENT_URL must use HTTPS and cannot point to localhost or a loopback address.');
  }

  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new Error('HTTP CLIENT_URL is permitted only for a loopback frontend in local development.');
  }

  return url.origin;
};

export const authRedirectUrl = (clientUrl, path = '/reset-password', options = {}) => {
  const origin = normalizeClientUrl(clientUrl, options);
  return new URL(path, origin).href;
};

/** Build the browser reset link while preserving Supabase's one-time proof fields. */
export const passwordRecoveryUrl = (clientUrl, tokenHash, type, options = {}) => {
  const url = new URL(authRedirectUrl(clientUrl, '/reset-password', options));
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', type);
  return url.href;
};
