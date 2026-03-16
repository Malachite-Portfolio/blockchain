/**
 * ============================================================
 * MALACHITE — Crypto Price Service
 * CoinGecko API integration with caching
 * ============================================================
 */

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

const SYMBOL_TO_ID = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana',
    USDT: 'tether', BNB: 'binancecoin', XRP: 'ripple',
    ADA: 'cardano', AVAX: 'avalanche-2', DOT: 'polkadot',
    MATIC: 'matic-network', LINK: 'chainlink', UNI: 'uniswap',
    DOGE: 'dogecoin', SHIB: 'shiba-inu', LTC: 'litecoin',
};

// Cache prices for 30 seconds
let priceCache = {};
let lastFetch = 0;
const CACHE_TTL = 30000;

/**
 * Fetch all prices from CoinGecko (cached)
 */
async function fetchAllPrices() {
    const now = Date.now();
    if (now - lastFetch < CACHE_TTL && Object.keys(priceCache).length > 0) {
        return priceCache;
    }

    try {
        const ids = Object.values(SYMBOL_TO_ID).join(',');
        const res = await fetch(
            `${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
        );

        if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
        const data = await res.json();

        // Map to symbols
        const prices = {};
        for (const [symbol, coinId] of Object.entries(SYMBOL_TO_ID)) {
            if (data[coinId]) {
                prices[symbol] = {
                    price: data[coinId].usd,
                    change24h: data[coinId].usd_24h_change || 0,
                    volume24h: data[coinId].usd_24h_vol || 0,
                    marketCap: data[coinId].usd_market_cap || 0,
                };
            }
        }

        priceCache = prices;
        lastFetch = now;
        return prices;

    } catch (err) {
        console.warn('⚠️ Price fetch failed:', err.message);
        return priceCache; // Return stale cache on error
    }
}

/**
 * Fetch single coin price
 */
async function fetchPrice(symbol) {
    const prices = await fetchAllPrices();
    return prices[symbol.toUpperCase()]?.price || null;
}

/**
 * Fetch detailed market data for a coin
 */
async function fetchMarketData(symbol) {
    const coinId = SYMBOL_TO_ID[symbol.toUpperCase()];
    if (!coinId) return null;

    try {
        const res = await fetch(`${COINGECKO_API}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`);
        if (!res.ok) return null;
        const data = await res.json();

        return {
            symbol: symbol.toUpperCase(),
            name: data.name,
            price: data.market_data.current_price.usd,
            change24h: data.market_data.price_change_percentage_24h,
            change7d: data.market_data.price_change_percentage_7d,
            change30d: data.market_data.price_change_percentage_30d,
            high24h: data.market_data.high_24h.usd,
            low24h: data.market_data.low_24h.usd,
            marketCap: data.market_data.market_cap.usd,
            volume24h: data.market_data.total_volume.usd,
            circulatingSupply: data.market_data.circulating_supply,
            totalSupply: data.market_data.total_supply,
            ath: data.market_data.ath.usd,
            athDate: data.market_data.ath_date.usd,
            rank: data.market_cap_rank,
            image: data.image?.small,
        };
    } catch (err) {
        console.warn('Market data fetch failed:', err.message);
        return null;
    }
}

/**
 * Fetch price history for charts
 */
async function fetchPriceHistory(symbol, days) {
    const coinId = SYMBOL_TO_ID[symbol.toUpperCase()];
    if (!coinId) return null;

    try {
        const res = await fetch(`${COINGECKO_API}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`);
        if (!res.ok) return null;
        const data = await res.json();

        return {
            prices: data.prices.map(([t, p]) => ({ time: t, price: p })),
            volumes: data.total_volumes.map(([t, v]) => ({ time: t, volume: v })),
        };
    } catch (err) {
        console.warn('Price history fetch failed:', err.message);
        return null;
    }
}

module.exports = { fetchAllPrices, fetchPrice, fetchMarketData, fetchPriceHistory, SYMBOL_TO_ID };
