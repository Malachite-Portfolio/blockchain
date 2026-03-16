/**
 * ============================================================
 * MALACHITE — Wallet API Routes
 * Deposit, Withdraw, Transfer, Balance, Address Management
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDB, generateId, auditLog } = require('./database');
const { authenticateToken } = require('./auth');

router.use(authenticateToken);

const SUPPORTED_CURRENCIES = ['BTC', 'ETH', 'SOL', 'USDT', 'BNB', 'XRP', 'ADA', 'AVAX'];
const MIN_WITHDRAW = { BTC: 0.0001, ETH: 0.001, SOL: 0.01, USDT: 10, BNB: 0.01, XRP: 1, ADA: 1, AVAX: 0.1 };

/* ==========================================================
   GET ALL WALLETS
   GET /api/wallet
   ========================================================== */
router.get('/', (req, res) => {
    const db = getDB();

    // Ensure user has wallets for all supported currencies
    const createWallet = db.prepare(`
    INSERT OR IGNORE INTO wallets (id, user_id, currency, balance, address)
    VALUES (?, ?, ?, 0, ?)
  `);

    const txn = db.transaction(() => {
        for (const currency of SUPPORTED_CURRENCIES) {
            const address = generateWalletAddress(currency);
            createWallet.run(generateId(), req.user.id, currency, address);
        }
    });
    txn();

    const wallets = db.prepare(`
    SELECT id, currency, balance, locked_balance, address, created_at, updated_at
    FROM wallets WHERE user_id = ? ORDER BY balance DESC
  `).all(req.user.id);

    res.json({ wallets });
});

/* ==========================================================
   GET SINGLE WALLET
   GET /api/wallet/:currency
   ========================================================== */
router.get('/:currency', (req, res) => {
    const currency = req.params.currency.toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
        return res.status(400).json({ error: 'Unsupported currency' });
    }

    const db = getDB();
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND currency = ?')
        .get(req.user.id, currency);

    if (!wallet) {
        return res.status(404).json({ error: 'Wallet not found' });
    }

    // Get recent transactions
    const transactions = db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? AND currency = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(req.user.id, currency);

    res.json({ wallet, transactions });
});

/* ==========================================================
   DEPOSIT (Simulate)
   POST /api/wallet/deposit
   ========================================================== */
router.post('/deposit', (req, res) => {
    const { currency, amount } = req.body;

    if (!currency || !amount) {
        return res.status(400).json({ error: 'currency and amount are required' });
    }

    const cur = currency.toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(cur)) {
        return res.status(400).json({ error: 'Unsupported currency' });
    }
    if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Amount must be positive' });
    }
    if (amount > 1000000) {
        return res.status(400).json({ error: 'Amount exceeds maximum deposit limit' });
    }

    const db = getDB();
    const txn = db.transaction(() => {
        // Update or create wallet
        db.prepare(`
      INSERT INTO wallets (id, user_id, currency, balance, address)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, currency)
      DO UPDATE SET balance = balance + ?, updated_at = datetime('now')
    `).run(generateId(), req.user.id, cur, amount, generateWalletAddress(cur), amount);

        // Record transaction
        db.prepare(`
      INSERT INTO transactions (id, user_id, type, currency, amount, status, description, tx_hash)
      VALUES (?, ?, 'deposit', ?, ?, 'completed', ?, ?)
    `).run(
            generateId(), req.user.id, cur, amount,
            `Deposit ${amount} ${cur}`,
            '0x' + crypto.randomBytes(32).toString('hex')
        );
    });

    txn();
    auditLog(req.user.id, 'DEPOSIT', cur, req, { amount });

    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND currency = ?')
        .get(req.user.id, cur);

    res.json({
        message: `Deposited ${amount} ${cur} successfully`,
        newBalance: wallet.balance,
        currency: cur,
    });
});

/* ==========================================================
   WITHDRAW
   POST /api/wallet/withdraw
   ========================================================== */
router.post('/withdraw', (req, res) => {
    const { currency, amount, toAddress } = req.body;

    if (!currency || !amount || !toAddress) {
        return res.status(400).json({ error: 'currency, amount, and toAddress are required' });
    }

    const cur = currency.toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(cur)) {
        return res.status(400).json({ error: 'Unsupported currency' });
    }
    if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Amount must be positive' });
    }
    if (amount < (MIN_WITHDRAW[cur] || 0)) {
        return res.status(400).json({ error: `Minimum withdrawal: ${MIN_WITHDRAW[cur]} ${cur}` });
    }

    // Validate address format
    if (!isValidAddress(cur, toAddress)) {
        return res.status(400).json({ error: 'Invalid withdrawal address' });
    }

    const db = getDB();
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND currency = ?')
        .get(req.user.id, cur);

    if (!wallet || wallet.balance < amount) {
        return res.status(400).json({
            error: 'Insufficient balance',
            available: wallet ? wallet.balance : 0,
        });
    }

    const fee = calculateWithdrawFee(cur, amount);
    const netAmount = amount - fee;

    const txId = generateId();
    const txn = db.transaction(() => {
        // Deduct from wallet
        db.prepare('UPDATE wallets SET balance = balance - ?, updated_at = datetime("now") WHERE user_id = ? AND currency = ?')
            .run(amount, req.user.id, cur);

        // Create withdrawal transaction
        db.prepare(`
      INSERT INTO transactions (id, user_id, type, currency, amount, fee, status, to_address, description, tx_hash)
      VALUES (?, ?, 'withdraw', ?, ?, ?, 'processing', ?, ?, ?)
    `).run(
            txId, req.user.id, cur, netAmount, fee, toAddress,
            `Withdraw ${netAmount} ${cur} to ${toAddress.slice(0, 10)}...`,
            '0x' + crypto.randomBytes(32).toString('hex')
        );
    });

    txn();
    auditLog(req.user.id, 'WITHDRAW', cur, req, { amount, fee, toAddress });

    res.json({
        message: 'Withdrawal submitted',
        transaction: {
            id: txId,
            amount: netAmount,
            fee,
            currency: cur,
            toAddress,
            status: 'processing',
            estimatedTime: '10-30 minutes',
        },
    });
});

/* ==========================================================
   TRANSFER BETWEEN WALLETS (Internal)
   POST /api/wallet/transfer
   ========================================================== */
router.post('/transfer', (req, res) => {
    const { fromCurrency, toCurrency, amount } = req.body;

    if (!fromCurrency || !toCurrency || !amount) {
        return res.status(400).json({ error: 'fromCurrency, toCurrency, and amount required' });
    }
    if (fromCurrency === toCurrency) {
        return res.status(400).json({ error: 'Cannot transfer to same currency' });
    }

    const db = getDB();
    const fromWallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND currency = ?')
        .get(req.user.id, fromCurrency.toUpperCase());

    if (!fromWallet || fromWallet.balance < amount) {
        return res.status(400).json({ error: 'Insufficient balance' });
    }

    const txn = db.transaction(() => {
        // Deduct
        db.prepare('UPDATE wallets SET balance = balance - ?, updated_at = datetime("now") WHERE user_id = ? AND currency = ?')
            .run(amount, req.user.id, fromCurrency.toUpperCase());

        // Add
        db.prepare(`
      INSERT INTO wallets (id, user_id, currency, balance, address)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, currency)
      DO UPDATE SET balance = balance + ?, updated_at = datetime('now')
    `).run(generateId(), req.user.id, toCurrency.toUpperCase(), amount, generateWalletAddress(toCurrency), amount);

        // Record transfer
        db.prepare(`
      INSERT INTO transactions (id, user_id, type, currency, amount, status, description)
      VALUES (?, ?, 'transfer', ?, ?, 'completed', ?)
    `).run(generateId(), req.user.id, fromCurrency.toUpperCase(), amount,
            `Transfer ${amount} ${fromCurrency} → ${toCurrency}`);
    });

    txn();
    auditLog(req.user.id, 'TRANSFER', `${fromCurrency}/${toCurrency}`, req, { amount });

    res.json({ message: `Transferred ${amount} ${fromCurrency} → ${toCurrency}` });
});

/* ==========================================================
   TRANSACTION HISTORY
   GET /api/wallet/transactions
   ========================================================== */
router.get('/transactions/all', (req, res) => {
    const db = getDB();
    const { type, currency, status, limit: lim, offset } = req.query;

    let query = 'SELECT * FROM transactions WHERE user_id = ?';
    const params = [req.user.id];

    if (type) { query += ' AND type = ?'; params.push(type); }
    if (currency) { query += ' AND currency = ?'; params.push(currency.toUpperCase()); }
    if (status) { query += ' AND status = ?'; params.push(status); }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(lim) || 50, parseInt(offset) || 0);

    const transactions = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE user_id = ?')
        .get(req.user.id);

    res.json({ transactions, total: total.count });
});

/* ==========================================================
   HELPER FUNCTIONS
   ========================================================== */

function generateWalletAddress(currency) {
    const prefix = { BTC: '1', ETH: '0x', SOL: '', BNB: 'bnb', XRP: 'r', ADA: 'addr1', AVAX: '0x', USDT: '0x' };
    return (prefix[currency] || '0x') + crypto.randomBytes(20).toString('hex');
}

function isValidAddress(currency, address) {
    if (!address || address.length < 10) return false;
    const patterns = {
        BTC: /^(1|3|bc1)[a-zA-Z0-9]{25,62}$/,
        ETH: /^0x[a-fA-F0-9]{40}$/,
        SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
        USDT: /^0x[a-fA-F0-9]{40}$/,
        BNB: /^(bnb|0x)[a-zA-Z0-9]{38,42}$/,
        XRP: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
    };
    const pattern = patterns[currency];
    return pattern ? pattern.test(address) : address.length > 10;
}

function calculateWithdrawFee(currency, amount) {
    const fees = { BTC: 0.0005, ETH: 0.005, SOL: 0.01, USDT: 1, BNB: 0.001, XRP: 0.25, ADA: 0.5, AVAX: 0.01 };
    return fees[currency] || amount * 0.001;
}

module.exports = router;
