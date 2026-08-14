const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// LOCAL DISK STORAGE — fine for development and small scale.
//
// Before you go to production with real users, swap this for S3-compatible
// object storage (AWS S3, Cloudflare R2, or DigitalOcean Spaces all work the
// same way): replace `multer.diskStorage` with `multer-s3` and point
// `UPLOAD_DIR` at a bucket name instead of a local folder. The rest of the
// app only ever deals with the resulting file URL, so no other code needs to
// change. Local disk storage will NOT survive a redeploy on most hosting
// platforms (the filesystem resets), so this swap is not optional before launch.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    const ok = /image\/(jpeg|png|webp)|application\/pdf/.test(file.mimetype);
    cb(ok ? null : new Error("Only JPEG, PNG, WEBP, or PDF files are allowed"), ok);
  },
});

module.exports = { upload, uploadDir };
