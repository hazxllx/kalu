/** Read every explicit server page; never silently treat a capped page as all records. */
export const loadServerRows = async (list, pageSize = 100) => {
  const result = new Map();
  for (let offset = 0; ; offset += pageSize) {
    const response = await list({ limit: pageSize, offset });
    const rows = Array.isArray(response) ? response : response?.rows || response?.records;
    if (!Array.isArray(rows)) throw new Error('The server returned an incomplete record list.');
    const previousSize = result.size;
    for (const row of rows) {
      if (!row?.id) throw new Error('The server returned a record without a stable ID.');
      result.set(String(row.id), row);
    }
    const total = response?.total;
    if (Number.isFinite(total) && offset + rows.length >= total) break;
    if (rows.length < pageSize) {
      if (Number.isFinite(total) && offset + rows.length < total) throw new Error('The server returned an incomplete record page.');
      break;
    }
    if (result.size === previousSize) throw new Error('The server record pagination did not advance.');
  }
  return [...result.values()];
};
