const fs = require('fs').promises;
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'app', 'window');

// Ensure upload directory exists
const ensureUploadDir = async () => {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating upload directory:', error);
  }
};

// Initialize directory on module load
ensureUploadDir();

/**
 * Upload file to public/app/window
 */
const uploadFile = async (req, res) => {
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
      path: `/app/window/${req.file.filename}`,
      uploadedAt: new Date().toISOString()
    };

    console.log('✅ File uploaded:', fileInfo);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      file: fileInfo
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload file: ' + error.message
    });
  }
};

/**
 * Get list of files in public/app/window
 */
const listFiles = async (req, res) => {
  try {
    await ensureUploadDir();

    const files = await fs.readdir(UPLOAD_DIR);
    const fileList = [];

    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      const stats = await fs.stat(filePath);
      
      // Skip directories
      if (stats.isDirectory()) {
        continue;
      }

      fileList.push({
        filename: file,
        size: stats.size,
        path: `/app/window/${file}`,
        uploadedAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString()
      });
    }

    // Sort by uploaded date (newest first)
    fileList.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({
      success: true,
      files: fileList,
      count: fileList.length
    });
  } catch (error) {
    console.error('❌ List files error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list files: ' + error.message
    });
  }
};

/**
 * Delete file from public/app/window
 */
const deleteFile = async (req, res) => {
  try {
    const { filename } = req.params;

    if (!filename) {
      return res.status(400).json({
        success: false,
        error: 'Filename is required'
      });
    }

    // Security: Prevent directory traversal
    const safeFilename = path.basename(filename);
    const filePath = path.join(UPLOAD_DIR, safeFilename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Delete file
    await fs.unlink(filePath);

    console.log('✅ File deleted:', safeFilename);

    res.json({
      success: true,
      message: 'File deleted successfully',
      filename: safeFilename
    });
  } catch (error) {
    console.error('❌ Delete file error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete file: ' + error.message
    });
  }
};

module.exports = {
  uploadFile,
  listFiles,
  deleteFile
};

