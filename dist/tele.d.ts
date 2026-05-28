// tele.js — TypeScript declarations
// https://github.com/your-org/tele-js

export interface ElementSummary {
  tag: string;
  id: string | null;
  classes: string[];
}

export interface TeleEvent {
  type: string;
  ts: number;
  sessionId: string;
  page: string;
  // click
  button?: 'left' | 'right';
  x?: number;
  y?: number;
  element?: ElementSummary | null;
  // scroll
  scrollX?: number;
  scrollY?: number;
  percentX?: number;
  percentY?: number;
  // keydown / keyup
  key?: string;
  code?: string;
  target?: ElementSummary | '[sensitive]' | null;
  // visibility
  state?: 'active' | 'inactive';
  // resize
  width?: number;
  height?: number;
  // custom — any extra fields from tele.track()
  [key: string]: unknown;
}

export type EventType =
  | 'click'
  | 'mousemove'
  | 'scroll'
  | 'keydown'
  | 'keyup'
  | 'visibility'
  | 'resize'
  | '*'
  | (string & {}); // allow custom event types

export interface CaptureConfig {
  click?: boolean;
  mousemove?: boolean;
  scroll?: boolean;
  keydown?: boolean;
  keyup?: boolean;
  visibility?: boolean;
  resize?: boolean;
}

export interface TeleConfig {
  /** POST endpoint. Body: `{ sessionId, events }` */
  endpoint?: string;
  /** Supabase project URL */
  supabaseUrl?: string;
  /** Supabase anon key */
  supabaseAnonKey?: string;
  /** Auto-flush interval in ms (default: 5000) */
  flushInterval?: number;
  /** Max events held in memory before a forced flush (default: 500) */
  maxQueue?: number;
  /** Max events kept in localStorage fallback (default: 20000) */
  maxStored?: number;
  /** Minimum ms between mousemove samples (default: 100) */
  mouseThrottle?: number;
  /** Supply your own session ID, otherwise one is generated */
  sessionId?: string;
  /** Toggle individual event types */
  capture?: CaptureConfig;
  /**
   * Custom transport — if provided, `endpoint` and `supabase*` are ignored.
   * Called with the batch of events on every flush.
   */
  onFlush?: (events: TeleEvent[]) => void;
  /**
   * Called synchronously for every captured event before it enters the queue.
   * Useful for real-time UI updates.
   */
  onEvent?: (event: TeleEvent) => void;
}

export interface TeleInstance {
  /** Subscribe to an event type. Use `'*'` to receive all events. */
  on(type: EventType, fn: (event: TeleEvent) => void): this;
  /** Unsubscribe a specific listener. */
  off(type: EventType, fn: (event: TeleEvent) => void): this;
  /** Manually record a custom event. */
  track(type: string, data?: Record<string, unknown>): this;
  /** Flush the in-memory queue immediately. Returns a Promise. */
  flush(): Promise<void>;
  /** Return a snapshot of the current in-memory queue. */
  getQueue(): TeleEvent[];
  /** Clear the in-memory queue without sending. */
  reset(): this;
  /** Patch config at runtime (e.g. set endpoint after user auth). */
  config(patch: Partial<TeleConfig>): this;
  /** Re-attach DOM listeners (called automatically on init). */
  start(): void;
  /** Remove all DOM listeners and stop the auto-flush timer. */
  stop(): void;
  /** Session ID for this instance. */
  readonly sessionId: string;
  /** SDK version string. */
  readonly version: string;
  /** Create an isolated second instance with its own queue and config. */
  create(config?: TeleConfig): TeleInstance;
}

/** Auto-initialised default instance (uses `window.TELE_CONFIG` if present). */
declare const tele: TeleInstance;
export default tele;

/** Browser global — available as `window.tele` when using the UMD build. */
declare global {
  interface Window {
    tele: TeleInstance;
    TELE_CONFIG?: TeleConfig;
  }
}
