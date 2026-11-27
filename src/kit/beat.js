// Musical time. A BeatGrid maps beats ↔ seconds, either from a constant tempo
// (bpm + downbeat offset) or from a measured beat list (audio analysis), so the
// same template drives a 120 BPM bumper or a rubato lyric video.

export class BeatGrid {
  /**
   * @param {{bpm?:number, offset?:number, beatsPerBar?:number, beats?:number[], downbeats?:number[]}} o
   */
  constructor(o = {}) {
    this.bpm = o.bpm ?? 120;
    this.offset = o.offset ?? 0;
    this.beatsPerBar = o.beatsPerBar ?? 4;
    this.beats = Array.isArray(o.beats) && o.beats.length > 1 ? o.beats.slice().sort((a, b) => a - b) : null;
    this.spb = 60 / this.bpm;
    if (this.beats) {
      const n = this.beats.length;
      this.spb = (this.beats[n - 1] - this.beats[0]) / (n - 1);
      this.bpm = 60 / this.spb;
      this.offset = this.beats[0];
    }
  }
  /** Seconds of beat number n (fractional allowed; n=0 is the downbeat). */
  t(n) {
    if (!this.beats) return this.offset + n * this.spb;
    const b = this.beats, last = b.length - 1;
    if (n <= 0) return b[0] + n * (b[1] - b[0]);
    if (n >= last) return b[last] + (n - last) * (b[last] - b[last - 1]);
    const i = Math.floor(n);
    return b[i] + (n - i) * (b[i + 1] - b[i]);
  }
  /** Beat position (float) at time t. */
  b(t) {
    if (!this.beats) return (t - this.offset) / this.spb;
    const b = this.beats, last = b.length - 1;
    if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]);
    if (t >= b[last]) return last + (t - b[last]) / (b[last] - b[last - 1]);
    let lo = 0, hi = last;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (b[m] <= t) lo = m; else hi = m;
    }
    return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
  }
  /** Seconds of the n-th sixteenth note. */
  s16(n) {
    return this.t(n / 4);
  }
  bar(n) {
    return this.t(n * this.beatsPerBar);
  }
  /** Duration of one beat near beat n (seconds). */
  beatLen(n = 0) {
    return this.t(n + 1) - this.t(n);
  }
  /**
   * Percussive envelope: 1 on each grid hit, exponential decay after.
   * every=1 → every beat, 0.25 → sixteenths, 4 → bars.
   */
  pulse(t, every = 1, decay = 10) {
    const bp = this.b(t) / every;
    if (bp < 0) return 0;
    const since = (bp - Math.floor(bp)) * every * this.beatLen(Math.floor(this.b(t)));
    return Math.exp(-decay * since);
  }
}
