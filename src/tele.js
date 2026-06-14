/*!
 * Telesense — Lightweight behavioural telemetry SDK
 * https://github.com/EbParsa/Telesense
 * MIT License
 */
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.tele = factory());
})(this, function () {
  'use strict';

  // ─── defaults ────────────────────────────────────────────────────────────────

  const DEFAULTS = {
    endpoint:        '',          // POST URL e.g. 'https://your-api.com/telemetry'
    supabaseUrl:     '',          // Supabase project URL
    supabaseAnonKey: '',          // Supabase anon key
    flushInterval:   5000,        // ms between auto-flushes
    maxQueue:        500,         // Max events held in memory before forced flush
    maxStored:       20000,       // Max events kept in localStorage fallback
    mouseThrottle:   100,         // ms between mousemove samples
    sessionId:       null,        // Supply your own or one is generated
    capture: {                    // Modify captured events
      click:      true,
      mousemove:  true,
      touchstart: true,
      touchmove:  true,
      touchend:   true,
      scroll:     true,
      keydown:    true,
      keyup:      true,
      visibility: true,
      resize:     true,
    },
    onFlush: null,   // (events: TeleEvent[]) => void — custom transport hook
    onEvent: null,   // (event: TeleEvent) => void — fired for every captured event
  };

  // ─── helpers ─────────────────────────────────────────────────────────────────

  const uid = () => {
    const ts = Date.now().toString(36);

    // Browser/Web Crypto path
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(4);
      globalThis.crypto.getRandomValues(bytes);
      const rand = Array.from(bytes, b => b.toString(36)).join('').slice(0, 6).padEnd(6, '0');
      return `${ts}-${rand}`;
    }

    // Node.js fallback
    if (typeof require === 'function') {
      try {
        const nodeCrypto = require('crypto');
        const bytes = nodeCrypto.randomBytes(4);
        const rand = Array.from(bytes, b => b.toString(36)).join('').slice(0, 6).padEnd(6, '0');
        return `${ts}-${rand}`;
      } catch (e) { /* ignore and use final fallback */ }
    }

    // Final non-crypto fallback for very constrained environments
    return `${ts}-000000`;
  };

  const isSensitive = (el) => {
    if (!el || !el.tagName) return false;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type        || '').toLowerCase();
    const name = (el.name        || '').toLowerCase();
    const id   = (el.id          || '').toLowerCase();
    const ac   = (el.autocomplete|| '').toLowerCase();
    return (tag === 'input' && ['password','email','tel','number'].includes(type))
      || name.includes('card') || id.includes('card') || ac.includes('cc-');
  };

  const elSummary = (el) => (!el || !el.tagName ? null : {
    tag:     el.tagName.toLowerCase(),
    id:      el.id   || null,
    classes: typeof el.className === 'string'
      ? el.className.split(/\s+/).filter(Boolean) : [],
  });

  // Helper function to get touch coordinates
  const getTouchCoords = (touchEvent) => {
    if (!touchEvent.touches || touchEvent.touches.length === 0) {
      return { x: null, y: null };
    }
    const touch = touchEvent.touches[0];
    return {
      x: touch.clientX,
      y: touch.clientY,
      touches: touchEvent.touches.length
    };
  };

  // Helper function to get changed touch for touchend
  const getChangedTouchCoords = (touchEvent) => {
    if (!touchEvent.changedTouches || touchEvent.changedTouches.length === 0) {
      return { x: null, y: null };
    }
    const touch = touchEvent.changedTouches[0];
    return {
      x: touch.clientX,
      y: touch.clientY,
      touches: touchEvent.touches?.length || 0
    };
  };

  // ─── factory ─────────────────────────────────────────────────────────────────

  function createTele(userConfig = {}) {
    const cfg       = Object.assign({}, DEFAULTS, userConfig,
                        { capture: Object.assign({}, DEFAULTS.capture, userConfig.capture) });
    const sessionId = cfg.sessionId || uid();

    let queue      = [];
    let listeners  = {};   // type → [fn, ...]
    let lastMouse  = 0;
    let _flushTimer = null;
    let _attached  = false;

    // ── record ────────────────────────────────────────────────────────────────

    const record = (type, data) => {
      const event = {
        type,
        ts:        Date.now(),
        sessionId,
        page:      location.pathname,
        ...data,
      };

      queue.push(event);
      if (cfg.onEvent) cfg.onEvent(event);
      if (listeners[type]) listeners[type].forEach(fn => fn(event));
      if (listeners['*'])  listeners['*'].forEach(fn => fn(event));

      if (queue.length >= cfg.maxQueue) flush();
    };

    // ── transports ────────────────────────────────────────────────────────────

    const persistLocal = (events) => {
      try {
        const key  = 'tele_events';
        const curr = JSON.parse(localStorage.getItem(key) || '[]');
        localStorage.setItem(key, JSON.stringify(
          curr.concat(events).slice(-cfg.maxStored)
        ));
      } catch (_) {}
    };

    const sendEndpoint = (events, beacon = false) => {
      const body = JSON.stringify({ sessionId, events });
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(cfg.endpoint, new Blob([body], { type: 'application/json' }));
        return;
      }
      fetch(cfg.endpoint, {
        method:    'POST',
        headers:   { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => persistLocal(events));
    };

    const sendSupabase = async (events) => {
      const url  = `${cfg.supabaseUrl}/rest/v1/telemetry_events`;
      const rows = events.map(e => ({ session_id: sessionId, event_json: e }));
      await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey:          cfg.supabaseAnonKey,
          Authorization:  `Bearer ${cfg.supabaseAnonKey}`,
          Prefer:         'return=minimal',
        },
        body:      JSON.stringify(rows),
        keepalive: true,
      });
    };

    // ── flush ─────────────────────────────────────────────────────────────────

    const flush = (beacon = false) => {
      if (!queue.length) return Promise.resolve();
      const events = queue.splice(0);

      if (cfg.onFlush) {
        try { cfg.onFlush(events); } catch (_) {}
        return Promise.resolve();
      }

      if (cfg.endpoint) {
        sendEndpoint(events, beacon);
        return Promise.resolve();
      }

      if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
        return sendSupabase(events).catch(() => persistLocal(events));
      }

      persistLocal(events);
      return Promise.resolve();
    };

    // ── DOM listeners ─────────────────────────────────────────────────────────

    const handlers = {};

    const attach = () => {
      if (_attached) return;
      _attached = true;

      if (cfg.capture.mousemove) {
        handlers.mousemove = (e) => {
          const now = Date.now();
          if (now - lastMouse < cfg.mouseThrottle) return;
          lastMouse = now;
          record('mousemove', { x: e.clientX, y: e.clientY });
        };
        document.addEventListener('mousemove', handlers.mousemove, { passive: true });
      }

      if (cfg.capture.click) {
        handlers.click = (e) => record('click', {
          button:  e.button === 2 ? 'right' : 'left',
          x:       e.clientX,
          y:       e.clientY,
          element: elSummary(e.target),
        });
        handlers.contextmenu = (e) => record('click', {
          button:  'right',
          x:       e.clientX,
          y:       e.clientY,
          element: elSummary(e.target),
        });
        document.addEventListener('click',       handlers.click,       { passive: true });
        document.addEventListener('contextmenu', handlers.contextmenu, { passive: true });
      }

      if (cfg.capture.touchstart) {
        handlers.touchstart = (e) => {
          const coords = getTouchCoords(e);
          record('touchstart', {
            x: coords.x,
            y: coords.y,
            touches: coords.touches,
            element: elSummary(e.target),
          });
        };
        document.addEventListener('touchstart', handlers.touchstart, { passive: true });
      }

      if (cfg.capture.touchmove) {
        handlers.touchmove = (e) => {
          const now = Date.now();
          if (now - lastMouse < cfg.mouseThrottle) return;
          lastMouse = now;

          const coords = getTouchCoords(e);
          record('touchmove', {
            x: coords.x,
            y: coords.y,
            touches: coords.touches,
            element: elSummary(e.target),
          });
        };
        document.addEventListener('touchmove', handlers.touchmove, { passive: true });
      }

      if (cfg.capture.touchend) {
        handlers.touchend = (e) => {
          const coords = getChangedTouchCoords(e);
          record('touchend', {
            x: coords.x,
            y: coords.y,
            touches: coords.touches,
            element: elSummary(e.target),
          });
        };
        document.addEventListener('touchend', handlers.touchend, { passive: true });
      }

      if (cfg.capture.scroll) {
        handlers.scroll = () => {
          const doc  = document.documentElement;
          const maxY = Math.max(1, doc.scrollHeight - window.innerHeight);
          const maxX = Math.max(1, doc.scrollWidth  - window.innerWidth);
          record('scroll', {
            scrollX:  window.scrollX,
            scrollY:  window.scrollY,
            percentX: Math.round((window.scrollX / maxX) * 100),
            percentY: Math.round((window.scrollY / maxY) * 100),
          });
        };
        document.addEventListener('scroll', handlers.scroll, { passive: true });
      }

      if (cfg.capture.keydown) {
        handlers.keydown = (e) => record('keydown', {
          key:    isSensitive(e.target) ? '[masked]' : e.key,
          code:   isSensitive(e.target) ? '[masked]' : e.code,
          target: elSummary(e.target),
        });
        document.addEventListener('keydown', handlers.keydown);
      }

      if (cfg.capture.keyup) {
        handlers.keyup = (e) => record('keyup', {
          key:    isSensitive(e.target) ? '[masked]' : e.key,
          code:   isSensitive(e.target) ? '[masked]' : e.code,
          target: elSummary(e.target),
        });
        document.addEventListener('keyup', handlers.keyup);
      }

      if (cfg.capture.visibility) {
        handlers.visibilitychange = () => record('visibility', {
          state: document.hidden ? 'inactive' : 'active',
        });
        document.addEventListener('visibilitychange', handlers.visibilitychange);
      }

      if (cfg.capture.resize) {
        handlers.resize = () => record('resize', {
          width:  window.innerWidth,
          height: window.innerHeight,
        });
        window.addEventListener('resize', handlers.resize, { passive: true });
      }

      handlers.beforeunload = () => flush(true);
      window.addEventListener('beforeunload', handlers.beforeunload);

      _flushTimer = setInterval(() => flush(false), cfg.flushInterval);
    };

    const detach = () => {
      clearInterval(_flushTimer);
      if (handlers.mousemove)         document.removeEventListener('mousemove',        handlers.mousemove);
      if (handlers.click)             document.removeEventListener('click',            handlers.click);
      if (handlers.touchstart)        document.removeEventListener('touchstart',       handlers.touchstart);
      if (handlers.touchmove)         document.removeEventListener('touchmove',        handlers.touchmove);
      if (handlers.touchend)          document.removeEventListener('touchend',         handlers.touchend);
      if (handlers.contextmenu)       document.removeEventListener('contextmenu',      handlers.contextmenu);
      if (handlers.scroll)            document.removeEventListener('scroll',           handlers.scroll);
      if (handlers.keydown)           document.removeEventListener('keydown',          handlers.keydown);
      if (handlers.keyup)             document.removeEventListener('keyup',            handlers.keyup);
      if (handlers.visibilitychange)  document.removeEventListener('visibilitychange', handlers.visibilitychange);
      if (handlers.resize)            window.removeEventListener( 'resize',            handlers.resize);
      if (handlers.beforeunload)      window.removeEventListener( 'beforeunload',      handlers.beforeunload);
      _attached = false;
    };

    // ── public API ────────────────────────────────────────────────────────────

    const api = {
      /**
       * Subscribe to one event type (or '*' for all).
       * @param {string}   type
       * @param {Function} fn
       */
      on(type, fn) {
        (listeners[type] = listeners[type] || []).push(fn);
        return api;
      },

      /** Remove a specific listener. */
      off(type, fn) {
        if (listeners[type]) listeners[type] = listeners[type].filter(f => f !== fn);
        return api;
      },

      /** Manually record a custom event. */
      track(type, data = {}) {
        record(type, data);
        return api;
      },

      /** Flush the queue immediately. Returns a Promise. */
      flush: () => flush(false),

      /** Return a copy of the current in-memory queue. */
      getQueue: () => [...queue],

      /** Clear the in-memory queue without sending. */
      reset() {
        queue = [];
        return api;
      },

      /** Update config at runtime (e.g. set endpoint after auth). */
      config(patch = {}) {
        Object.assign(cfg, patch);
        if (patch.capture) Object.assign(cfg.capture, patch.capture);
        return api;
      },

      /** Attach DOM listeners (called automatically on init). */
      start: attach,

      /** Remove all DOM listeners and stop auto-flush. */
      stop: detach,

      /** Session id for this instance. */
      get sessionId() { return sessionId; },

      /** SDK version. */
      version: '1.0.0',
    };

    // auto-start
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attach);
    } else {
      attach();
    }

    return api;
  }

  // ─── auto-init from window.TELE_CONFIG ───────────────────────────────────

  const autoConfig = (typeof window !== 'undefined' && window.TELE_CONFIG) || {};
  const defaultInstance = createTele(autoConfig);

  // Expose createTele so advanced users can create isolated instances
  defaultInstance.create = createTele;

  return defaultInstance;
});
