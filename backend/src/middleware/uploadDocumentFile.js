import multer from 'multer';
import path from 'node:path';
import ApiError from '../utils/apiError.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '../validators/documents.validators.js';

/**
 * Multer upload for resident document endpoints. Keeps the file in memory
 * (no disk persistence) and converts it to a Node File-like object on
 * `req.file`, preserving the original filename, MIME type and byte length.
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
  limits: { fileSize: MAX_FILE_SIZE },
});

const toNodeFile = (multerFile) => {
  const { buffer, originalname, mimetype } = multerFile;
  const ext = path.extname(originalname).toLowerCase();
  const name = originalname || `document${ext || '.bin'}`;
  const file = new File([buffer], name, { type: mimetype });
  return file;
};

const hasExpectedSignature = (file) => {
  const bytes = file.buffer;
  if (file.mimetype === 'application/pdf') return bytes.subarray(0, 4).toString() === '%PDF';
  if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
};

export const uploadDocumentFile = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(ApiError.badRequest('File size must not exceed 10 MB.'));
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
      return next(ApiError.badRequest('The uploaded file content does not match an approved document type.'));
    }
    req.file = toNodeFile(req.file);
    next();
  });
};

export default uploadDocumentFile;
