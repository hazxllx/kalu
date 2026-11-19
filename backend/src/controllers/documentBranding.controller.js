/**
 * Official Document Branding Controller (municipal/health-office logos for certificates, referrals, etc.).
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> authenticate -> authorize -> [officialLogoUpload] -> controller -> documentBranding.service -> Supabase Storage & repository
 *
 * Authorized administrators upload, inspect, and remove the official municipal
 * and health-office logos rendered on printable clinical documents. Clinical
 * staff fetch active branding assets per document type (`medical_certificate`,
 * `referral`, etc.) with strict `Cache-Control: private, no-store` and `nosniff` headers.
 */
import * as branding from '../services/documentBranding.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Retrieves current official logo configuration and file metadata across all
 * supported logo slots for the authenticated administrator (`req.user`).
 * Delegates to `branding.getAdminLogoSettings` and returns `200 OK` via `sendData`.
 */
export const getAdminLogos = async (req, res) => {
  sendData(res, await branding.getAdminLogoSettings({ user: req.user }));
};

/**
 * Retrieves active branding metadata and logo data/URLs for `req.params.documentType`
 * on behalf of `req.user`. Sets `Cache-Control: private, no-store` and
 * `X-Content-Type-Options: nosniff` headers, then returns `200 OK` via `sendData`.
 */
export const getForDocument = async (req, res) => {
  res
    .set('Cache-Control', 'private, no-store')
    .set('X-Content-Type-Options', 'nosniff');
  sendData(res, await branding.getDocumentBranding({
    user: req.user,
    documentType: req.params.documentType,
  }));
};

/**
 * Uploads and activates a new official logo image (`req.file`, pre-validated format
 * in `req.officialLogoFormat`) for slot `req.params.logoType` on behalf of `req.user`.
 * Delegates to `branding.uploadOfficialLogo` and responds with `201 Created` via `sendData`.
 */
export const uploadLogo = async (req, res) => {
  sendData(res, await branding.uploadOfficialLogo({
    user: req.user,
    logoType: req.params.logoType,
    file: req.file,
    format: req.officialLogoFormat,
  }), { status: 201 });
};

/**
 * Removes the configured official logo for slot `req.params.logoType` on behalf
 * of `req.user` via `branding.removeOfficialLogo`, returning `200 OK` via `sendData`.
 */
export const removeLogo = async (req, res) => {
  sendData(res, await branding.removeOfficialLogo({
    user: req.user,
    logoType: req.params.logoType,
  }));
};

export default { getAdminLogos, getForDocument, uploadLogo, removeLogo };
