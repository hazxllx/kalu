// backend/src/controllers/m1.controller.js
import * as service from '../services/m1.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

/**
 * FHSIS Monthly Form M1 reporting and health-program record controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> m1.controller -> m1.service -> repository/Supabase`
 *
 * Acts as a thin HTTP adapter over `m1.service`: parses reporting period parameters
 * (`year`, `month`, `quarter`, `period`, `date`), optional `barangayId` scope filters,
 * indicator codes, manual aggregate overrides, and report metadata/remarks. Role-based
 * access control, barangay/municipality scoping, and FHSIS M1 indicator aggregation are
 * enforced in the service layer using the authenticated `req.user` session.
 */

/**
 * Coerces a query or body parameter to a finite number, returning `fallback`
 * when the input is undefined, null, empty, or non-numeric.
 *
 * @param {*} v - Raw query or body value to parse.
 * @param {number|null} [fallback=null] - Default value when `v` is not finite.
 * @returns {number|null} Parsed finite number or `fallback`.
 */
const num = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Returns the current server Date for defaulting unspecified reporting periods.
 *
 * @returns {Date} Current timestamp.
 */
const now = () => new Date();

/**
 * Handles `GET` requests for the FHSIS M1 indicator catalog definitions.
 * Calls `service.listCatalog()` and responds with `200 OK` via `sendData`.
 *
 * @param {Object} _req - Express request (unused).
 * @param {Object} res - Express response.
 */
export const catalog = async (_req, res) => sendData(res, service.listCatalog());

/**
 * Handles catalog synchronization requests to seed or reconcile FHSIS M1
 * indicator definitions in persistent storage via `service.ensureCatalog()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
export const syncCatalog = async (req, res) =>
  sendData(res, await service.ensureCatalog({ }));

/**
 * Handles `GET` requests listing daily M1 participant records wrapped in `{ daily }`.
 * Extracts `req.user`, `req.query.date`, and optional `req.query.barangayId`,
 * delegating to `service.dailyParticipants()` and responding with `200 OK`.
 *
 * @param {Object} req - Express request with authenticated `user` and date/barangay query filters.
 * @param {Object} res - Express response.
 */
export const listRecords = async (req, res) =>
  sendData(res, {
    daily: await service.dailyParticipants({
      user: req.user,
      date: req.query.date,
      barangayId: req.query.barangayId || null,
    }),
  });

/**
 * Handles `GET` requests for daily FHSIS M1 participant counts and activity logs.
 * Extracts `req.user`, `req.query.date`, and optional `req.query.barangayId`,
 * delegating to `service.dailyParticipants()` and responding with `200 OK`.
 *
 * @param {Object} req - Express request with authenticated `user` and `date`/`barangayId` query params.
 * @param {Object} res - Express response.
 */
export const daily = async (req, res) =>
  sendData(res, await service.dailyParticipants({
    user: req.user,
    date: req.query.date,
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` requests for a monthly FHSIS M1 indicator report.
 * Defaults `req.query.year` and `req.query.month` to the current server year/month,
 * passes optional `req.query.barangayId` and `req.user` to `service.monthlyReport()`,
 * and responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with `year`, `month`, and `barangayId` query params.
 * @param {Object} res - Express response.
 */
export const monthly = async (req, res) =>
  sendData(res, await service.monthlyReport({
    user: req.user,
    year: num(req.query.year, now().getFullYear()),
    month: num(req.query.month, now().getMonth() + 1),
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` requests for an annual FHSIS M1 indicator summary.
 * Defaults `req.query.year` to the current server year, passes optional
 * `req.query.barangayId` and `req.user` to `service.annualSummary()`, and responds
 * with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with `year` and `barangayId` query params.
 * @param {Object} res - Express response.
 */
export const annual = async (req, res) =>
  sendData(res, await service.annualSummary({
    user: req.user,
    year: num(req.query.year, now().getFullYear()),
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` requests for unified reporting-period FHSIS M1 reports
 * (`monthly`, `quarterly`, or `annual`) — the single source used by the
 * exported/printed M1 PDF across every period.
 * Extracts `period` (default `'monthly'`), `year`, `month`, `quarter`, and `barangayId`
 * from `req.query`, delegates to `service.periodReport()`, and responds with `200 OK`.
 *
 * @param {Object} req - Express request with period filter query parameters.
 * @param {Object} res - Express response.
 */
export const report = async (req, res) =>
  sendData(res, await service.periodReport({
    user: req.user,
    period: req.query.period || 'monthly',
    year: num(req.query.year, now().getFullYear()),
    month: req.query.month != null ? num(req.query.month) : null,
    quarter: req.query.quarter != null ? num(req.query.quarter) : null,
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` drilldown requests for a specific FHSIS M1 indicator (`req.params.code`),
 * returning the underlying resident/service records contributing to its count for the
 * requested `period`, `quarter`, `year`, `month`, and `barangayId`.
 * Delegates to `service.drilldown()` and responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with `params.code` and period query params.
 * @param {Object} res - Express response.
 */
export const drilldown = async (req, res) =>
  sendData(res, await service.drilldown({
    user: req.user,
    indicatorCode: req.params.code,
    period: req.query.period || undefined,
    quarter: req.query.quarter != null ? num(req.query.quarter) : null,
    year: num(req.query.year, now().getFullYear()),
    month: req.query.month != null ? num(req.query.month) : null,
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `POST` requests to create an operational M1 service record.
 * Reads payload from `req.body.record` (falling back to `req.body`), delegates
 * to `service.createRecord()` with `req.user`, and responds with `201 Created` (`sendCreated`).
 *
 * @param {Object} req - Express request with M1 record payload in `body`.
 * @param {Object} res - Express response.
 */
export const createRecord = async (req, res) =>
  sendCreated(res, { record: await service.createRecord({ user: req.user, payload: req.body?.record || req.body || {} }) });

/**
 * Handles `PUT`/`PATCH` requests to update an existing M1 record (`req.params.id`).
 * Extracts update fields from `req.body.record` (or `req.body`), delegates to
 * `service.updateRecord()`, and responds with `200 OK` (`sendData`) containing `{ record }`.
 *
 * @param {Object} req - Express request with `params.id` and update payload in `body`.
 * @param {Object} res - Express response.
 */
export const updateRecord = async (req, res) =>
  sendData(res, { record: await service.updateRecord({ user: req.user, id: req.params.id, payload: req.body?.record || req.body || {} }) });

/**
 * Handles `DELETE` requests to remove an M1 record (`req.params.id`) within the
 * caller's scope via `service.deleteRecord()`. Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const removeRecord = async (req, res) =>
  sendData(res, await service.deleteRecord({ user: req.user, id: req.params.id }));

/**
 * Handles `GET` requests for monthly FHSIS M1 report metadata (facility headers,
 * prepared-by/reviewed-by signatories, population figures) for `year`, `month`,
 * and optional `barangayId` via `service.getReportMeta()`. Responds with `200 OK`.
 *
 * @param {Object} req - Express request with `year`, `month`, and `barangayId` query params.
 * @param {Object} res - Express response.
 */
export const getMeta = async (req, res) =>
  sendData(res, await service.getReportMeta({
    user: req.user,
    year: num(req.query.year, now().getFullYear()),
    month: num(req.query.month, now().getMonth() + 1),
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` requests listing manual FHSIS M1 entries (aggregate indicator figures
 * that have no operational clinical form source) for the specified `year`, `month`,
 * and optional `barangayId` via `service.listManualEntries()`. Responds with `200 OK`.
 *
 * @param {Object} req - Express request with `year`, `month`, and `barangayId` query params.
 * @param {Object} res - Express response.
 */
export const listManual = async (req, res) =>
  sendData(res, await service.listManualEntries({
    user: req.user,
    year: num(req.query.year, now().getFullYear()),
    month: num(req.query.month, now().getMonth() + 1),
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `POST`/`PUT` requests to upsert manual FHSIS M1 aggregate figures for an
 * indicator (`indicatorCode` / `indicator_code`), normalizing `values` to an array
 * and resolving `year`, `month`, `remarks`, and `barangayId` from `req.body` or `req.query`.
 * Delegates to `service.saveManualEntry()` and responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with manual indicator values in `body`.
 * @param {Object} res - Express response.
 */
export const saveManual = async (req, res) => {
  const body = req.body || {};
  return sendData(res, await service.saveManualEntry({
    user: req.user,
    year: num(body.year ?? req.query.year, now().getFullYear()),
    month: num(body.month ?? req.query.month, now().getMonth() + 1),
    indicatorCode: body.indicatorCode ?? body.indicator_code,
    values: Array.isArray(body.values) ? body.values : [],
    remarks: body.remarks,
    barangayId: body.barangayId ?? req.query.barangayId ?? null,
  }));
};

/**
 * Handles `PUT`/`POST` requests to save monthly M1 report metadata (`req.body.meta` or `req.body`),
 * resolving `year`, `month`, and `barangayId` from `req.query` or `period_year`/`period_month`
 * in the payload. Delegates to `service.saveReportMeta()` and responds with `200 OK`.
 *
 * @param {Object} req - Express request with metadata payload and period params.
 * @param {Object} res - Express response.
 */
export const saveMeta = async (req, res) => {
  const body = req.body?.meta || req.body || {};
  return sendData(res, await service.saveReportMeta({
    user: req.user,
    year: num(req.query.year ?? body.period_year, now().getFullYear()),
    month: num(req.query.month ?? body.period_month, now().getMonth() + 1),
    barangayId: req.query.barangayId || body.barangayId || null,
    payload: body,
  }));
};

/**
 * Handles `PATCH`/`PUT` requests to save narrative remarks for a specific M1 indicator
 * (`req.params.code`) in a given `year`, `month`, and optional `barangayId`.
 * Delegates to `service.saveIndicatorRemarks()` and responds with `200 OK`.
 *
 * @param {Object} req - Express request with `params.code` and `remarks`/period in `body` or `query`.
 * @param {Object} res - Express response.
 */
export const saveRemarks = async (req, res) => {
  const body = req.body || {};
  return sendData(res, await service.saveIndicatorRemarks({
    user: req.user,
    year: num(body.period_year ?? req.query.year, now().getFullYear()),
    month: num(body.period_month ?? req.query.month, now().getMonth() + 1),
    indicatorCode: req.params.code,
    remarks: body.remarks,
    barangayId: body.barangayId || req.query.barangayId || null,
  }));
};

// Program-specific record retrieval endpoints

/**
 * Handles `GET` requests for maternal/prenatal care M1 program records (`programId: 'prenatal'`)
 * filtered by `period`, `year`, `month`, `quarter`, and `barangayId` via `service.getRecordsByProgram()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with period and barangay query filters.
 * @param {Object} res - Express response.
 */
export const getPrenatalRecords = async (req, res) =>
  sendData(res, await service.getRecordsByProgram({
    user: req.user,
    programId: 'prenatal',
    period: req.query.period || 'monthly',
    year: num(req.query.year, now().getFullYear()),
    month: req.query.month != null ? num(req.query.month) : null,
    quarter: req.query.quarter != null ? num(req.query.quarter) : null,
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` requests for Non-Communicable Disease (NCD) M1 program records (`programId: 'ncd'`)
 * filtered by `period`, `year`, `month`, `quarter`, and `barangayId` via `service.getRecordsByProgram()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with period and barangay query filters.
 * @param {Object} res - Express response.
 */
export const getNcdRecords = async (req, res) =>
  sendData(res, await service.getRecordsByProgram({
    user: req.user,
    programId: 'ncd',
    period: req.query.period || 'monthly',
    year: num(req.query.year, now().getFullYear()),
    month: req.query.month != null ? num(req.query.month) : null,
    quarter: req.query.quarter != null ? num(req.query.quarter) : null,
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` requests for cervical cancer screening M1 program records (`programId: 'cervical'`)
 * filtered by `period`, `year`, `month`, `quarter`, and `barangayId` via `service.getRecordsByProgram()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with period and barangay query filters.
 * @param {Object} res - Express response.
 */
export const getCervicalRecords = async (req, res) =>
  sendData(res, await service.getRecordsByProgram({
    user: req.user,
    programId: 'cervical',
    period: req.query.period || 'monthly',
    year: num(req.query.year, now().getFullYear()),
    month: req.query.month != null ? num(req.query.month) : null,
    quarter: req.query.quarter != null ? num(req.query.quarter) : null,
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` requests for visual acuity screening M1 program records (`programId: 'visual'`)
 * filtered by `period`, `year`, `month`, `quarter`, and `barangayId` via `service.getRecordsByProgram()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with period and barangay query filters.
 * @param {Object} res - Express response.
 */
export const getVisualRecords = async (req, res) =>
  sendData(res, await service.getRecordsByProgram({
    user: req.user,
    programId: 'visual',
    period: req.query.period || 'monthly',
    year: num(req.query.year, now().getFullYear()),
    month: req.query.month != null ? num(req.query.month) : null,
    quarter: req.query.quarter != null ? num(req.query.quarter) : null,
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` requests for oral health M1 program records (`programId: 'oral'`)
 * filtered by `period`, `year`, `month`, `quarter`, and `barangayId` via `service.getRecordsByProgram()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with period and barangay query filters.
 * @param {Object} res - Express response.
 */
export const getOralRecords = async (req, res) =>
  sendData(res, await service.getRecordsByProgram({
    user: req.user,
    programId: 'oral',
    period: req.query.period || 'monthly',
    year: num(req.query.year, now().getFullYear()),
    month: req.query.month != null ? num(req.query.month) : null,
    quarter: req.query.quarter != null ? num(req.query.quarter) : null,
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` requests for environmental health and sanitation M1 program records
 * (`programId: 'environmental'`) filtered by `period`, `year`, `month`, `quarter`,
 * and `barangayId` via `service.getRecordsByProgram()`. Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with period and barangay query filters.
 * @param {Object} res - Express response.
 */
export const getEnvironmentalRecords = async (req, res) =>
  sendData(res, await service.getRecordsByProgram({
    user: req.user,
    programId: 'environmental',
    period: req.query.period || 'monthly',
    year: num(req.query.year, now().getFullYear()),
    month: req.query.month != null ? num(req.query.month) : null,
    quarter: req.query.quarter != null ? num(req.query.quarter) : null,
    barangayId: req.query.barangayId || null,
  }));

/**
 * Handles `GET` requests for general program enrollment M1 records (`programId: 'enrollment'`)
 * filtered by `period`, `year`, `month`, `quarter`, and `barangayId` via `service.getRecordsByProgram()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with period and barangay query filters.
 * @param {Object} res - Express response.
 */
export const getEnrollmentRecords = async (req, res) =>
  sendData(res, await service.getRecordsByProgram({
    user: req.user,
    programId: 'enrollment',
    period: req.query.period || 'monthly',
    year: num(req.query.year, now().getFullYear()),
    month: req.query.month != null ? num(req.query.month) : null,
    quarter: req.query.quarter != null ? num(req.query.quarter) : null,
    barangayId: req.query.barangayId || null,
  }));

export default {
  catalog, syncCatalog, daily, monthly, annual, report, drilldown,
  createRecord, updateRecord, removeRecord, getMeta, saveMeta, saveRemarks,
  listManual, saveManual,
  getPrenatalRecords, getNcdRecords, getCervicalRecords, getVisualRecords,
  getOralRecords, getEnvironmentalRecords, getEnrollmentRecords,
};
