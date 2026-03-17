# Table Finder System

A table finder for dinner ceremony guests with a backend database that stores up to 100 names (and more).

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Seed the database** (adds 100 sample guests across 10 tables)
   ```bash
   npm run seed
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. Open **http://localhost:3000** for the guest finder, or **http://localhost:3000/admin.html** to manage guests (password required).

Set the admin password with the `ADMIN_PASSWORD` environment variable (default: `admin2024`). Example (Windows): `$env:ADMIN_PASSWORD = "your_secret"; npm start`

## Features

- **Guest finder** – Enter a name to see their table assignment
- **Admin panel** – Add and view all guests
- **SQLite database** – Persistent storage in `data/guests.db` for 100+ names
- **Responsive UI** – Works on mobile and desktop

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/find-table` | POST | Find table by guest name (body: `{ "name": "..." }`) |
| `/api/search` | GET | Search guests (query: `?q=...`) |
| `/api/guests` | GET | List all guests |
| `/api/guests` | POST | Add guest (body: `{ "name": "...", "table_number": 1 }`) |
