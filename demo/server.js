#!/usr/bin/env node
/**
 * tele.js dev server
 * Serves the demo page and accepts telemetry POST requests.
 *
 * Usage:
 *   npm run demo
 *   # or directly:
 *   node demo/server.js [--port 3000]
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.PORT || process.argv.find(a => /^\d+$/.test(a)) || '3000', 10);

// In-memory store (resets on restart — use a DB for persistence)
let eventStore = [];
const MAX_STORE = 20000;

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json',
  '.ts':   'text/plain',
};

// ── helpers ───────────────────────────────────────────────────────────────────

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch(e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

// ── request handler ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── POST /telemetry — receive a batch ──────────────────────────────────────
  if (method === 'POST' && url.pathname === '/telemetry') {
    try {
      const { events = [], sessionId = 'unknown' } = await readBody(req);
      if (!Array.isArray(events)) return json(res, 400, { error: 'events must be an array' });

      const stamped = events.map(e => ({ ...e, sessionId, receivedAt: Date.now() }));
      eventStore.push(...stamped);
      if (eventStore.length > MAX_STORE) eventStore = eventStore.slice(-MAX_STORE);

      console.log(`  ← ${stamped.length} event(s) from session ${sessionId.slice(0, 12)}…`);
      return json(res, 200, { ok: true, accepted: stamped.length });
    } catch (_) {
      return json(res, 400, { error: 'invalid JSON' });
    }
  }

  // ── GET /events — retrieve all stored events ───────────────────────────────
  if (method === 'GET' && url.pathname === '/events') {
    return json(res, 200, { events: eventStore, total: eventStore.length });
  }

  // ── GET /events/stats — quick summary ─────────────────────────────────────
  if (method === 'GET' && url.pathname === '/events/stats') {
    const byType = eventStore.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {});
    const sessions = [...new Set(eventStore.map(e => e.sessionId))];
    return json(res, 200, { total: eventStore.length, byType, sessionCount: sessions.length });
  }

  // ── DELETE /events/reset — clear store ────────────────────────────────────
  if ((method === 'DELETE' || method === 'POST') && url.pathname === '/events/reset') {
    const count = eventStore.length;
    eventStore  = [];
    console.log(`  ✗ store cleared (${count} events removed)`);
    return json(res, 200, { ok: true, cleared: count });
  }

  // ── static files ──────────────────────────────────────────────────────────
  let filePath = url.pathname;
  if (filePath === '/' || filePath === '') filePath = '/demo/index.html';
  serveFile(res, path.join(ROOT, filePath));
});

server.listen(PORT, () => {
  console.log('\n🚀 tele.js dev server');
  console.log(`   Demo:      http://localhost:${PORT}/`);
  console.log(`   Endpoint:  POST http://localhost:${PORT}/telemetry`);
  console.log(`   Events:    GET  http://localhost:${PORT}/events`);
  console.log(`   Stats:     GET  http://localhost:${PORT}/events/stats`);
  console.log(`   Reset:     DEL  http://localhost:${PORT}/events/reset\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✗ Port ${PORT} is in use. Try: PORT=3001 npm run demo`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
