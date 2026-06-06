const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const { format } = require('date-fns');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5007;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/notification';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:5001';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'internal-service-secret-2026';

app.use(cors());
app.use(express.json());

// Notification model (in-app, simulates SNS)
const notificationSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4() },
  timestamp: { type: String, default: () => format(new Date(), 'yyyy-MM-dd HH:mm:ss') },
  type: { type: String, required: true },
  message: { type: String, required: true },
  vendorId: { type: String },
  vendorName: { type: String },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const Notification = mongoose.model('Notification', notificationSchema);

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Notification Service connected to MongoDB');
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
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'notification-service' }));

// Create notification (internal)
app.post('/api/notifications', async (req, res) => {
  try {
    if (req.headers['x-internal-service'] !== INTERNAL_SECRET) {
      await verifyAuthToken(req);
    }

    const { type, message, vendorId, vendorName = '' } = req.body;
    if (!type || !message) return res.status(400).json({ error: 'type and message required' });

    const notif = await Notification.create({
      type,
      message,
      vendorId,
      vendorName
    });

    res.json({ success: true, notification: notif });
  } catch (err) {
    res.status(500).json({ error: 'Create failed' });
  }
});

// Get notifications (for UI, unread first)
app.get('/api/notifications', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const notifs = await Notification.find().sort({ createdAt: -1 }).limit(50).lean();
    res.json(notifs);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Mark as read
app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const updated = await Notification.findOneAndUpdate(
      { id: req.params.id },
      { read: true },
      { new: true }
    );
    res.json({ success: true, notification: updated });
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Mark all read
app.put('/api/notifications/read-all', async (req, res) => {
  try {
    await verifyAuthToken(req);
    await Notification.updateMany({}, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Seed
app.post('/api/notifications/seed', async (req, res) => {
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Notification Service running on port ${PORT}`);
});