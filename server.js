const express = require('express');
const path = require('path');
const crypto = require('crypto');
const {
  initDatabase,
  findGuestByName,
  searchGuests,
  addGuest,
  getAllGuests,
  getGuestCount,
  markGuestSeated,
  setGuestSeated,
  updateGuestTable,
  deleteGuest
} = require('./database');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2024';
const adminSessions = new Map(); // token -> expiry

function createAdminToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized. Admin access required.' });
  }
  if (Date.now() > adminSessions.get(token)) {
    adminSessions.delete(token);
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  next();
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Ensure data directory and database exist
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
initDatabase();

// Guest-facing: find table by exact name
app.post('/find-table', (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.json({ error: 'Please enter your name.' });
    }
    const guest = findGuestByName(name);
    if (guest) {
      res.json({
        id: guest.id,
        table: guest.table_number,
        name: guest.name,
        seated: !!guest.seated
      });
    } else {
      res.json({ error: 'Name not found. Please check your spelling or ask a host.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Mark guest as seated
app.patch('/api/guests/:id/seat', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid guest ID.' });
    const ok = markGuestSeated(id);
    if (ok) res.json({ success: true });
    else res.status(404).json({ error: 'Guest not found.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update.' });
  }
});

// Guest-facing: search (partial match)
app.get('/api/search', (req, res) => {
  try {
    const q = req.query.q || '';
    const guests = searchGuests(q);
    res.json({ guests });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// Admin: login
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body || {};
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password.' });
    }
    const token = createAdminToken();
    const expires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    adminSessions.set(token, expires);
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminSessions.delete(token);
  res.json({ success: true });
});

// Admin: list all guests (protected)
app.get('/api/guests', requireAdmin, (req, res) => {
  try {
    const guests = getAllGuests();
    const count = getGuestCount();
    res.json({ guests, count });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// Admin: set guest seated status (protected, requires password confirm)
app.patch('/api/guests/:id/seated', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password, seated } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Invalid guest ID.' });
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password. Action not confirmed.' });
    }
    const ok = setGuestSeated(id, !!seated);
    if (ok) res.json({ success: true });
    else res.status(404).json({ error: 'Guest not found.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update.' });
  }
});

// Admin: update guest table (protected, requires password confirm)
app.patch('/api/guests/:id/table', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password, table_number } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Invalid guest ID.' });
    if (!table_number) return res.status(400).json({ error: 'New table number is required.' });
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password. Action not confirmed.' });
    }
    const ok = updateGuestTable(id, table_number);
    if (ok) res.json({ success: true });
    else res.status(404).json({ error: 'Guest not found.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update table.' });
  }
});

// Admin: delete guest (protected, requires password confirm)
app.delete('/api/guests/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Invalid guest ID.' });
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password. Action not confirmed.' });
    }
    const ok = deleteGuest(id);
    if (ok) res.json({ success: true });
    else res.status(404).json({ error: 'Guest not found.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete guest.' });
  }
});

// Admin: add guest (protected)
app.post('/api/guests', requireAdmin, (req, res) => {
  try {
    const { name, table_number } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Name is required.' });
    }
    const guest = addGuest(name, table_number);
    res.status(201).json(guest);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add guest.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Table Finder running at http://localhost:${PORT}`);
});
