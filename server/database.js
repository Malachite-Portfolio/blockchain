/**
 * ============================================================
 * MALACHITE — Database Layer (SQLite)
 * Zero-config, file-based, production-ready
 * ============================================================
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'malachite.db');

let db;

function getDB() {
    if (!db) {
        // Ensure data directory exists
        const fs = require('fs');
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');     // Better concurrent performance
        db.pragma('foreign_keys = ON');      // Enforce FK constraints
        db.pragma('busy_timeout = 5000');    // Wait 5s on lock
        initTables();
    }
    return db;
}

function initTables() {
    db.exec(`
    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT,
      phone TEXT,
      avatar_url TEXT,
      role TEXT DEFAULT 'user' CHECK(role IN ('user','admin','moderator')),
      two_fa_secret TEXT,
      two_fa_enabled INTEGER DEFAULT 0,
      email_verified INTEGER DEFAULT 0,
      kyc_status TEXT DEFAULT 'pending' CHECK(kyc_status IN ('pending','submitted','verified','rejected')),
      is_active INTEGER DEFAULT 1,
      last_login_at TEXT,
      last_login_ip TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Wallets
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      balance REAL DEFAULT 0,
      locked_balance REAL DEFAULT 0,
      address TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, currency)
    );

    -- Transactions
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('deposit','withdraw','trade_buy','trade_sell','transfer','fee')),
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed','cancelled')),
      tx_hash TEXT,
      from_address TEXT,
      to_address TEXT,
      description TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Trade Orders
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pair TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('buy','sell')),
      type TEXT DEFAULT 'market' CHECK(type IN ('market','limit','stop_loss','take_profit')),
      amount REAL NOT NULL,
      price REAL,
      filled_amount REAL DEFAULT 0,
      filled_price REAL DEFAULT 0,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','partial','filled','cancelled','expired')),
      stop_price REAL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Watchlist / Favorites
    CREATE TABLE IF NOT EXISTS watchlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      coin_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, coin_id)
    );

    -- Price Alerts
    CREATE TABLE IF NOT EXISTS price_alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      condition TEXT NOT NULL CHECK(condition IN ('above','below')),
      target_price REAL NOT NULL,
      is_triggered INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Audit Log (security)
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      resource TEXT,
      ip_address TEXT,
      user_agent TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Sessions for server-side session store
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_pair ON orders(pair);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id);
  `);

    console.log('📦 Database tables initialized');
}

/* ==========================================================
   HELPER FUNCTIONS
   ========================================================== */

function generateId() {
    return crypto.randomUUID();
}

function auditLog(userId, action, resource, req, details) {
    const stmt = getDB().prepare(`
    INSERT INTO audit_log (user_id, action, resource, ip_address, user_agent, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    stmt.run(
        userId,
        action,
        resource,
        req ? (req.ip || req.connection?.remoteAddress) : null,
        req ? req.get('User-Agent') : null,
        typeof details === 'object' ? JSON.stringify(details) : details
    );
}

module.exports = { getDB, generateId, auditLog };
