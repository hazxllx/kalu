export const permissionLoadErrorMessage = (error) => {
  const status = Number(error?.status || error?.statusCode);
  const message = String(error?.message || '');

  if (status === 401) {
    return 'Your session is invalid or has expired. Sign in again, then retry loading permissions.';
  }
  if (status === 403) {
    return 'Your account is not authorized to load role permissions. Contact an administrator.';
  }
  if (status === 404) {
    return 'The role-permissions API endpoint was not found. Check the API URL and backend deployment.';
  }
  if (status >= 500) {
    return `The permissions service returned a server error (HTTP ${status}). Please retry.`;
  }
  if (error?.code === 'INVALID_PERMISSION_MATRIX_RESPONSE') {
    return 'The permissions API returned an invalid response. Check the API URL and backend deployment.';
  }
  if (/invalid url|failed to parse url|unsupported url/i.test(message)) {
    return 'The permissions API URL is invalid. Check the frontend API configuration.';
  }
  if (
    error?.name === 'TypeError' ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(message)
  ) {
    return 'The permissions API could not be reached. Check the network, API URL, and CORS configuration, then retry.';
  }
  if (status >= 400) {
    return `The permission request failed (HTTP ${status}). ${message || 'Please retry.'}`;
  }
  return 'Role permissions could not be loaded. Please retry.';
};

export default permissionLoadErrorMessage;
