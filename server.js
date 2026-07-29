const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const path = require('path');
const db = require('./db');
const { sendWelcomeEmail } = require('./mailer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(__dirname));

// ---- Invite list lookup (for plus-one eligibility) ----
app.get('/api/invites/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const matches = db.get('invites')
    .filter(i => i.name.toLowerCase().includes(q))
    .value()
    .slice(0, 8);
  res.json(matches);
});

// ---- Registration ----
app.post('/api/register', async (req, res) => {
  const { tag_uid, name, email, phone, plus_one, plus_one_name } = req.body;

  if (!tag_uid || !name) {
    return res.status(400).json({ error: 'tag_uid and name are required' });
  }

  const existing = db.get('guests').find({ tag_uid }).value();
  if (existing) {
    return res.status(409).json({ error: 'This card is already registered', guest: existing });
  }

  const guest = {
    tag_uid,
    name,
    email: email || null,
    phone: phone || null,
    plus_one: !!plus_one,
    plus_one_name: plus_one ? (plus_one_name || null) : null,
    registered_at: new Date().toISOString(),
    checked_in: false,
    checked_in_at: null
  };

  db.get('guests').push(guest).write();

  let emailResult = { sent: false };
  if (email) {
    emailResult = await sendWelcomeEmail(guest);
  }

  res.json({ success: true, guest, email: emailResult });
});

// ---- V2 Registration (No NFC card required) ----
app.post('/api/register-v2', async (req, res) => {
  const { name, email, phone, guests: additionalGuests } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  // Generate a unique ID for this registration
  const tag_uid = 'V2-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

  const guest = {
    tag_uid,
    name,
    email: email || null,
    phone: phone || null,
    plus_one: additionalGuests && additionalGuests.length > 0,
    plus_one_name: additionalGuests && additionalGuests.length > 0 ? additionalGuests.map(g => g.name).join(', ') : null,
    registered_at: new Date().toISOString(),
    checked_in: false,
    checked_in_at: null
  };

  db.get('guests').push(guest).write();

  // Register additional guests if provided
  if (additionalGuests && additionalGuests.length > 0) {
    for (const additionalGuest of additionalGuests) {
      if (additionalGuest.name) {
        const additionalGuestUid = 'V2-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const additionalGuestData = {
          tag_uid: additionalGuestUid,
          name: additionalGuest.name,
          email: additionalGuest.email || null,
          phone: null,
          plus_one: false,
          plus_one_name: null,
          registered_at: new Date().toISOString(),
          checked_in: false,
          checked_in_at: null
        };
        db.get('guests').push(additionalGuestData).write();
      }
    }
  }

  let emailResult = { sent: false };
  if (email) {
    emailResult = await sendWelcomeEmail(guest);
  }

  res.json({ success: true, guest, email: emailResult });
});

// ---- Check-in ----
app.post('/api/checkin', (req, res) => {
  const { tag_uid } = req.body;
  if (!tag_uid) return res.status(400).json({ error: 'tag_uid is required' });

  const guest = db.get('guests').find({ tag_uid }).value();

  if (!guest) {
    return res.json({ status: 'not_registered', tag_uid });
  }

  if (guest.checked_in) {
    return res.json({ status: 'already_used', guest });
  }

  db.get('guests').find({ tag_uid }).assign({
    checked_in: true,
    checked_in_at: new Date().toISOString()
  }).write();

  const updated = db.get('guests').find({ tag_uid }).value();
  res.json({ status: 'granted', guest: updated });
});

// ---- Admin: upload invite list (CSV: name,email,phone,plus_one) ----
app.post('/api/admin/upload', upload.single('file'), (req, res) => {
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

  db.set('invites', invites).write();
  res.json({ success: true, count: invites.length });
});

// ---- Admin: stats + guest list ----
app.get('/api/admin/stats', (req, res) => {
  const invites = db.get('invites').value();
  const guests = db.get('guests').value();
  res.json({
    invited: invites.length,
    registered: guests.length,
    checked_in: guests.filter(g => g.checked_in).length
  });
});

app.get('/api/admin/guests', (req, res) => {
  res.json(db.get('guests').value());
});

if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Odetayo NFC event server running on port ${PORT}`));
}

module.exports = app;
