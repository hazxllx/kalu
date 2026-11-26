// frontend/src/services/api/apiBaseUrl.js
import { requireLocalUrl } from '../../lib/localSafety.js';

export const DEFAULT_LOCAL_API_URL = 'http://localhost:5000/api';

export const normalizeApiBaseUrl = (apiUrl) => {
  const configuredUrl = String(apiUrl || '').trim();
  if (!configuredUrl) {
    throw new Error('VITE_API_URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error('VITE_API_URL must be an absolute http(s) URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('VITE_API_URL must use http or https.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('VITE_API_URL must not contain credentials, a query string, or a fragment.');
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = /\/api$/i.test(path) ? path : `${path}/api`;
  return parsed.toString();
};

export const resolveApiBaseUrl = (apiUrl, isProduction = false) => {
  if (!String(apiUrl || '').trim() && isProduction) {
    throw new Error('VITE_API_URL is required for production builds.');
  }
  const resolved = normalizeApiBaseUrl(apiUrl || DEFAULT_LOCAL_API_URL);
  if (!isProduction) requireLocalUrl(resolved, 'VITE_API_URL');
  return resolved;
};
