import { REPORT_STATUS } from '../services/reports.service.js';
import { invalid, isUuid, text, valid } from './common.js';

/**
 * Report request validation. The sender, sender role, municipality and barangay
 * scope are all taken from the authenticated session in the service — never
 * from the body — so only the report content and the (optional) recipient role
 * are accepted here.
 */

const LIMITS = { short: 120, notes: 2000 };
const RECIPIENT_DECISIONS = [REPORT_STATUS.RECEIVED, REPORT_STATUS.REVIEWED, REPORT_STATUS.REJECTED];

export const createReportValidator = (input = {}) => {
  const errors = {};
  const reportType = text(input?.reportType || input?.report_type);
  if (!reportType) errors.reportType = 'Select the report type.';
  if (reportType.length > LIMITS.short) errors.reportType = 'The report type is too long.';

  const row = {
    reportType,
    reportPeriod: text(input?.reportPeriod || input?.report_period).slice(0, LIMITS.short),
    title: text(input?.title).slice(0, LIMITS.short),
    remarks: text(input?.remarks).slice(0, LIMITS.notes),
  };
  const recipientRole = text(input?.recipientRole || input?.recipient_role);
  if (recipientRole) row.recipientRole = recipientRole;
  const status = text(input?.status);
  if (status === REPORT_STATUS.DRAFT) row.status = REPORT_STATUS.DRAFT;

  if (Object.keys(errors).length) return invalid(errors);
  return valid(row);
};

export const reviewReportValidator = (input = {}) => {
  const errors = {};
  const status = text(input?.status);
  if (!RECIPIENT_DECISIONS.includes(status)) errors.status = 'Select a valid report review status.';
  const remarks = text(input?.remarks).slice(0, LIMITS.notes);
  if (status === REPORT_STATUS.REJECTED && !remarks) {
    errors.remarks = 'Please provide a reason for rejecting this report.';
  }
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ status, remarks });
};

export const reportIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A report reference is required.' });
  if (!isUuid(id)) return invalid({ id: 'The report reference is not valid.' });
  return valid({ ...params, id });
};

export default { createReportValidator, reviewReportValidator, reportIdParamValidator };
