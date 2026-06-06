const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'vendorhub-jwt-secret-2026'; // In prod use env, for now configurable
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/auth';

app.use(cors());
app.use(express.json());

// Mongoose User model (MongoDB per service)
const userSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), unique: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'reviewer', 'vendor'], required: true },
  name: { type: String, required: true },
  vendorId: { type: String }, // for vendor role
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Connect to MongoDB (own DB 'auth')
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Auth Service connected to MongoDB');
  seedUsers();
}).catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Seed test users (no hardcodes in final, but seed for E2E)
async function seedUsers() {
  try {
    const count = await User.countDocuments();
    if (count > 0) {
      console.log('Users already seeded');
      return;
    }

    const users = [
      {
        email: 'admin@vendorhub.com',
        password: 'admin123',
        role: 'admin',
        name: 'Sarah Chen (Admin)'
      },
      {
        email: 'reviewer1@vendorhub.com',
        password: 'reviewer123',
        role: 'reviewer',
        name: 'Michael Torres (Reviewer)'
      },
      {
        email: 'reviewer2@vendorhub.com',
        password: 'reviewer123',
        role: 'reviewer',
        name: 'Priya Patel (Reviewer)'
      },
      {
        email: 'vendor1@acme.com',
        password: 'vendor123',
        role: 'vendor',
        name: 'Acme Cloud Services',
        vendorId: 'v1'
      },
      {
        email: 'vendor2@securenet.io',
        password: 'vendor123',
        role: 'vendor',
        name: 'SecureNet Solutions',
        vendorId: 'v2'
      },
      {
        email: 'vendor3@dataflow.ai',
        password: 'vendor123',
        role: 'vendor',
        name: 'DataFlow Analytics',
        vendorId: 'v3'
      }
    ];

    for (const u of users) {
      const passwordHash = await bcrypt.hash(u.password, 10);
      await User.create({
        email: u.email,
        passwordHash,
        role: u.role,
        name: u.name,
        vendorId: u.vendorId
      });
    }
    console.log('✅ Auth Service seeded with test users');
  } catch (err) {
    console.error('Seed error:', err);
  }
}

// JWT verify middleware (used by other services too via /verify)
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'auth-service' }));

// Register (for vendors self-onboard, or admin can create)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role = 'vendor', name, vendorId } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password, name required' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email,
      passwordHash,
      role,
      name,
      vendorId
    });

    res.json({ success: true, user: { id: user.id, email: user.email, role: user.role, name: user.name, vendorId: user.vendorId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role, 
        name: user.name,
        vendorId: user.vendorId 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, role: user.role, name: user.name, vendorId: user.vendorId }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify token (called by other services for inter-service auth)
app.post('/api/auth/verify', verifyToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Get current user (for frontend)
app.get('/api/auth/me', verifyToken, (req, res) => {
  res.json(req.user);
});

// Get user by id (internal)
app.get('/api/auth/users/:id', verifyToken, async (req, res) => {
  const user = await User.findOne({ id: req.params.id });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, email: user.email, role: user.role, name: user.name, vendorId: user.vendorId });
});

// List users (admin only - simple enforcement)
app.get('/api/auth/users', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const users = await User.find({}, '-passwordHash');
  res.json(users.map(u => ({ id: u.id, email: u.email, role: u.role, name: u.name, vendorId: u.vendorId })));
});

// Seed endpoint for manual trigger (used in orchestration)
app.post('/api/auth/seed', async (req, res) => {
  await seedUsers();
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Auth Service running on port ${PORT}`);
  console.log('Test users: admin@vendorhub.com/admin123, reviewer1@vendorhub.com/reviewer123, vendor1@acme.com/vendor123');
});