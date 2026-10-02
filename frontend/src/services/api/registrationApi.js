import api from './apiClient';

/**
 * Resident self-registration API.
 *
 * The Supabase Auth account is created in the browser via `supabase.auth.signUp`
 * (standard flow — the auth trigger creates the pending `profiles` row). This
 * call then creates the linked `residents` record for the signed-in account.
 */
export const registrationApi = {
  registerResident: async (payload) => {
    const response = await api.post('/registration/resident', payload);
    return response?.resident || null;
  },
  // Resident self-service: activate the account after accepting an invitation
  // link and setting a password on /reset-password. Safe no-op on the server
  // unless the resident's record is Verified. Best-effort from the client.
  activate: () => api.post('/registration/activate'),
};

export default registrationApi;
