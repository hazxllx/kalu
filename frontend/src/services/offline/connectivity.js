/**
 * Connectivity tracking.
 *
 * `navigator.onLine` is a hint, not the truth: it is often `true` on a captive
 * portal or when the Wi-Fi link exists but the internet does not. We therefore
 * treat it as a fast signal for the UI and let the sync engine decide the real
 * state from actual request outcomes (a classified `network` error means
 * offline). This module has no side effects beyond event subscription.
 */

export const isNavigatorOnline = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine !== false;

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

export default { isNavigatorOnline, subscribeConnectivity };
