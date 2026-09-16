const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const TOTAL_TABLES = 12;
const RESERVATION_DURATION = 90;
const SLOT_MINUTES = 30;
const OPEN_TIME = '12:00';
const LAST_SEATING = '22:00';
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-please';

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function generateSlots() {
  const slots = [];
  for (let t = timeToMinutes(OPEN_TIME); t <= timeToMinutes(LAST_SEATING); t += SLOT_MINUTES) {
    slots.push(minutesToTime(t));
  }
  return slots;
}

function isValidDateString(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime());
}

function isPastDate(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00') < today;
}

function tablesBookedAt(date, time) {
  const start = timeToMinutes(time);
  const end = start + RESERVATION_DURATION;
  const rows = db.prepare(`SELECT time FROM reservations WHERE date = ? AND status = 'confirmed'`).all(date);
  let count = 0;
  for (const row of rows) {
    const rs = timeToMinutes(row.time);
    const re = rs + RESERVATION_DURATION;
    if (rs < end && start < re) count++;
  }
  return count;
}

function requireAdmin(req, res, next) {
  const key = req.header('X-Admin-Key');
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Invalid admin key.' });
  next();
}

app.get('/api/availability/day', (req, res) => {
  const { date } = req.query;
  if (!date || !isValidDateString(date)) return res.status(400).json({ error: 'Invalid date format.' });
  if (isPastDate(date)) return res.status(400).json({ error: 'Date in the past.' });
  const slots = generateSlots().map((time) => ({
    time,
    tablesLeft: Math.max(0, TOTAL_TABLES - tablesBookedAt(date, time))
  }));
  res.json({ date, totalTables: TOTAL_TABLES, slots });
});

app.post('/api/reservations', (req, res) => {
  const { name, phone, date, time, guests, notes } = req.body || {};
  if (!name || !phone || !date || !time || !guests) return res.status(400).json({ error: 'Missing fields.' });
  if (!isValidDateString(date) || isPastDate(date)) return res.status(400).json({ error: 'Invalid date.' });
  if (!generateSlots().includes(time)) return res.status(400).json({ error: 'Invalid time.' });
  const guestCount = parseInt(guests, 10);
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20) return res.status(400).json({ error: 'Invalid guest count.' });
  if (tablesBookedAt(date, time) >= TOTAL_TABLES) return res.status(409).json({ error: 'Slot full.' });
  const result = db.prepare(`INSERT INTO reservations (name, phone, date, time, guests, notes, status) VALUES (?, ?, ?, ?, ?, ?, 'confirmed')`).run(name.trim(), phone.trim(), date, time, guestCount, (notes || '').trim());
  res.status(201).json({ id: result.lastInsertRowid, status: 'confirmed', message: `Confirmed for ${guestCount} on ${date} at ${time}.` });
});

app.get('/api/admin/reservations', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT * FROM reservations ORDER BY date ASC, time ASC`).all());
});

app.patch('/api/admin/reservations/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['confirmed', 'cancelled', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const result = db.prepare(`UPDATE reservations SET status = ? WHERE id = ?`).run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
});

app.delete('/api/admin/reservations/:id', requireAdmin, (req, res) => {
  const result = db.prepare(`DELETE FROM reservations WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Zypher's running at http://localhost:${PORT}`);
  console.log(`Admin at http://localhost:${PORT}/admin.html`);
});
