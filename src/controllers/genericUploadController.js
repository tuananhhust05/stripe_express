const path = require('path');
const fs = require('fs').promises;

// Upload directory for generic uploads
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'upload');

// Ensure upload directory exists
const ensureUploadDir = async () => {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    console.error('[upload] Error creating upload directory:', error);
  }
};

// Initialize directory on module load
ensureUploadDir();

/**
 * Upload file to public/upload
 */
const uploadToUploadFolder = async (req, res) => {
  try {
    await ensureUploadDir();

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const fileInfo = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: `/upload/${req.file.filename}`,
      uploadedAt: new Date().toISOString()
    };

    console.log('✅ [upload] File uploaded:', fileInfo);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      file: fileInfo
    });
  } catch (error) {
    console.error('❌ [upload] Upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload file: ' + error.message
    });
  }
};

module.exports = {
  uploadToUploadFolder
};


