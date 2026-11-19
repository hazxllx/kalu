import * as service from '../services/residentFollowups.service.js';
import scheduleRequests from '../services/scheduleRequests.service.js';
import referrals from '../services/referrals.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Resident follow-up endpoints. Ownership is always derived from the
 * authenticated session in the service layer — the controller never passes a
 * client-supplied resident id, and the follow-up id in the URL is only ever
 * matched against the caller's own resident record.
 */

export const list = async (req, res) => {
  const [rows, referralRows, requests] = await Promise.all([
    service.listOwn({ user: req.user }),
    referrals.list({ user: req.user, box: 'all' }),
    scheduleRequests.listForStaff({ user: req.user }),
  ]);
  sendData(res, {
    rows,
    referrals: referralRows.map((row) => ({
      id: row.id, canonicalId: row.id, reason: row.reason || '', receivingFacility: row.destination_facility || '',
      referralDate: row.referral_date || '', scheduledAt: row.scheduled_at || null, assignedRecipient: row.recipient?.full_name || '',
      status: row.status, serviceProgressStatus: row.status,
      scheduleResponseStatus: row.schedule_response_status || 'Default Confirmed',
      facilityType: row.recipient_facility?.type || '', facilityMunicipalityId: row.recipient_facility?.municipality_id || '',
      residentMunicipalityId: row.resident?.municipality_id || '', destinationIsHospital: /hospital/i.test(`${row.destination_facility || ''} ${row.external_receiving_facility || ''}`),
      registeredFacility: Boolean(row.recipient_facility_id),
      external: !row.recipient_facility_id,
    })),
    scheduleRequests: requests,
  });
};

export const get = async (req, res) =>
  sendData(res, { record: await service.getOwn({ user: req.user, id: req.params.id }) });

export const approve = async (req, res) =>
  sendData(res, { request: await scheduleRequests.submit({ user: req.user, targetType: 'follow_up', targetId: req.params.id, requestType: 'attendance' }) });

export const reject = async (req, res) =>
  sendData(res, { request: await scheduleRequests.submit({ user: req.user, targetType: 'follow_up', targetId: req.params.id, requestType: 'cancellation', reason: req.body?.reason }) });

export default { list, get, approve, reject };
