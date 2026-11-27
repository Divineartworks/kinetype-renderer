// Frame-exact clock for a headless Chrome page: the film clock IS the page clock.
//
// Each tick (1) lets exactly 1000/fps ms of *virtual* time pass in the page (timers, rAF, CSS
// animation start times, Date.now, performance.now) and (2) asks the compositor for exactly one
// frame via HeadlessExperimental.beginFrame, with frameTimeTicks advancing by the same amount.
// Nothing depends on how loaded the host is: a slow tick makes the capture take longer, never
// the film look different. Input is dispatched *inside* a tick (Chrome acks it on the next
// begin-frame), so an action lands on a defined frame.
import crypto from 'node:crypto';
import { stats } from './timeline.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

export class FrameClock {
  constructor(cdp, { fps = 30, quality = 94, onFrame = null, budgetWaitMs = 2500, log = null } = {}) {
    this.log = log;
    this.cdp = cdp;
    this.fps = fps;
    this.ms = 1000 / fps;
    // frameTimeTicks is CLOCK_MONOTONIC ms. Animations created before the first begin-frame (page load)
    // start on the real clock; a frame clock that starts in the past would leave them frozen at their
    // first keyframe (half-faded UI). Start one minute ahead of real time so they always complete.
    this.tickBase = Number(process.hrtime.bigint() / 1000000n) + 60000;
    this.quality = quality;
    this.onFrame = onFrame;           // (index, buffer, hash) for every RECORDED frame
    this.budgetWaitMs = budgetWaitMs;
    this.ticks = 0;                   // all ticks, including unrecorded warm-up
    this.base = Infinity;             // tick index of recorded frame 0
    this.last = null;                 // last frame buffer
    this.lastHash = null;
    this.hashes = [];                 // hash of every tick (settle detection), bounded window
    this.unchanged = 0;               // recorded frames with no fresh pixels (previous repeated)
    this.budgetTimeouts = 0;          // ticks whose virtual-time budget never expired in time
    this.beginFrameErrors = 0;
    this.latencies = [];
    this._expired = null;
    cdp.on('Emulation.virtualTimeBudgetExpired', () => this._expired && this._expired());
  }

  async init() {
    await this.cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
  }

  /** Index of the next recorded frame (0 until recording has started). */
  now() { return Number.isFinite(this.base) ? this.ticks - this.base : 0; }
  startRecording() { if (!Number.isFinite(this.base)) this.base = this.ticks; }
  get recording() { return Number.isFinite(this.base); }

  async tick() {
    const t0 = Date.now();
    let fire;
    const expired = new Promise((r) => { fire = r; });
    this._expired = () => fire(false);
    await this.cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: this.ms });
    const timedOut = await Promise.race([expired, sleep(this.budgetWaitMs).then(() => true)]);
    if (timedOut) { this.budgetTimeouts++; this.onStall?.(); }
    let buf = null;
    try {
      const r = await this.cdp.send('HeadlessExperimental.beginFrame', {
        frameTimeTicks: this.tickBase + this.ticks * this.ms, interval: this.ms,
        screenshot: { format: 'jpeg', quality: this.quality },
      });
      if (r.screenshotData) buf = Buffer.from(r.screenshotData, 'base64');
    } catch { this.beginFrameErrors++; }
    const idx = this.ticks - this.base;
    this.ticks++;
    if (buf) { this.last = buf; this.lastHash = sha(buf); }
    else if (this.last && idx >= 0) this.unchanged++;
    this.hashes.push(this.lastHash);
    if (this.hashes.length > 64) this.hashes.shift();
    if (idx >= 0 && this.last) this.onFrame?.(idx, this.last, this.lastHash);
    // observers read the page as it was on this frame (virtual time is paused between ticks)
    if (idx >= 0 && this.afterFrame) await this.afterFrame(idx);
    this.latencies.push(Date.now() - t0);
    if (this.log && this.ticks % 30 === 0) this.log(`tick ${this.ticks} (recorded ${Math.max(0, idx + 1)}) last ${Date.now() - t0} ms, budget timeouts ${this.budgetTimeouts}`);
  }

  async frames(k) { for (let i = 0; i < k; i++) await this.tick(); }

  /** Run fn (an input dispatch / Playwright call that needs frames to complete) inside a tick. */
  async input(fn) {
    let settled = false; let val; let err;
    const pr = Promise.resolve().then(fn).then((v) => { val = v; settled = true; }, (e) => { err = e; settled = true; });
    await this.tick();
    if (!settled) await Promise.race([pr, sleep(1500)]);
    for (let extra = 0; !settled && extra < 200; extra++) { await this.tick(); await Promise.race([pr, sleep(150)]); }
    if (!settled) throw new Error('input did not complete');
    if (err) throw err;
    return val;
  }

  /** Tick until the promise settles (navigation, long loads). */
  async during(promise, { maxTicks = 600 } = {}) {
    let done = false; let err; let val;
    promise.then((v) => { val = v; done = true; }, (e) => { err = e; done = true; });
    for (let i = 0; !done && i < maxTicks; i++) await this.tick();
    if (!done) throw new Error(`still pending after ${maxTicks} frames`);
    if (err) throw err;
    return val;
  }

  /** Last n tick hashes identical (nothing moved on screen for n frames)? */
  stable(n) {
    const h = this.hashes;
    if (h.length < n) return false;
    for (let i = h.length - n; i < h.length; i++) if (h[i] !== h[h.length - 1] || h[i] == null) return false;
    return true;
  }

  report() {
    return { ticks: this.ticks, unchangedFrames: this.unchanged, budgetTimeouts: this.budgetTimeouts, beginFrameErrors: this.beginFrameErrors, tickMs: stats(this.latencies) };
  }
}
