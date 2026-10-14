import { recordDate } from "./reportSnapshot.js";

/** Normalize supported API response envelopes without inventing an empty result. */
export const toRecordArray = (res) => {
  if (Array.isArray(res)) return res;
  const rows = res?.records || res?.rows || res?.data || [];
  return Array.isArray(rows) ? rows : [];
};

/**
 * Keep only rows with dates inside the selected period. Undated records are
 * excluded when a period is selected because they cannot be assigned reliably.
 */
export const summarizeRecords = (response, window) => {
  const sourceRecords = toRecordArray(response);
  if (!window) {
    return summarize(sourceRecords, sourceRecords, false, "");
  }

  const datedRecords = sourceRecords.filter((record) => recordDate(record));
  const records = datedRecords.filter((record) => {
    const date = recordDate(record);
    return date >= window.from && date <= window.to;
  });
  const undatedCount = sourceRecords.length - datedRecords.length;
  const note = undatedCount
    ? datedRecords.length === 0
      ? `All ${undatedCount} record${undatedCount === 1 ? " lacks" : "s lack"} a reliable date and could not be assigned to the selected period.`
      : `${undatedCount} record${undatedCount === 1 ? " was" : "s were"} excluded because no reliable date was available.`
    : "";
  return summarize(records, sourceRecords, true, note);
};

const summarize = (records, sourceRecords, periodFiltered, note) => {
  const byStatus = {};
  for (const record of records) {
    const status = record?.status ? String(record.status) : "Unspecified";
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return {
    total: records.length,
    byStatus,
    periodFiltered,
    records,
    sourceCount: sourceRecords.length,
    note,
  };
};

export default { toRecordArray, summarizeRecords };
