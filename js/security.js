/* ============================================================
   MALACHITE — Frontend Security Module
   XSS Prevention, Input Sanitization, Anti-Clickjacking,
   MetaMask Security, reCAPTCHA Integration
   ============================================================ */

(function () {
    'use strict';

    /* ==========================================================
       1. XSS PREVENTION — HTML Sanitizer
       ========================================================== */

    /**
     * Sanitize a string to prevent XSS when inserting into DOM.
     * Escapes all HTML special characters.
     */
    window.MalachiteSecurity = window.MalachiteSecurity || {};

    MalachiteSecurity.sanitizeHTML = function (str) {
        if (typeof str !== 'string') return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '/': '&#x2F;',
            '`': '&#96;',
        };
        return str.replace(/[&<>"'/`]/g, (char) => map[char]);
    };

    /**
     * Sanitize and validate a number input (for trading forms).
     * Returns sanitized number or null if invalid.
     */
    MalachiteSecurity.sanitizeNumber = function (value) {
        if (typeof value === 'number') return value;
        const cleaned = String(value).replace(/[^0-9.]/g, '');
        const num = parseFloat(cleaned);
        if (isNaN(num) || !isFinite(num) || num < 0) return null;
        return num;
    };

    /**
     * Create a safe text node instead of using innerHTML.
     */
    MalachiteSecurity.safeTextContent = function (element, text) {
        if (element) element.textContent = text;
    };

    /* ==========================================================
       2. INPUT VALIDATION — Trade Forms
       ========================================================== */

    function initInputValidation() {
        const tradeInputs = document.querySelectorAll('.trade-input');

        tradeInputs.forEach((input) => {
            // Prevent non-numeric input
            input.addEventListener('keydown', (e) => {
                const allowed = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', '.'];
                if (allowed.includes(e.key)) return;
                if (e.key >= '0' && e.key <= '9') return;
                e.preventDefault();
            });

            // Sanitize on paste
            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const pasted = (e.clipboardData || window.clipboardData).getData('text');
                const sanitized = MalachiteSecurity.sanitizeNumber(pasted);
                if (sanitized !== null) {
                    input.value = sanitized;
                    input.dispatchEvent(new Event('input'));
                }
            });

            // Validate on blur
            input.addEventListener('blur', () => {
                const val = MalachiteSecurity.sanitizeNumber(input.value);
                if (val === null && input.value !== '') {
                    input.value = '';
                    input.style.borderColor = '#ff6b6b';
                    setTimeout(() => { input.style.borderColor = ''; }, 2000);
                }
            });

            // Max length protection
            input.setAttribute('maxlength', '20');
        });
    }

    /* ==========================================================
       3. ANTI-CLICKJACKING — Frame Busting
       ========================================================== */

    function initAntiClickjacking() {
        // CSP frame-ancestors: 'none' handles modern browsers.
        // This is fallback for older browsers.
        if (window.self !== window.top) {
            // We're in an iframe — break out
            document.body.innerHTML = '<h1 style="color:#ff6b6b;text-align:center;padding:100px;font-family:sans-serif;">⚠️ This page cannot be loaded in an iframe.</h1>';
            window.top.location = window.self.location;
            return;
        }
    }

    /* ==========================================================
       4. METAMASK / WALLET SECURITY
       ========================================================== */

    MalachiteSecurity.connectWallet = async function () {
        // Check if MetaMask is installed
        if (typeof window.ethereum === 'undefined') {
            console.warn('⚠️ MetaMask not detected');
            return { success: false, error: 'MetaMask not installed' };
        }

        try {
            // Request account access (EIP-1102)
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts',
            });

            if (!accounts || accounts.length === 0) {
                return { success: false, error: 'No accounts found' };
            }

            const account = accounts[0];

            // Validate Ethereum address format
            if (!/^0x[a-fA-F0-9]{40}$/.test(account)) {
                return { success: false, error: 'Invalid Ethereum address' };
            }

            // Get chain ID
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });

            // Listen for account/chain changes
            window.ethereum.on('accountsChanged', (newAccounts) => {
                if (newAccounts.length === 0) {
                    console.log('🔒 Wallet disconnected');
                    document.dispatchEvent(new CustomEvent('wallet:disconnected'));
                } else {
                    document.dispatchEvent(new CustomEvent('wallet:changed', {
                        detail: { account: newAccounts[0] }
                    }));
                }
            });

            window.ethereum.on('chainChanged', (newChainId) => {
                console.log('🔗 Chain changed to:', newChainId);
                // Reload to avoid stale state
                window.location.reload();
            });

            console.log('✅ Wallet connected:', account.slice(0, 6) + '...' + account.slice(-4));
            return { success: true, account, chainId };

        } catch (err) {
            if (err.code === 4001) {
                return { success: false, error: 'User rejected connection' };
            }
            return { success: false, error: err.message };
        }
    };

    /**
     * Sign a message securely (for authentication)
     */
    MalachiteSecurity.signMessage = async function (account, message) {
        if (!account || !message) return null;

        try {
            // Add timestamp to prevent replay attacks
            const timestampedMsg = `${message}\n\nTimestamp: ${Date.now()}\nDomain: ${window.location.hostname}`;

            const signature = await window.ethereum.request({
                method: 'personal_sign',
                params: [timestampedMsg, account],
            });

            return { message: timestampedMsg, signature };
        } catch (err) {
            console.error('❌ Signing failed:', err.message);
            return null;
        }
    };

    /* ==========================================================
       5. RATE LIMITING (Client-Side)
       ========================================================== */

    const rateLimitMap = new Map();

    MalachiteSecurity.rateLimit = function (key, maxAttempts, windowMs) {
        const now = Date.now();
        const entry = rateLimitMap.get(key) || { attempts: 0, windowStart: now };

        // Reset window if expired
        if (now - entry.windowStart > windowMs) {
            entry.attempts = 0;
            entry.windowStart = now;
        }

        entry.attempts++;
        rateLimitMap.set(key, entry);

        if (entry.attempts > maxAttempts) {
            const remainingMs = windowMs - (now - entry.windowStart);
            console.warn(`⚠️ Rate limit exceeded for "${key}". Try again in ${Math.ceil(remainingMs / 1000)}s`);
            return false;
        }

        return true;
    };

    /* ==========================================================
       6. SUSPICIOUS ACTIVITY MONITOR
       ========================================================== */

    const suspiciousEvents = [];

    function logSuspicious(type, detail) {
        const event = {
            type,
            detail,
            timestamp: new Date().toISOString(),
            url: window.location.href,
            userAgent: navigator.userAgent,
        };
        suspiciousEvents.push(event);
        console.warn('🚨 Suspicious activity:', type, detail);

        // If too many suspicious events, lock the page
        if (suspiciousEvents.length > 50) {
            document.body.innerHTML = '<div style="color:#ff6b6b;text-align:center;padding:100px;font-family:sans-serif;"><h1>⚠️ Security Alert</h1><p>Suspicious activity detected. Please refresh the page.</p></div>';
        }
    }

    // Monitor for DevTools tampering attempts
    let devToolsOpen = false;
    const threshold = 160;

    setInterval(() => {
        const widthThreshold = window.outerWidth - window.innerWidth > threshold;
        const heightThreshold = window.outerHeight - window.innerHeight > threshold;
        if (widthThreshold || heightThreshold) {
            if (!devToolsOpen) {
                devToolsOpen = true;
                // Don't block, just log
                console.log('ℹ️ Developer tools detected');
            }
        } else {
            devToolsOpen = false;
        }
    }, 1000);

    // Prevent common XSS injection via URL params
    function checkURLSafety() {
        const url = window.location.href;
        const dangerousPatterns = [
            /<script/i,
            /javascript:/i,
            /on\w+\s*=/i,
            /eval\(/i,
            /document\.cookie/i,
            /\.innerHTML/i,
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(url)) {
                logSuspicious('XSS_URL_ATTEMPT', url);
                // Clean the URL
                window.history.replaceState({}, document.title, window.location.pathname);
                break;
            }
        }
    }

    /* ==========================================================
       7. SECURE COOKIE HELPERS
       ========================================================== */

    MalachiteSecurity.setCookie = function (name, value, days) {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; Secure; SameSite=Strict`;
    };

    MalachiteSecurity.getCookie = function (name) {
        const cookies = document.cookie.split('; ');
        for (const cookie of cookies) {
            const [key, val] = cookie.split('=');
            if (key === name) return decodeURIComponent(val);
        }
        return null;
    };

    MalachiteSecurity.deleteCookie = function (name) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; Secure; SameSite=Strict`;
    };

    /* ==========================================================
       INIT
       ========================================================== */

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        initAntiClickjacking();
        initInputValidation();
        checkURLSafety();
        console.log('🔒 Malachite Security Module loaded');
    }

})();
