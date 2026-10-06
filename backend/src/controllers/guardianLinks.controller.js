import * as guardianLinksService from '../services/guardianLinks.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

export const searchGuardianCandidates = async (req, res) => {
  const results = await guardianLinksService.searchGuardianCandidates({ user: req.user, q: req.query.q || '' });
  sendData(res, { results });
};

export const createGuardianLink = async (req, res) => {
  const link = await guardianLinksService.createGuardianLink({
    user: req.user,
    payload: req.body?.guardianLink || req.body || {},
  });
  sendCreated(res, { guardianLink: link });
};

export const requestOwnGuardianLink = async (req, res) => {
  const result = await guardianLinksService.requestOwnGuardianLink({
    user: req.user,
    ...(req.body?.guardianRequest || req.body || {}),
  });
  sendCreated(res, result);
};

export const listOwnGuardianLinks = async (req, res) => {
  const result = await guardianLinksService.listOwnGuardianLinks({ user: req.user });
  sendData(res, result);
};

export const listIncomingGuardianRequests = async (req, res) => {
  const requests = await guardianLinksService.listIncomingGuardianRequests({ user: req.user });
  sendData(res, { requests });
};

export const respondToGuardianRequest = async (req, res) => {
  const request = await guardianLinksService.respondToGuardianRequest({
    user: req.user,
    linkId: req.params.id,
    decision: req.body?.decision,
  });
  sendData(res, { request });
};

export const cancelOwnGuardianRequest = async (req, res) => {
  const guardianLink = await guardianLinksService.cancelOwnGuardianRequest({
    user: req.user,
  });
  sendData(res, { guardianLink });
};

export const listGuardianLinksForMinor = async (req, res) => {
  const links = await guardianLinksService.listGuardianLinksForMinor({
    user: req.user,
    minorResidentId: req.params.minorId,
  });
  sendData(res, { guardianLinks: links });
};

export const reviewGuardianLink = async (req, res) => {
  const link = await guardianLinksService.reviewGuardianLink({
    user: req.user,
    linkId: req.params.id,
    decision: req.body?.review?.decision,
    note: req.body?.review?.note || '',
  });
  sendData(res, { guardianLink: link });
};

export const correctGuardianLink = async (req, res) => {
  const link = await guardianLinksService.correctGuardianLink({
    user: req.user,
    linkId: req.params.id,
    payload: req.body?.correction || req.body || {},
  });
  sendData(res, { guardianLink: link });
};

export default {
  searchGuardianCandidates,
  createGuardianLink,
  requestOwnGuardianLink,
  listOwnGuardianLinks,
  listIncomingGuardianRequests,
  respondToGuardianRequest,
  cancelOwnGuardianRequest,
  listGuardianLinksForMinor,
  reviewGuardianLink,
  correctGuardianLink,
};
