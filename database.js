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
      table_number INTEGER NOT NULL,
      seated INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_guests_name ON guests(name);
    CREATE INDEX IF NOT EXISTS idx_guests_table ON guests(table_number);
  `);
  try {
    db.exec('ALTER TABLE guests ADD COLUMN seated INTEGER DEFAULT 0');
  } catch (_) { /* column exists */ }
  db.close();
}

function findGuestByName(name) {
  const db = getDb();
  const stmt = db.prepare(
    'SELECT id, name, table_number, COALESCE(seated, 0) AS seated FROM guests WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))'
  );
  const guest = stmt.get(name?.trim() || '');
  db.close();
  return guest;
}

function markGuestSeated(id) {
  const db = getDb();
  const stmt = db.prepare('UPDATE guests SET seated = 1 WHERE id = ?');
  const result = stmt.run(id);
  db.close();
  return result.changes > 0;
}

function setGuestSeated(id, seated) {
  const db = getDb();
  const stmt = db.prepare('UPDATE guests SET seated = ? WHERE id = ?');
  const result = stmt.run(seated ? 1 : 0, id);
  db.close();
  return result.changes > 0;
}

function updateGuestTable(id, tableNumber) {
  const db = getDb();
  const stmt = db.prepare('UPDATE guests SET table_number = ? WHERE id = ?');
  const result = stmt.run(parseInt(tableNumber, 10) || 1, id);
  db.close();
  return result.changes > 0;
}

function deleteGuest(id) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM guests WHERE id = ?');
  const result = stmt.run(id);
  db.close();
  return result.changes > 0;
}

function searchGuests(query) {
  const db = getDb();
  const trimmed = (query || '').trim();
  if (!trimmed) return [];
  const stmt = db.prepare(
    'SELECT name, table_number FROM guests WHERE LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT 10'
  );
  const guests = stmt.all(`%${trimmed}%`);
  db.close();
  return guests;
}

function addGuest(name, tableNumber) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO guests (name, table_number) VALUES (?, ?)');
  const result = stmt.run(name?.trim(), parseInt(tableNumber, 10) || 1);
  db.close();
  return { id: result.lastInsertRowid, name: name?.trim(), table_number: parseInt(tableNumber, 10) };
}

function getAllGuests() {
  const db = getDb();
  const stmt = db.prepare('SELECT id, name, table_number, COALESCE(seated, 0) AS seated FROM guests ORDER BY table_number, name');
  const guests = stmt.all();
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

module.exports = {
  getDb,
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
};
