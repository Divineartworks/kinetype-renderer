// Builds the C2 capture document (kinetype.capture.v1) from what the driver recorded.
// Pure: the driver feeds it frame-indexed observations; times become seconds on the capture clock.
import { secondsOf } from './timeline.js';

export class Recorder {
  constructor({ fps }) {
    this.fps = fps;
    this.events = [];
    this.marks = [];
    this.steps = [];
    this._open = null;
  }
  t(frame) { return secondsOf(frame, this.fps); }
  beginStep(id, frame, meta = {}) { this._open = { id, t0: this.t(frame), ...meta }; }
  endStep(frame) {
    if (!this._open) throw new Error('endStep without beginStep');
    const { id, t0 } = this._open;
    this.steps.push({ id, t0, t1: Math.max(t0, this.t(frame)) });
    this._open = null;
  }
  mark(id, frame) { this.marks.push({ t: this.t(frame), id }); }
  /** type: click | hover | move | type | fill | press | scroll | navigate */
  event(type, frame, data = {}) {
    const e = { t: this.t(frame), type, step: this._open?.id, ...data };
    if (e.step === undefined) delete e.step;
    this.events.push(e);
    return e;
  }
  /** Close the last navigate/typing windows etc. is the driver's job; here only ordering is enforced. */
  finish() {
    this.events.sort((a, b) => a.t - b.t);
    return { events: this.events, marks: this.marks, steps: this.steps };
  }
}

const r1 = (n) => Math.round(n * 100) / 100;
export const boxOf = (b) => ({ x: r1(b.x), y: r1(b.y), w: r1(b.width ?? b.w), h: r1(b.height ?? b.h) });
export const centerOf = (b) => ({ x: r1(b.x + (b.width ?? b.w) / 2), y: r1(b.y + (b.height ?? b.h) / 2) });

export function buildCapture({ flow, rec, frameCount, frameSize, video }) {
  const { events, marks, steps } = rec.finish();
  return {
    schema: 'kinetype.capture.v1',
    flow: flow.name,
    app: { name: flow.app.name, baseUrl: flow.app.baseUrl, ...(flow.app.commit ? { commit: flow.app.commit } : {}) },
    device: { kind: flow.device.kind, viewport: flow.device.viewport, deviceScaleFactor: flow.device.deviceScaleFactor },
    fps: flow.fps,
    duration: secondsOf(frameCount, flow.fps),
    frames: { dir: 'frames', pattern: 'f%06d.jpg', count: frameCount, width: frameSize.width, height: frameSize.height },
    video,
    events,
    marks,
    steps,
  };
}
