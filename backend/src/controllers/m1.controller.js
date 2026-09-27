import * as service from '../services/m1.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

/**
 * FHSIS M1 controller — thin HTTP layer over m1.service. The service enforces
 * role/scope and derives the acting user from the authenticated session.
 */

const num = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const now = () => new Date();

export const catalog = async (_req, res) => sendData(res, service.listCatalog());

export const syncCatalog = async (req, res) =>
  sendData(res, await service.ensureCatalog({ }));

export const listRecords = async (req, res) =>
  sendData(res, {
    daily: await service.dailyParticipants({
      user: req.user,
      date: req.query.date,
      barangayId: req.query.barangayId || null,
    }),
  });

export const daily = async (req, res) =>
  sendData(res, await service.dailyParticipants({
    user: req.user,
    date: req.query.date,
    barangayId: req.query.barangayId || null,
  }));

export const monthly = async (req, res) =>
  sendData(res, await service.monthlyReport({
    user: req.user,
    year: num(req.query.year, now().getFullYear()),
    month: num(req.query.month, now().getMonth() + 1),
    barangayId: req.query.barangayId || null,
  }));

export const annual = async (req, res) =>
  sendData(res, await service.annualSummary({
    user: req.user,
    year: num(req.query.year, now().getFullYear()),
    barangayId: req.query.barangayId || null,
  }));

export const drilldown = async (req, res) =>
  sendData(res, await service.drilldown({
    user: req.user,
    indicatorCode: req.params.code,
    year: num(req.query.year, now().getFullYear()),
    month: req.query.month != null ? num(req.query.month) : null,
    barangayId: req.query.barangayId || null,
  }));

export const createRecord = async (req, res) =>
  sendCreated(res, { record: await service.createRecord({ user: req.user, payload: req.body?.record || req.body || {} }) });

export const updateRecord = async (req, res) =>
  sendData(res, { record: await service.updateRecord({ user: req.user, id: req.params.id, payload: req.body?.record || req.body || {} }) });

export const removeRecord = async (req, res) =>
  sendData(res, await service.deleteRecord({ user: req.user, id: req.params.id }));

export const getMeta = async (req, res) =>
  sendData(res, await service.getReportMeta({
    user: req.user,
    year: num(req.query.year, now().getFullYear()),
    month: num(req.query.month, now().getMonth() + 1),
    barangayId: req.query.barangayId || null,
  }));

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

export default {
  catalog, syncCatalog, daily, monthly, annual, drilldown,
  createRecord, updateRecord, removeRecord, getMeta, saveMeta, saveRemarks,
};
