const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const { format, addDays, isBefore } = require('date-fns');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5003;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/document';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:5001';
const COMPLIANCE_SERVICE_URL = process.env.COMPLIANCE_SERVICE_URL || 'http://compliance-service:5005';
const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL || 'http://audit-service:5006';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:5007';
const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL || 'http://workflow-service:5004';

const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.ensureDirSync(UPLOADS_DIR);

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer storage (simulates S3; in AWS use S3 + KMS)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, unique);
  }
});
const upload = multer({ 
  storage, 
  limits: { fileSize: 25 * 1024 * 1024 } 
});

// Document model (versioning via name + vendor + version num)
const documentSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), unique: true },
  vendorId: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, default: 'Uploaded Document' },
  version: { type: Number, default: 1 },
  uploaded: { type: String },
  expires: { type: String },
  status: { type: String, default: 'Valid' },
  filePath: { type: String },
  uploadedBy: { type: String },
  approvalComment: { type: String },
  rejectionReason: { type: String },
  previousVersions: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

const Document = mongoose.model('Document', documentSchema);

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Document Service connected to MongoDB');
}).catch(err => {
  console.error('MongoDB error:', err);
  process.exit(1);
});

// Internal service secret for inter-service calls (no user token needed)
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'internal-service-secret-2026';

// Auth verify helper (supports user JWT or internal service calls)
async function verifyAuthToken(req) {
  // Internal service-to-service call bypass
  if (req.headers['x-internal-service'] === INTERNAL_SECRET) {
    return { id: 'internal-service', role: 'admin', name: 'Internal Service' };
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) throw new Error('No token');
  try {
    const res = await axios.post(`${AUTH_SERVICE_URL}/api/auth/verify`, {}, {
      headers: { Authorization: authHeader }
    });
    return res.data.user;
  } catch (e) {
    throw new Error('Auth failed: ' + e.message);
  }
}

// Helper to notify other services (event simulation via HTTP)
async function triggerComplianceUpdate(vendorId) {
  try {
    await axios.post(`${COMPLIANCE_SERVICE_URL}/api/compliance/calculate`, { vendorId }, {
      headers: { 'x-internal-service': INTERNAL_SECRET }
    });
  } catch (e) { console.log('Compliance update skipped:', e.message); }
}

async function logAudit(action, vendorId, user, details, extra = {}) {
  try {
    await axios.post(`${AUDIT_SERVICE_URL}/api/audit/log`, {
      action, vendorId, user, details, ...extra
    }, {
      headers: { 'x-internal-service': INTERNAL_SECRET }
    });
  } catch (e) { console.log('Audit log skipped:', e.message); }
}

async function createNotification(type, message, vendorId, vendorName = '') {
  try {
    await axios.post(`${NOTIFICATION_SERVICE_URL}/api/notifications`, {
      type, message, vendorId, vendorName
    }, {
      headers: { 'x-internal-service': INTERNAL_SECRET }
    });
  } catch (e) { console.log('Notification skipped:', e.message); }
}

async function createWorkflowTask(vendorId, documentId, docName) {
  try {
    await axios.post(`${WORKFLOW_SERVICE_URL}/api/workflow/tasks`, {
      vendorId, documentId, docName, type: 'Document Review'
    }, {
      headers: { 'x-internal-service': INTERNAL_SECRET }
    });
  } catch (e) { console.log('Workflow task skipped:', e.message); }
}

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'document-service' }));

// Upload single document (with versioning)
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    const user = await verifyAuthToken(req); // require auth
    const { vendorId, type = 'Uploaded Document', expires } = req.body;
    if (!req.file || !vendorId) {
      return res.status(400).json({ error: 'file and vendorId required' });
    }

    const file = req.file;
    const uploadedBy = user.name || (user.role === 'vendor' ? 'Vendor Portal' : 'Internal Team');

    // Versioning logic: same name for vendor = increment version
    const existingDocs = await Document.find({ vendorId, name: file.originalname }).sort({ version: -1 });
    const version = existingDocs.length > 0 ? (existingDocs[0].version + 1) : 1;

    const previousVersions = existingDocs.map(d => ({
      id: d.id,
      version: d.version,
      uploaded: d.uploaded
    }));

    const newDoc = await Document.create({
      vendorId,
      name: file.originalname,
      type,
      version,
      uploaded: format(new Date(), 'yyyy-MM-dd'),
      expires: expires || format(addDays(new Date(), 365), 'yyyy-MM-dd'),
      status: 'Valid',
      filePath: `/uploads/${file.filename}`,
      uploadedBy,
      previousVersions
    });

    // Event-driven: trigger downstream
    await triggerComplianceUpdate(vendorId);
    await logAudit('Document Uploaded', vendorId, uploadedBy, `${file.originalname} (v${version})`);
    await createNotification('DOCUMENT_UPLOADED', `New document uploaded: ${file.originalname} (v${version})`, vendorId);
    await createWorkflowTask(vendorId, newDoc.id, newDoc.name);

    res.json({ success: true, document: newDoc });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// Bulk upload (array of files)
app.post('/api/documents/bulk-upload', upload.array('files', 10), async (req, res) => {
  try {
    const user = await verifyAuthToken(req);
    const { vendorId } = req.body;
    if (!req.files || req.files.length === 0 || !vendorId) {
      return res.status(400).json({ error: 'files and vendorId required' });
    }

    const uploadedBy = user.name || (user.role === 'vendor' ? 'Vendor Portal' : 'Internal Team');
    const results = [];

    for (const file of req.files) {
      const existingDocs = await Document.find({ vendorId, name: file.originalname }).sort({ version: -1 });
      const version = existingDocs.length > 0 ? (existingDocs[0].version + 1) : 1;
      const previousVersions = existingDocs.map(d => ({ id: d.id, version: d.version, uploaded: d.uploaded }));

      const doc = await Document.create({
        vendorId,
        name: file.originalname,
        type: 'Bulk Upload',
        version,
        uploaded: format(new Date(), 'yyyy-MM-dd'),
        expires: format(addDays(new Date(), 365), 'yyyy-MM-dd'),
        status: 'Valid',
        filePath: `/uploads/${file.filename}`,
        uploadedBy,
        previousVersions
      });

      results.push(doc);

      // Trigger per doc (can optimize)
      await triggerComplianceUpdate(vendorId);
      await logAudit('Document Uploaded (Bulk)', vendorId, uploadedBy, `${file.originalname} (v${version})`);
      await createNotification('DOCUMENT_UPLOADED', `Bulk upload: ${file.originalname} (v${version})`, vendorId);
    }

    await createWorkflowTask(vendorId, null, `Bulk: ${req.files.length} files`);

    res.json({ success: true, documents: results });
  } catch (err) {
    console.error('Bulk upload error:', err);
    res.status(500).json({ error: 'Bulk upload failed' });
  }
});

// Get documents for a vendor
app.get('/api/documents/vendor/:vendorId', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const docs = await Document.find({ vendorId: req.params.vendorId }).sort({ version: -1, createdAt: -1 }).lean();
    res.json(docs);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Get all documents (for internal)
app.get('/api/documents', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const docs = await Document.find().sort({ createdAt: -1 }).lean();
    res.json(docs);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Get expiring documents (within configurable days)
app.get('/api/documents/expiring', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const now = new Date();
    const EXPIRY_WINDOW = parseInt(process.env.EXPIRY_WINDOW_DAYS || '90');
    const expiryThreshold = addDays(now, EXPIRY_WINDOW);

    const expiring = await Document.find({
      expires: { $exists: true, $ne: null },
      status: { $ne: 'Rejected' }
    }).lean();

    const filtered = expiring
      .filter(d => {
        if (!d.expires) return false;
        const exp = new Date(d.expires);
        return isBefore(exp, expiryThreshold) && !isBefore(exp, now);
      })
      .sort((a, b) => new Date(a.expires) - new Date(b.expires));

    // Enrich with vendor name? For now, return as is, frontend can join or call vendor service
    res.json(filtered);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Approve document (triggers workflow complete, compliance recalc)
app.put('/api/documents/:id/approve', async (req, res) => {
  try {
    const user = await verifyAuthToken(req);
    if (!['admin', 'reviewer'].includes(user.role)) {
      return res.status(403).json({ error: 'Only reviewers/admins can approve' });
    }

    const { comment = '' } = req.body;
    const doc = await Document.findOneAndUpdate(
      { id: req.params.id },
      { status: 'Approved', approvalComment: comment },
      { new: true }
    );

    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await triggerComplianceUpdate(doc.vendorId);
    await logAudit('Document Approved', doc.vendorId, user.name, doc.name, { comment });
    await createNotification('DOCUMENT_APPROVED', `Document approved: ${doc.name}`, doc.vendorId);

    // Notify workflow if needed
    try {
      await axios.put(`${WORKFLOW_SERVICE_URL}/api/workflow/tasks/complete`, { documentId: doc.id }, {
        headers: { 'x-internal-service': INTERNAL_SECRET }
      });
    } catch (e) {}

    res.json({ success: true, document: doc });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// Reject document
app.put('/api/documents/:id/reject', async (req, res) => {
  try {
    const user = await verifyAuthToken(req);
    if (!['admin', 'reviewer'].includes(user.role)) {
      return res.status(403).json({ error: 'Only reviewers/admins can reject' });
    }

    const { reason = 'Non-compliant' } = req.body;
    const doc = await Document.findOneAndUpdate(
      { id: req.params.id },
      { status: 'Rejected', rejectionReason: reason },
      { new: true }
    );

    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await triggerComplianceUpdate(doc.vendorId);
    await logAudit('Document Rejected', doc.vendorId, user.name, `${doc.name} - ${reason}`);
    await createNotification('DOCUMENT_REJECTED', `Document rejected: ${doc.name} - ${reason}`, doc.vendorId);

    res.json({ success: true, document: doc });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// Get single doc
app.get('/api/documents/:id', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const doc = await Document.findOne({ id: req.params.id }).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Seed (if needed)
app.post('/api/documents/seed', async (req, res) => {
  // Could add sample docs, but for now just ok
  res.json({ success: true, message: 'Document service seed not auto-populated (use uploads)' });
});

app.listen(PORT, () => {
  console.log(`✅ Document Service running on port ${PORT}`);
  console.log('Features: single+bulk upload, versioning, expiring, approve/reject with inter-service events');
});