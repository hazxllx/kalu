/**
 * Intake workflow endpoints (BHW / RHU personnel / Health Supervisor).
 */
import * as intakeService from '../services/intake.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

export const searchResidents = async (req, res) => {
  const residents = await intakeService.searchResidents({ q: req.query.q || '' });
  sendData(res, { residents });
};

export const getResident = async (req, res) => {
  const resident = await intakeService.getResidentForIntake({ id: req.params.id, user: req.user });
  sendData(res, { resident });
};

export const createSubmission = async (req, res) => {
  const submission = await intakeService.createSubmission({
    residentId: req.body.residentId || null,
    resident: req.body.resident || null,
    visit: req.body.visit || {},
    user: req.user,
  });
  sendCreated(res, { submission });
};

export const listMySubmissions = async (req, res) => {
  const submissions = await intakeService.listMySubmissions({ user: req.user });
  sendData(res, { submissions });
};

export const getSubmission = async (req, res) => {
  const submission = await intakeService.getSubmissionForIntake({ id: req.params.id, user: req.user });
  sendData(res, { submission });
};

export const updateSubmission = async (req, res) => {
  const submission = await intakeService.updateSubmissionDraft({
    id: req.params.id,
    visit: req.body.visit || {},
    user: req.user,
  });
  sendData(res, { submission });
};

export const submitSubmission = async (req, res) => {
  const result = await intakeService.submitSubmission({ id: req.params.id, user: req.user });
  sendData(res, result);
};

export default {
  searchResidents,
  getResident,
  createSubmission,
  listMySubmissions,
  getSubmission,
  updateSubmission,
  submitSubmission,
};
