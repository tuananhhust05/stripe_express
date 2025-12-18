const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Upload directory for macOS installers
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'app', 'mac');

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
    // Keep original filename exactly as uploaded
    const originalName = file.originalname;
    const filePath = path.join(UPLOAD_DIR, originalName);

    // If file exists, delete it first (replace old file)
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log('✅ [mac] Replaced existing file:', originalName);
      } catch (error) {
        console.error('⚠️ [mac] Error deleting existing file:', error);
      }
    }

    cb(null, originalName);
  }
});

// Configure multer with no file size limit
const uploadMac = multer({
  storage: storage,
  limits: {
    fileSize: Infinity // No file size limit
  },
  fileFilter: (req, file, cb) => {
    // Accept all file types
    cb(null, true);
  }
});

module.exports = uploadMac;


