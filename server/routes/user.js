/**
 * ============================================================
 * MALACHITE — User Profile API Routes
 * Profile, settings, KYC, audit log
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { getDB, auditLog } = require('./database');
const { authenticateToken } = require('./auth');

router.use(authenticateToken);

/* ==========================================================
   GET PROFILE
   GET /api/user/profile
   ========================================================== */
router.get('/profile', (req, res) => {
    const db = getDB();
    const user = db.prepare(`
    SELECT id, email, full_name, phone, avatar_url, role, two_fa_enabled,
           email_verified, kyc_status, last_login_at, created_at
    FROM users WHERE id = ?
  `).get(req.user.id);

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
});

/* ==========================================================
   UPDATE PROFILE
   PUT /api/user/profile
   ========================================================== */
router.put('/profile', (req, res) => {
    const { fullName, phone } = req.body;
    const db = getDB();

    const updates = [];
    const params = [];

    if (fullName !== undefined) {
        if (fullName.length > 100) return res.status(400).json({ error: 'Name too long (max 100)' });
        updates.push('full_name = ?'); params.push(fullName.trim());
    }
    if (phone !== undefined) {
        if (phone && !/^\+?[\d\s-]{7,15}$/.test(phone)) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }
        updates.push('phone = ?'); params.push(phone.trim());
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    updates.push('updated_at = datetime("now")');
    params.push(req.user.id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    auditLog(req.user.id, 'PROFILE_UPDATE', 'users', req);

    res.json({ message: 'Profile updated' });
});

/* ==========================================================
   CHANGE PASSWORD
   POST /api/user/change-password
   ========================================================== */
router.post('/change-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const bcrypt = require('bcrypt');

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password required' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const db = getDB();
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

    const hashed = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE users SET password = ?, updated_at = datetime("now") WHERE id = ?')
        .run(hashed, req.user.id);

    auditLog(req.user.id, 'PASSWORD_CHANGE', 'users', req);
    res.json({ message: 'Password changed successfully' });
});

/* ==========================================================
   DASHBOARD STATS
   GET /api/user/dashboard
   ========================================================== */
router.get('/dashboard', async (req, res) => {
    const db = getDB();
    const { fetchAllPrices } = require('./prices');

    // Get wallet balances
    const wallets = db.prepare('SELECT currency, balance FROM wallets WHERE user_id = ? AND balance > 0')
        .all(req.user.id);

    const prices = await fetchAllPrices();
    let totalValue = 0;
    wallets.forEach((w) => {
        if (w.currency === 'USDT') totalValue += w.balance;
        else if (prices[w.currency]) totalValue += w.balance * prices[w.currency].price;
    });

    // Recent trades
    const recentTrades = db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? AND type IN ('trade_buy','trade_sell')
    ORDER BY created_at DESC LIMIT 5
  `).all(req.user.id);

    // Open orders
    const openOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND status = "open"')
        .get(req.user.id);

    // Total trades
    const totalTrades = db.prepare(`
    SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND type IN ('trade_buy','trade_sell')
  `).get(req.user.id);

    res.json({
        portfolio: {
            totalValueUSD: totalValue.toFixed(2),
            walletCount: wallets.length,
        },
        openOrders: openOrders.count,
        totalTrades: totalTrades.count,
        recentTrades,
    });
});

/* ==========================================================
   ACTIVITY LOG
   GET /api/user/activity
   ========================================================== */
router.get('/activity', (req, res) => {
    const db = getDB();
    const { limit: lim } = req.query;

    const logs = db.prepare(`
    SELECT action, resource, ip_address, created_at
    FROM audit_log WHERE user_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(req.user.id, parseInt(lim) || 30);

    res.json({ activity: logs });
});

module.exports = router;
