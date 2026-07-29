const express = require('express');
const multer = require('multer');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { z } = require('zod');
const { parse } = require('csv-parse/sync');
const { sql } = require('./db');
const { sendWelcomeEmail } = require('./mailer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ---- In-memory image storage (replace with database in production) ----
const imageStorage = {
  scan: null,
  register: null,
  checkin: null
};

// ---- Database Setup (runs per-request on Vercel serverless) ----
let dbReady = false;
async function setupDatabase() {
  if (dbReady) return;
  try {
    await sql`CREATE TABLE IF NOT EXISTS invites (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, plus_one_eligible BOOLEAN DEFAULT false)`;
    await sql`CREATE TABLE IF NOT EXISTS guests (id SERIAL PRIMARY KEY, tag_uid TEXT, card_id INTEGER, name TEXT NOT NULL, email TEXT, phone TEXT, plus_one BOOLEAN DEFAULT false, plus_one_name TEXT, status VARCHAR(20) DEFAULT 'pending', registered_at TIMESTAMP DEFAULT NOW(), checked_in BOOLEAN DEFAULT false, checked_in_at TIMESTAMP)`;
    await sql`CREATE TABLE IF NOT EXISTS cards (id SERIAL PRIMARY KEY, uid_hash VARCHAR(64) UNIQUE NOT NULL, status VARCHAR(20) DEFAULT 'unused', created_at TIMESTAMP DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, event_type VARCHAR(50) NOT NULL, card_uid_hash VARCHAR(64), guest_id INTEGER, ip_address VARCHAR(45), user_agent TEXT, details JSONB, created_at TIMESTAMP DEFAULT NOW())`;
    dbReady = true;
    console.log('[db] All tables ready');
  } catch (err) {
    console.error('[db] Setup error:', err.message);
  }
}

setupDatabase().catch(() => {});

// ---- Security Middleware ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true }
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token']
}));

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(express.static(__dirname));

// ---- Rate Limiters ----
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const checkinLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 3,
  message: { error: 'Too many check-in attempts. Please try again.' },
  standardHeaders: true,
  legacyHeaders: false
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please try again later.' }
});

app.use('/api/', generalLimiter);

// ---- Card UID Hashing ----
const CARD_SALT = process.env.CARD_SALT || crypto.randomBytes(32).toString('hex');

function hashCardUID(uid) {
  return crypto.createHash('sha256')
    .update(uid.toUpperCase().trim() + CARD_SALT)
    .digest('hex');
}

// ---- Audit Logging ----
async function logAuditEvent(eventType, data) {
  try {
    await sql`
      INSERT INTO audit_logs (event_type, card_uid_hash, guest_id, ip_address, user_agent, details)
      VALUES (${eventType}, ${data.card_uid_hash || null}, ${data.guest_id || null}, ${data.ip_address || null}, ${data.user_agent || null}, ${JSON.stringify(data.details || {})}::jsonb)
    `;
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// ---- Input Validation Schemas ----
const registerSchema = z.object({
  token: z.string().min(1).max(50).regex(/^[A-F0-9:]+$/i, 'Invalid token format'),
  name: z.string().min(2).max(100).trim(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  phone: z.string().min(10).max(15).regex(/^\+?[0-9]+$/, 'Invalid phone format')
});

const checkinSchema = z.object({
  token: z.string().min(1).max(50).regex(/^[A-F0-9:]+$/i, 'Invalid token format')
});

// ---- Invite list lookup (for plus-one eligibility) ----
app.get('/api/invites/search', async (req, res) => {
  await setupDatabase();
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const matches = await sql`
    SELECT * FROM invites
    WHERE LOWER(name) LIKE '%' || ${q} || '%'
    LIMIT 8
  `;
  res.json(matches);
});

// ---- Card Status Check ----
app.get('/api/card/:uid/status', async (req, res) => {
  await setupDatabase();
  const uid = req.params.uid;
  
  if (!uid || !/^[A-F0-9:]+$/i.test(uid)) {
    return res.status(400).json({ error: 'Invalid card UID format' });
  }
  
  const uidHash = hashCardUID(uid);
  
  try {
    const cards = await sql`SELECT * FROM cards WHERE uid_hash = ${uidHash}`;
    
    if (cards.length === 0) {
      return res.json({ status: 'unused', card_uid: uid });
    }
    
    const card = cards[0];
    
    // Get guest info if registered
    const guests = await sql`SELECT * FROM guests WHERE card_id = ${card.id}`;
    
    if (guests.length === 0) {
      return res.json({ status: card.status, card_uid: uid });
    }
    
    const guest = guests[0];
    
    if (guest.checked_in) {
      return res.json({ 
        status: 'checked_in', 
        card_uid: uid,
        guest_name: guest.name,
        checked_in_at: guest.checked_in_at
      });
    }
    
    return res.json({ 
      status: 'registered', 
      card_uid: uid,
      guest_name: guest.name,
      email: guest.email
    });
    
  } catch (err) {
    console.error('Card status error:', err);
    res.status(500).json({ error: 'Failed to check card status' });
  }
});

// ---- V2 Registration (NFC Token Flow) ----
app.post('/api/register-v2', registrationLimiter, async (req, res) => {
  await setupDatabase();
  // Validate input
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ 
      error: 'Invalid input', 
      details: result.error.issues.map(i => i.message)
    });
  }
  
  const { token, name, email, phone } = result.data;
  const tokenHash = hashCardUID(token);
  
  try {
    // Check if token is already registered
    const existingCards = await sql`SELECT * FROM cards WHERE uid_hash = ${tokenHash}`;
    
    if (existingCards.length > 0) {
      const card = existingCards[0];
      const existingGuests = await sql`SELECT * FROM guests WHERE card_id = ${card.id}`;
      
      if (existingGuests.length > 0) {
        await logAuditEvent('registration_attempt_duplicate', {
          card_uid_hash: tokenHash,
          ip_address: req.ip,
          user_agent: req.headers['user-agent'],
          details: { name, email }
        });
        
        return res.status(409).json({ 
          error: 'This token is already registered',
          guest_name: existingGuests[0].name
        });
      }
    }
    
    // Create or get card record
    let cardId;
    if (existingCards.length > 0) {
      cardId = existingCards[0].id;
      // Update card status
      await sql`UPDATE cards SET status = 'registered' WHERE id = ${cardId}`;
    } else {
      const newCard = await sql`
        INSERT INTO cards (uid_hash, status)
        VALUES (${tokenHash}, 'registered')
        RETURNING id
      `;
      cardId = newCard[0].id;
    }
    
    // Create guest record
    const guests = await sql`
      INSERT INTO guests (card_id, name, email, phone, status)
      VALUES (${cardId}, ${name}, ${email || null}, ${phone}, 'confirmed')
      RETURNING *
    `;
    const guest = guests[0];
    
    // Log successful registration
    await logAuditEvent('registration', {
      card_uid_hash: tokenHash,
      guest_id: guest.id,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      details: { name, email, phone }
    });
    
    // Send confirmation email with token
    let emailResult = { sent: false };
    if (email) {
      emailResult = await sendWelcomeEmail(guest, token);
    }
    
    res.json({ 
      success: true, 
      guest: {
        id: guest.id,
        name: guest.name,
        email: guest.email,
        phone: guest.phone,
        status: guest.status
      },
      email: emailResult
    });
    
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ---- V2 Check-in ----
app.post('/api/checkin-v2', checkinLimiter, async (req, res) => {
  await setupDatabase();
  // Validate input
  const result = checkinSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ 
      error: 'Invalid input', 
      details: result.error.issues.map(i => i.message)
    });
  }
  
  const { token } = result.data;
  const tokenHash = hashCardUID(token);
  
  try {
    const cards = await sql`SELECT * FROM cards WHERE uid_hash = ${tokenHash}`;
    
    if (cards.length === 0) {
      await logAuditEvent('checkin_attempt_not_registered', {
        card_uid_hash: tokenHash,
        ip_address: req.ip,
        user_agent: req.headers['user-agent']
      });
      
      return res.json({ status: 'not_registered', token });
    }
    
    const card = cards[0];
    const guests = await sql`SELECT * FROM guests WHERE card_id = ${card.id}`;
    
    if (guests.length === 0) {
      await logAuditEvent('checkin_attempt_no_guest', {
        card_uid_hash: tokenHash,
        ip_address: req.ip,
        user_agent: req.headers['user-agent']
      });
      
      return res.json({ status: 'not_registered', token });
    }
    
    const guest = guests[0];
    
    if (guest.checked_in) {
      await logAuditEvent('checkin_attempt_already_used', {
        card_uid_hash: tokenHash,
        guest_id: guest.id,
        ip_address: req.ip,
        user_agent: req.headers['user-agent']
      });
      
      return res.json({ 
        status: 'already_used', 
        guest: {
          name: guest.name,
          checked_in_at: guest.checked_in_at
        }
      });
    }
    
    // Perform check-in
    const updated = await sql`
      UPDATE guests SET checked_in = true, checked_in_at = NOW()
      WHERE id = ${guest.id}
      RETURNING *
    `;
    
    // Update card status
    await sql`UPDATE cards SET status = 'checked_in' WHERE id = ${card.id}`;
    
    // Log successful check-in
    await logAuditEvent('checkin', {
      card_uid_hash: tokenHash,
      guest_id: guest.id,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      details: { name: guest.name }
    });
    
    res.json({ 
      status: 'granted', 
      guest: {
        name: updated[0].name,
        plus_one: updated[0].plus_one,
        plus_one_name: updated[0].plus_one_name
      }
    });
    
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ error: 'Check-in failed. Please try again.' });
  }
});

// ---- V1 Registration (Legacy) ----
app.post('/api/register', async (req, res) => {
  await setupDatabase();
  const { tag_uid, name, email, phone, plus_one, plus_one_name } = req.body;

  if (!tag_uid || !name) {
    return res.status(400).json({ error: 'tag_uid and name are required' });
  }

  const existing = await sql`SELECT * FROM guests WHERE tag_uid = ${tag_uid}`;
  if (existing.length > 0) {
    return res.status(409).json({ error: 'This card is already registered', guest: existing[0] });
  }

  const rows = await sql`
    INSERT INTO guests (tag_uid, name, email, phone, plus_one, plus_one_name)
    VALUES (${tag_uid}, ${name}, ${email || null}, ${phone || null}, ${!!plus_one}, ${plus_one ? (plus_one_name || null) : null})
    RETURNING *
  `;
  const guest = rows[0];

  let emailResult = { sent: false };
  if (email) {
    emailResult = await sendWelcomeEmail(guest);
  }

  res.json({ success: true, guest, email: emailResult });
});

// ---- V1 Check-in (Legacy) ----
app.post('/api/checkin', async (req, res) => {
  await setupDatabase();
  const { tag_uid } = req.body;
  if (!tag_uid) return res.status(400).json({ error: 'tag_uid is required' });

  const rows = await sql`SELECT * FROM guests WHERE tag_uid = ${tag_uid}`;

  if (rows.length === 0) {
    return res.json({ status: 'not_registered', tag_uid });
  }

  if (rows[0].checked_in) {
    return res.json({ status: 'already_used', guest: rows[0] });
  }

  const updated = await sql`
    UPDATE guests SET checked_in = true, checked_in_at = NOW()
    WHERE tag_uid = ${tag_uid}
    RETURNING *
  `;
  res.json({ status: 'granted', guest: updated[0] });
});

// ---- Admin: upload invite list (CSV: name,email,phone,plus_one) ----
app.post('/api/admin/upload', upload.single('file'), async (req, res) => {
  await setupDatabase();
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse CSV: ' + err.message });
  }

  const invites = records.map(r => ({
    name: r.name || '',
    email: r.email || '',
    phone: r.phone || '',
    plus_one_eligible: String(r.plus_one).trim().toUpperCase() === 'TRUE'
  })).filter(r => r.name);

  await sql`DELETE FROM invites`;
  for (const inv of invites) {
    await sql`
      INSERT INTO invites (name, email, phone, plus_one_eligible)
      VALUES (${inv.name}, ${inv.email}, ${inv.phone}, ${inv.plus_one_eligible})
    `;
  }

  res.json({ success: true, count: invites.length });
});

// ---- Admin: stats + guest list ----
app.get('/api/admin/stats', async (req, res) => {
  await setupDatabase();
  const invited = await sql`SELECT COUNT(*)::int AS count FROM invites`;
  const registered = await sql`SELECT COUNT(*)::int AS count FROM guests`;
  const checkedIn = await sql`SELECT COUNT(*)::int AS count FROM guests WHERE checked_in = true`;
  const tokensIssued = await sql`SELECT COUNT(*)::int AS count FROM cards WHERE status != 'unused'`;
  res.json({
    invited: invited[0].count,
    registered: registered[0].count,
    checked_in: checkedIn[0].count,
    tokens_issued: tokensIssued[0].count
  });
});

app.get('/api/admin/guests', async (req, res) => {
  await setupDatabase();
  const limit = req.query.limit ? parseInt(req.query.limit) : 1000;
  const guests = await sql`SELECT * FROM guests ORDER BY registered_at DESC LIMIT ${limit}`;
  res.json(guests);
});

// ---- Admin: images ----
app.get('/api/admin/images', (req, res) => {
  res.json(imageStorage);
});

app.post('/api/admin/images', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  
  const type = req.body.type;
  if (!['scan', 'register', 'checkin'].includes(type)) {
    return res.status(400).json({ error: 'Invalid image type' });
  }
  
  const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  imageStorage[type] = base64;
  
  res.json({ success: true, type });
});

// ---- Admin: get images for public pages ----
app.get('/api/images/:type', (req, res) => {
  const type = req.params.type;
  if (!['scan', 'register', 'checkin'].includes(type)) {
    return res.status(400).json({ error: 'Invalid image type' });
  }
  res.json({ url: imageStorage[type] });
});

// ---- Admin: get all images ----
app.get('/api/images', (req, res) => {
  res.json(imageStorage);
});

// ---- Admin: audit logs ----
app.get('/api/admin/audit-logs', async (req, res) => {
  await setupDatabase();
  const logs = await sql`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100`;
  res.json(logs);
});

if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Odetayo NFC event server running on port ${PORT}`));
}

module.exports = app;