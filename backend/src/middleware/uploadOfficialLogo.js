// backend/src/middleware/uploadOfficialLogo.js
import multer from 'multer';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import ApiError from '../utils/apiError.js';

/**
 * @module middleware/uploadOfficialLogo
 *
 * Official municipality/barangay/RHU branding logo upload and image-safety
 * validation middleware for KALUSAGAP.
 * Position in request pipeline:
 *   `route -> authenticate -> authorize -> uploadOfficialLogo -> controller -> service -> Supabase Storage`
 *
 * Keeps logo uploads in memory (`multer.memoryStorage()`) and performs defense-in-depth
 * screening beyond MIME type checks:
 *   1. Caps raw upload size at 5 MB (`MAX_OFFICIAL_LOGO_SIZE`).
 *   2. Verifies binary PNG (`PNG_SIGNATURE`) or JPEG (`FF D8 FF`) magic bytes.
 *   3. Enforces a 20-megapixel ceiling (`MAX_IMAGE_PIXELS`) and 128 MB JPEG
 *      decoder memory limit to guard against image decompression bombs.
 *   4. Decodes full pixel data (`pngjs` / `jpeg-js`) to reject truncated,
 *      corrupted, or polyglot files before storage.
 */

/** Maximum allowed byte size (5 MB) for an official seal/logo image. */
export const MAX_OFFICIAL_LOGO_SIZE = 5 * 1024 * 1024;
/** Maximum total pixel count (20 MP) permitted to prevent decompression bombs. */
const MAX_IMAGE_PIXELS = 20_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Validates an uploaded logo's binary signature, pixel dimensions, and full
 * image decode integrity for PNG and JPEG formats. Throws a 400 `ApiError` when
 * the buffer is empty, malformed, oversized in dimensions, or undecodable.
 *
 * @param {Object} file - Multer file object containing `buffer` and `mimetype`.
 * @returns {Object} Verified format descriptor `{ mimeType, extension }`.
 */
export const validateOfficialLogo = (file) => {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    throw ApiError.badRequest('The uploaded logo is empty or invalid.');
  }

  if (file.mimetype === 'image/png') {
    // PNG header requires 8-byte signature followed by IHDR chunk containing
    // big-endian 32-bit width (offset 16) and height (offset 20).
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw ApiError.badRequest('The uploaded file is not a valid PNG image.');
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!width || !height || width * height > MAX_IMAGE_PIXELS) {
      throw ApiError.badRequest('The image dimensions are not supported.');
    }
    try {
      const decoded = PNG.sync.read(buffer);
      if (!decoded.width || !decoded.height || !decoded.data?.length) {
        throw new Error('Decoded image has no pixel data.');
      }
    } catch {
      throw ApiError.badRequest('The uploaded PNG could not be decoded.');
    }
    return { mimeType: 'image/png', extension: '.png' };
  }

  if (file.mimetype === 'image/jpeg') {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw ApiError.badRequest('The uploaded file is not a valid JPEG image.');
    }
    try {
      // Bound both pixel resolution and decoder heap usage during JPEG decompression.
      const decoded = jpeg.decode(buffer, {
        useTArray: true,
        maxResolutionInMP: MAX_IMAGE_PIXELS / 1_000_000,
        maxMemoryUsageInMB: 128,
      });
      if (!decoded.width || !decoded.height || !decoded.data?.length) {
        throw new Error('Decoded image has no pixel data.');
      }
    } catch {
      throw ApiError.badRequest('The uploaded JPEG could not be decoded.');
    }
    return { mimeType: 'image/jpeg', extension: '.jpg' };
  }

  throw ApiError.badRequest('Only PNG and JPEG logo files are supported.');
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, callback) => {
    if (!['image/png', 'image/jpeg'].includes(file.mimetype)) {
      callback(ApiError.badRequest('Only PNG and JPEG logo files are supported.'));
      return;
    }
    callback(null, true);
  },
  limits: { fileSize: MAX_OFFICIAL_LOGO_SIZE, files: 1 },
});

/**
 * Express middleware handling single `'file'` official logo uploads. Normalizes
 * Multer errors to 400 `ApiError`, validates image bytes via `validateOfficialLogo`,
 * and attaches `req.officialLogoFormat = { mimeType, extension }` alongside `req.file`.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next callback.
 */
export const uploadOfficialLogo = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(ApiError.badRequest('Logo files must not exceed 5 MB.'));
      }
      return next(ApiError.badRequest('Unable to process the uploaded logo.'));
    }
    if (error) return next(error);
    if (!req.file) return next(ApiError.badRequest('Please choose a PNG or JPEG logo.'));
    try {
      req.officialLogoFormat = validateOfficialLogo(req.file);
      next();
    } catch (validationError) {
      next(validationError);
    }
  });
};

export default uploadOfficialLogo;
