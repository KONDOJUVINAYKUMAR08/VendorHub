const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5004;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/workflow';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:5001';
const DOCUMENT_SERVICE_URL = process.env.DOCUMENT_SERVICE_URL || 'http://document-service:5003';
const COMPLIANCE_SERVICE_URL = process.env.COMPLIANCE_SERVICE_URL || 'http://compliance-service:5005';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'internal-service-secret-2026';

app.use(cors());
app.use(express.json());

// Task model for workflow
const taskSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), unique: true },
  vendorId: { type: String, required: true },
  documentId: { type: String },
  docName: { type: String },
  type: { type: String, default: 'Document Review' },
  status: { type: String, default: 'Pending' },
  createdAt: { type: Date, default: Date.now },
  dueDate: { type: Date, default: () => new Date(Date.now() + 7*24*60*60*1000) }
});

const WorkflowTask = mongoose.model('WorkflowTask', taskSchema);

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Workflow Service connected to MongoDB');
}).catch(err => {
  console.error('MongoDB error:', err);
  process.exit(1);
});

// Verify helper
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
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'workflow-service' }));

// Create task (called internally by document on upload)
app.post('/api/workflow/tasks', async (req, res) => {
  try {
    // internal only or admin
    if (req.headers['x-internal-service'] !== INTERNAL_SECRET) {
      const user = await verifyAuthToken(req);
      if (!['admin', 'reviewer'].includes(user.role)) return res.status(403).json({ error: 'Forbidden' });
    }

    const { vendorId, documentId, docName, type = 'Document Review' } = req.body;
    if (!vendorId) return res.status(400).json({ error: 'vendorId required' });

    const task = await WorkflowTask.create({
      vendorId,
      documentId,
      docName: docName || 'Document Review',
      type
    });

    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: 'Create task failed' });
  }
});

// Get pending tasks (for internal dashboard)
app.get('/api/workflow/tasks', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const tasks = await WorkflowTask.find({ status: 'Pending' }).sort({ createdAt: -1 }).lean();
    res.json(tasks);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Complete task (on approve)
app.put('/api/workflow/tasks/complete', async (req, res) => {
  try {
    if (req.headers['x-internal-service'] !== INTERNAL_SECRET) {
      await verifyAuthToken(req);
    }

    const { documentId, taskId } = req.body;
    let query = {};
    if (documentId) query.documentId = documentId;
    if (taskId) query.id = taskId;

    const updated = await WorkflowTask.findOneAndUpdate(
      query,
      { status: 'Completed' },
      { new: true }
    );

    if (!updated) {
      // not error if no task
      return res.json({ success: true, message: 'No pending task or already completed' });
    }

    res.json({ success: true, task: updated });
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Get all tasks
app.get('/api/workflow/all', async (req, res) => {
  try {
    await verifyAuthToken(req);
    const tasks = await WorkflowTask.find().sort({ createdAt: -1 }).lean();
    res.json(tasks);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Seed
app.post('/api/workflow/seed', async (req, res) => {
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Workflow Service running on port ${PORT}`);
});