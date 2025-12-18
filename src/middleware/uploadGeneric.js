const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

// Upload directory for generic uploads
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'upload');

// Only allow image extensions
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate UUID filename, keep original extension (if any)
    const ext = path.extname(file.originalname || '').toLowerCase();
    const uuid = randomUUID();
    const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '';
    const newFilename = `${uuid}${safeExt}`;

    // If file exists (very unlikely with UUID but safe), delete it first
    const filePath = path.join(UPLOAD_DIR, newFilename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log('✅ [upload] Replaced existing file:', newFilename);
      } catch (error) {
        console.error('⚠️ [upload] Error deleting existing file:', error);
      }
    }

    cb(null, newFilename);
  }
});

// Configure multer with no file size limit
const uploadGeneric = multer({
  storage: storage,
  limits: {
    fileSize: Infinity // No file size limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isImageMime = typeof file.mimetype === 'string' && file.mimetype.startsWith('image/');
    const isAllowedExt = ALLOWED_EXTENSIONS.has(ext);

    if (isImageMime && isAllowedExt) {
      return cb(null, true);
    }

    console.warn('❌ [upload] Blocked non-image upload:', {
      originalname: file.originalname,
      mimetype: file.mimetype
    });
    cb(new Error('Only image files are allowed'));
  }
});

module.exports = uploadGeneric;


