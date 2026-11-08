/**
 * PHN queue + referral endpoints (PHN role / authorized readers).
 */
import * as phnQueueService from '../services/phnQueue.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

export const listQueue = async (req, res) => {
  const { rows } = await phnQueueService.listQueue({
    statuses: req.query.status ? String(req.query.status).split(',') : null,
    q: req.query.q || '',
    user: req.user,
  });
  sendData(res, { submissions: rows });
};

export const listConsultationHealthServices = async (req, res) => {
  const services = await phnQueueService.listConsultationHealthServices({ user: req.user });
  sendData(res, { services });
};

export const getSubmission = async (req, res) => {
  const submission = await phnQueueService.viewSubmission({ id: req.params.id, user: req.user });
  sendData(res, { submission });
};

export const updateSubmission = async (req, res) => {
  const submission = await phnQueueService.updateSubmissionForPhn({
    id: req.params.id,
    patch: req.body.submission || req.body,
    user: req.user,
  });
  sendData(res, { submission });
};

export const receiveSubmission = async (req, res) => {
  const submission = await phnQueueService.receiveSubmission({ id: req.params.id, user: req.user });
  sendData(res, { submission });
};

export const markInReview = async (req, res) => {
  const submission = await phnQueueService.markInReview({ id: req.params.id, user: req.user });
  sendData(res, { submission });
};

export const completeSubmission = async (req, res) => {
  const submission = await phnQueueService.completeSubmission({ id: req.params.id, user: req.user });
  sendData(res, { submission });
};

export const createReferral = async (req, res) => {
  const referral = await phnQueueService.createReferral({
    visitId: req.params.id,
    draft: req.body.referral || req.body.record || req.body || {},
    user: req.user,
  });
  sendCreated(res, { referral });
};

export const listReferrals = async (req, res) => {
  const { rows } = await phnQueueService.listReferrals({ q: req.query.q || '', box: req.query.box, status: req.query.status, user: req.user });
  sendData(res, { referrals: rows });
};

export const getReferral = async (req, res) => {
  const referral = await phnQueueService.getReferral({ id: req.params.id, user: req.user });
  sendData(res, { referral });
};

export const getReferralByVisit = async (req, res) => {
  const referral = await phnQueueService.getReferralByVisitId({ visitId: req.params.id, user: req.user });
  sendData(res, { referral });
};

export const updateReferral = async (req, res) => {
  const referral = await phnQueueService.updateReferral({
    id: req.params.id,
    patch: req.body.referral || req.body.record || req.body || {},
    user: req.user,
  });
  sendData(res, { referral });
};

export const syncReferral = async (req, res) => {
  const body = req.body.referral || req.body.record || req.body || {};
  const referral = await phnQueueService.syncReferralSnapshots({ id: req.params.id, user: req.user, version: body.expected_version ?? body.version });
  sendData(res, { referral });
};

export const updateReferralStatus = async (req, res) => {
  const body = req.body.referral || req.body.record || req.body || {};
  sendData(res, { referral: await phnQueueService.updateReferralStatus({ id: req.params.id, user: req.user, status: body.status, resolutionNotes: body.resolution_notes ?? body.resolutionNotes, version: body.expected_version ?? body.version }) });
};

export default {
  listQueue,
  listConsultationHealthServices,
  getSubmission,
  updateSubmission,
  receiveSubmission,
  markInReview,
  completeSubmission,
  createReferral,
  listReferrals,
  getReferral,
  getReferralByVisit,
  updateReferral,
  syncReferral,
  updateReferralStatus,
};
