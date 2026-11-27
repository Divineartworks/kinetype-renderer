import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromePath, launch } from '../src/cli/browser.js';
import { check } from '../src/cli/check.js';

// A fake browser that can die (like a Chrome SIGSEGV) during its first context.
// The check must report that one example FAIL and give the next a fresh browser.
function fakeLauncher({ dieOnFirst }) {
  const launched = [];
  const launchFn = async () => {
    const handlers = [];
    let connected = true;
    const die = () => { if (!connected) return; connected = false; handlers.forEach((h) => h()); };
    const b = {
      id: launched.length,
      isConnected: () => connected,
      on: (ev, h) => { if (ev === 'disconnected') handlers.push(h); },
      close: async () => die(),
      newContext: async () => {
        if (!connected) throw new Error('browser.newContext: Target page, context or browser has been closed');
        const page = {
          on() {},
          goto: async () => {},
          waitForFunction: async () => {},
          evaluate: async (_fn, arg) => {
            if (dieOnFirst && b.id === 0) { die(); throw new Error('page.evaluate: Target crashed'); }
            return typeof arg === 'number' ? 7 : { duration: 2, fps: 30, frames: 60, missingGlyphs: {} };
          },
        };
        return { newPage: async () => page, close: async () => {} };
      },
    };
    launched.push(b);
    return b;
  };
  return { launchFn, launched };
}

test('check: a browser crash fails only that example; the next gets a fresh browser', async () => {
  const { launchFn, launched } = fakeLauncher({ dieOnFirst: true });
  const { results } = await check({ only: 'ascii-cam', log: () => {}, launch: launchFn });
  assert.equal(results.length, 3);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /Target crashed/);
  assert.deepEqual(results.slice(1).map((r) => [r.ok, r.error]), [[true, undefined], [true, undefined]]);
  assert.equal(launched.length, 2);
});

test('check: a healthy browser is reused, not relaunched per example', async () => {
  const { launchFn, launched } = fakeLauncher({ dieOnFirst: false });
  const { results } = await check({ only: 'ascii-cam', log: () => {}, launch: launchFn });
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.equal(launched.length, 1);
});

test('check: real Chrome killed after the first example still checks the rest', { skip: !chromePath() && 'no Chrome', timeout: 600000 }, async () => {
  const launched = [];
  const killer = async () => {
    const b = await launch();
    launched.push(b);
    if (launched.length === 1) {
      // take this browser down right after its first context closes
      const orig = b.newContext.bind(b);
      b.newContext = async (...a) => {
        const ctx = await orig(...a);
        const close = ctx.close.bind(ctx);
        ctx.close = async () => {
          await close();
          await b.close(); // stands in for the Chrome SIGSEGV: the browser is gone mid-check
        };
        return ctx;
      };
    }
    return b;
  };
  const { results } = await check({ only: 'ascii-cam', log: () => {}, launch: killer });
  assert.equal(results.length, 3);
  assert.ok(results.slice(1).every((r) => r.ok), JSON.stringify(results.map((r) => [r.example, r.ok, r.error])));
  assert.equal(launched.length, 2);
});
