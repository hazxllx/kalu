/**
 * Official document branding endpoints (logos for certificates, referrals, etc).
 *
 * Authorized administrators upload and manage the municipal logos that appear
 * on official documents. The service retrieves the configured logos for each
 * document type (medical certificate, referral, etc) and caches them to minimize
 * repetitive database queries.
 */
import * as branding from '../services/documentBranding.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Retrieve current logo configuration for all document types (admin view).
 * Shows uploaded logos and their file metadata.
 */
export const getAdminLogos = async (req, res) => {
  sendData(res, await branding.getAdminLogoSettings({ user: req.user }));
};

export const getForDocument = async (req, res) => {
  res
    .set('Cache-Control', 'private, no-store')
    .set('X-Content-Type-Options', 'nosniff');
  sendData(res, await branding.getDocumentBranding({
    user: req.user,
    documentType: req.params.documentType,
  }));
};

export const uploadLogo = async (req, res) => {
  sendData(res, await branding.uploadOfficialLogo({
    user: req.user,
    logoType: req.params.logoType,
    file: req.file,
    format: req.officialLogoFormat,
  }), { status: 201 });
};

export const removeLogo = async (req, res) => {
  sendData(res, await branding.removeOfficialLogo({
    user: req.user,
    logoType: req.params.logoType,
  }));
};

export default { getAdminLogos, getForDocument, uploadLogo, removeLogo };
