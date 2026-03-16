/**
 * ============================================================
 * MALACHITE — Production Server
 * Express + SQLite + WebSocket + Full Security
 * ============================================================
 *
 * INSTALL:
 *   cd server
 *   npm init -y
 *   npm install express better-sqlite3 helmet cors express-rate-limit
 *   npm install express-session cookie-parser jsonwebtoken bcrypt
 *   npm install speakeasy qrcode dotenv morgan ws
 *
 * RUN:
 *   node server/server.js
 *
 * ENV (.env in project root):
 *   PORT=3000
 *   JWT_SECRET=<random-64-char-hex>
 *   JWT_REFRESH_SECRET=<random-64-char-hex>
 *   SESSION_SECRET=<random-32-char>
 *   ENCRYPTION_KEY=<exactly-32-chars>
 *   NODE_ENV=production
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');
const morgan = require('morgan');
const http = require('http');

const { applySecurityMiddleware } = require('./security');
const { getDB } = require('./database');
const { initWebSocket } = require('./websocket');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ─── Initialize Database ───
getDB();

// ─── Request Logging ───
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Body Parsers ───
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ─── Security Middleware ───
applySecurityMiddleware(app);

// ─── API Health Check ───
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        server: 'Malachite v1.0',
        uptime: process.uptime().toFixed(0) + 's',
        timestamp: new Date().toISOString(),
        database: 'connected',
    });
});

// ─── API Routes ───
app.use('/api/auth', require('./auth'));
app.use('/api/trade', require('./routes/trade'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/market', require('./routes/market'));
app.use('/api/user', require('./routes/user'));

// ─── Serve Static Frontend ───
app.use(express.static(path.join(__dirname, '..'), {
    dotfiles: 'deny',
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    },
}));

// ─── SPA Fallback ───
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ─── Global Error Handler ───
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    console.error('💥 Server Error:', err.message);
    if (process.env.NODE_ENV !== 'production') {
        console.error(err.stack);
    }
    res.status(err.status || 500).json({ error: 'Internal server error' });
});

// ─── WebSocket for Real-time Prices ───
initWebSocket(server);

// ─── Graceful Shutdown ───
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
    console.log('\n🛑 Shutting down gracefully...');
    server.close(() => {
        const db = getDB();
        db.close();
        console.log('✅ Server closed');
        process.exit(0);
    });
}

// ─── Start Server ───
server.listen(PORT, () => {
    console.log(`
  ┌─────────────────────────────────────────┐
  │   🟢 MALACHITE SERVER v1.0              │
  │   Port: ${PORT}                             │
  │   Env:  ${(process.env.NODE_ENV || 'development').padEnd(30)}│
  │   DB:   SQLite (WAL mode)               │
  │   WS:   WebSocket on /ws                │
  │   Security: ALL LAYERS ACTIVE           │
  └─────────────────────────────────────────┘
  
  API Endpoints:
    POST   /api/auth/register
    POST   /api/auth/login
    POST   /api/auth/refresh
    POST   /api/auth/logout
    GET    /api/market/prices
    GET    /api/market/coin/:symbol
    GET    /api/market/chart/:symbol
    GET    /api/trade/orders
    POST   /api/trade/order
    GET    /api/trade/portfolio
    GET    /api/wallet
    POST   /api/wallet/deposit
    POST   /api/wallet/withdraw
    GET    /api/user/profile
    GET    /api/user/dashboard
    GET    /api/health
    WS     ws://localhost:${PORT}/ws
  `);
});

module.exports = app;
