# Telesense

> Lightweight, zero-dependency behavioural telemetry SDK. Drop one script tag — get clicks, scrolls, keypresses, heatmap data, and a clean JS API.

[![demo](https://img.shields.io/website?url=https%3A%2F%2FEbParsa.github.io%2FTelesense&up_message=live&up_color=22bb00&down_message=updating...&down_color=ea7600&style=flat-square&logo=github&label=demo&labelColor=black)](https://EbParsa.github.io/Telesense)
[![npm version](https://img.shields.io/npm/v/telesense?style=flat-square&logo=npm&labelColor=black&color=darkviolet)](https://www.npmjs.com/package/telesense)
[![script tag size](https://img.shields.io/badge/minified-%3C20KB-f7df1e?style=flat-square&logo=javascript&labelColor=black)](https://EbParsa.github.io/Telesense)
[![license](https://img.shields.io/badge/license-MIT-f03c2e?style=flat-square&logo=git&labelColor=black)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6?style=flat-square&logo=typescript&labelColor=black)](https://www.npmjs.com/package/telesense)

**[Live demo →](https://EbParsa.github.io/Telesense)**

---

## Why Telesense?

| | Telesense | Heap | Mixpanel | Hotjar |
|---|---|---|---|---|
| Self-hosted | ✅ | ❌ | ❌ | ❌ |
| Zero dependencies | ✅ | ❌ | ❌ | ❌ |
| Bundle size | **<20 kB** | ~120 kB | ~80 kB | ~60 kB |
| Custom transport | ✅ | ❌ | ❌ | ❌ |
| TypeScript types | ✅ | partial | partial | ❌ |
| Open source | ✅ | ❌ | ❌ | ❌ |

---

## Quick start

### Script tag (no build step)

```html
<!-- 1. Optional config -->
<script>
  window.TELE_CONFIG = {
    endpoint: '/telemetry',   // your backend
    flushInterval: 5000       // ms between auto-flushes
  };
</script>

<!-- 2. Load SDK -->
<script src="https://cdn.jsdelivr.net/npm/telesense/dist/tele.umd.min.js"></script>

<!-- 3. tele is globally available -->
<script>
  tele.on('click', ev => console.log('click at', ev.x, ev.y));
</script>
```

### npm / bundler

```bash
npm install telesense
```

```js
import tele from 'telesense';

tele.config({ endpoint: '/telemetry' });

tele.on('*', ev => console.log(ev));
tele.track('signup_complete', { plan: 'pro' });
```

---

## Captured events

| Type | Payload fields |
|------|---------------|
| `click` | `button`, `x`, `y`, `element` |
| `mousemove` | `x`, `y` (throttled 100 ms) |
| `touchstart`, `touchmove`, `touchend` | `x`, `y`, `touches`, `element` |
| `scroll` | `scrollX`, `scrollY`, `percentX`, `percentY` |
| `keydown` / `keyup` | `key`, `code`, `target` — sensitive fields auto-masked |
| `visibility` | `state` (`active` \| `inactive`) |
| `resize` | `width`, `height` |
| _custom_ | anything you pass to `tele.track()` |

Sensitive inputs (`type="password"`, `name="card*"`, `autocomplete="cc-*"`) are detected automatically — input key is replaced with `[masked]`.

---

## API reference

### `tele.on(type, fn)` → `this`

Subscribe to an event type. Use `'*'` to receive all events.

```js
tele.on('click', ev => { /* ev.x, ev.y, ev.element */ });
tele.on('*',     ev => sendToAnalytics(ev));
```

### `tele.off(type, fn)` → `this`

Remove a specific listener.

### `tele.track(type, data?)` → `this`

Record a custom event. Merged with `sessionId`, `ts`, `page`.

```js
tele.track('video_play',  { videoId: 'abc123', position: 0 });
tele.track('form_submit', { formId: 'checkout', valid: true });
```

### `tele.flush()` → `Promise<void>`

Send the in-memory queue immediately (outside the normal interval).

### `tele.getQueue()` → `TeleEvent[]`

Snapshot of all queued events not yet flushed.

### `tele.reset()` → `this`

Clear the queue without sending (useful for logout / session change).

### `tele.config(patch)` → `this`

Update config at runtime — safe to call after the SDK loads.

```js
// Set endpoint after user authenticates
tele.config({ endpoint: `/telemetry?userId=${user.id}` });
```

### `tele.start()` / `tele.stop()`

Attach or detach all DOM listeners and the auto-flush timer.

### `tele.create(config?)` → `TeleInstance`

Create a completely isolated second instance — separate queue, session, and config.

```js
const adminTele = tele.create({ sessionId: `admin-${uid}`, endpoint: '/admin-tele' });
```

### `tele.sessionId` (read-only)

The session ID for this instance (auto-generated or from `config.sessionId`).

### `tele.version` (read-only)

Current version string, e.g. `"1.0.0"`.

---

## Configuration

```js
window.TELE_CONFIG = {
  // ── transports (pick one, or use onFlush for a custom transport)
  endpoint:        '',     // POST URL
  supabaseUrl:     '',     // Supabase project URL
  supabaseAnonKey: '',     // Supabase anon/public key

  // ── behaviour
  flushInterval:   5000,   // ms between auto-flushes
  maxQueue:        500,    // max in-memory events before forced flush
  maxStored:       20000,  // max events in localStorage fallback
  mouseThrottle:   100,    // ms between mousemove samples
  scrollThrottle:  100,    // ms between scroll samples
  sessionId:       null,   // supply your own or one is generated

  // ── toggle individual event types
  capture: {
    click:      true,
    mousemove:  true,
    touchstart: true,
    touchmove:  true,
    touchend:   true,
    scroll:     true,
    keydown:    true,
    keyup:      true,
    visibility: true,
    resize:     true
  },

  // ── custom transport (overrides endpoint + supabase)
  onFlush: null,   // (events: TeleEvent[]) => void

  // ── per-event hook (fires synchronously, before queue)
  onEvent: null,   // (event: TeleEvent) => void
};
```

---

## Transport options

### 1. Your own backend

```js
tele.config({ endpoint: 'https://your-api.com/telemetry' });
```

Expected shape: `POST` with `Content-Type: application/json`, body `{ sessionId, events[] }`.

### 2. Supabase (serverless, no backend required)

```sql
-- Run once in Supabase SQL editor
create table telemetry_events (
  id         bigint generated always as identity primary key,
  session_id text    not null,
  event_json jsonb   not null,
  created_at timestamptz default now()
);
alter table telemetry_events enable row level security;
create policy "anon_insert" on telemetry_events for insert to anon with check (true);
create policy "anon_select" on telemetry_events for select to anon using (true);
```

```js
tele.config({
  supabaseUrl:     'https://xxxx.supabase.co',
  supabaseAnonKey: 'your-anon-key',
});
```

### 3. Custom transport

```js
tele.config({
  onFlush: async (events) => {
    await fetch('/my-endpoint', {
      method: 'POST',
      body: JSON.stringify(events),
    });
  },
});
```

### 4. localStorage (offline / zero config)

If no transport is configured, events are stored in `localStorage` under `tele_events` (up to `maxStored` entries). This is the default fallback when any transport fails.

---

## Backend (Node.js / Express)

A minimal reference backend is included in `demo/server.js`. It exposes:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/telemetry` | Receive a batch of events |
| `GET`  | `/events` | Retrieve all stored events |
| `GET`  | `/events/stats` | Event counts by type + session count |
| `DELETE` | `/events/reset` | Clear the store |

```bash
node demo/server.js
# or with a custom port
PORT=4000 node demo/server.js
```

---

## TypeScript

Full types ship with the package — no `@types/` install needed.

```ts
import tele, { TeleEvent, TeleConfig, TeleInstance } from 'telesense';

tele.on('click', (ev: TeleEvent) => {
  console.log(ev.x, ev.y, ev.element?.tag);
});

const cfg: TeleConfig = {
  endpoint: '/telemetry',
  onEvent: (ev: TeleEvent) => updateUI(ev),
};
tele.config(cfg);
```

---

## Local development

```bash
git clone https://github.com/EbParsa/telesense
cd telesense
npm install

# Build (produces dist/)
npm run build

# Build + watch
npm run build:watch

# Tests (23 tests, <1 s)
npm test

# Run the demo with a live backend
npm run demo
# → http://localhost:3000
```

---

## Contributing

1. Fork → branch → PR against `main`.
2. Tests must pass: `npm test`.
3. Keep the minified build under 20 kB.
4. One feature / fix per PR — keep diffs focused.

---

## License

[MIT](LICENSE) © EbParsa
