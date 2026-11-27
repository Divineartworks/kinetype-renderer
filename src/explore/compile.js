// explored plan → kinetype.flow.v1 + director.narration.v1.
// A step's narration describes the screen that is visible AFTER that step's actions, so the mark (the narration anchor,
// contract C2) is placed after the actions: speech never starts before the screen it describes has landed.
import { flowProblems } from '../capture/flow.js';

export const slug = (s) => (String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'demo');
const tgt = (t) => ({ role: t.role, name: t.name, exact: t.exact ?? true });

export function compile({ plan, startUrl, baseUrl, device = 'desktop', name, voice }) {
  const base = new URL(baseUrl);
  const rel = (u) => { const x = new URL(u, base); return x.pathname + x.search + x.hash; };
  const n = slug(name || plan.title || base.host);
  const steps = [{ id: 'open', action: 'goto', url: rel(startUrl), hold: 0.8 }];
  for (const s of plan.steps) {
    const id = slug(s.id);
    (s.do || []).forEach((a, i) => {
      const sid = `${id}-${i + 1}-${a.type}`;
      if (a.type === 'click' || a.type === 'hover') steps.push({ id: sid, action: a.type, target: tgt(a.target) });
      else if (a.type === 'scroll') steps.push(a.target ? { id: sid, action: 'scroll', target: tgt(a.target), duration: 1.1 } : { id: sid, action: 'scroll', by: a.by, duration: 1.1 });
      else if (a.type === 'wait') steps.push({ id: sid, action: 'wait', seconds: Math.min(5, (a.ms || 500) / 1000) });
    });
    steps.push({ id, action: 'mark', label: (s.say || '').slice(0, 70) });
  }
  const flow = {
    schema: 'kinetype.flow.v1', name: n,
    app: { name: (plan.title && plan.title.length <= 60 ? plan.title : base.host), baseUrl: base.origin },
    device: { kind: device },
    fps: 30,
    steps,
  };
  const narration = {
    schema: 'director.narration.v1', flow: n, source: base.origin, voice: voice || { provider: 'auto' },
    lines: plan.steps.filter((s) => s.say).map((s) => ({ step: slug(s.id), mark: slug(s.id), text: s.say })),
  };
  const problems = flowProblems(flow);
  const markIds = new Set(steps.filter((s) => s.action === 'mark').map((s) => s.id));
  for (const l of narration.lines) if (!markIds.has(l.mark)) problems.push(`narration line ${l.step} has no mark`);
  return { flow, narration, problems };
}
