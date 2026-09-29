const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'guests.db');

function getDb() {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

function initDatabase() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      table_number INTEGER DEFAULT 0,
      seated INTEGER DEFAULT 0,
      email TEXT,
      checked_in_at DATETIME,
      check_in_method TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_guests_name ON guests(name);
  `);

  const columns = db.prepare('PRAGMA table_info(guests)').all().map((c) => c.name);
  const addColumn = (name, ddl) => {
    if (!columns.includes(name)) {
      try {
        db.exec(`ALTER TABLE guests ADD COLUMN ${ddl}`);
      } catch (_) { /* race / already exists */ }
    }
  };

  addColumn('seated', 'seated INTEGER DEFAULT 0');
  addColumn('email', 'email TEXT');
  addColumn('checked_in_at', 'checked_in_at DATETIME');
  addColumn('check_in_method', 'check_in_method TEXT');

  // Unique email (case-insensitive) — only for rows that have an email
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_email_unique
    ON guests (LOWER(TRIM(email)))
    WHERE email IS NOT NULL AND TRIM(email) != '';
  `);

  db.close();
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function firstNameFrom(name) {
  const parts = (name || '').trim().split(/\s+/);
  return parts[0] || 'Guest';
}

function mapGuest(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email || null,
    table_number: row.table_number,
    checked_in: !!row.seated,
    seated: !!row.seated,
    checked_in_at: row.checked_in_at || null,
    check_in_method: row.check_in_method || null,
    created_at: row.created_at || null
  };
}

function findGuestByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, name, email, table_number,
           COALESCE(seated, 0) AS seated,
           checked_in_at, check_in_method, created_at
    FROM guests
    WHERE email IS NOT NULL
      AND LOWER(TRIM(email)) = ?
  `);
  const guest = stmt.get(normalized);
  db.close();
  return mapGuest(guest);
}

function findGuestByName(name) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, name, email, table_number,
           COALESCE(seated, 0) AS seated,
           checked_in_at, check_in_method, created_at
    FROM guests
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
  `);
  const guest = stmt.get(name?.trim() || '');
  db.close();
  return mapGuest(guest);
}

function findGuestById(id) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, name, email, table_number,
           COALESCE(seated, 0) AS seated,
           checked_in_at, check_in_method, created_at
    FROM guests
    WHERE id = ?
  `);
  const guest = stmt.get(id);
  db.close();
  return mapGuest(guest);
}

/**
 * Atomically check in an attendee.
 * Returns { ok, alreadyCheckedIn, guest } — uniqueness enforced by
 * UPDATE ... WHERE seated = 0 (no duplicate attendance).
 */
function checkInGuest(id, method) {
  const db = getDb();
  const now = new Date().toISOString();
  const checkInMethod = method === 'manual' ? 'manual' : 'self';

  const update = db.prepare(`
    UPDATE guests
    SET seated = 1,
        checked_in_at = ?,
        check_in_method = ?
    WHERE id = ? AND COALESCE(seated, 0) = 0
  `);
  const result = update.run(now, checkInMethod, id);

  const select = db.prepare(`
    SELECT id, name, email, table_number,
           COALESCE(seated, 0) AS seated,
           checked_in_at, check_in_method, created_at
    FROM guests
    WHERE id = ?
  `);
  const row = select.get(id);
  db.close();

  if (!row) {
    return { ok: false, alreadyCheckedIn: false, guest: null };
  }

  const guest = mapGuest(row);
  if (result.changes > 0) {
    return { ok: true, alreadyCheckedIn: false, guest };
  }
  if (guest.checked_in) {
    return { ok: false, alreadyCheckedIn: true, guest };
  }
  return { ok: false, alreadyCheckedIn: false, guest };
}

function markGuestSeated(id) {
  return checkInGuest(id, 'self').ok;
}

function setGuestSeated(id, seated) {
  const db = getDb();
  if (seated) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE guests
      SET seated = 1,
          checked_in_at = COALESCE(checked_in_at, ?),
          check_in_method = COALESCE(check_in_method, 'manual')
      WHERE id = ?
    `);
    const result = stmt.run(now, id);
    db.close();
    return result.changes > 0;
  }
  const stmt = db.prepare(`
    UPDATE guests
    SET seated = 0,
        checked_in_at = NULL,
        check_in_method = NULL
    WHERE id = ?
  `);
  const result = stmt.run(id);
  db.close();
  return result.changes > 0;
}

function updateGuestTable(id, tableNumber) {
  const db = getDb();
  const stmt = db.prepare('UPDATE guests SET table_number = ? WHERE id = ?');
  const result = stmt.run(parseInt(tableNumber, 10) || 0, id);
  db.close();
  return result.changes > 0;
}

function updateGuest(id, { name, email } = {}) {
  const db = getDb();
  const current = db.prepare('SELECT id, name, email FROM guests WHERE id = ?').get(id);
  if (!current) {
    db.close();
    return false;
  }
  const newName = name != null ? String(name).trim() : current.name;
  const newEmail = email != null ? normalizeEmail(email) : current.email;
  if (!newName) {
    db.close();
    return false;
  }
  try {
    const stmt = db.prepare('UPDATE guests SET name = ?, email = ? WHERE id = ?');
    const result = stmt.run(newName, newEmail || null, id);
    db.close();
    return result.changes > 0;
  } catch (err) {
    db.close();
    if (err && String(err.message).includes('UNIQUE')) {
      const conflict = new Error('EMAIL_TAKEN');
      throw conflict;
    }
    throw err;
  }
}

function deleteGuest(id) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM guests WHERE id = ?');
  const result = stmt.run(id);
  db.close();
  return result.changes > 0;
}

function bulkCheckIn(ids) {
  const db = getDb();
  const now = new Date().toISOString();
  const update = db.prepare(`
    UPDATE guests
    SET seated = 1,
        checked_in_at = ?,
        check_in_method = 'manual'
    WHERE id = ? AND COALESCE(seated, 0) = 0
  `);
  let updated = 0;
  const run = db.transaction((list) => {
    for (const id of list) {
      const result = update.run(now, id);
      if (result.changes > 0) updated++;
    }
  });
  run(ids || []);
  db.close();
  return { updated };
}

function bulkCheckOut(ids) {
  const db = getDb();
  const update = db.prepare(`
    UPDATE guests
    SET seated = 0,
        checked_in_at = NULL,
        check_in_method = NULL
    WHERE id = ? AND COALESCE(seated, 0) = 1
  `);
  let updated = 0;
  const run = db.transaction((list) => {
    for (const id of list) {
      const result = update.run(id);
      if (result.changes > 0) updated++;
    }
  });
  run(ids || []);
  db.close();
  return { updated };
}

function bulkDeleteGuests(ids) {
  const db = getDb();
  const del = db.prepare('DELETE FROM guests WHERE id = ?');
  let deleted = 0;
  const run = db.transaction((list) => {
    for (const id of list) {
      const result = del.run(id);
      if (result.changes > 0) deleted++;
    }
  });
  run(ids || []);
  db.close();
  return { deleted };
}

function searchGuests(query) {
  const db = getDb();
  const trimmed = (query || '').trim();
  if (!trimmed) return [];
  const stmt = db.prepare(`
    SELECT id, name, email, table_number,
           COALESCE(seated, 0) AS seated,
           checked_in_at, check_in_method, created_at
    FROM guests
    WHERE LOWER(name) LIKE LOWER(?)
       OR (email IS NOT NULL AND LOWER(email) LIKE LOWER(?))
    ORDER BY name
    LIMIT 10
  `);
  const pattern = `%${trimmed}%`;
  const guests = stmt.all(pattern, pattern).map(mapGuest);
  db.close();
  return guests;
}

/**
 * Public check-in suggestions: match first or last name prefix.
 * Requires at least 4 characters. Returns names only (limited).
 */
function suggestGuestsByNamePrefix(query) {
  const trimmed = (query || '').trim();
  if (trimmed.length < 4) return [];

  const db = getDb();
  const prefix = trimmed.toLowerCase();
  const stmt = db.prepare(`
    SELECT DISTINCT name
    FROM guests
    WHERE LOWER(TRIM(name)) LIKE ? || '%'
       OR LOWER(name) LIKE '% ' || ? || '%'
    ORDER BY name
    LIMIT 8
  `);
  const rows = stmt.all(prefix, prefix);
  db.close();
  return rows.map((r) => ({ name: r.name }));
}

function addGuest(name, tableNumber, email) {
  const db = getDb();
  const normalizedEmail = normalizeEmail(email);
  try {
    const stmt = db.prepare(
      'INSERT INTO guests (name, table_number, email) VALUES (?, ?, ?)'
    );
    const result = stmt.run(
      name?.trim(),
      parseInt(tableNumber, 10) || 0,
      normalizedEmail || null
    );
    db.close();
    return {
      id: result.lastInsertRowid,
      name: name?.trim(),
      table_number: parseInt(tableNumber, 10) || 0,
      email: normalizedEmail || null,
      checked_in: false
    };
  } catch (err) {
    db.close();
    if (err && String(err.message).includes('UNIQUE')) {
      const conflict = new Error('EMAIL_TAKEN');
      throw conflict;
    }
    throw err;
  }
}

/**
 * Bulk-import attendees by name (and optional email).
 * Skips blank rows and names that already exist (case-insensitive).
 */
function importGuests(entries) {
  const db = getDb();
  const findExisting = db.prepare(
    'SELECT id FROM guests WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))'
  );
  const insert = db.prepare(
    'INSERT INTO guests (name, table_number, email) VALUES (?, 0, ?)'
  );

  let imported = 0;
  let skipped = 0;
  const errors = [];

  const run = db.transaction((rows) => {
    for (const row of rows) {
      const name = (row.name || '').trim();
      if (!name) {
        skipped++;
        continue;
      }
      if (findExisting.get(name)) {
        skipped++;
        continue;
      }
      const email = normalizeEmail(row.email) || null;
      try {
        insert.run(name, email);
        imported++;
      } catch (err) {
        if (err && String(err.message).includes('UNIQUE')) {
          skipped++;
        } else {
          errors.push(name);
        }
      }
    }
  });

  run(entries || []);
  db.close();
  return { imported, skipped, errors };
}

function getAllGuests() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, name, email, table_number,
           COALESCE(seated, 0) AS seated,
           checked_in_at, check_in_method, created_at
    FROM guests
    ORDER BY name
  `);
  const guests = stmt.all().map(mapGuest);
  db.close();
  return guests;
}

function getGuestCount() {
  const db = getDb();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM guests');
  const { count } = stmt.get();
  db.close();
  return count;
}

function getAttendanceStats() {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS rsvp,
      SUM(CASE WHEN COALESCE(seated, 0) = 1 THEN 1 ELSE 0 END) AS checked_in
    FROM guests
  `).get();
  db.close();
  const rsvp = row.rsvp || 0;
  const checkedIn = row.checked_in || 0;
  const remaining = Math.max(0, rsvp - checkedIn);
  const attendance = rsvp > 0 ? Math.round((checkedIn / rsvp) * 1000) / 10 : 0;
  return { rsvp, checkedIn, remaining, attendance };
}

module.exports = {
  getDb,
  initDatabase,
  normalizeEmail,
  firstNameFrom,
  findGuestByEmail,
  findGuestByName,
  findGuestById,
  checkInGuest,
  searchGuests,
  suggestGuestsByNamePrefix,
  addGuest,
  importGuests,
  getAllGuests,
  getGuestCount,
  getAttendanceStats,
  markGuestSeated,
  setGuestSeated,
  updateGuestTable,
  updateGuest,
  deleteGuest,
  bulkCheckIn,
  bulkCheckOut,
  bulkDeleteGuests
};
