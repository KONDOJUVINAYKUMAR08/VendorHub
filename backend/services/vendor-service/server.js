const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5002;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/vendor';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:5001';

app.use(cors());
app.use(express.json());

// Vendor model
const vendorSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), unique: true },
  name: { type: String, required: true },
  category: { type: String, default: 'General' },
  contact: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastReview: { type: String }
});

const Vendor = mongoose.model('Vendor', vendorSchema);

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Vendor Service connected to MongoDB');
  seedVendors();
}).catch(err => {
  console.error('MongoDB error:', err);
  process.exit(1);
});

async function seedVendors() {
  try {
    const count = await Vendor.countDocuments();
    if (count > 0) {
      console.log('Vendors already seeded');
      return;
    }

    const vendors = [
      { id: 'v1', name: 'Acme Cloud Services', category: 'Cloud Provider', contact: 'security@acmecloud.com' },
      { id: 'v2', name: 'SecureNet Solutions', category: 'Security Vendor', contact: 'compliance@securenet.io' },
      { id: 'v3', name: 'DataFlow Analytics', category: 'Software Vendor', contact: 'legal@dataflow.ai' },
      { id: 'v4', name: 'Global Hardware Inc', category: 'Hardware Vendor', contact: 'procurement@globalhw.com' },
      { id: 'v5', name: 'CloudShield Inc', category: 'Cybersecurity', contact: 'info@cloudshield.com' }
    ];

    await Vendor.insertMany(vendors);
    console.log('✅ Vendor Service seeded 5 vendors');
  } catch (err) {
    console.error('Vendor seed error:', err);
  }
}

// Verify token helper (call auth service)
async function verifyAuthToken(req) {
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
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'vendor-service' }));

// Get all vendors (protected)
app.get('/api/vendors', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const vendors = await Vendor.find().lean();
    res.json(vendors.map(v => ({
      id: v.id,
      name: v.name,
      category: v.category,
      contact: v.contact,
      createdAt: v.createdAt,
      lastReview: v.lastReview
    })));
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Get one vendor
app.get('/api/vendors/:id', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const vendor = await Vendor.findOne({ id: req.params.id }).lean();
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json({
      id: vendor.id,
      name: vendor.name,
      category: vendor.category,
      contact: vendor.contact,
      createdAt: vendor.createdAt,
      lastReview: vendor.lastReview
    });
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Register new vendor (self or admin)
app.post('/api/vendors/register', async (req, res) => {
  try {
    // For public register, no token required? But for now, allow, or require for internal.
    // To keep simple, allow unauth for vendor self register (as in original)
    const { name, category = 'New Vendor', contact } = req.body;
    if (!name || !contact) return res.status(400).json({ error: 'name and contact required' });

    const newV = {
      id: uuidv4(),
      name,
      category,
      contact
    };
    const vendor = await Vendor.create(newV);

    // Log to audit? but later, or call audit service, but for now just create
    res.json(vendor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Register failed' });
  }
});

// Update vendor (admin/reviewer)
app.put('/api/vendors/:id', async (req, res) => {
  try {
    const user = await verifyAuthToken(req);
    if (!['admin', 'reviewer'].includes(user.role)) return res.status(403).json({ error: 'Forbidden' });

    const { name, category, contact } = req.body;
    const updated = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      { name, category, contact },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Seed endpoint
app.post('/api/vendors/seed', async (req, res) => {
  await seedVendors();
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Vendor Service running on port ${PORT}`);
});