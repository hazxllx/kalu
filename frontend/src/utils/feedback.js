/** Shared feedback wording and API-error normalization for data workflows. */
export const feedbackMessages = Object.freeze({
  created: "Created successfully.",
  saved: "Changes saved successfully.",
  updated: "Information updated successfully.",
  submitted: "Submitted successfully.",
  approved: "Approved successfully.",
  rejected: "Rejected successfully.",
  deleted: "Deleted successfully.",
  statusUpdated: "Status updated successfully.",
  uploaded: "File uploaded successfully.",
});

export const getErrorMessage = (error, fallback = "Unable to complete this action. Please try again.") => {
  const status = error?.status ?? error?.response?.status;
  if (status === 401) return "Your session has expired. Please log in again.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 409 || /duplicate|already exists|unique/i.test(String(error?.message || ""))) return "This record already exists.";
  return error?.userMessage || error?.response?.data?.message || error?.message || fallback;
};

export const notifySuccess = (toast, message, options = {}) => toast?.success
  ? toast.success(message, options)
  : toast?.({ title: "Success", description: message, variant: "success", duration: 4000, ...options });

export const notifyError = (toast, error, fallback, options = {}) => {
  const message = getErrorMessage(error, fallback);
  return toast?.error
    ? toast.error(message, options)
    : toast?.({ title: "Something went wrong", description: message, variant: "error", duration: 8000, ...options });
};
