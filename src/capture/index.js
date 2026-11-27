// Public entry points shared by the CLI and the MCP server.
import fs from 'node:fs';
import path from 'node:path';
import { loadFlow, flowProblems } from './flow.js';
import { capture } from './driver.js';
import { validateCaptureFile } from './validate.js';
import { contactSheet } from './sheet.js';

export { validateCaptureFile, contactSheet, flowProblems };

export async function captureFlow(flowFile, { out, baseUrl, fontDirs = [], quality, crf, headed, log, transport, serial } = {}) {
  const { flow, hash } = loadFlow(flowFile);
  if (flow.device?.kind === 'android') {
    // C1 v2: a real device (or its stand-in) — rehearse, then perform natively (src/device)
    const dev = await import('../device/index.js');
    return dev.performFlow(flowFile, { out, baseUrl, log, transport, serial });
  }
  const problems = flowProblems(flow);
  if (problems.length) throw new Error(`invalid flow ${flowFile}:\n  ${problems.join('\n  ')}`);
  const dest = out ? path.resolve(out) : path.resolve('out', 'capture', flow.name);
  fs.mkdirSync(dest, { recursive: true });
  const r = await capture(flow, { out: dest, baseUrl, fontDirs, quality, crf, headed, log, flowHash: hash });
  const v = validateCaptureFile(path.join(dest, 'capture.json'));
  if (v.problems.length) throw new Error(`capture does not satisfy C2:\n  ${v.problems.join('\n  ')}`);
  return {
    out: dest, capture: path.join(dest, 'capture.json'), receipt: path.join(dest, 'receipt.json'),
    frames: r.doc.frames.count, duration: r.doc.duration, fps: r.doc.fps, events: r.doc.events.length, marks: r.doc.marks.length, steps: r.doc.steps.length,
    qa: { droppedFrames: r.receipt.qa.droppedFrames, unchangedFrames: r.receipt.qa.unchangedFrames, cappedSettles: r.receipt.qa.cappedSettles, warnings: r.receipt.qa.warnings, pageErrors: r.receipt.qa.pageErrors, httpErrors: r.receipt.qa.httpErrors },
    wallSeconds: r.receipt.wallSeconds,
  };
}
