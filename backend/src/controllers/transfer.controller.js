import * as transferService from '../services/transfer.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

export const requestOtp = async (req, res) => sendData(res, await transferService.requestOtp({ user: req.user }));
export const verifyOtp = async (req, res) => sendData(res, await transferService.verifyOtp({ user: req.user, requestId: req.body?.requestId, otp: req.body?.otp }));
export const uploadDocument = async (req, res) => sendCreated(res, { document: await transferService.uploadDocument({ user: req.user, requestId: req.params.id, file: req.file, documentType: req.body?.documentType, governmentIdType: req.body?.governmentIdType, governmentIdTypeOther: req.body?.governmentIdTypeOther }) });
export const getMine = async (req, res) => sendData(res, { transfer: await transferService.getMine({ user: req.user }) });
export const submit = async (req, res) => sendData(res, { transfer: await transferService.submit({ user: req.user, requestId: req.params.id }) });
export const listQueue = async (req, res) => sendData(res, await transferService.listQueue({ user: req.user, status: req.query.status || 'pending' }));
export const getForReview = async (req, res) => sendData(res, await transferService.getForReview({ user: req.user, requestId: req.params.id }));
export const approve = async (req, res) => sendData(res, { transfer: await transferService.approve({ user: req.user, requestId: req.params.id, residentId: req.body?.residentId }) });
export const reject = async (req, res) => sendData(res, { transfer: await transferService.reject({ user: req.user, requestId: req.params.id, reason: req.body?.reason }) });

export default { requestOtp, verifyOtp, uploadDocument, getMine, submit, listQueue, getForReview, approve, reject };