import { REPORT_STATUS, reportContentError } from '../services/reports.service.js';
import { invalid, isUuid, text, valid } from './common.js';

/**
 * Report request validation. The sender, sender role, municipality and barangay
 * scope are all taken from the authenticated session in the service — never
 * from the body — so only the report content and the (optional) recipient role
 * are accepted here.
 */

const LIMITS = { short: 120, notes: 2000 };
const RECIPIENT_DECISIONS = [
  REPORT_STATUS.RECEIVED,
  REPORT_STATUS.REVIEWED,
  REPORT_STATUS.NEEDS_REVISION,
  REPORT_STATUS.REJECTED,
];

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
  if (!row.reportPeriod) errors.reportPeriod = 'A reporting period is required.';
  const recipientRole = text(input?.recipientRole || input?.recipient_role);
  if (recipientRole) row.recipientRole = recipientRole;
  const status = text(input?.status);
  if (status && ![REPORT_STATUS.DRAFT, REPORT_STATUS.SUBMITTED].includes(status)) {
    errors.status = 'A report can only be created as a draft or submitted report.';
  }
  if (status === REPORT_STATUS.DRAFT) row.status = REPORT_STATUS.DRAFT;

  // The immutable snapshot is mandatory, including for drafts, so neither a
  // draft nor a submitted row can represent report metadata without its data.
  const content = input?.content;
  const contentError = reportContentError(content, reportType, row.reportPeriod);
  if (contentError) {
    errors.content = contentError;
  } else {
    row.content = content;
  }

  if (Object.keys(errors).length) return invalid(errors);
  return valid(row);
};

export const reviewReportValidator = (input = {}) => {
  const errors = {};
  const status = text(input?.status);
  if (!RECIPIENT_DECISIONS.includes(status)) errors.status = 'Select a valid report review status.';
  const remarks = text(input?.remarks).slice(0, LIMITS.notes);
  if ([REPORT_STATUS.NEEDS_REVISION, REPORT_STATUS.REJECTED].includes(status) && !remarks) {
    errors.remarks = 'Please explain the revisions needed or why this report is rejected.';
  }
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ status, remarks });
};

export const resubmitReportValidator = (input = {}) => {
  const content = input?.content;
  const contentError = reportContentError(
    content,
    text(content?.reportType),
    text(content?.reportPeriod),
  );
  if (contentError) return invalid({ content: contentError });
  return valid({ content });
};

export const submitReportValidator = (input = {}) => {
  if (input && Object.keys(input).length > 0) {
    return invalid({ body: 'Submitting a draft does not accept report changes.' });
  }
  return valid({});
};

export const reportIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A report reference is required.' });
  if (!isUuid(id)) return invalid({ id: 'The report reference is not valid.' });
  return valid({ ...params, id });
};

export default {
  createReportValidator,
  reviewReportValidator,
  resubmitReportValidator,
  submitReportValidator,
  reportIdParamValidator,
};
