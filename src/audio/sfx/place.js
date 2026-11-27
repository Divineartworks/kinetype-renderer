// Event -> SFX cue placement. Pure function; events are FILM-time (already retimed by the caller).
import { hash, mulberry32 } from '../../kit/rng.js';

const MIN_GAP = { key: 0.028, default: 0.03 };
const pan = (seed, w = 0.15) => (hash(seed, 'pan') / 4294967296 * 2 - 1) * w;

/**
 * events: [{t, type:'click'|'tap'|'type'|'swipe'|'scroll'|'mark'|'cut', t1?, text?, keys?:[{t,ch}],
 *           kind?:'payoff'|'notify'|'success'|'counter', count?}]
 * opts: {seed=1, cutSounds=false, exclude:[[t0,t1]]}
 * returns cues [{t, sound, seed, gain, dur?, pan?, ch?}] sorted by t.
 */
export function placeSfx(events = [], opts = {}) {
  const base = opts.seed ?? 1, excl = opts.exclude ?? [];
  const raw = [];
  const add = (c) => raw.push(c);
  events.forEach((e, ei) => {
    const s = (...k) => hash(base, ei, ...k);
    const t = e.t, t1 = e.t1 ?? t;
    switch (e.type) {
      case 'click': case 'tap':
        add({ t, sound: 'tap', seed: s('tap'), gain: 1, pan: pan(s('tap')) });
        break;
      case 'type': {
        let ks = e.keys;
        if (!ks || !ks.length) {
          const chars = [...(e.text ?? '')];
          const r = mulberry32(s('jit')), n = chars.length, span = Math.max(0, t1 - t);
          ks = chars.map((ch, i) => ({ t: Math.max(t, t + (n > 1 ? span * i / (n - 1) : 0) + (r() * 2 - 1) * 0.012), ch }));
        }
        ks.forEach((k, i) => {
          const sd = s('key', i), kind = k.ch === ' ' ? 0.75 : (k.ch === '\b' || k.ch === '\n') ? 1.1 : 1;
          add({ t: k.t, sound: 'key', ch: k.ch, seed: sd, gain: kind * (0.9 + 0.1 * (hash(sd, 'g') / 4294967296)), pan: pan(sd) });
        });
        break;
      }
      case 'swipe': case 'scroll':
        add({ t, sound: 'swipe', seed: s('swipe'), gain: 1, dur: Math.max(0.15, Math.min(0.5, t1 - t || 0.3)) });
        break;
      case 'mark':
        if (e.kind === 'notify') add({ t, sound: 'notify', seed: s('notify'), gain: 1 });
        else if (e.kind === 'success' || e.kind === 'payoff') add({ t, sound: 'success', seed: s('success'), gain: 1 });
        else if (e.kind === 'coin') add({ t, sound: 'coin', seed: s('coin'), gain: 1 });
        else if (e.kind === 'counter') {
          const n = Math.max(1, e.count ?? 10), end = t1 > t ? t1 : t + 0.8;
          for (let i = 0; i < n; i++) add({ t: t + (end - t) * (n > 1 ? i / (n - 1) : 0), sound: 'tick', seed: s('tick', i), gain: 0.8 + 0.2 * (i / n), pan: pan(s('tick', i), 0.08) });
        }
        break;
      case 'cut':
        if (opts.cutSounds) add({ t, sound: 'whoosh-cut', seed: s('cut'), gain: 1, dur: 0.35 });
        break;
    }
  });
  raw.sort((a, b) => a.t - b.t || (a.sound < b.sound ? -1 : 1));
  const last = {}, out = [];
  for (const c of raw) {
    if (c.t < 0 || excl.some(([a, b]) => c.t >= a && c.t <= b)) continue;
    const gap = MIN_GAP[c.sound] ?? MIN_GAP.default;
    if (last[c.sound] !== undefined && c.t - last[c.sound] < gap) continue;
    last[c.sound] = c.t;
    out.push(c);
  }
  return out;
}
