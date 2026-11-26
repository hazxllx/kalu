// backend/src/middleware/uploadStaffDocuments.js
import multer from 'multer';
import path from 'node:path';
import ApiError from '../utils/apiError.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '../validators/documents.validators.js';

/**
 * @module middleware/uploadStaffDocuments
 *
 * Personnel-registration verification document upload middleware for KALUSAGAP.
 * Position in request pipeline:
 *   `route -> rateLimit -> uploadStaffDocuments -> validate -> controller -> service -> Supabase Storage`
 *
 * Files arrive under the multipart field `documents` (0..8 files); a parallel
 * `documentTypes` text field carries a JSON array of the document-type labels
 * in the SAME order, so each file keeps its human type without a fragile
 * per-role field map. Files are kept in memory (no disk) and converted to Node
 * `File` objects on `req.staffDocuments`.
 *
 * The request is a public multipart submission; a plain JSON registration has
 * no multipart body, so this middleware is a no-op for it (multer only handles
 * `multipart/form-data`) and the endpoint stays backward compatible.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(ApiError.badRequest('Only PDF, JPG, and PNG files are allowed.'));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: MAX_FILE_SIZE, files: 8 },
});

/**
 * Wraps a Multer in-memory file descriptor into a standard Node `File` object.
 *
 * @param {Object} multerFile - Multer file descriptor (`buffer`, `originalname`, `mimetype`).
 * @returns {File} Node `File` instance for downstream storage upload.
 */
const toNodeFile = (multerFile) => {
  const { buffer, originalname, mimetype } = multerFile;
  const ext = path.extname(originalname || '').toLowerCase();
  const name = originalname || `document${ext || '.bin'}`;
  return new File([buffer], name, { type: mimetype });
};

/**
 * Verifies leading magic bytes against approved PDF (`%PDF`), PNG, and JPEG
 * signatures so spoofed or corrupted files cannot bypass MIME filtering.
 *
 * @param {Object} file - Multer file descriptor with `buffer` and `mimetype`.
 * @returns {boolean} `true` when binary header matches the declared format.
 */
const hasExpectedSignature = (file) => {
  const bytes = file.buffer;
  if (!bytes || bytes.length < 4) return false;
  if (file.mimetype === 'application/pdf') return bytes.subarray(0, 4).toString() === '%PDF';
  if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
};

/**
 * Parses the JSON-encoded `documentTypes` multipart text field into an ordered
 * array of string labels aligned by index with `req.files`, returning `[]` on
 * empty or malformed JSON.
 *
 * @param {string|undefined} raw - Raw `req.body.documentTypes` string.
 * @returns {Array<string>} Normalized document type labels.
 */
const parseTypes = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((t) => String(t || '')) : [];
  } catch {
    return [];
  }
};

/**
 * Express middleware accepting up to 8 `'documents'` files on staff registration
 * submissions. Maps Multer size/count/field errors to 400 `ApiError`, skips files
 * whose binary signature does not match an approved format, pairs each valid file
 * with its positional `documentType` (defaulting to `'Supporting Document'`), and
 * populates `req.staffDocuments`.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next callback.
 */
export const uploadStaffDocuments = (req, res, next) => {
  upload.array('documents', 8)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(ApiError.badRequest('Each document must not exceed 10 MB.'));
        if (err.code === 'LIMIT_FILE_COUNT') return next(ApiError.badRequest('Too many documents were attached.'));
        if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(ApiError.badRequest('Unexpected document field.'));
        return next(ApiError.badRequest('Unable to process the uploaded documents.'));
      }
      if (err instanceof ApiError) return next(err);
      return next(ApiError.badRequest('Unable to process the uploaded documents.'));
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const types = parseTypes(req.body?.documentTypes);
    const documents = [];
    files.forEach((uploaded, index) => {
      if (!hasExpectedSignature(uploaded)) {
        // Skip a file whose content does not match an approved type rather than
        // failing the whole registration; the required-document check on the
        // client already guides the applicant.
        return;
      }
      documents.push({
        documentType: types[index] || 'Supporting Document',
        file: toNodeFile(uploaded),
        originalFilename: uploaded.originalname || '',
        mimeType: uploaded.mimetype || '',
        fileSize: uploaded.size || (uploaded.buffer ? uploaded.buffer.length : 0),
      });
    });
    req.staffDocuments = documents;
    next();
  });
};

export default uploadStaffDocuments;
