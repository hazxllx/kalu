/**
 * Connectivity tracking.
 *
 * Browser events describe the device link, while public API health describes
 * backend availability. A failed API or mutation is not inferred to mean that
 * the device is offline.
 */

import { resolveApiBaseUrl } from '../api/apiBaseUrl.js';

let lastHealthCheck = 0;
let cachedHealth = null;
const HEALTH_CACHE_MS = 15_000;
const HEALTH_TIMEOUT_MS = 5_000;

export const isNavigatorOnline = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine !== false;

/** Probe the public, unauthenticated API readiness endpoint. */
export const checkBackendHealth = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && cachedHealth !== null && now - lastHealthCheck < HEALTH_CACHE_MS) return cachedHealth;
  lastHealthCheck = now;

  if (typeof fetch !== 'function') {
    cachedHealth = null;
    return cachedHealth;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Backend health check timeout')), HEALTH_TIMEOUT_MS);
  try {
    const baseUrl = resolveApiBaseUrl(import.meta.env?.VITE_API_URL, import.meta.env?.MODE === 'production');
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    cachedHealth = response?.ok === true;
  } catch {
    cachedHealth = false;
  } finally {
    clearTimeout(timeout);
  }
  return cachedHealth;
};

export const resetBackendHealth = () => {
  lastHealthCheck = 0;
  cachedHealth = null;
};

/**
 * Subscribe to browser online/offline events.
 * @param {(online: boolean) => void} handler
 * @returns {() => void} unsubscribe
 */
export const subscribeConnectivity = (handler) => {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => handler(true);
  const onOffline = () => handler(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
};

export default { isNavigatorOnline, subscribeConnectivity, checkBackendHealth, resetBackendHealth };
