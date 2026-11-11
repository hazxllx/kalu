/**
 * Status Label Formatter
 * 
 * Converts database status values to user-friendly labels with consistent styling.
 * Prevents raw snake_case values from being displayed to users.
 */

export const STATUS_LABELS = Object.freeze({
  // Consultation/record statuses
  in_review: 'In Review',
  pending: 'Pending',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  in_progress: 'In Progress',
  
  // Alternative formats
  'In Review': 'In Review',
  'In Progress': 'In Progress',
  'Pending': 'Pending',
  'Completed': 'Completed',
  'Rejected': 'Rejected',
  'Cancelled': 'Cancelled',
});

export const STATUS_COLORS = Object.freeze({
  'In Review': 'bg-blue-50 text-blue-700',
  'In Progress': 'bg-cyan-50 text-cyan-700',
  'Pending': 'bg-amber-50 text-amber-700',
  'Completed': 'bg-green-50 text-green-700',
  'Rejected': 'bg-red-50 text-red-700',
  'Cancelled': 'bg-gray-100 text-gray-600',
});

export const RISK_LEVEL_LABELS = Object.freeze({
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  moderate: 'Moderate',
  'Low': 'Low',
  'Medium': 'Medium',
  'High': 'High',
  'Moderate': 'Moderate',
});

export const RISK_LEVEL_COLORS = Object.freeze({
  'Low': 'bg-emerald-50 text-emerald-700',
  'Medium': 'bg-amber-50 text-amber-700',
  'Moderate': 'bg-amber-50 text-amber-700',
  'High': 'bg-rose-50 text-rose-700',
});

/**
 * Format status value to user-friendly label
 * Falls back to original value if unknown, properly capitalized
 * 
 * @param {string} value - Raw database status value
 * @returns {string} Formatted label for display
 */
export const formatStatusLabel = (value) => {
  if (!value) return 'Pending';
  
  const label = STATUS_LABELS[value];
  if (label) return label;
  
  // Fallback: convert snake_case to Title Case for unknown values
  return String(value)
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Get color classes for status badge
 * 
 * @param {string} value - Raw database status value or formatted label
 * @returns {string} Tailwind color classes
 */
export const getStatusColor = (value) => {
  if (!value) return 'bg-gray-100 text-gray-700';
  
  const label = formatStatusLabel(value);
  return STATUS_COLORS[label] || 'bg-gray-100 text-gray-700';
};

/**
 * Format risk level value to user-friendly label
 * 
 * @param {string} value - Raw database risk level
 * @returns {string} Formatted label
 */
export const formatRiskLabel = (value) => {
  if (!value) return 'Not assessed';
  
  const label = RISK_LEVEL_LABELS[value];
  return label || 'Not assessed';
};

/**
 * Get color classes for risk badge
 * 
 * @param {string} value - Raw database risk level or formatted label
 * @returns {string} Tailwind color classes
 */
export const getRiskColor = (value) => {
  if (!value) return 'bg-gray-100 text-gray-700';
  
  const label = formatRiskLabel(value);
  return RISK_LEVEL_COLORS[label] || 'bg-gray-100 text-gray-700';
};

/**
 * Get check-up status display
 * Maps consultation record status to check-up display status
 * 
 * @param {string} recordStatus - Consultation record status
 * @returns {string} Check-up display status
 */
export const getCheckupStatus = (recordStatus) => {
  if (!recordStatus) return 'Pending';
  
  if (recordStatus === 'completed') return 'Completed';
  if (recordStatus === 'in_progress') return 'In Progress';
  if (recordStatus === 'in_review') return 'In Review';
  if (recordStatus === 'pending') return 'Pending';
  
  return 'Pending';
};

/**
 * Get check-up indicator color
 * Returns Tailwind color for the status dot
 * 
 * @param {string} checkupStatus - Check-up display status
 * @returns {string} Tailwind color class
 */
export const getCheckupIndicatorColor = (checkupStatus) => {
  switch (checkupStatus) {
    case 'Completed':
      return 'bg-green-500';
    case 'In Progress':
      return 'bg-teal-500';
    case 'In Review':
      return 'bg-blue-500';
    case 'Pending':
    default:
      return 'bg-gray-300';
  }
};
