import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS appointments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref             TEXT NOT NULL UNIQUE,
  patient_name    TEXT NOT NULL,
  phone           TEXT NOT NULL,
  notes           TEXT,
  service_id      TEXT NOT NULL,
  doctor_id       TEXT NOT NULL,
  date            TEXT NOT NULL,          -- YYYY-MM-DD (clinic local)
  time            TEXT NOT NULL,          -- HH:MM (clinic local)
  duration_min    INTEGER NOT NULL,
  status          TEXT NOT NULL,          -- pending_payment | confirmed | completed | cancelled | no_show | expired | payment_conflict
  deposit_amount  REAL NOT NULL,
  currency        TEXT NOT NULL,
  payment_provider TEXT,
  payment_id      TEXT,
  paid_at         INTEGER,
  hold_expires_at INTEGER,
  reminder_sent   INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appt_doctor_date ON appointments (doctor_id, date);
CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments (status);
CREATE INDEX IF NOT EXISTS idx_appt_phone ON appointments (phone);

CREATE TABLE IF NOT EXISTS otps (
  phone         TEXT PRIMARY KEY,
  code_hash     TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  sent_count    INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL,
  last_sent_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sms_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  body        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  status      TEXT NOT NULL,
  error       TEXT,
  created_at  INTEGER NOT NULL
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// Run fn inside a transaction. node:sqlite is synchronous, so this is atomic within the process.
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
