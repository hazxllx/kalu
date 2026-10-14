const errorStatus = (error) => Number(error?.status ?? error?.statusCode) || null;

const errorMessage = (error) =>
  String(error?.payload?.error?.message || error?.message || '').trim().toLowerCase();

export const householdLoadErrorMessage = (error) => {
  const status = errorStatus(error);
  const message = errorMessage(error);

  if (status === 401) {
    return 'Your session has expired or is invalid. Sign in again, then retry loading households.';
  }

  if (status === 403) {
    if (/missing|inactive|no longer approved|invalid.*assignment|assignment.*invalid/.test(message)) {
      return 'Your barangay assignment is missing, inactive, or no longer approved. Contact your administrator to update your profile.';
    }
    return 'You do not have permission to view these households. Contact your administrator if you believe this is incorrect.';
  }

  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /network|fetch failed|failed to fetch|offline|timeout|connection refused/.test(message)
  ) {
    return 'The household service is unavailable. Check your connection and try again.';
  }

  if (status >= 500) {
    return 'The household service could not complete the database request. Try again; contact your administrator if the problem continues.';
  }

  return 'The household request could not be completed. Try again; contact your administrator if the problem continues.';
};

export default householdLoadErrorMessage;