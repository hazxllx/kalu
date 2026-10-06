/**
 * Service worker registration + update lifecycle (PWA).
 *
 * Registration is intentionally limited to production builds: the development
 * server serves modules on demand and a service worker there would fight the
 * dev server for control of the page. In production the worker precaches the
 * versioned shell/assets (`src/sw.js`) and this module surfaces update
 * availability so the UI can offer a user-approved refresh instead of forcing
 * one mid-session.
 */

const UPDATE_EVENT = 'kalusagap:pwa-update-available';
const OFFLINE_READY_EVENT = 'kalusagap:pwa-offline-ready';

/** @type {ServiceWorkerRegistration | null} */
let activeRegistration = null;
/** @type {ServiceWorker | null} */
let waitingWorker = null;
let reloading = false;

/** True when the current build can register a service worker at all. */
export const pwaSupported = () =>
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator;

const announce = (name, detail) => {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* CustomEvent unavailable — ignore */
  }
};

const trackInstalling = (registration) => {
  const installing = registration.installing;
  if (!installing) return;
  installing.addEventListener('statechange', () => {
    if (installing.state === 'installed') {
      if (navigator.serviceWorker.controller) {
        waitingWorker = registration.waiting;
        announce(UPDATE_EVENT, { registration });
      } else {
        announce(OFFLINE_READY_EVENT, { registration });
      }
    }
  });
};

/**
 * Register the KALUSAGAP service worker. No-op outside production or when the
 * browser lacks service-worker support.
 */
export const registerServiceWorker = () => {
  if (!pwaSupported()) return;
  if (!(import.meta.env && import.meta.env.PROD)) return;

  const start = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        activeRegistration = registration;

        if (registration.waiting && navigator.serviceWorker.controller) {
          waitingWorker = registration.waiting;
          announce(UPDATE_EVENT, { registration });
        }

        registration.addEventListener('updatefound', () => trackInstalling(registration));
        trackInstalling(registration);

        // Poll for updates when the tab regains focus, at most once a minute.
        let lastCheck = 0;
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible') return;
          const now = Date.now();
          if (now - lastCheck < 60_000) return;
          lastCheck = now;
          registration.update().catch(() => {});
        });
      })
      .catch(() => {
        /* registration failures must never break the app */
      });
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
};

/**
 * Activate a waiting update and reload once the new worker takes control.
 * Safe to call when no update is waiting (it simply does nothing).
 */
export const applyServiceWorkerUpdate = () => {
  if (!pwaSupported()) return;
  if (!waitingWorker) {
    if (activeRegistration) activeRegistration.update().catch(() => {});
    return;
  }
  const worker = waitingWorker;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  worker.postMessage({ type: 'SKIP_WAITING' });
};

export const subscribeToUpdate = (handler) => {
  const listener = (event) => handler(event.detail || {});
  window.addEventListener(UPDATE_EVENT, listener);
  return () => window.removeEventListener(UPDATE_EVENT, listener);
};

export default {
  pwaSupported,
  registerServiceWorker,
  applyServiceWorkerUpdate,
  subscribeToUpdate,
};
