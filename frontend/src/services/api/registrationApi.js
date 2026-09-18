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
};

export default registrationApi;
