export const reportGroup = (type) => /\btcl\b|target client/i.test(type || '') ? 'TCL' : /\bm1\b|maternal/i.test(type || '') ? 'M1' : 'Other';

export const submissionFromReport = (report) => {
  if (!report?.id) throw new Error('A persisted report must have a server ID.');
  return {
    ...report,
    id: String(report.id),
    reference: String(report.id),
    type: report.reportType || '',
    group: reportGroup(report.reportType),
    period: report.dateFrom && report.dateTo ? `${report.dateFrom} to ${report.dateTo}` : '',
    // A created timestamp is not evidence that a report was submitted then.
    submittedAt: report.submittedAt || null,
    creator: report.createdByName || report.createdBy || '',
  };
};

export const linkedReviewHistory = (report, reviews) => (reviews || []).filter((review) => String(review.submissionRef) === String(report.id));

export const reviewPersistedReport = async ({ report, status, remarks, review }) => {
  if (!report?.id || !status) throw new Error('Select a persisted report and a valid server transition.');
  const response = await review(report.id, { status, remarks });
  if (!response?.record?.id || String(response.record.id) !== String(report.id) || response.record.status !== status) {
    throw new Error('The server did not confirm the report review. Refresh before retrying.');
  }
  return response.record;
};
