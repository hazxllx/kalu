import * as onboarding from '../services/municipalityOnboarding.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

export const submit = async (req, res) => sendCreated(res, await onboarding.submit(req.body || {}));
export const status = async (req, res) => sendData(res, await onboarding.getStatus(req.params.reference));
export const list = async (req, res) => sendData(res, await onboarding.listForReviewer(req.user));
export const decide = async (req, res) => sendData(res, await onboarding.decide({ reference: req.params.reference, ...req.body, user: req.user }));
export const verification = async (req, res) => sendData(res, await onboarding.getVerification(req.params.token));
export const verificationDecision = async (req, res) => sendData(res, await onboarding.decideWithToken({ token: req.params.token, ...req.body }));
export const resubmit = async (req, res) => sendData(res, await onboarding.resubmit(req.params.reference, req.body || {}));

export default { submit, status, list, decide, verification, verificationDecision, resubmit };