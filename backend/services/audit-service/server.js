const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const { format } = require('date-fns');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5006;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/audit';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:5001';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'internal-service-secret-2026';

app.use(cors());
app.use(express.json());

// Immutable audit log model
const auditSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4() },
  timestamp: { type: String, default: () => format(new Date(), 'yyyy-MM-dd HH:mm:ss') },
  action: { type: String, required: true },
  vendorId: { type: String },
  user: { type: String },
  details: { type: String },
  metadata: { type: Object },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: false }); // immutable-ish

const AuditLog = mongoose.model('AuditLog', auditSchema);

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Audit Service connected to MongoDB');
}).catch(err => {
  console.error('MongoDB error:', err);
  process.exit(1);
});

// Verify
async function verifyAuthToken(req) {
  if (req.headers['x-internal-service'] === INTERNAL_SECRET) {
    return { id: 'internal', role: 'admin', name: 'Internal Service' };
  }
  const authHeader = req.headers.authorization;
  if (!authHeader) throw new Error('No token');
  try {
    const res = await axios.post(`${AUTH_SERVICE_URL}/api/auth/verify`, {}, {
      headers: { Authorization: authHeader }
    });
    return res.data.user;
  } catch (e) {
    throw new Error('Auth failed');
  }
}

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'audit-service' }));

// Log action (called by other services)
app.post('/api/audit/log', async (req, res) => {
  try {
    // allow internal
    if (req.headers['x-internal-service'] !== INTERNAL_SECRET) {
      await verifyAuthToken(req);
    }

    const { action, vendorId, user, details, ...extra } = req.body;
    if (!action) return res.status(400).json({ error: 'action required' });

    const entry = await AuditLog.create({
      action,
      vendorId,
      user: user || 'System',
      details: details || '',
      metadata: extra
    });

    res.json({ success: true, log: entry });
  } catch (err) {
    res.status(500).json({ error: 'Log failed' });
  }
});

// Get all logs (queryable)
app.get('/api/audit/logs', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const { vendorId, action, limit = 100 } = req.query;
    let query = {};
    if (vendorId) query.vendorId = vendorId;
    if (action) query.action = new RegExp(action, 'i');

    const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(parseInt(limit)).lean();
    res.json(logs);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Get recent for dashboard
app.get('/api/audit/recent', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(20).lean();
    res.json(logs);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Seed
app.post('/api/audit/seed', async (req, res) => {
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Audit Service running on port ${PORT}`);
  console.log('Immutable audit trail enabled (maps to CloudTrail + DynamoDB later)');
});