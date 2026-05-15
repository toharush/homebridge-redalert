import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const PORT = 3100;

function getLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const nets of Object.values(interfaces)) {
    if (!nets) continue;
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const LAN_IP = getLanIp();

const cities: { name: string; area: string }[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'src/data/cities.json'), 'utf-8'),
);

const CATEGORIES: Record<string, { threat: number; title: string; emoji: string }> = {
  rockets:          { threat: 0, title: 'ירי רקטות וטילים', emoji: '🚀' },
  uav:             { threat: 5, title: 'חדירת כלי טיס עוין', emoji: '✈️' },
  terror:          { threat: 2, title: 'חדירת מחבלים', emoji: '⚠️' },
  nonconventional: { threat: 7, title: 'איום כימי', emoji: '☣️' },
  eventended:      { threat: 99, title: 'האירוע הסתיים', emoji: '✓' },
};

const wsClients = new Set<WebSocket>();
let activeAlert: { cities: string[]; category: string; timeout: ReturnType<typeof setTimeout> } | null = null;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHtml());
    return;
  }

  if (req.method === 'GET' && req.url === '/api/cities') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cities));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/fire') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { cities: cityNames, category, duration } = JSON.parse(body);
        if (!cityNames || !cityNames.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No cities provided' }));
          return;
        }
        fireAlert(cityNames, category || 'rockets', (duration || 30) * 1000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, cities: cityNames, category }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/end') {
    if (activeAlert) {
      endAlert(activeAlert.cities);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active alert' }));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      active: activeAlert ? { cities: activeAlert.cities, category: activeAlert.category } : null,
      clients: wsClients.size,
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server, path: '/socket' });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`  [WS] Client connected (${wsClients.size} total)`);
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`  [WS] Client disconnected (${wsClients.size} total)`);
  });
  ws.on('ping', () => ws.pong());
});

function broadcast(message: unknown) {
  const data = JSON.stringify(message);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function fireAlert(cityNames: string[], categoryKey: string, durationMs: number) {
  const category = CATEGORIES[categoryKey];
  if (!category) {
    console.log(`  Unknown category: ${categoryKey}`);
    return;
  }

  if (activeAlert) {
    clearTimeout(activeAlert.timeout);
  }

  const timeout = setTimeout(() => endAlert(cityNames), durationMs);
  activeAlert = { cities: cityNames, category: categoryKey, timeout };

  broadcast({
    type: 'ALERT',
    data: {
      threat: category.threat,
      title: "",
      data: cityNames,
      isDrill: false,
    },
  });

  console.log(`\n  🚨 ALERT: ${category.title}`);
  console.log(`  Cities (${cityNames.length}): ${cityNames.slice(0, 5).join(', ')}${cityNames.length > 5 ? ` +${cityNames.length - 5} more` : ''}`);
  console.log(`  Duration: ${durationMs / 1000}s\n`);
}

function endAlert(cityNames: string[]) {
  activeAlert = null;

  broadcast({
    type: 'SYSTEM_MESSAGE',
    data: {
      titleHe: 'עדכון פיקוד העורף',
      bodyHe: `האירוע הסתיים באזורים: ${cityNames.join(', ')}`,
    },
  });

  console.log(`  ✓ Event ended: ${cityNames.slice(0, 5).join(', ')}${cityNames.length > 5 ? ` +${cityNames.length - 5} more` : ''}\n`);
}

function getHtml(): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Red Alert Mock Server</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e;
    color: #eee;
    min-height: 100vh;
    padding: 20px;
  }
  .container { max-width: 600px; margin: 0 auto; }
  h1 { text-align: center; margin-bottom: 24px; color: #e94560; }
  .card {
    background: #16213e;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
    border: 1px solid #0f3460;
  }
  label { display: block; margin-bottom: 6px; font-weight: 500; color: #a8b2d1; }
  .city-input-wrap { position: relative; }
  #cityInput {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #0f3460;
    background: #0f3460;
    color: #eee;
    font-size: 15px;
    outline: none;
  }
  #cityInput:focus { border-color: #e94560; }
  .suggestions {
    position: absolute;
    top: 100%;
    left: 0; right: 0;
    background: #0f3460;
    border-radius: 0 0 8px 8px;
    max-height: 200px;
    overflow-y: auto;
    z-index: 10;
    display: none;
  }
  .suggestions.open { display: block; }
  .suggestion {
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid #16213e;
  }
  .suggestion:hover { background: #1a1a2e; }
  .suggestion .area { font-size: 12px; color: #888; }
  .selected-cities {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
    min-height: 32px;
  }
  .chip {
    background: #e94560;
    color: #fff;
    padding: 4px 10px;
    border-radius: 16px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .chip button {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
  }
  select, input[type="number"] {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #0f3460;
    background: #0f3460;
    color: #eee;
    font-size: 15px;
    outline: none;
  }
  .row { display: flex; gap: 12px; margin-top: 12px; }
  .row > div { flex: 1; }
  .btn {
    width: 100%;
    padding: 14px;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.1s, opacity 0.2s;
  }
  .btn:active { transform: scale(0.97); }
  .btn-fire { background: #e94560; color: #fff; }
  .btn-fire:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-end { background: #333; color: #eee; margin-top: 8px; }
  .status-bar {
    text-align: center;
    padding: 10px;
    border-radius: 8px;
    font-size: 14px;
  }
  .status-idle { background: #1b4332; color: #95d5b2; }
  .status-active { background: #5c1a1a; color: #ff6b6b; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
  .ws-count { text-align: center; font-size: 13px; color: #666; margin-top: 8px; }
</style>
</head>
<body>
<div class="container">
  <h1>Red Alert Mock</h1>

  <div class="card">
    <div id="statusBar" class="status-bar status-idle">No active alert</div>
    <div class="ws-count">WS Clients: <span id="wsCount">0</span></div>
  </div>

  <div class="card">
    <label for="cityInput">Cities</label>
    <div class="city-input-wrap">
      <input id="cityInput" type="text" placeholder="Search city..." autocomplete="off">
      <div id="suggestions" class="suggestions"></div>
    </div>
    <div id="selectedCities" class="selected-cities"></div>

    <div class="row">
      <div>
        <label for="categorySelect">Category</label>
        <select id="categorySelect">
          <option value="rockets">Rockets - ירי רקטות וטילים</option>
          <option value="uav">UAV - חדירת כלי טיס עוין</option>
          <option value="terror">Terror - חדירת מחבלים</option>
          <option value="nonconventional">Non-conventional - איום כימי</option>
          <option value="eventended">Event Ended - האירוע הסתיים</option>
        </select>
      </div>
      <div>
        <label for="durationInput">Duration (sec)</label>
        <input id="durationInput" type="number" value="30" min="5" max="300">
      </div>
    </div>
  </div>

  <button id="fireBtn" class="btn btn-fire" disabled>Fire Alert</button>
  <button id="endBtn" class="btn btn-end">End Alert</button>
</div>

<script>
  let allCities = [];
  let selected = [];

  const cityInput = document.getElementById('cityInput');
  const suggestionsEl = document.getElementById('suggestions');
  const selectedEl = document.getElementById('selectedCities');
  const fireBtn = document.getElementById('fireBtn');
  const endBtn = document.getElementById('endBtn');
  const statusBar = document.getElementById('statusBar');
  const wsCount = document.getElementById('wsCount');

  fetch('/api/cities').then(r => r.json()).then(data => { allCities = data; });

  cityInput.addEventListener('input', () => {
    const q = cityInput.value.trim();
    if (!q) { suggestionsEl.classList.remove('open'); return; }
    const results = allCities
      .filter(c => (c.name.includes(q) || (c.area && c.area.includes(q))) && !selected.includes(c.name))
      .slice(0, 15);
    if (!results.length) { suggestionsEl.classList.remove('open'); return; }
    suggestionsEl.innerHTML = results.map(c =>
      '<div class="suggestion" data-name="' + escHtml(c.name) + '">' + escHtml(c.name) + ' <span class="area">(' + escHtml(c.area || '') + ')</span></div>'
    ).join('');
    suggestionsEl.classList.add('open');
  });

  suggestionsEl.addEventListener('click', (e) => {
    const el = e.target.closest('.suggestion');
    if (!el) return;
    addCity(el.dataset.name);
    cityInput.value = '';
    suggestionsEl.classList.remove('open');
    cityInput.focus();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.city-input-wrap')) suggestionsEl.classList.remove('open');
  });

  function addCity(name) {
    if (selected.includes(name)) return;
    selected.push(name);
    render();
  }

  window.removeCity = function(name) {
    selected = selected.filter(c => c !== name);
    render();
  };

  function render() {
    selectedEl.innerHTML = selected.map(c =>
      '<span class="chip">' + escHtml(c) + '<button onclick="removeCity(\\''+escJs(c)+'\\')">\\u00d7</button></span>'
    ).join('');
    fireBtn.disabled = selected.length === 0;
  }

  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function escJs(s) { return s.replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'"); }

  fireBtn.addEventListener('click', async () => {
    const body = {
      cities: selected,
      category: document.getElementById('categorySelect').value,
      duration: parseInt(document.getElementById('durationInput').value) || 30,
    };
    await fetch('/api/fire', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    pollStatus();
  });

  endBtn.addEventListener('click', async () => {
    await fetch('/api/end', { method: 'POST' });
    pollStatus();
  });

  async function pollStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      wsCount.textContent = data.clients;
      if (data.active) {
        statusBar.className = 'status-bar status-active';
        const cats = {rockets:'Rockets',uav:'UAV',terror:'Terror',nonconventional:'Non-conventional'};
        statusBar.textContent = '\\ud83d\\udea8 ' + (cats[data.active.category]||data.active.category) + ': ' + data.active.cities.slice(0,3).join(', ') + (data.active.cities.length > 3 ? ' +' + (data.active.cities.length-3) : '');
      } else {
        statusBar.className = 'status-bar status-idle';
        statusBar.textContent = 'No active alert';
      }
    } catch {}
  }

  setInterval(pollStatus, 2000);
  pollStatus();
</script>
</body>
</html>`;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              Red Alert Mock Server                            ║
╠═══════════════════════════════════════════════════════════════╣
║  UI:    http://${LAN_IP}:${PORT}                               ║
║  WS:    ws://${LAN_IP}:${PORT}/socket                          ║
║                                                               ║
║  Point a custom WebSocket source to the WS URL above.        ║
╚═══════════════════════════════════════════════════════════════╝
`);
});
