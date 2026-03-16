/**
 * ============================================================
 * MALACHITE — WebSocket Server
 * Real-time price streaming & trade notifications
 * ============================================================
 */

const WebSocket = require('ws');
const { fetchAllPrices } = require('./prices');

let wss;

function initWebSocket(server) {
    wss = new WebSocket.Server({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        console.log(`🔌 WS Client connected: ${ip}`);

        ws.isAlive = true;
        ws.subscriptions = new Set(['prices']); // Default subscription

        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.type) {
                    case 'subscribe':
                        if (data.channel) ws.subscriptions.add(data.channel);
                        ws.send(JSON.stringify({ type: 'subscribed', channel: data.channel }));
                        break;

                    case 'unsubscribe':
                        if (data.channel) ws.subscriptions.delete(data.channel);
                        ws.send(JSON.stringify({ type: 'unsubscribed', channel: data.channel }));
                        break;

                    case 'ping':
                        ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
                        break;

                    default:
                        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
                }
            } catch (err) {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
            }
        });

        ws.on('close', () => {
            console.log(`🔌 WS Client disconnected: ${ip}`);
        });

        // Send initial prices
        sendPricesToClient(ws);
    });

    // ─── Price Broadcasting ───
    setInterval(async () => {
        const prices = await fetchAllPrices();
        broadcast('prices', { type: 'prices', data: prices, time: Date.now() });
    }, 5000); // Every 5 seconds

    // ─── Heartbeat to detect dead connections ───
    setInterval(() => {
        wss.clients.forEach((ws) => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    console.log('📡 WebSocket server initialized');
}

/**
 * Broadcast message to all clients subscribed to a channel
 */
function broadcast(channel, data) {
    if (!wss) return;
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.subscriptions.has(channel)) {
            client.send(msg);
        }
    });
}

/**
 * Send current prices to a single client
 */
async function sendPricesToClient(ws) {
    try {
        const prices = await fetchAllPrices();
        ws.send(JSON.stringify({ type: 'prices', data: prices, time: Date.now() }));
    } catch (err) {
        console.warn('Failed to send initial prices:', err.message);
    }
}

/**
 * Notify a specific user about trade execution
 */
function notifyUser(userId, event, data) {
    if (!wss) return;
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.userId === userId) {
            client.send(JSON.stringify({ type: event, data, time: Date.now() }));
        }
    });
}

module.exports = { initWebSocket, broadcast, notifyUser };
