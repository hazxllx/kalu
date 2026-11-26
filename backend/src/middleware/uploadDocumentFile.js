// backend/src/middleware/uploadDocumentFile.js
import multer from 'multer';
import path from 'node:path';
import ApiError from '../utils/apiError.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '../validators/documents.validators.js';

/**
 * @module middleware/uploadDocumentFile
 *
 * Resident identification and supporting document upload middleware for KALUSAGAP.
 * Position in request pipeline:
 *   `route -> [authenticate -> authorize] -> uploadDocumentFile / uploadGovernmentIdPairFiles / uploadResidentDocumentFiles -> controller -> service -> Supabase Storage`
 *
 * Buffers multipart uploads strictly in memory (`multer.memoryStorage()`, no disk
 * persistence), enforces `ALLOWED_MIME_TYPES` (PDF, JPG, PNG) and `MAX_FILE_SIZE`
 * (10 MB), verifies leading binary magic bytes to reject spoofed `Content-Type`
 * headers, and converts validated uploads into standard Node `File` instances on
 * `req.file` and/or `req.governmentIdPair`.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(ApiError.unsupportedMediaType('Only PDF, JPG, and PNG files are allowed.'));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: MAX_FILE_SIZE },
});

/**
 * Wraps a Multer in-memory file descriptor into a Web-standard `File` instance,
 * preserving the original filename (with extension fallback) and MIME type.
 *
 * @param {Object} multerFile - Multer file object containing `buffer`, `originalname`, and `mimetype`.
 * @returns {File} Node `File` object ready for service-layer screening and Supabase Storage upload.
 */
const toNodeFile = (multerFile) => {
  const { buffer, originalname, mimetype } = multerFile;
  const ext = path.extname(originalname).toLowerCase();
  const name = originalname || `document${ext || '.bin'}`;
  const file = new File([buffer], name, { type: mimetype });
  return file;
};

/**
 * Verifies that the uploaded buffer's leading magic bytes match its declared MIME
 * type (`%PDF` for PDF, 8-byte PNG signature, or `FF D8 FF` SOI marker for JPEG),
 * preventing renamed executables or corrupted payloads from passing MIME checks.
 *
 * @param {Object} file - Multer file object with `buffer` and `mimetype`.
 * @returns {boolean} `true` when binary header matches an approved document format.
 */
const hasExpectedSignature = (file) => {
  const bytes = file.buffer;
  if (file.mimetype === 'application/pdf') return bytes.subarray(0, 4).toString() === '%PDF';
  if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
};

/**
 * Single-document upload middleware reading multipart field `'file'`.
 * Maps Multer size/field errors to 413/400 `ApiError`, verifies binary magic
 * bytes (415 on mismatch), and attaches a Node `File` to `req.file`.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next callback.
 */
export const uploadDocumentFile = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(ApiError.payloadTooLarge('File size is not supported. Please upload a clear copy of your identification document (10 MB maximum).'));
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(ApiError.badRequest('No file was provided.'));
        }
        return next(ApiError.badRequest('Unable to process the uploaded file.'));
      }
      if (err instanceof ApiError) return next(err);
      return next(ApiError.badRequest('Unable to process the uploaded file.'));
    }
    if (!req.file) {
      return next(ApiError.badRequest('Please upload a valid document.'));
    }
    if (!hasExpectedSignature(req.file)) {
      return next(ApiError.unsupportedMediaType('The uploaded file content does not match an approved document type.'));
    }
    req.file = toNodeFile(req.file);
    next();
  });
};

/**
 * Paired government-ID upload middleware reading multipart fields
 * `'governmentIdFront'` and `'governmentIdBack'`. Requires both sides to be
 * present and signature-valid for identity cross-checking, attaching them as
 * Node `File` objects on `req.governmentIdPair`.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next callback.
 */
export const uploadGovernmentIdPairFiles = (req, res, next) => {
  upload.fields([
    { name: 'governmentIdFront', maxCount: 1 },
    { name: 'governmentIdBack', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(ApiError.payloadTooLarge('Each government ID image must be 10 MB or smaller.'));
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(ApiError.badRequest('Only the government ID front and back may be submitted for cross-checking.'));
        }
        return next(ApiError.badRequest('Unable to process the uploaded ID images.'));
      }
      if (err instanceof ApiError) return next(err);
      return next(ApiError.badRequest('Unable to process the uploaded ID images.'));
    }

    const files = req.files || {};
    const front = files.governmentIdFront?.[0];
    const back = files.governmentIdBack?.[0];
    if (!front || !back) {
      return next(ApiError.badRequest('Please provide both the front and back of your government ID.'));
    }
    if (![front, back].every(hasExpectedSignature)) {
      return next(ApiError.unsupportedMediaType('An uploaded file does not match an approved document type.'));
    }
    req.governmentIdPair = {
      governmentIdFront: toNodeFile(front),
      governmentIdBack: toNodeFile(back),
    };
    next();
  });
};

/**
 * Composite resident verification upload middleware accepting a required primary
 * `'file'` document alongside an optional `'governmentIdFront'` and
 * `'governmentIdBack'` pair. Enforces that if either government ID side is
 * supplied, both sides must be present and signature-verified; populates
 * `req.file` and `req.governmentIdPair` (`{ governmentIdFront, governmentIdBack }` or `null`).
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next callback.
 */
export const uploadResidentDocumentFiles = (req, res, next) => {
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'governmentIdFront', maxCount: 1 },
    { name: 'governmentIdBack', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(ApiError.payloadTooLarge('File size is not supported. Please upload a clear document image (10 MB maximum).'));
        }
        return next(ApiError.badRequest('Unable to process the uploaded document.'));
      }
      if (err instanceof ApiError) return next(err);
      return next(ApiError.badRequest('Unable to process the uploaded document.'));
    }

    const files = req.files || {};
    const primary = files.file?.[0];
    const front = files.governmentIdFront?.[0];
    const back = files.governmentIdBack?.[0];
    if (!primary) return next(ApiError.badRequest('Please upload a valid document.'));
    if (![primary, front, back].filter(Boolean).every(hasExpectedSignature)) {
      return next(ApiError.unsupportedMediaType('An uploaded file does not match an approved document type.'));
    }
    if (Boolean(front) !== Boolean(back)) {
      return next(ApiError.badRequest('Both government ID sides are required for cross-verification.'));
    }

    req.file = toNodeFile(primary);
    req.governmentIdPair = front && back
      ? { governmentIdFront: toNodeFile(front), governmentIdBack: toNodeFile(back) }
      : null;
    next();
  });
};

export default uploadDocumentFile;
