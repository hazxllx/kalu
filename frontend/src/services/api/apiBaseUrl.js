export const normalizeApiBaseUrl = (apiUrl) => {
  const baseUrl = String(apiUrl || '/api').trim().replace(/\/+$/, '') || '/api';
  return /\/api$/i.test(baseUrl) ? baseUrl : `${baseUrl}/api`;
};
