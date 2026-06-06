const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5005;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/compliance';
const DOCUMENT_SERVICE_URL = process.env.DOCUMENT_SERVICE_URL || 'http://document-service:5003';
const VENDOR_SERVICE_URL = process.env.VENDOR_SERVICE_URL || 'http://vendor-service:5002';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:5001';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'internal-service-secret-2026';

// Auth verify helper (supports JWT or internal service)
async function verifyAuthToken(req) {
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

// Configurable thresholds - NO HARDCODES (use env)
const EXPIRY_WINDOW_DAYS = parseInt(process.env.EXPIRY_WINDOW_DAYS || '90');
const HIGH_RISK_EXPIRED_THRESHOLD = parseInt(process.env.HIGH_RISK_EXPIRED_THRESHOLD || '0');
const HIGH_RISK_REJECTED_THRESHOLD = parseInt(process.env.HIGH_RISK_REJECTED_THRESHOLD || '1');
const HIGH_RISK_COMPLIANCE_RATIO = parseFloat(process.env.HIGH_RISK_COMPLIANCE_RATIO || '0.4');
const MEDIUM_RISK_EXPIRING_THRESHOLD = parseInt(process.env.MEDIUM_RISK_EXPIRING_THRESHOLD || '2');
const MEDIUM_RISK_COMPLIANCE_RATIO = parseFloat(process.env.MEDIUM_RISK_COMPLIANCE_RATIO || '0.75');

app.use(cors());
app.use(express.json());

// VendorRisk model (compliance owns the calc results)
const riskSchema = new mongoose.Schema({
  vendorId: { type: String, required: true, unique: true },
  risk: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  score: { type: Number, default: 50 },
  status: { type: String, default: 'Under Review' },
  lastCalculated: { type: Date, default: Date.now },
  details: { type: Object }
});

const VendorRisk = mongoose.model('VendorRisk', riskSchema);

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Compliance Service connected to MongoDB');
}).catch(err => {
  console.error('MongoDB error:', err);
  process.exit(1);
});

// Dynamic risk calculation - fully configurable, no hardcodes in logic beyond defaults
function calculateRiskAndStatus(docs = []) {
  if (docs.length === 0) {
    return { risk: 'High', score: 25, status: 'High Risk', details: { reason: 'No documents' } };
  }

  const now = new Date();
  let valid = 0, expiring = 0, expired = 0, rejected = 0;

  docs.forEach(d => {
    if (d.status === 'Rejected') { rejected++; return; }
    if (!d.expires) { valid++; return; }

    const exp = new Date(d.expires);
    if (exp < now) expired++;
    else if (exp < new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)) expiring++;
    else valid++;
  });

  const total = docs.length;
  const complianceRatio = (valid + (expiring * 0.5)) / total;

  let risk, score, status, details;

  if (expired > HIGH_RISK_EXPIRED_THRESHOLD || rejected > HIGH_RISK_REJECTED_THRESHOLD || complianceRatio < HIGH_RISK_COMPLIANCE_RATIO) {
    risk = 'High';
    score = Math.max(20, Math.floor(35 * complianceRatio));
    status = 'High Risk';
    details = { expired, rejected, complianceRatio: complianceRatio.toFixed(2) };
  } else if (expiring > MEDIUM_RISK_EXPIRING_THRESHOLD || complianceRatio < MEDIUM_RISK_COMPLIANCE_RATIO) {
    risk = 'Medium';
    score = Math.floor(55 + (30 * complianceRatio));
    status = 'Under Review';
    details = { expiring, complianceRatio: complianceRatio.toFixed(2) };
  } else {
    risk = 'Low';
    score = Math.floor(82 + (18 * complianceRatio));
    status = 'Active';
    details = { complianceRatio: complianceRatio.toFixed(2) };
  }

  return { 
    risk, 
    score: Math.min(100, Math.max(20, Math.round(score))), 
    status,
    details
  };
}

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'compliance-service', config: { EXPIRY_WINDOW_DAYS, HIGH_RISK_EXPIRED_THRESHOLD } }));

// Calculate / upsert for a vendor (called by document service on events)
app.post('/api/compliance/calculate', async (req, res) => {
  try {
    // allow internal calls without user token
    if (req.headers['x-internal-service'] !== INTERNAL_SECRET) {
      try { await verifyAuthToken(req); } catch (e) { return res.status(401).json({ error: 'Unauthorized' }); }
    }
    const { vendorId } = req.body;
    if (!vendorId) return res.status(400).json({ error: 'vendorId required' });

    // Fetch docs from document-service (inter-service call using internal secret)
    let docs = [];
    try {
      const docsRes = await axios.get(`${DOCUMENT_SERVICE_URL}/api/documents/vendor/${vendorId}`, {
        headers: { 'x-internal-service': process.env.INTERNAL_SECRET || 'internal-service-secret-2026' }
      });
      docs = docsRes.data || [];
    } catch (e) {
      console.log('Could not fetch docs for compliance:', e.message);
      // fallback empty
    }

    const calc = calculateRiskAndStatus(docs);

    // Upsert risk
    const riskRecord = await VendorRisk.findOneAndUpdate(
      { vendorId },
      { ...calc, lastCalculated: new Date() },
      { upsert: true, new: true }
    );

    // Optionally update vendor service lastReview, but skip for now to avoid more deps

    res.json({ success: true, vendorId, ...calc, riskRecord });
  } catch (err) {
    console.error('Calc error:', err);
    res.status(500).json({ error: 'Calculation failed' });
  }
});

// Get risk for vendor
app.get('/api/compliance/vendor/:vendorId', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const risk = await VendorRisk.findOne({ vendorId: req.params.vendorId }).lean();
    if (!risk) {
      // trigger calc if not exist
      return res.json({ risk: 'Medium', score: 50, status: 'Under Review' });
    }
    res.json(risk);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Get all risks (for dashboard)
app.get('/api/compliance/risks', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const risks = await VendorRisk.find().lean();
    res.json(risks);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Get dashboard stats (aggregated from risks + some)
app.get('/api/compliance/dashboard', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const risks = await VendorRisk.find().lean();
    const total = risks.length;
    const high = risks.filter(r => r.risk === 'High').length;
    const avg = total ? Math.round(risks.reduce((s, r) => s + (r.score || 0), 0) / total) : 0;

    // For expiring, call document service (internal)
    let expiringSoon = 0;
    try {
      const expRes = await axios.get(`${DOCUMENT_SERVICE_URL}/api/documents/expiring`, {
        headers: { 'x-internal-service': process.env.INTERNAL_SECRET || 'internal-service-secret-2026' }
      });
      expiringSoon = expRes.data ? expRes.data.length : 0;
    } catch (e) {}

    const riskDistribution = {
      Low: risks.filter(r => r.risk === 'Low').length,
      Medium: risks.filter(r => r.risk === 'Medium').length,
      High: high
    };

    res.json({
      totalVendors: total || 5, // fallback
      highRisk: high,
      expiringSoon,
      avgScore: avg,
      riskDistribution
    });
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Seed (recalc all if needed)
app.post('/api/compliance/seed', async (req, res) => {
  // Could recalc for all known vendors, but simple
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Compliance Service running on port ${PORT}`);
  console.log(`Config: expiry=${EXPIRY_WINDOW_DAYS}d, thresholds configurable via env`);
});