/**
 * ============================================================
 * MALACHITE — Security Middleware
 * Helmet, CORS, Rate Limiting, CSRF, Sessions, IP Monitoring
 * ============================================================
 */

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const cookieParser = require('cookie-parser');

/**
 * Apply all security middleware to the Express app
 */
function applySecurityMiddleware(app) {

    // ─── 1. HELMET — Secure HTTP Headers ───
    app.use(helmet({
        // Content Security Policy
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://cdnjs.cloudflare.com",
                    "https://cdn.jsdelivr.net",
                    "https://www.google.com",
                    "https://www.gstatic.com",
                ],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "blob:"],
                connectSrc: ["'self'", "https://api.coingecko.com", "https://www.google.com"],
                frameSrc: ["https://www.google.com"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                frameAncestors: ["'none'"], // Prevent clickjacking
            },
        },
        // Strict-Transport-Security (HSTS)
        hsts: {
            maxAge: 31536000,        // 1 year
            includeSubDomains: true,
            preload: true,
        },
        // Prevent clickjacking
        frameguard: { action: 'deny' },
        // X-Content-Type-Options: nosniff
        noSniff: true,
        // Referrer-Policy
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        // X-DNS-Prefetch-Control
        dnsPrefetchControl: { allow: false },
        // X-Download-Options
        ieNoOpen: true,
        // X-Permitted-Cross-Domain-Policies
        permittedCrossDomainPolicies: { permittedPolicies: 'none' },
        // Cross-Origin policies
        crossOriginEmbedderPolicy: false, // Allow loading external resources
        crossOriginOpenerPolicy: { policy: 'same-origin' },
        crossOriginResourcePolicy: { policy: 'same-site' },
    }));

    // ─── 2. CORS — Cross-Origin Resource Sharing ───
    app.use(cors({
        origin: process.env.ALLOWED_ORIGINS
            ? process.env.ALLOWED_ORIGINS.split(',')
            : ['http://localhost:3000'],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
        credentials: true,
        maxAge: 86400, // Cache preflight for 24h
    }));

    // ─── 3. COOKIE PARSER ───
    app.use(cookieParser(process.env.SESSION_SECRET || 'malachite-secret'));

    // ─── 4. SESSION MANAGEMENT ───
    app.use(session({
        name: 'malachite.sid',
        secret: process.env.SESSION_SECRET || 'malachite-session-secret-change-me',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,     // Prevent XSS cookie theft
            sameSite: 'strict', // Prevent CSRF
            maxAge: 30 * 60 * 1000, // 30 minutes
            domain: process.env.COOKIE_DOMAIN || undefined,
        },
    }));

    // ─── 5. RATE LIMITING ───

    // Global rate limit: 100 requests per 15 minutes
    const globalLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        message: { error: 'Too many requests. Please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.ip,
    });
    app.use(globalLimiter);

    // Strict rate limit for auth endpoints: 5 attempts per 15 minutes
    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: { error: 'Too many login attempts. Account temporarily locked.' },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true, // Don't count successful logins
    });
    app.use('/api/auth/login', authLimiter);
    app.use('/api/auth/register', authLimiter);

    // Transaction rate limit: 20 per minute
    const txLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 20,
        message: { error: 'Too many transactions. Please slow down.' },
    });
    app.use('/api/trade', txLimiter);
    app.use('/api/withdraw', txLimiter);

    // ─── 6. IP-BASED MONITORING ───
    const suspiciousIPs = new Map();

    app.use((req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const entry = suspiciousIPs.get(ip) || { count: 0, firstSeen: Date.now(), blocked: false };

        // Track request frequency
        entry.count++;

        // Flag IPs making too many failed requests
        if (entry.count > 200 && (Date.now() - entry.firstSeen) < 60000) {
            entry.blocked = true;
            console.warn(`🚨 SUSPICIOUS IP BLOCKED: ${ip} — ${entry.count} requests in ${Math.round((Date.now() - entry.firstSeen) / 1000)}s`);
        }

        if (entry.blocked) {
            return res.status(429).json({ error: 'Your IP has been temporarily blocked due to suspicious activity.' });
        }

        suspiciousIPs.set(ip, entry);

        // Clean up old entries every 5 minutes
        if (Math.random() < 0.001) {
            const cutoff = Date.now() - 300000;
            for (const [key, val] of suspiciousIPs) {
                if (val.firstSeen < cutoff) suspiciousIPs.delete(key);
            }
        }

        next();
    });

    // ─── 7. REQUEST SANITIZATION ───
    app.use((req, res, next) => {
        // Sanitize query parameters
        for (const key in req.query) {
            if (typeof req.query[key] === 'string') {
                req.query[key] = sanitizeInput(req.query[key]);
            }
        }

        // Sanitize body
        if (req.body && typeof req.body === 'object') {
            sanitizeObject(req.body);
        }

        next();
    });

    // ─── 8. SECURITY RESPONSE HEADERS ───
    app.use((req, res, next) => {
        // Prevent caching of sensitive data
        if (req.path.startsWith('/api/')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
        }

        // Remove server fingerprint
        res.removeHeader('X-Powered-By');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');

        next();
    });
}

/**
 * Sanitize a string against common injection attacks
 */
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/[<>]/g, '')              // Strip HTML angle brackets
        .replace(/javascript:/gi, '')       // Strip JS protocol
        .replace(/on\w+=/gi, '')           // Strip event handlers
        .replace(/eval\(/gi, '')           // Strip eval
        .replace(/script/gi, '')           // Strip script references
        .trim()
        .slice(0, 1000);                   // Limit string length
}

/**
 * Recursively sanitize an object
 */
function sanitizeObject(obj) {
    for (const key in obj) {
        if (typeof obj[key] === 'string') {
            obj[key] = sanitizeInput(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeObject(obj[key]);
        }
    }
}

module.exports = { applySecurityMiddleware, sanitizeInput };
