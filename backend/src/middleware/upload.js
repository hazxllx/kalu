import multer from 'multer';

/**
 * @module middleware/upload
 *
 * General-purpose multipart file upload middleware for KALUSAGAP.
 * Position in request pipeline:
 *   `route -> authenticate -> authorize -> uploadMiddleware -> controller -> service -> Supabase Storage`
 *
 * Buffers uploaded files in memory (`multer.memoryStorage()`) with zero local
 * disk persistence so controllers and services can inspect and forward buffers
 * directly to Supabase Storage while enforcing MIME-type allowlisting and a
 * 10 MB maximum file size.
 */
const storage = multer.memoryStorage();

/**
 * Multer file filter restricting uploads to approved office document (PDF, DOC,
 * DOCX) and image (JPEG, PNG, WebP) MIME types.
 *
 * @param {Object} req - Express request object.
 * @param {Object} file - Multer file descriptor (`mimetype`, `originalname`, etc.).
 * @param {Function} cb - Multer acceptance callback `(error, acceptFile)`.
 */
const fileFilter = (req, file, cb) => {
  // Allow common document and image types
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
  }
};

/**
 * Preconfigured Multer instance using in-memory storage, document/image MIME
 * filtering, and a 10 MB per-file size cap. Use `.single(...)`, `.array(...)`,
 * or `.fields(...)` on route definitions.
 */
export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max
  },
});

export default uploadMiddleware;
