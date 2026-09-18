/**
 * Local (non-demo) Public Health Nurse (RHU-level) datasets.
 *
 * This module carries no demo data. Every collection starts empty and the UI
 * shows an empty/loading state until the corresponding backend endpoint
 * supplies real rows. Export names and object shapes are preserved from the
 * previous development module so existing pages keep compiling and scope-filtering
 * helpers (`@/lib/phnScope`) keep working unchanged.
 */

import { BARANGAYS, BARANGAY_FILTERS } from "@/lib/barangays";

export { BARANGAYS, BARANGAY_FILTERS };

/** Canonical referral statuses for the PHN workflow. */
export const REFERRAL_STATUSES = Object.freeze([
  "For Review",
  "Accepted",
  "Pending",
  "Follow-up Required",
  "Completed",
]);

/** Canonical follow-up statuses. */
export const FOLLOWUP_STATUSES = Object.freeze([
  "Scheduled",
  "Due Today",
  "Overdue",
  "Completed",
  "Cancelled",
]);

/** Canonical health-service statuses. */
export const SERVICE_STATUSES = Object.freeze(["Scheduled", "Ongoing", "Completed", "Cancelled"]);

/** Shape preserved for the signed-in PHN; values are supplied by the session. */
export const PHN_PROFILE = Object.freeze({
  name: "",
  role: "",
  facility: "",
});

export const barangayCommunity = [];

export const phnCheckupQueue = [];

export const phnResidents = [];

export const phnReferrals = [];

export const phnFollowUps = [];

export const phnAlerts = [];

export const phnHealthServices = [];

export const phnAssessments = [];

export const phnNotifications = [];

export const phnReportSummary = [];

export const phnMonthlyTrend = [];
