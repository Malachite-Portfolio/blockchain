/**
 * ============================================================
 * MALACHITE — Authentication Module (Database-backed)
 * JWT, bcrypt, 2FA TOTP, AES-256-GCM, Brute-force Protection
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { getDB, generateId, auditLog } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_TO_A_256_BIT_SECRET';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'CHANGE_THIS_REFRESH_SECRET';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'malachite-32-char-key-changeme!';
const BCRYPT_ROUNDS = 12;

const refreshTokens = new Set(); // Move to DB/Redis in production

/* ==========================================================
   PASSWORD HASHING
   ========================================================== */
async function hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function isStrongPassword(password) {
    const errors = [];
    if (password.length < 8) errors.push('Minimum 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('At least one uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('At least one lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('At least one number');
    if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) errors.push('At least one special character');
    return { valid: errors.length === 0, errors };
}

/* ==========================================================
   JWT TOKENS
   ========================================================== */
function generateAccessToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role || 'user' },
        JWT_SECRET,
        { expiresIn: '15m', issuer: 'malachite', audience: 'malachite-platform' }
    );
}

function generateRefreshToken(user) {
    const token = jwt.sign({ id: user.id, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    refreshTokens.add(token);
    return token;
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });

    try {
        req.user = jwt.verify(token, JWT_SECRET, { issuer: 'malachite', audience: 'malachite-platform' });
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        return res.status(403).json({ error: 'Invalid token' });
    }
}

/* ==========================================================
   ENCRYPTION (AES-256-GCM)
   ========================================================== */
function encryptData(plaintext) {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY, 'utf-8').slice(0, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}

function decryptData(encryptedStr) {
    const [ivHex, authTagHex, encrypted] = encryptedStr.split(':');
    const key = Buffer.from(ENCRYPTION_KEY, 'utf-8').slice(0, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/* ==========================================================
   BRUTE-FORCE PROTECTION
   ========================================================== */
const loginAttempts = new Map();

function checkBruteForce(id) {
    const entry = loginAttempts.get(id) || { count: 0, lockUntil: 0 };
    if (entry.lockUntil > Date.now()) return { allowed: false, remaining: Math.ceil((entry.lockUntil - Date.now()) / 1000) };
    return { allowed: true };
}

function recordFailedLogin(id) {
    const entry = loginAttempts.get(id) || { count: 0, lockUntil: 0 };
    entry.count++;
    const locks = [0, 0, 0, 60000, 60000, 300000, 900000, 3600000];
    const lockMs = locks[Math.min(entry.count, locks.length - 1)];
    if (lockMs > 0) entry.lockUntil = Date.now() + lockMs;
    loginAttempts.set(id, entry);
}

/* ==========================================================
   ROUTES
   ========================================================== */

// ─── REGISTER ───
router.post('/register', async (req, res) => {
    try {
        const { email, password, fullName } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const strength = isStrongPassword(password);
        if (!strength.valid) return res.status(400).json({ error: 'Weak password', details: strength.errors });

        const db = getDB();
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
        if (existing) {
            await bcrypt.hash('dummy', BCRYPT_ROUNDS); // Timing-safe
            return res.status(400).json({ error: 'Registration failed' });
        }

        const hashedPassword = await hashPassword(password);
        const twoFASecret = speakeasy.generateSecret({ name: `Malachite (${email})`, issuer: 'Malachite', length: 32 });
        const userId = generateId();

        db.prepare(`
      INSERT INTO users (id, email, password, full_name, two_fa_secret)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, email.toLowerCase(), hashedPassword, fullName || null, encryptData(twoFASecret.base32));

        // Create default USDT wallet with demo balance
        db.prepare('INSERT INTO wallets (id, user_id, currency, balance, address) VALUES (?, ?, "USDT", 10000, ?)')
            .run(generateId(), userId, '0x' + crypto.randomBytes(20).toString('hex'));

        const qrDataUrl = await QRCode.toDataURL(twoFASecret.otpauth_url);
        auditLog(userId, 'REGISTER', 'users', req);

        res.status(201).json({
            message: 'Registration successful',
            userId,
            demoBalance: '10,000 USDT (for testing)',
            twoFA: { qrCode: qrDataUrl, manualKey: twoFASecret.base32, message: 'Scan with Google Authenticator' },
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ─── LOGIN ───
router.post('/login', async (req, res) => {
    try {
        const { email, password, twoFACode } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const brute = checkBruteForce(email.toLowerCase());
        if (!brute.allowed) return res.status(429).json({ error: `Account locked. Try in ${brute.remaining}s` });

        const db = getDB();
        const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase());

        if (!user) {
            await bcrypt.hash('dummy', BCRYPT_ROUNDS);
            recordFailedLogin(email.toLowerCase());
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!(await bcrypt.compare(password, user.password))) {
            recordFailedLogin(email.toLowerCase());
            auditLog(user.id, 'LOGIN_FAILED', 'auth', req);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // 2FA check
        if (user.two_fa_enabled) {
            if (!twoFACode) return res.status(200).json({ requires2FA: true });
            const secret = decryptData(user.two_fa_secret);
            if (!speakeasy.totp.verify({ secret, encoding: 'base32', token: twoFACode, window: 1 })) {
                recordFailedLogin(email.toLowerCase());
                return res.status(401).json({ error: 'Invalid 2FA code' });
            }
        }

        // Success
        loginAttempts.delete(email.toLowerCase());
        db.prepare('UPDATE users SET last_login_at = datetime("now"), last_login_ip = ? WHERE id = ?')
            .run(req.ip || req.connection?.remoteAddress, user.id);

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true, secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict', maxAge: 7 * 24 * 3600000, path: '/api/auth/refresh',
        });

        auditLog(user.id, 'LOGIN_SUCCESS', 'auth', req);

        res.json({
            message: 'Login successful',
            accessToken,
            expiresIn: '15m',
            user: { id: user.id, email: user.email, name: user.full_name, role: user.role },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ─── REFRESH TOKEN ───
router.post('/refresh', (req, res) => {
    const token = req.cookies?.refreshToken;
    if (!token || !refreshTokens.has(token)) return res.status(401).json({ error: 'Invalid refresh token' });

    try {
        const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
        const db = getDB();
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
        if (!user) return res.status(401).json({ error: 'User not found' });

        refreshTokens.delete(token);
        const newAccess = generateAccessToken(user);
        const newRefresh = generateRefreshToken(user);

        res.cookie('refreshToken', newRefresh, {
            httpOnly: true, secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict', maxAge: 7 * 24 * 3600000, path: '/api/auth/refresh',
        });

        res.json({ accessToken: newAccess, expiresIn: '15m' });
    } catch { return res.status(401).json({ error: 'Invalid refresh token' }); }
});

// ─── ENABLE 2FA ───
router.post('/enable-2fa', authenticateToken, (req, res) => {
    const { twoFACode } = req.body;
    const db = getDB();
    const user = db.prepare('SELECT two_fa_secret FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const secret = decryptData(user.two_fa_secret);
    if (!speakeasy.totp.verify({ secret, encoding: 'base32', token: twoFACode, window: 1 })) {
        return res.status(400).json({ error: 'Invalid 2FA code' });
    }

    db.prepare('UPDATE users SET two_fa_enabled = 1 WHERE id = ?').run(req.user.id);
    auditLog(req.user.id, '2FA_ENABLED', 'users', req);
    res.json({ message: '2FA enabled successfully' });
});

// ─── LOGOUT ───
router.post('/logout', (req, res) => {
    const token = req.cookies?.refreshToken;
    if (token) refreshTokens.delete(token);
    res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    res.json({ message: 'Logged out' });
});

module.exports = router;
module.exports.authenticateToken = authenticateToken;
module.exports.encryptData = encryptData;
module.exports.decryptData = decryptData;
