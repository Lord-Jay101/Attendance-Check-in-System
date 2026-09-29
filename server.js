const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const {
  initDatabase,
  findGuestByName,
  findGuestById,
  checkInGuest,
  firstNameFrom,
  suggestGuestsByNamePrefix,
  addGuest,
  importGuests,
  getAllGuests,
  getGuestCount,
  getAttendanceStats,
  setGuestSeated,
  updateGuest,
  deleteGuest,
  bulkCheckIn,
  bulkCheckOut,
  bulkDeleteGuests
} = require('./database');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2024';
const EVENT_NAME = process.env.EVENT_NAME || '2026 Africa Leadership Summit';
const adminSessions = new Map(); // token -> expiry

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(req, file, cb) {
    const name = (file.originalname || '').toLowerCase();
    const ok =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      name.endsWith('.csv') ||
      (file.mimetype && /spreadsheet|excel|csv|octet-stream/.test(file.mimetype));
    if (ok) cb(null, true);
    else cb(new Error('Please upload an Excel (.xlsx, .xls) or CSV file.'));
  }
});

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

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  // Practical validation — rejects empty / obvious junk without being overly strict
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && trimmed.length <= 254;
}

function formatCheckInTime(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch {
    return iso;
  }
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
initDatabase();

// Public event info (no sensitive data)
app.get('/api/event', (req, res) => {
  res.json({ name: EVENT_NAME });
});

/**
 * Name autocomplete for check-in (min 4 characters).
 * Matches the start of a first or last name. Returns names only.
 */
app.get('/api/check-in/suggest', (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 4) {
      return res.json({ suggestions: [] });
    }
    const suggestions = suggestGuestsByNamePrefix(q);
    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ suggestions: [] });
  }
});

/**
 * Guest name lookup — does NOT record attendance yet.
 * Outcomes: found | already_checked_in | not_found | validation error
 */
app.post('/api/check-in', (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

    if (!name) {
      return res.status(400).json({
        status: 'error',
        error: 'Please enter your name.'
      });
    }
    if (name.length < 2) {
      return res.status(400).json({
        status: 'error',
        error: 'Please enter your full name.'
      });
    }

    const guest = findGuestByName(name);
    if (!guest) {
      return res.json({
        status: 'not_found',
        message: "We couldn't find your RSVP. Please check that your details are correct or speak to a member of the registration team."
      });
    }

    if (guest.checked_in) {
      return res.json({
        status: 'already_checked_in',
        id: guest.id,
        name: guest.name,
        firstName: firstNameFrom(guest.name),
        checkedInAt: guest.checked_in_at,
        checkedInAtDisplay: formatCheckInTime(guest.checked_in_at),
        message: 'You\'re already checked in.'
      });
    }

    return res.json({
      status: 'found',
      id: guest.id,
      name: guest.name,
      firstName: firstNameFrom(guest.name),
      message: 'Please confirm your attendance.'
    });
  } catch (err) {
    console.error('Check-in lookup error:', err.message);
    res.status(500).json({
      status: 'error',
      error: 'Something went wrong. Please try again or speak to the registration team.'
    });
  }
});

/**
 * Confirm attendance — records check-in after guest verifies on the result page.
 * Requires matching id + name to prevent casual ID guessing.
 */
app.post('/api/check-in/confirm', (req, res) => {
  try {
    const id = parseInt(req.body?.id, 10);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

    if (!id || !name) {
      return res.status(400).json({
        status: 'error',
        error: 'Unable to confirm. Please go back and try again.'
      });
    }

    const guest = findGuestById(id);
    if (!guest || guest.name.trim().toLowerCase() !== name.toLowerCase()) {
      return res.json({
        status: 'not_found',
        message: "We couldn't find your RSVP. Please speak to the registration team."
      });
    }

    if (guest.checked_in) {
      return res.json({
        status: 'already_checked_in',
        firstName: firstNameFrom(guest.name),
        checkedInAt: guest.checked_in_at,
        checkedInAtDisplay: formatCheckInTime(guest.checked_in_at),
        message: 'You\'re already checked in.'
      });
    }

    const result = checkInGuest(guest.id, 'self');
    if (result.alreadyCheckedIn) {
      return res.json({
        status: 'already_checked_in',
        firstName: firstNameFrom(result.guest.name),
        checkedInAt: result.guest.checked_in_at,
        checkedInAtDisplay: formatCheckInTime(result.guest.checked_in_at),
        message: 'You\'re already checked in.'
      });
    }
    if (!result.ok) {
      return res.status(500).json({
        status: 'error',
        error: 'Unable to complete check-in. Please speak to the registration team.'
      });
    }

    return res.json({
      status: 'checked_in',
      firstName: firstNameFrom(result.guest.name),
      checkedInAt: result.guest.checked_in_at,
      checkedInAtDisplay: formatCheckInTime(result.guest.checked_in_at),
      message: 'You\'re checked in!'
    });
  } catch (err) {
    console.error('Check-in confirm error:', err.message);
    res.status(500).json({
      status: 'error',
      error: 'Something went wrong. Please try again or speak to the registration team.'
    });
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
    const expires = Date.now() + 24 * 60 * 60 * 1000;
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

// Admin: list attendees + live stats
app.get('/api/guests', requireAdmin, (req, res) => {
  try {
    const guests = getAllGuests();
    const count = getGuestCount();
    const stats = getAttendanceStats();
    res.json({ guests, count, stats });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  try {
    res.json(getAttendanceStats());
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// Admin: manual check-in (requires password confirm)
app.post('/api/admin/check-in/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Invalid attendee ID.' });
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password. Action not confirmed.' });
    }

    const guest = findGuestById(id);
    if (!guest) return res.status(404).json({ error: 'Attendee not found.' });

    if (guest.checked_in) {
      return res.json({
        status: 'already_checked_in',
        guest,
        checkedInAtDisplay: formatCheckInTime(guest.checked_in_at)
      });
    }

    const result = checkInGuest(id, 'manual');
    if (result.alreadyCheckedIn) {
      return res.json({
        status: 'already_checked_in',
        guest: result.guest,
        checkedInAtDisplay: formatCheckInTime(result.guest.checked_in_at)
      });
    }
    if (!result.ok) {
      return res.status(500).json({ error: 'Failed to check in attendee.' });
    }

    res.json({
      status: 'checked_in',
      guest: result.guest,
      checkedInAtDisplay: formatCheckInTime(result.guest.checked_in_at)
    });
  } catch (err) {
    console.error('Admin check-in error:', err.message);
    res.status(500).json({ error: 'Failed to check in attendee.' });
  }
});

// Admin: check out (requires password confirm)
app.post('/api/admin/check-out/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Invalid attendee ID.' });
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password. Action not confirmed.' });
    }

    const guest = findGuestById(id);
    if (!guest) return res.status(404).json({ error: 'Attendee not found.' });

    if (!guest.checked_in) {
      return res.json({
        status: 'not_checked_in',
        guest
      });
    }

    const ok = setGuestSeated(id, false);
    if (!ok) return res.status(500).json({ error: 'Failed to check out attendee.' });

    res.json({
      status: 'checked_out',
      guest: findGuestById(id)
    });
  } catch (err) {
    console.error('Admin check-out error:', err.message);
    res.status(500).json({ error: 'Failed to check out attendee.' });
  }
});

// Admin: bulk check-in / check-out / delete (requires password)
app.post('/api/admin/bulk', requireAdmin, (req, res) => {
  try {
    const { password, action, ids } = req.body || {};
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password. Action not confirmed.' });
    }
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'Select at least one attendee.' });
    }
    const parsedIds = ids
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!parsedIds.length) {
      return res.status(400).json({ error: 'Select at least one attendee.' });
    }

    if (action === 'checkin') {
      const result = bulkCheckIn(parsedIds);
      return res.json({
        success: true,
        action: 'checkin',
        updated: result.updated,
        message: `Checked in ${result.updated} attendee${result.updated === 1 ? '' : 's'}.`
      });
    }
    if (action === 'checkout') {
      const result = bulkCheckOut(parsedIds);
      return res.json({
        success: true,
        action: 'checkout',
        updated: result.updated,
        message: `Checked out ${result.updated} attendee${result.updated === 1 ? '' : 's'}.`
      });
    }
    if (action === 'delete') {
      const result = bulkDeleteGuests(parsedIds);
      return res.json({
        success: true,
        action: 'delete',
        deleted: result.deleted,
        message: `Deleted ${result.deleted} attendee${result.deleted === 1 ? '' : 's'}.`
      });
    }
    return res.status(400).json({ error: 'Unknown bulk action.' });
  } catch (err) {
    console.error('Bulk action error:', err.message);
    res.status(500).json({ error: 'Bulk action failed.' });
  }
});

// Admin: set / clear attendance (password confirm)
app.patch('/api/guests/:id/seated', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password, seated } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Invalid attendee ID.' });
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password. Action not confirmed.' });
    }
    if (seated) {
      const result = checkInGuest(id, 'manual');
      if (result.ok || result.alreadyCheckedIn) {
        return res.json({ success: true, guest: result.guest });
      }
      return res.status(404).json({ error: 'Attendee not found.' });
    }
    const ok = setGuestSeated(id, false);
    if (ok) res.json({ success: true });
    else res.status(404).json({ error: 'Attendee not found.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update.' });
  }
});

// Admin: update attendee name/email
app.patch('/api/guests/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password, name, email } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Invalid attendee ID.' });
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password. Action not confirmed.' });
    }
    if (email != null && email !== '' && !isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    try {
      const ok = updateGuest(id, { name, email });
      if (ok) res.json({ success: true, guest: findGuestById(id) });
      else res.status(404).json({ error: 'Attendee not found.' });
    } catch (e) {
      if (e.message === 'EMAIL_TAKEN') {
        return res.status(409).json({ error: 'That email is already on the RSVP list.' });
      }
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to update attendee.' });
  }
});

// Admin: delete attendee
app.delete('/api/guests/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Invalid attendee ID.' });
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password. Action not confirmed.' });
    }
    const ok = deleteGuest(id);
    if (ok) res.json({ success: true });
    else res.status(404).json({ error: 'Attendee not found.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete attendee.' });
  }
});

// Admin: add attendee to RSVP list (email optional — check-in is by name)
app.post('/api/guests', requireAdmin, (req, res) => {
  try {
    const { name, email } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    try {
      const guest = addGuest(name, 0, email || null);
      res.status(201).json(guest);
    } catch (e) {
      if (e.message === 'EMAIL_TAKEN') {
        return res.status(409).json({ error: 'That email is already on the RSVP list.' });
      }
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to add attendee.' });
  }
});

/**
 * Parse spreadsheet rows into { name, email? } entries.
 * Looks for Name / Full Name / Guest / Attendee columns; otherwise uses the first column.
 */
function extractGuestsFromSheet(workbook) {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!rows.length) {
    // Fallback: treat as a single-column list with no header
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    return matrix
      .map((r) => ({ name: String(r[0] || '').trim() }))
      .filter((r) => r.name && !/^name$/i.test(r.name));
  }

  const keys = Object.keys(rows[0] || {});
  const findKey = (...candidates) =>
    keys.find((k) => candidates.some((c) => k.trim().toLowerCase() === c));

  const nameKey =
    findKey('name', 'full name', 'fullname name', 'guest', 'attendee', 'full_name') ||
    keys[0];
  const emailKey = findKey('email', 'email address', 'e-mail', 'mail');

  return rows
    .map((row) => ({
      name: String(row[nameKey] || '').trim(),
      email: emailKey ? String(row[emailKey] || '').trim() : ''
    }))
    .filter((r) => r.name);
}

// Admin: import guests from Excel / CSV
app.post('/api/guests/import', requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Please choose an Excel or CSV file.' });
      }

      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const entries = extractGuestsFromSheet(workbook);
      if (!entries.length) {
        return res.status(400).json({
          error: 'No guest names found. Use a column headed “Name”, or put one name per row.'
        });
      }

      const result = importGuests(entries);
      res.json({
        success: true,
        imported: result.imported,
        skipped: result.skipped,
        total: entries.length,
        message: `Imported ${result.imported} guest${result.imported === 1 ? '' : 's'}` +
          (result.skipped ? ` (${result.skipped} skipped — blank or already on the list).` : '.')
      });
    } catch (e) {
      console.error('Import error:', e.message);
      res.status(500).json({ error: 'Could not read that spreadsheet. Please try again.' });
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`${EVENT_NAME} running at http://localhost:${PORT}`);
  console.log(`Guest check-in: http://localhost:${PORT}/`);
  console.log(`Admin:          http://localhost:${PORT}/admin.html`);
});

