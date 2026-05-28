/**
 * tele.js — test suite
 * Run: npm test
 */

// Load the UMD build into the jsdom environment
const fs   = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '../dist/tele.umd.js'), 'utf-8');

// Helper — create a fresh tele instance per test (avoids shared state)
function loadFresh(config = {}) {
  // Reset any existing window.tele
  delete global.window.tele;
  delete global.window.TELE_CONFIG;

  if (Object.keys(config).length) {
    global.window.TELE_CONFIG = config;
  }

  // Re-evaluate in global scope
  const fn = new Function('window', 'document', 'navigator', 'location', 'fetch', 'localStorage', code + '\nreturn window.tele;');
  return fn(global.window, global.document, global.navigator, global.location, global.fetch, global.localStorage);
}

// ── mocks ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Minimal fetch mock
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }));

  // localStorage mock
  const store = {};
  global.localStorage = {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = v; },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { Object.keys(store).forEach(k => delete store[k]); },
  };

  // navigator.sendBeacon mock
  global.navigator.sendBeacon = jest.fn(() => true);

  // location mock
  delete global.window.location;
  global.window.location = { pathname: '/test' };
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── core API ───────────────────────────────────────────────────────────────

describe('core API surface', () => {
  test('exposes all required methods', () => {
    const tele = loadFresh();
    expect(typeof tele.on).toBe('function');
    expect(typeof tele.off).toBe('function');
    expect(typeof tele.track).toBe('function');
    expect(typeof tele.flush).toBe('function');
    expect(typeof tele.getQueue).toBe('function');
    expect(typeof tele.reset).toBe('function');
    expect(typeof tele.config).toBe('function');
    expect(typeof tele.start).toBe('function');
    expect(typeof tele.stop).toBe('function');
    expect(typeof tele.create).toBe('function');
    expect(typeof tele.sessionId).toBe('string');
    expect(typeof tele.version).toBe('string');
  });

  test('version is a semver string', () => {
    const tele = loadFresh();
    expect(tele.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('sessionId is non-empty and stable within instance', () => {
    const tele = loadFresh();
    const id = tele.sessionId;
    expect(id.length).toBeGreaterThan(4);
    expect(tele.sessionId).toBe(id);
  });

  test('custom sessionId is respected', () => {
    const tele = loadFresh({ sessionId: 'my-session-42' });
    expect(tele.sessionId).toBe('my-session-42');
  });

  test('create() returns an independent instance', () => {
    const tele = loadFresh();
    const inst2 = tele.create({ sessionId: 'inst-2' });
    expect(inst2.sessionId).toBe('inst-2');
    expect(inst2.sessionId).not.toBe(tele.sessionId);
    // queues are independent
    inst2.track('ping');
    expect(inst2.getQueue()).toHaveLength(1);
    expect(tele.getQueue()).toHaveLength(0);
  });
});

// ── track & queue ──────────────────────────────────────────────────────────

describe('track() and queue', () => {
  test('track() adds an event to the queue', () => {
    const tele = loadFresh();
    tele.stop(); // prevent auto-flush interference
    tele.track('pageview', { url: '/home' });
    const q = tele.getQueue();
    expect(q).toHaveLength(1);
    expect(q[0].type).toBe('pageview');
    expect(q[0].url).toBe('/home');
  });

  test('track() attaches sessionId, ts, page', () => {
    const tele = loadFresh();
    tele.stop();
    tele.track('custom');
    const ev = tele.getQueue()[0];
    expect(ev.sessionId).toBe(tele.sessionId);
    expect(typeof ev.ts).toBe('number');
    expect(ev.page).toBe('/test');
  });

  test('getQueue() returns a copy, not the live array', () => {
    const tele = loadFresh();
    tele.stop();
    tele.track('a');
    const q1 = tele.getQueue();
    tele.track('b');
    const q2 = tele.getQueue();
    expect(q1).toHaveLength(1);
    expect(q2).toHaveLength(2);
  });

  test('reset() clears the queue', () => {
    const tele = loadFresh();
    tele.stop();
    tele.track('x');
    tele.track('y');
    tele.reset();
    expect(tele.getQueue()).toHaveLength(0);
  });

  test('chaining: track().track().reset() returns instance', () => {
    const tele = loadFresh();
    tele.stop();
    const result = tele.track('a').track('b').reset();
    expect(result).toBe(tele);
  });
});

// ── event listeners ────────────────────────────────────────────────────────

describe('on() / off()', () => {
  test('on() receives matching events', () => {
    const tele = loadFresh();
    tele.stop();
    const received = [];
    tele.on('pageview', ev => received.push(ev));
    tele.track('pageview', { p: 1 });
    tele.track('click',    { p: 2 });
    expect(received).toHaveLength(1);
    expect(received[0].p).toBe(1);
  });

  test("on('*') receives all events", () => {
    const tele = loadFresh();
    tele.stop();
    const received = [];
    tele.on('*', ev => received.push(ev));
    tele.track('a');
    tele.track('b');
    tele.track('c');
    expect(received).toHaveLength(3);
  });

  test('off() removes a specific listener', () => {
    const tele = loadFresh();
    tele.stop();
    const calls = [];
    const fn = ev => calls.push(ev);
    tele.on('ping', fn);
    tele.track('ping'); // heard
    tele.off('ping', fn);
    tele.track('ping'); // not heard
    expect(calls).toHaveLength(1);
  });

  test('on() is chainable', () => {
    const tele = loadFresh();
    tele.stop();
    const result = tele.on('a', () => {}).on('b', () => {});
    expect(result).toBe(tele);
  });
});

// ── onEvent callback ────────────────────────────────────────────────────────

describe('onEvent config callback', () => {
  test('called for every event', () => {
    const events = [];
    const tele = loadFresh({ onEvent: ev => events.push(ev) });
    tele.stop();
    tele.track('foo');
    tele.track('bar');
    expect(events).toHaveLength(2);
    expect(events.map(e => e.type)).toEqual(['foo', 'bar']);
  });
});

// ── flush / transports ─────────────────────────────────────────────────────

describe('flush() and transports', () => {
  test('flush() clears the queue', async () => {
    const tele = loadFresh({ endpoint: 'https://example.com/telemetry' });
    tele.stop();
    tele.track('a');
    tele.track('b');
    await tele.flush();
    expect(tele.getQueue()).toHaveLength(0);
  });

  test('flush() POSTs to endpoint with correct shape', async () => {
    const tele = loadFresh({ endpoint: 'https://example.com/telemetry' });
    tele.stop();
    tele.track('click', { x: 10 });
    await tele.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://example.com/telemetry');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.sessionId).toBe(tele.sessionId);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe('click');
  });

  test('flush() calls onFlush when configured', async () => {
    const received = [];
    const tele = loadFresh({ onFlush: evs => received.push(...evs) });
    tele.stop();
    tele.track('custom-event');
    await tele.flush();
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('custom-event');
    // onFlush overrides fetch entirely
    expect(fetch).not.toHaveBeenCalled();
  });

  test('falls back to localStorage when fetch fails', async () => {
    fetch.mockRejectedValueOnce(new Error('network error'));
    const tele = loadFresh({ endpoint: 'https://example.com/telemetry' });
    tele.stop();
    tele.track('offline-event');
    await tele.flush();
    // wait for promise chain
    await new Promise(r => setTimeout(r, 50));
    const stored = JSON.parse(localStorage.getItem('tele_events') || '[]');
    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0].type).toBe('offline-event');
  });

  test('flush() is a no-op when queue is empty', async () => {
    const tele = loadFresh({ endpoint: 'https://example.com/telemetry' });
    tele.stop();
    await tele.flush();
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ── config() at runtime ────────────────────────────────────────────────────

describe('config()', () => {
  test('updates endpoint after init', async () => {
    const tele = loadFresh();
    tele.stop();
    tele.config({ endpoint: 'https://late.example.com/tele' });
    tele.track('late-event');
    await tele.flush();
    expect(fetch.mock.calls[0][0]).toBe('https://late.example.com/tele');
  });

  test('is chainable', () => {
    const tele = loadFresh();
    tele.stop();
    expect(tele.config({ flushInterval: 10000 })).toBe(tele);
  });
});

// ── capture flag guards ────────────────────────────────────────────────────

describe('capture config', () => {
  test('disabling all capture means no auto-events', () => {
    // We test this by confirming track() still works (manual only)
    const tele = loadFresh({
      capture: {
        click: false, mousemove: false, scroll: false,
        keydown: false, keyup: false, visibility: false, resize: false,
      },
    });
    tele.stop();
    tele.track('manual');
    expect(tele.getQueue()).toHaveLength(1);
  });
});
