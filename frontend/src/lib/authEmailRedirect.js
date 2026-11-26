// frontend/src/lib/authEmailRedirect.js
const isLoopbackHostname = (hostname) => {
  const normalized = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  const ipv4Parts = normalized.split('.').map(Number);
  const mappedIpv4 = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  return normalized === 'localhost' || normalized.endsWith('.localhost')
    || normalized === '::1'
    || Boolean(mappedIpv4 && (Number.parseInt(mappedIpv4[1], 16) & 0xff00) === 0x7f00)
    || (ipv4Parts.length === 4 && ipv4Parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
      && ipv4Parts[0] === 127);
};

/** Keep Auth-generated email callbacks on the frontend origin that sent them. */
export const authEmailRedirectTo = (
  path = "/",
  origin = globalThis.location?.origin,
  production = import.meta.env?.PROD === true,
) => {
  if (typeof origin !== "string" || !origin.trim()) {
    throw new Error("The frontend origin is unavailable for authentication email redirects.");
  }
  const frontendOrigin = new URL(origin);
  if (!['http:', 'https:'].includes(frontendOrigin.protocol)
    || frontendOrigin.username || frontendOrigin.password
    || (frontendOrigin.pathname && frontendOrigin.pathname !== '/')
    || frontendOrigin.search || frontendOrigin.hash) {
    throw new Error("The frontend origin is invalid for authentication email redirects.");
  }
  if (production && (frontendOrigin.protocol !== 'https:' || isLoopbackHostname(frontendOrigin.hostname))) {
    throw new Error("Production authentication email redirects require the public HTTPS frontend.");
  }
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error("Authentication email redirects must stay on the frontend origin.");
  }
  return new URL(path, frontendOrigin.origin).href;
};
