const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { sql } = require('./db');
const { sendWelcomeEmail } = require('./mailer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(__dirname));

// ---- Invite list lookup (for plus-one eligibility) ----
app.get('/api/invites/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const matches = await sql`
    SELECT * FROM invites
    WHERE LOWER(name) LIKE '%' || ${q} || '%'
    LIMIT 8
  `;
  res.json(matches);
});

// ---- Registration ----
app.post('/api/register', async (req, res) => {
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

// ---- Check-in ----
app.post('/api/checkin', async (req, res) => {
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
  const invited = await sql`SELECT COUNT(*)::int AS count FROM invites`;
  const registered = await sql`SELECT COUNT(*)::int AS count FROM guests`;
  const checkedIn = await sql`SELECT COUNT(*)::int AS count FROM guests WHERE checked_in = true`;
  res.json({
    invited: invited[0].count,
    registered: registered[0].count,
    checked_in: checkedIn[0].count
  });
});

app.get('/api/admin/guests', async (req, res) => {
  const guests = await sql`SELECT * FROM guests ORDER BY registered_at DESC`;
  res.json(guests);
});

if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Odetayo NFC event server running on port ${PORT}`));
}

module.exports = app;
