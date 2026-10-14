export const DEFAULT_PRODUCTION_API_URL = 'https://kalusagap.onrender.com/api';

export const normalizeApiBaseUrl = (apiUrl) => {
  const baseUrl = String(apiUrl || '/api').trim().replace(/\/+$/, '') || '/api';
  return /\/api$/i.test(baseUrl) ? baseUrl : `${baseUrl}/api`;
};

export const resolveApiBaseUrl = (apiUrl, isProduction) =>
  normalizeApiBaseUrl(apiUrl || (isProduction ? DEFAULT_PRODUCTION_API_URL : undefined));
