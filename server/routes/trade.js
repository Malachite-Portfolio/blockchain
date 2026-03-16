/**
 * ============================================================
 * MALACHITE — Trading API Routes
 * Buy/Sell orders, order book, trade history, portfolio
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { getDB, generateId, auditLog } = require('./database');
const { authenticateToken } = require('./auth');
const { fetchPrice } = require('./prices');

// All trade routes require authentication
router.use(authenticateToken);

/* ==========================================================
   PLACE ORDER (Buy / Sell)
   POST /api/trade/order
   ========================================================== */
router.post('/order', async (req, res) => {
    try {
        const { pair, side, type, amount, price: limitPrice } = req.body;
        const userId = req.user.id;

        // ─── Validation ───
        if (!pair || !side || !amount) {
            return res.status(400).json({ error: 'pair, side, and amount are required' });
        }
        if (!['buy', 'sell'].includes(side)) {
            return res.status(400).json({ error: 'side must be "buy" or "sell"' });
        }
        if (!['market', 'limit', 'stop_loss'].includes(type || 'market')) {
            return res.status(400).json({ error: 'Invalid order type' });
        }
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Amount must be positive number' });
        }
        if (type === 'limit' && (!limitPrice || limitPrice <= 0)) {
            return res.status(400).json({ error: 'Limit price required for limit orders' });
        }

        const db = getDB();
        const [baseCurrency, quoteCurrency] = pair.split('/');

        // Get current market price
        const currentPrice = await fetchPrice(baseCurrency);
        if (!currentPrice) {
            return res.status(503).json({ error: 'Unable to fetch market price. Try again.' });
        }

        const executionPrice = type === 'limit' ? limitPrice : currentPrice;
        const totalCost = amount * executionPrice;
        const fee = totalCost * 0.001; // 0.1% trading fee

        // ─── Check balance ───
        const walletCurrency = side === 'buy' ? quoteCurrency : baseCurrency;
        const requiredAmount = side === 'buy' ? totalCost + fee : amount;

        const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND currency = ?')
            .get(userId, walletCurrency);

        if (!wallet || wallet.balance < requiredAmount) {
            return res.status(400).json({
                error: 'Insufficient balance',
                required: requiredAmount.toFixed(8),
                available: wallet ? wallet.balance.toFixed(8) : '0',
                currency: walletCurrency,
            });
        }

        // ─── Execute order ───
        const orderId = generateId();
        const orderType = type || 'market';
        const isMarket = orderType === 'market';

        const txn = db.transaction(() => {
            // Create order
            db.prepare(`
        INSERT INTO orders (id, user_id, pair, side, type, amount, price, filled_amount, filled_price, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
                orderId, userId, pair, side, orderType, amount,
                executionPrice, isMarket ? amount : 0,
                isMarket ? executionPrice : 0,
                isMarket ? 'filled' : 'open'
            );

            if (isMarket) {
                // Deduct from source wallet
                db.prepare('UPDATE wallets SET balance = balance - ?, updated_at = datetime("now") WHERE user_id = ? AND currency = ?')
                    .run(requiredAmount, userId, walletCurrency);

                // Add to destination wallet
                const destCurrency = side === 'buy' ? baseCurrency : quoteCurrency;
                const destAmount = side === 'buy' ? amount : totalCost - fee;

                // Create destination wallet if not exists
                db.prepare(`
          INSERT INTO wallets (id, user_id, currency, balance)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, currency) DO UPDATE SET balance = balance + ?, updated_at = datetime('now')
        `).run(generateId(), userId, destCurrency, destAmount, destAmount);

                // Record transactions
                db.prepare(`
          INSERT INTO transactions (id, user_id, type, currency, amount, fee, status, description)
          VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
        `).run(
                    generateId(), userId, side === 'buy' ? 'trade_buy' : 'trade_sell',
                    baseCurrency, amount, fee,
                    `${side.toUpperCase()} ${amount} ${baseCurrency} @ $${executionPrice.toFixed(2)}`
                );

                // Fee transaction
                db.prepare(`
          INSERT INTO transactions (id, user_id, type, currency, amount, fee, status, description)
          VALUES (?, ?, 'fee', ?, ?, 0, 'completed', ?)
        `).run(generateId(), userId, quoteCurrency, fee, `Trading fee for order ${orderId}`);
            }
        });

        txn();

        auditLog(userId, 'TRADE_ORDER', pair, req, {
            orderId, side, type: orderType, amount, price: executionPrice, fee,
        });

        res.status(201).json({
            message: `Order ${isMarket ? 'executed' : 'placed'} successfully`,
            order: {
                id: orderId,
                pair,
                side,
                type: orderType,
                amount,
                price: executionPrice,
                fee: fee.toFixed(8),
                total: totalCost.toFixed(2),
                status: isMarket ? 'filled' : 'open',
            },
        });

    } catch (err) {
        console.error('Trade error:', err);
        res.status(500).json({ error: 'Order execution failed' });
    }
});

/* ==========================================================
   GET MY ORDERS
   GET /api/trade/orders?status=open&pair=BTC/USDT
   ========================================================== */
router.get('/orders', (req, res) => {
    const db = getDB();
    const { status, pair, limit: lim } = req.query;

    let query = 'SELECT * FROM orders WHERE user_id = ?';
    const params = [req.user.id];

    if (status) { query += ' AND status = ?'; params.push(status); }
    if (pair) { query += ' AND pair = ?'; params.push(pair); }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(lim) || 50);

    const orders = db.prepare(query).all(...params);
    res.json({ orders, total: orders.length });
});

/* ==========================================================
   CANCEL ORDER
   DELETE /api/trade/orders/:id
   ========================================================== */
router.delete('/orders/:id', (req, res) => {
    const db = getDB();
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
        .get(req.params.id, req.user.id);

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'open') return res.status(400).json({ error: 'Can only cancel open orders' });

    db.prepare('UPDATE orders SET status = "cancelled", updated_at = datetime("now") WHERE id = ?')
        .run(req.params.id);

    auditLog(req.user.id, 'ORDER_CANCELLED', order.pair, req, { orderId: req.params.id });
    res.json({ message: 'Order cancelled', orderId: req.params.id });
});

/* ==========================================================
   TRADE HISTORY
   GET /api/trade/history
   ========================================================== */
router.get('/history', (req, res) => {
    const db = getDB();
    const { limit: lim, offset } = req.query;

    const trades = db.prepare(`
    SELECT * FROM transactions
    WHERE user_id = ? AND type IN ('trade_buy', 'trade_sell')
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, parseInt(lim) || 50, parseInt(offset) || 0);

    const total = db.prepare(`
    SELECT COUNT(*) as count FROM transactions
    WHERE user_id = ? AND type IN ('trade_buy', 'trade_sell')
  `).get(req.user.id);

    res.json({ trades, total: total.count });
});

/* ==========================================================
   PORTFOLIO SUMMARY
   GET /api/trade/portfolio
   ========================================================== */
router.get('/portfolio', async (req, res) => {
    const db = getDB();

    const wallets = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND balance > 0')
        .all(req.user.id);

    let totalUSD = 0;
    const holdings = [];

    for (const wallet of wallets) {
        let usdValue = 0;
        if (wallet.currency === 'USDT' || wallet.currency === 'USD') {
            usdValue = wallet.balance;
        } else {
            const price = await fetchPrice(wallet.currency);
            usdValue = price ? wallet.balance * price : 0;
        }
        totalUSD += usdValue;
        holdings.push({
            currency: wallet.currency,
            balance: wallet.balance,
            lockedBalance: wallet.locked_balance,
            usdValue: usdValue.toFixed(2),
            allocation: 0, // Calculated below
        });
    }

    // Calculate allocation percentages
    holdings.forEach((h) => {
        h.allocation = totalUSD > 0 ? ((parseFloat(h.usdValue) / totalUSD) * 100).toFixed(2) : '0';
    });

    res.json({
        totalValueUSD: totalUSD.toFixed(2),
        holdings: holdings.sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue)),
    });
});

module.exports = router;
