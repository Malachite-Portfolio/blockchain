/* ============================================================
   MALACHITE — Main JavaScript
   Dynamic Animated Trading Theme
   ============================================================ */

(function () {
  'use strict';

  /* ==========================================================
     REAL-TIME CRYPTO PRICES — CoinGecko API
     ========================================================== */
  const COINGECKO_API = 'https://api.coingecko.com/api/v3';
  const COIN_IDS = 'bitcoin,ethereum,solana,tether,binancecoin,ripple,cardano,avalanche-2';
  const COIN_MAP = {
    bitcoin: { symbol: 'BTC', icon: '₿', name: 'Bitcoin' },
    ethereum: { symbol: 'ETH', icon: 'Ξ', name: 'Ethereum' },
    solana: { symbol: 'SOL', icon: '◎', name: 'Solana' },
    tether: { symbol: 'USDT', icon: '₮', name: 'Tether' },
    binancecoin: { symbol: 'BNB', icon: '⬡', name: 'BNB' },
    ripple: { symbol: 'XRP', icon: '✕', name: 'XRP' },
    cardano: { symbol: 'ADA', icon: '◆', name: 'Cardano' },
    'avalanche-2': { symbol: 'AVAX', icon: '▲', name: 'Avalanche' },
  };

  // Shared live price store — all components read from here
  const livePrices = {};
  let pricesLoaded = false;

  async function fetchLivePrices() {
    try {
      const res = await fetch(
        `${COINGECKO_API}/simple/price?ids=${COIN_IDS}&vs_currencies=usd&include_24hr_change=true`
      );
      if (!res.ok) return;
      const data = await res.json();

      Object.keys(data).forEach((id) => {
        const mapped = COIN_MAP[id];
        if (!mapped) return;
        livePrices[mapped.symbol] = {
          price: data[id].usd,
          change24h: data[id].usd_24h_change || 0,
          icon: mapped.icon,
          name: mapped.name,
        };
      });

      pricesLoaded = true;
      applyLivePrices();
      console.log('✅ Live crypto prices updated from CoinGecko');
    } catch (err) {
      console.warn('⚠️ CoinGecko fetch failed, using local simulation:', err.message);
    }
  }

  // Apply fetched prices to every component on the page
  function applyLivePrices() {
    if (!pricesLoaded) return;

    // 1) Ticker
    tickerData.forEach((coin) => {
      if (livePrices[coin.symbol]) {
        coin.price = livePrices[coin.symbol].price;
        coin.change24h = livePrices[coin.symbol].change24h;
      }
    });
    rebuildTickerPrices();

    // 2) Market cards
    Object.keys(marketCoins).forEach((sym) => {
      if (livePrices[sym]) {
        marketCoins[sym].price = livePrices[sym].price;
        // Push real price into sparkline data
        marketCoins[sym].data.push(livePrices[sym].price);
        if (marketCoins[sym].data.length > 60) marketCoins[sym].data.shift();
      }
    });

    // 3) Hero terminal (BTC)
    if (livePrices.BTC) {
      heroChartPrice = livePrices.BTC.price;
      heroChartData.push(heroChartPrice);
      if (heroChartData.length > 50) heroChartData.shift();
      drawHeroMiniChart();
      const termPrice = document.getElementById('terminalPrice');
      const termChange = document.getElementById('terminalChange');
      if (termPrice) termPrice.textContent = '$' + heroChartPrice.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
      if (termChange) {
        const chg = livePrices.BTC.change24h.toFixed(2);
        const isPos = parseFloat(chg) >= 0;
        termChange.textContent = (isPos ? '+' : '') + chg + '%';
        termChange.className = 'terminal-change ' + (isPos ? 'positive' : 'negative');
      }
    }

    // 4) Floating badges
    updateFloatingBadges();
  }

  function updateFloatingBadges() {
    const badges = [
      { el: document.querySelector('.fb-1'), sym: 'BTC' },
      { el: document.querySelector('.fb-2'), sym: 'ETH' },
      { el: document.querySelector('.fb-3'), sym: 'SOL' },
    ];
    badges.forEach(({ el, sym }) => {
      if (!el || !livePrices[sym]) return;
      const p = livePrices[sym];
      el.querySelector('.fb-price').textContent = '$' + p.price.toLocaleString('en-US', { maximumFractionDigits: p.price < 10 ? 4 : 2 });
      const changeEl = el.querySelector('.fb-change');
      const chg = p.change24h.toFixed(2);
      const isPos = parseFloat(chg) >= 0;
      changeEl.textContent = (isPos ? '+' : '') + chg + '%';
      changeEl.className = 'fb-change ' + (isPos ? 'positive' : 'negative');
    });
  }

  function rebuildTickerPrices() {
    document.querySelectorAll('.ticker-item').forEach((el) => {
      const symbol = el.dataset.symbol;
      const coin = tickerData.find((c) => c.symbol === symbol);
      if (!coin) return;
      const priceEl = el.querySelector('.ticker-price');
      const changeEl = el.querySelector('.ticker-change');
      priceEl.textContent = '$' + coin.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: coin.price < 10 ? 4 : 2 });
      const chg = (coin.change24h || 0).toFixed(2);
      const isPos = parseFloat(chg) >= 0;
      changeEl.textContent = (isPos ? '+' : '') + chg + '%';
      changeEl.className = 'ticker-change ' + (isPos ? 'positive' : 'negative');
    });
  }

  // Fetch immediately, then every 30 seconds
  fetchLivePrices();
  setInterval(fetchLivePrices, 30000);

  /* ========== PAGE LOADER ========== */
  window.addEventListener('load', () => {
    setTimeout(() => {
      document.getElementById('page-loader').classList.add('hidden');
    }, 800);
  });

  /* ========== CURSOR GLOW ========== */
  const cursorGlow = document.getElementById('cursor-glow');
  if (window.matchMedia('(pointer: fine)').matches) {
    document.addEventListener('mousemove', (e) => {
      cursorGlow.style.left = e.clientX + 'px';
      cursorGlow.style.top = e.clientY + 'px';
    });
  }

  /* ========== MATRIX RAIN ========== */
  const matrixCanvas = document.getElementById('matrixCanvas');
  if (matrixCanvas) {
    const mCtx = matrixCanvas.getContext('2d');
    let matrixCols = [];
    const chars = '01アイウエオカキクケコサシスセソタチツテト$¥€£₿ΞMATRIX';
    const fontSize = 14;

    function resizeMatrix() {
      matrixCanvas.width = window.innerWidth;
      matrixCanvas.height = window.innerHeight;
      const cols = Math.floor(matrixCanvas.width / fontSize);
      matrixCols = Array.from({ length: cols }, () =>
        Math.floor(Math.random() * matrixCanvas.height / fontSize)
      );
    }

    function drawMatrix() {
      mCtx.fillStyle = 'rgba(0, 0, 0, 0.06)';
      mCtx.fillRect(0, 0, matrixCanvas.width, matrixCanvas.height);

      matrixCols.forEach((y, i) => {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;

        // Vary brightness
        const brightness = Math.random();
        if (brightness > 0.95) {
          mCtx.fillStyle = '#66ff66';
          mCtx.shadowColor = '#22e622';
          mCtx.shadowBlur = 8;
        } else if (brightness > 0.8) {
          mCtx.fillStyle = '#22e622';
          mCtx.shadowBlur = 0;
        } else {
          mCtx.fillStyle = 'rgba(34, 230, 34, 0.3)';
          mCtx.shadowBlur = 0;
        }

        mCtx.font = fontSize + 'px JetBrains Mono, monospace';
        mCtx.fillText(char, x, y * fontSize);

        if (y * fontSize > matrixCanvas.height && Math.random() > 0.975) {
          matrixCols[i] = 0;
        }
        matrixCols[i]++;
      });

      mCtx.shadowBlur = 0;
      requestAnimationFrame(drawMatrix);
    }

    resizeMatrix();
    drawMatrix();
    window.addEventListener('resize', resizeMatrix);
  }

  /* ========== NAVBAR SCROLL ========== */
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  });

  /* ========== HAMBURGER MENU ========== */
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');

  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navLinks.classList.toggle('open');
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('active');
      navLinks.classList.remove('open');
    });
  });

  /* ========== TYPEWRITER EFFECT ========== */
  const typewriterEl = document.getElementById('typewriter');
  const phrases = ['Faster', 'Smarter', 'Richer', 'Stronger', 'Higher'];
  let phraseIndex = 0;
  let charIndex = 0;
  let isDeleting = false;
  let typeSpeed = 100;

  function typeWriter() {
    if (!typewriterEl) return;
    const current = phrases[phraseIndex];

    if (isDeleting) {
      charIndex--;
      typeSpeed = 50;
    } else {
      charIndex++;
      typeSpeed = 120;
    }

    typewriterEl.textContent = current.substring(0, charIndex);

    if (!isDeleting && charIndex === current.length) {
      typeSpeed = 2000; // Pause at end
      isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      phraseIndex = (phraseIndex + 1) % phrases.length;
      typeSpeed = 300; // Pause before next word
    }

    setTimeout(typeWriter, typeSpeed);
  }

  typeWriter();

  /* ========== PARTICLE CANVAS ========== */
  const canvas = document.getElementById('particleCanvas');
  const ctx = canvas.getContext('2d');
  let particles = [];

  function resizeCanvas() {
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;
  }

  function createParticles() {
    particles = [];
    const count = Math.min(100, Math.floor(canvas.width * canvas.height / 10000));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: Math.random() * 2 + 0.5,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        alpha: Math.random() * 0.6 + 0.1,
      });
    }
  }

  function drawParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(34, 230, 34, ${p.alpha})`;
      ctx.fill();
    });

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(34, 230, 34, ${0.08 * (1 - dist / 130)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(drawParticles);
  }

  resizeCanvas();
  createParticles();
  drawParticles();
  window.addEventListener('resize', () => {
    resizeCanvas();
    createParticles();
  });

  /* ========== PARALLAX ON HERO ========== */
  const heroContent = document.querySelector('.hero-content');
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    if (scrollY < window.innerHeight) {
      heroContent.style.transform = `translateY(${scrollY * 0.2}px)`;
      heroContent.style.opacity = 1 - scrollY / (window.innerHeight * 0.9);
    }
  });

  /* ========== LIVE CRYPTO TICKER ========== */
  const tickerData = [
    { symbol: 'BTC', name: 'Bitcoin', price: 48235.67, change24h: 0, icon: '₿' },
    { symbol: 'ETH', name: 'Ethereum', price: 3278.42, change24h: 0, icon: 'Ξ' },
    { symbol: 'SOL', name: 'Solana', price: 120.15, change24h: 0, icon: '◎' },
    { symbol: 'USDT', name: 'Tether', price: 1.0, change24h: 0, icon: '₮' },
    { symbol: 'BNB', name: 'BNB', price: 412.38, change24h: 0, icon: '⬡' },
    { symbol: 'XRP', name: 'XRP', price: 0.8234, change24h: 0, icon: '✕' },
    { symbol: 'ADA', name: 'Cardano', price: 0.6512, change24h: 0, icon: '◆' },
    { symbol: 'AVAX', name: 'Avalanche', price: 42.87, change24h: 0, icon: '▲' },
  ];

  const tickerTrack = document.getElementById('tickerTrack');

  function buildTicker() {
    let html = '';
    for (let loop = 0; loop < 2; loop++) {
      tickerData.forEach((coin) => {
        const chg = coin.change24h.toFixed(2);
        const isPositive = parseFloat(chg) >= 0;
        html += `
          <div class="ticker-item" data-symbol="${coin.symbol}">
            <span style="font-size:1.2rem;filter:drop-shadow(0 0 8px rgba(34,230,34,0.5))">${coin.icon}</span>
            <span class="ticker-symbol">${coin.symbol}</span>
            <span class="ticker-price">$${coin.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: coin.price < 10 ? 4 : 2 })}</span>
            <span class="ticker-change ${isPositive ? 'positive' : 'negative'}">${isPositive ? '+' : ''}${chg}%</span>
          </div>`;
      });
    }
    tickerTrack.innerHTML = html;
  }

  buildTicker();

  // Micro-fluctuation between API calls (keeps UI feeling alive)
  setInterval(() => {
    tickerData.forEach((coin) => {
      const swingPercent = (Math.random() - 0.5) * 0.15; // Tiny fluctuation
      coin.price = Math.max(0.01, coin.price * (1 + swingPercent / 100));
    });
    rebuildTickerPrices();
  }, 5000);

  /* ========== HERO TRADING TERMINAL — MINI CHART ========== */
  const heroMiniCanvas = document.getElementById('heroMiniChart');
  let heroChartData = [];
  let heroChartPrice = 48100;

  for (let i = 0; i < 50; i++) {
    heroChartPrice += (Math.random() - 0.47) * 120;
    heroChartData.push(heroChartPrice);
  }

  function drawHeroMiniChart() {
    if (!heroMiniCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = heroMiniCanvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w === 0 || h === 0) return;
    heroMiniCanvas.width = w * dpr;
    heroMiniCanvas.height = h * dpr;
    const c = heroMiniCanvas.getContext('2d');
    c.scale(dpr, dpr);

    const pad = 4;
    const min = Math.min(...heroChartData) * 0.9995;
    const max = Math.max(...heroChartData) * 1.0005;
    const range = max - min || 1;
    const stepX = (w - pad * 2) / (heroChartData.length - 1);

    const pts = heroChartData.map((v, i) => ({
      x: pad + i * stepX,
      y: h - pad - ((v - min) / range) * (h - pad * 2),
    }));

    // Gradient fill
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(34,230,34,0.25)');
    grad.addColorStop(0.5, 'rgba(34,230,34,0.08)');
    grad.addColorStop(1, 'rgba(34,230,34,0)');

    c.beginPath();
    c.moveTo(pts[0].x, h);
    pts.forEach((p, i) => {
      if (i === 0) { c.lineTo(p.x, p.y); return; }
      const prev = pts[i - 1];
      const cpx = (prev.x + p.x) / 2;
      c.bezierCurveTo(cpx, prev.y, cpx, p.y, p.x, p.y);
    });
    c.lineTo(pts[pts.length - 1].x, h);
    c.closePath();
    c.fillStyle = grad;
    c.fill();

    // Line
    c.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) { c.moveTo(p.x, p.y); return; }
      const prev = pts[i - 1];
      const cpx = (prev.x + p.x) / 2;
      c.bezierCurveTo(cpx, prev.y, cpx, p.y, p.x, p.y);
    });
    c.strokeStyle = '#22e622';
    c.lineWidth = 2.5;
    c.shadowColor = '#22e622';
    c.shadowBlur = 10;
    c.stroke();
    c.shadowBlur = 0;

    // Glowing dot
    const last = pts[pts.length - 1];
    c.beginPath();
    c.arc(last.x, last.y, 4, 0, Math.PI * 2);
    c.fillStyle = '#22e622';
    c.fill();
    c.beginPath();
    c.arc(last.x, last.y, 9, 0, Math.PI * 2);
    c.fillStyle = 'rgba(34,230,34,0.25)';
    c.fill();

    // Grid
    c.strokeStyle = 'rgba(34,230,34,0.04)';
    c.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
  }

  function updateHeroChart() {
    heroChartPrice += (Math.random() - 0.47) * 100;
    heroChartData.push(heroChartPrice);
    if (heroChartData.length > 50) heroChartData.shift();
    drawHeroMiniChart();

    // Update terminal price
    const termPrice = document.getElementById('terminalPrice');
    const termChange = document.getElementById('terminalChange');
    if (termPrice) {
      termPrice.textContent = '$' + heroChartPrice.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    }
    if (termChange) {
      const chg = ((heroChartPrice - 48100) / 48100 * 100).toFixed(2);
      const isPos = parseFloat(chg) >= 0;
      termChange.textContent = (isPos ? '+' : '') + chg + '%';
      termChange.className = 'terminal-change ' + (isPos ? 'positive' : 'negative');
    }
  }

  /* ========== LIVE ORDER FLOW FEED ========== */
  const orderFlowEl = document.getElementById('orderFlow');
  let tradeCount = 0;

  function addTrade() {
    if (!orderFlowEl) return;
    const isBuy = Math.random() > 0.45;
    const price = (47800 + Math.random() * 800).toFixed(2);
    const amount = (Math.random() * 2).toFixed(4);
    const now = new Date();
    const time = now.getHours().toString().padStart(2, '0') + ':' +
      now.getMinutes().toString().padStart(2, '0') + ':' +
      now.getSeconds().toString().padStart(2, '0');

    const item = document.createElement('div');
    item.className = 'order-flow-item';
    item.innerHTML = `
      <span class="of-type ${isBuy ? 'buy' : 'sell'}">${isBuy ? 'BUY' : 'SELL'}</span>
      <span class="of-price">$${parseFloat(price).toLocaleString()}</span>
      <span class="of-amount">${amount} BTC</span>
      <span class="of-time">${time}</span>
    `;

    orderFlowEl.insertBefore(item, orderFlowEl.firstChild);

    // Keep max 12 items
    while (orderFlowEl.children.length > 12) {
      orderFlowEl.removeChild(orderFlowEl.lastChild);
    }

    tradeCount++;
  }

  // Init with some trades
  for (let i = 0; i < 6; i++) addTrade();

  // Continuous trades
  setInterval(addTrade, 1800);

  /* ========== HERO TERMINAL INIT ========== */
  let heroInfoInterval = null;

  function initHeroTerminal() {
    drawHeroMiniChart();
    if (!heroInfoInterval) {
      heroInfoInterval = setInterval(updateHeroChart, 2000);
    }
  }

  const heroSection = document.getElementById('hero');
  if (heroSection) {
    const hiObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            initHeroTerminal();
            animateCounters(heroSection);
            hiObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    hiObserver.observe(heroSection);
  }

  window.addEventListener('resize', () => {
    if (heroInfoInterval) drawHeroMiniChart();
  });

  /* ========== SCROLL-TRIGGERED ANIMATIONS ========== */
  function animateCounters(el) {
    const counters = el.querySelectorAll('[data-count]');
    counters.forEach((counter) => {
      if (counter.dataset.animated) return;
      counter.dataset.animated = 'true';
      const target = parseFloat(counter.dataset.count);
      const decimals = parseInt(counter.dataset.decimals) || 0;
      const prefix = counter.dataset.prefix || '';
      const suffix = counter.dataset.suffix || '';
      const duration = 2000;
      const start = performance.now();

      function update(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        let value = target * ease;

        if (target >= 1000000) {
          counter.textContent = prefix + (value / 1000000).toFixed(1) + 'M' + suffix;
        } else if (target >= 1000) {
          counter.textContent = prefix + Math.floor(value).toLocaleString() + suffix;
        } else {
          counter.textContent = prefix + value.toFixed(decimals) + suffix;
        }

        if (progress < 1) requestAnimationFrame(update);
      }
      requestAnimationFrame(update);
    });
  }

  /* Circular Progress */
  function animateCircularProgress() {
    const fills = document.querySelectorAll('.cp-fill');
    fills.forEach((circle) => {
      if (circle.dataset.animated) return;
      circle.dataset.animated = 'true';
      const percent = parseInt(circle.dataset.percent);
      const circumference = 2 * Math.PI * 52;
      const offset = circumference - (percent / 100) * circumference;
      circle.style.strokeDashoffset = offset;

      const valueEl = circle.closest('.circular-progress-wrap').querySelector('.cp-value');
      const duration = 2000;
      const startTime = performance.now();
      function updateValue(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        valueEl.textContent = Math.floor(percent * ease) + '%';
        if (progress < 1) requestAnimationFrame(updateValue);
      }
      requestAnimationFrame(updateValue);
    });
  }

  /* Bar Chart */
  function animateBarChart() {
    const bars = document.querySelectorAll('.bar');
    bars.forEach((bar) => {
      if (bar.dataset.animated) return;
      bar.dataset.animated = 'true';
      const height = parseInt(bar.dataset.height);
      bar.style.height = height + '%';
    });
  }

  /* Line Chart (Canvas) */
  function animateLineChart() {
    const lineCanvas = document.getElementById('lineChart');
    if (!lineCanvas || lineCanvas.dataset.animated) return;
    lineCanvas.dataset.animated = 'true';

    const lctx = lineCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    lineCanvas.width = lineCanvas.offsetWidth * dpr;
    lineCanvas.height = lineCanvas.offsetHeight * dpr;
    lctx.scale(dpr, dpr);

    const realW = lineCanvas.offsetWidth;
    const realH = lineCanvas.offsetHeight;

    const dataPoints = [10, 25, 20, 45, 35, 60, 55, 78, 70, 95, 88, 110];
    const maxVal = 120;
    const padding = 10;
    const stepX = (realW - padding * 2) / (dataPoints.length - 1);

    const points = dataPoints.map((val, i) => ({
      x: padding + i * stepX,
      y: realH - padding - (val / maxVal) * (realH - padding * 2),
    }));

    let progress = 0;
    const animDuration = 2000;
    const startTime = performance.now();

    function drawLine(now) {
      const elapsed = now - startTime;
      progress = Math.min(elapsed / animDuration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const drawCount = Math.floor(points.length * ease);

      lctx.clearRect(0, 0, realW, realH);

      // Grid lines
      lctx.strokeStyle = 'rgba(34,230,34,0.04)';
      lctx.lineWidth = 0.5;
      for (let i = 0; i < 5; i++) {
        const y = padding + ((realH - padding * 2) / 4) * i;
        lctx.beginPath();
        lctx.moveTo(padding, y);
        lctx.lineTo(realW - padding, y);
        lctx.stroke();
      }

      if (drawCount < 2) {
        if (progress < 1) requestAnimationFrame(drawLine);
        return;
      }

      // Gradient fill
      const gradient = lctx.createLinearGradient(0, 0, 0, realH);
      gradient.addColorStop(0, 'rgba(34,230,34,0.2)');
      gradient.addColorStop(1, 'rgba(34,230,34,0)');

      lctx.beginPath();
      lctx.moveTo(points[0].x, realH - padding);
      for (let i = 0; i < drawCount; i++) {
        if (i === 0) {
          lctx.lineTo(points[i].x, points[i].y);
        } else {
          const cp1x = (points[i - 1].x + points[i].x) / 2;
          const cp1y = points[i - 1].y;
          const cp2x = cp1x;
          const cp2y = points[i].y;
          lctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, points[i].x, points[i].y);
        }
      }
      lctx.lineTo(points[drawCount - 1].x, realH - padding);
      lctx.closePath();
      lctx.fillStyle = gradient;
      lctx.fill();

      // Line
      lctx.beginPath();
      for (let i = 0; i < drawCount; i++) {
        if (i === 0) {
          lctx.moveTo(points[i].x, points[i].y);
        } else {
          const cp1x = (points[i - 1].x + points[i].x) / 2;
          const cp1y = points[i - 1].y;
          const cp2x = cp1x;
          const cp2y = points[i].y;
          lctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, points[i].x, points[i].y);
        }
      }
      lctx.strokeStyle = '#22e622';
      lctx.lineWidth = 2.5;
      lctx.shadowColor = '#22e622';
      lctx.shadowBlur = 8;
      lctx.stroke();
      lctx.shadowBlur = 0;

      // Dot on last visible point
      const lastPt = points[drawCount - 1];
      lctx.beginPath();
      lctx.arc(lastPt.x, lastPt.y, 4, 0, Math.PI * 2);
      lctx.fillStyle = '#22e622';
      lctx.fill();
      lctx.beginPath();
      lctx.arc(lastPt.x, lastPt.y, 9, 0, Math.PI * 2);
      lctx.fillStyle = 'rgba(34,230,34,0.25)';
      lctx.fill();

      if (progress < 1) requestAnimationFrame(drawLine);
    }

    requestAnimationFrame(drawLine);
  }

  /* ========== Intersection Observer for Infographics ========== */
  const infographicsSection = document.getElementById('infographics');
  if (infographicsSection) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCircularProgress();
            animateLineChart();
            animateBarChart();
            animateCounters(infographicsSection);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );
    observer.observe(infographicsSection);
  }

  /* ========== Wallet balance counters ========== */
  const walletsSection = document.getElementById('wallets');
  if (walletsSection) {
    const wObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCounters(walletsSection);
            wObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );
    wObserver.observe(walletsSection);
  }

  /* ========== Section Line Animations ========== */
  document.querySelectorAll('.section-line').forEach((line) => {
    const sObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            line.classList.add('visible');
            sObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    sObserver.observe(line);
  });

  /* ========== GSAP SCROLL REVEALS ========== */
  function initGSAP() {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);

    // Sections fade-in
    gsap.utils.toArray('.section-header').forEach((header) => {
      gsap.from(header, {
        y: 60,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: header,
          start: 'top 85%',
          toggleActions: 'play none none none',
        },
      });
    });

    // Cards stagger
    gsap.utils.toArray('[data-animate]').forEach((card, i) => {
      gsap.from(card, {
        y: 50,
        opacity: 0,
        scale: 0.95,
        duration: 0.8,
        delay: (i % 4) * 0.12,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: card,
          start: 'top 88%',
          toggleActions: 'play none none none',
        },
      });
    });

    // Dashboard
    const chartPanel = document.querySelector('.chart-panel');
    if (chartPanel) {
      gsap.from(chartPanel, {
        x: -60,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: chartPanel, start: 'top 80%' },
      });
    }

    const tradePanels = document.querySelector('.trade-panels');
    if (tradePanels) {
      gsap.from(tradePanels, {
        x: 60,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: tradePanels, start: 'top 80%' },
      });
    }
  }

  if (document.readyState === 'complete') {
    initGSAP();
  } else {
    window.addEventListener('load', () => setTimeout(initGSAP, 100));
  }

  /* ========== APEXCHARTS — CANDLESTICK ========== */
  function initCandlestick() {
    if (typeof ApexCharts === 'undefined') return;

    function genOHLC(count) {
      const data = [];
      let date = new Date('2026-02-01').getTime();
      let close = 47500;
      for (let i = 0; i < count; i++) {
        const open = close + (Math.random() - 0.48) * 600;
        const high = Math.max(open, close) + Math.random() * 400;
        const low = Math.min(open, close) - Math.random() * 400;
        close = open + (Math.random() - 0.45) * 800;
        data.push({
          x: new Date(date),
          y: [open.toFixed(2), high.toFixed(2), low.toFixed(2), close.toFixed(2)],
        });
        date += 3600000;
      }
      return data;
    }

    const options = {
      series: [{ data: genOHLC(50) }],
      chart: {
        type: 'candlestick',
        height: 360,
        background: 'transparent',
        toolbar: { show: false },
        fontFamily: 'JetBrains Mono, monospace',
      },
      theme: { mode: 'dark' },
      grid: {
        borderColor: 'rgba(34,230,34,0.06)',
        xaxis: { lines: { show: false } },
      },
      plotOptions: {
        candlestick: {
          colors: { upward: '#22e622', downward: '#ff6b6b' },
          wick: { useFillColor: true },
        },
      },
      xaxis: {
        type: 'datetime',
        labels: { style: { colors: '#4a6a4a', fontSize: '11px' } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: '#4a6a4a', fontSize: '11px' },
          formatter: (val) => '$' + val.toFixed(0),
        },
      },
      tooltip: {
        theme: 'dark',
        x: { format: 'MMM dd HH:mm' },
      },
    };

    const chartEl = document.getElementById('candlestickChart');
    if (chartEl) {
      const chart = new ApexCharts(chartEl, options);
      chart.render();
    }
  }

  // Init chart on section visibility
  const dashSection = document.getElementById('dashboard');
  if (dashSection) {
    const dObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            initCandlestick();
            dObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    dObserver.observe(dashSection);
  }

  /* ========== Timeframe buttons ========== */
  document.querySelectorAll('.tf-btn').forEach((btn) => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tf-btn').forEach((b) => b.classList.remove('active'));
      this.classList.add('active');
    });
  });

  /* ========== LIVE MARKETS — SPARKLINE CHARTS ========== */
  const marketCoins = {
    BTC: { price: 48235, data: [], trend: 1 },
    ETH: { price: 3278, data: [], trend: 1 },
    SOL: { price: 120.15, data: [], trend: -1 },
    BNB: { price: 412.38, data: [], trend: 1 },
    XRP: { price: 0.8234, data: [], trend: 1 },
    AVAX: { price: 42.87, data: [], trend: -1 },
  };

  // Seed initial data
  Object.keys(marketCoins).forEach((key) => {
    const coin = marketCoins[key];
    for (let i = 0; i < 60; i++) {
      const swing = (Math.random() - 0.48) * coin.price * 0.008;
      coin.price += swing;
      coin.data.push(coin.price);
    }
  });

  function drawSparkline(canvas, data, isPositive) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx2 = canvas.getContext('2d');
    ctx2.scale(dpr, dpr);

    const pad = 4;
    const min = Math.min(...data) * 0.999;
    const max = Math.max(...data) * 1.001;
    const range = max - min || 1;
    const stepX = (w - pad * 2) / (data.length - 1);

    const pts = data.map((val, i) => ({
      x: pad + i * stepX,
      y: h - pad - ((val - min) / range) * (h - pad * 2),
    }));

    const lineColor = isPositive ? '#22e622' : '#ff6b6b';
    const glowColor = isPositive ? 'rgba(34,230,34,' : 'rgba(255,107,107,';

    // Gradient fill
    const grad = ctx2.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, glowColor + '0.22)');
    grad.addColorStop(0.7, glowColor + '0.04)');
    grad.addColorStop(1, glowColor + '0)');

    // Fill area
    ctx2.beginPath();
    ctx2.moveTo(pts[0].x, h);
    pts.forEach((p, i) => {
      if (i === 0) { ctx2.lineTo(p.x, p.y); return; }
      const prev = pts[i - 1];
      const cpx = (prev.x + p.x) / 2;
      ctx2.bezierCurveTo(cpx, prev.y, cpx, p.y, p.x, p.y);
    });
    ctx2.lineTo(pts[pts.length - 1].x, h);
    ctx2.closePath();
    ctx2.fillStyle = grad;
    ctx2.fill();

    // Line
    ctx2.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) { ctx2.moveTo(p.x, p.y); return; }
      const prev = pts[i - 1];
      const cpx = (prev.x + p.x) / 2;
      ctx2.bezierCurveTo(cpx, prev.y, cpx, p.y, p.x, p.y);
    });
    ctx2.strokeStyle = lineColor;
    ctx2.lineWidth = 2.5;
    ctx2.shadowColor = lineColor;
    ctx2.shadowBlur = 10;
    ctx2.stroke();
    ctx2.shadowBlur = 0;

    // Endpoint glow dot
    const last = pts[pts.length - 1];
    ctx2.beginPath();
    ctx2.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx2.fillStyle = lineColor;
    ctx2.fill();
    ctx2.beginPath();
    ctx2.arc(last.x, last.y, 9, 0, Math.PI * 2);
    ctx2.fillStyle = glowColor + '0.28)';
    ctx2.fill();

    // Subtle grid
    ctx2.strokeStyle = glowColor + '0.04)';
    ctx2.lineWidth = 0.5;
    ctx2.shadowBlur = 0;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx2.beginPath();
      ctx2.moveTo(0, y);
      ctx2.lineTo(w, y);
      ctx2.stroke();
    }
  }

  function updateMarketCards() {
    document.querySelectorAll('.market-card').forEach((card) => {
      const sym = card.dataset.coin;
      const coin = marketCoins[sym];
      if (!coin) return;

      const volatility = coin.price < 10 ? 0.004 : 0.003;
      const swing = (Math.random() - 0.47) * coin.price * volatility;
      coin.price = Math.max(coin.price * 0.9, coin.price + swing);
      coin.data.push(coin.price);
      if (coin.data.length > 60) coin.data.shift();

      const first = coin.data[0];
      const last = coin.data[coin.data.length - 1];
      const changePct = ((last - first) / first * 100).toFixed(2);
      const isPositive = parseFloat(changePct) >= 0;

      const priceEl = card.querySelector('.mc-price');
      const changeEl = card.querySelector('.mc-change');

      if (coin.price >= 1000) {
        priceEl.textContent = '$' + coin.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } else if (coin.price >= 1) {
        priceEl.textContent = '$' + coin.price.toFixed(2);
      } else {
        priceEl.textContent = '$' + coin.price.toFixed(4);
      }

      changeEl.textContent = (isPositive ? '+' : '') + changePct + '%';
      changeEl.className = 'mc-change ' + (isPositive ? 'positive' : 'negative');

      const chartCanvas = card.querySelector('.mc-chart');
      if (chartCanvas) drawSparkline(chartCanvas, coin.data, isPositive);
    });
  }

  // Init sparklines on scroll into view
  const liveMarketsSection = document.getElementById('liveMarkets');
  let sparklineInterval = null;

  if (liveMarketsSection) {
    const mObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            updateMarketCards();
            if (!sparklineInterval) {
              sparklineInterval = setInterval(updateMarketCards, 1500);
            }
            mObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    mObserver.observe(liveMarketsSection);
  }

  window.addEventListener('resize', () => {
    if (sparklineInterval) updateMarketCards();
  });

})();
