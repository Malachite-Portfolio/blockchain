/**
 * ============================================================
 * MALACHITE — Market Data API Routes
 * Live prices, charts, search, trending, watchlist
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { fetchAllPrices, fetchMarketData, fetchPriceHistory, SYMBOL_TO_ID } = require('./prices');
const { getDB, generateId } = require('./database');
const { authenticateToken } = require('./auth');

/* ==========================================================
   LIVE PRICES (Public)
   GET /api/market/prices
   ========================================================== */
router.get('/prices', async (req, res) => {
    const prices = await fetchAllPrices();
    res.json({ prices, updatedAt: new Date().toISOString() });
});

/* ==========================================================
   SINGLE COIN DETAIL (Public)
   GET /api/market/coin/:symbol
   ========================================================== */
router.get('/coin/:symbol', async (req, res) => {
    const data = await fetchMarketData(req.params.symbol);
    if (!data) return res.status(404).json({ error: 'Coin not found' });
    res.json(data);
});

/* ==========================================================
   PRICE CHART DATA (Public)
   GET /api/market/chart/:symbol?days=7
   ========================================================== */
router.get('/chart/:symbol', async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 7, 365);
    const data = await fetchPriceHistory(req.params.symbol, days);
    if (!data) return res.status(404).json({ error: 'Chart data unavailable' });
    res.json(data);
});

/* ==========================================================
   SUPPORTED COINS (Public)
   GET /api/market/coins
   ========================================================== */
router.get('/coins', (req, res) => {
    const coins = Object.entries(SYMBOL_TO_ID).map(([symbol, id]) => ({ symbol, id }));
    res.json({ coins });
});

/* ==========================================================
   WATCHLIST (Authenticated)
   ========================================================== */
router.get('/watchlist', authenticateToken, (req, res) => {
    const db = getDB();
    const items = db.prepare('SELECT * FROM watchlist WHERE user_id = ? ORDER BY added_at DESC')
        .all(req.user.id);
    res.json({ watchlist: items });
});

router.post('/watchlist', authenticateToken, (req, res) => {
    const { symbol } = req.body;
    if (!symbol || !SYMBOL_TO_ID[symbol.toUpperCase()]) {
        return res.status(400).json({ error: 'Invalid symbol' });
    }

    const db = getDB();
    try {
        db.prepare('INSERT INTO watchlist (id, user_id, coin_id, symbol) VALUES (?, ?, ?, ?)')
            .run(generateId(), req.user.id, SYMBOL_TO_ID[symbol.toUpperCase()], symbol.toUpperCase());
        res.status(201).json({ message: `${symbol.toUpperCase()} added to watchlist` });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Already in watchlist' });
        }
        throw err;
    }
});

router.delete('/watchlist/:symbol', authenticateToken, (req, res) => {
    const db = getDB();
    db.prepare('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?')
        .run(req.user.id, req.params.symbol.toUpperCase());
    res.json({ message: 'Removed from watchlist' });
});

/* ==========================================================
   PRICE ALERTS (Authenticated)
   ========================================================== */
router.get('/alerts', authenticateToken, (req, res) => {
    const db = getDB();
    const alerts = db.prepare('SELECT * FROM price_alerts WHERE user_id = ? AND is_triggered = 0 ORDER BY created_at DESC')
        .all(req.user.id);
    res.json({ alerts });
});

router.post('/alerts', authenticateToken, (req, res) => {
    const { symbol, condition, targetPrice } = req.body;

    if (!symbol || !condition || !targetPrice) {
        return res.status(400).json({ error: 'symbol, condition, and targetPrice required' });
    }
    if (!['above', 'below'].includes(condition)) {
        return res.status(400).json({ error: 'condition must be "above" or "below"' });
    }

    const db = getDB();
    const id = generateId();
    db.prepare('INSERT INTO price_alerts (id, user_id, symbol, condition, target_price) VALUES (?, ?, ?, ?, ?)')
        .run(id, req.user.id, symbol.toUpperCase(), condition, targetPrice);

    res.status(201).json({ message: 'Price alert created', alertId: id });
});

router.delete('/alerts/:id', authenticateToken, (req, res) => {
    const db = getDB();
    db.prepare('DELETE FROM price_alerts WHERE id = ? AND user_id = ?')
        .run(req.params.id, req.user.id);
    res.json({ message: 'Alert deleted' });
});

module.exports = router;
