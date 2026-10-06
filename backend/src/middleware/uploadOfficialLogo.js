import multer from 'multer';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import ApiError from '../utils/apiError.js';

export const MAX_OFFICIAL_LOGO_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 20_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const validateOfficialLogo = (file) => {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    throw ApiError.badRequest('The uploaded logo is empty or invalid.');
  }

  if (file.mimetype === 'image/png') {
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
