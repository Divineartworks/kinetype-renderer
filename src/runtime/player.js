// Real-time player shell shared by `kinetype preview` and the single-file
// HTML export. The composition stays a pure seek(t); only this shell knows
// about wall-clock time, keys and audio.
export function mountPlayer(engine, { root = document.body, audio = null, title = '' } = {}) {
  const canvas = engine.canvas;
  const D = engine.duration, fps = engine.fps;
  let playing = true, t0 = performance.now(), offset = 0, hq = false, raf = 0;
  const css = document.createElement('style');
  css.textContent = `
    html,body{margin:0;height:100%;background:#050505;color:#9a9a9a;font:12px/1.2 ui-monospace,Menlo,monospace;overflow:hidden}
    .kt-stage{position:fixed;inset:0;display:grid;place-items:center}
    .kt-stage canvas{max-width:100vw;max-height:calc(100vh - 44px);width:auto;height:auto;aspect-ratio:${engine.W}/${engine.H};display:block}
    .kt-bar{position:fixed;left:0;right:0;bottom:0;height:44px;display:flex;gap:12px;align-items:center;padding:0 14px;background:#0b0b0b;border-top:1px solid #1d1d1d;opacity:.92}
    .kt-bar input{flex:1;accent-color:#e8e8e8}
    .kt-bar button{background:none;border:1px solid #333;color:#ddd;font:inherit;padding:4px 9px;cursor:pointer}
    .kt-t{min-width:150px;text-align:right;font-variant-numeric:tabular-nums}`;
  document.head.appendChild(css);
  const stage = document.createElement('div');
  stage.className = 'kt-stage';
  stage.appendChild(canvas);
  const bar = document.createElement('div');
  bar.className = 'kt-bar';
  bar.innerHTML = `<button data-k="play">❚❚</button><button data-k="hq" title="motion-blur preview (H)">HQ</button><input type="range" min="0" max="${D}" step="${1 / fps}" value="0"><span class="kt-t"></span><span>${title}</span>`;
  root.appendChild(stage);
  root.appendChild(bar);
  const range = bar.querySelector('input'), label = bar.querySelector('.kt-t'), playBtn = bar.querySelector('[data-k=play]'), hqBtn = bar.querySelector('[data-k=hq]');
  const now = () => {
    if (audio && !audio.paused) return audio.currentTime;
    return playing ? offset + (performance.now() - t0) / 1000 : offset;
  };
  const show = (t) => {
    t = engine.loop ? ((t % D) + D) % D : Math.min(Math.max(t, 0), D);
    // footage: request the frames around t; drawing uses whatever is cached
    if (engine.media && engine.prepare) engine.prepare(t, 1, 1).catch(() => {});
    if (hq && !playing) engine.drawBlurred(t, 8, 1);
    else engine.seek(t);
    range.value = t;
    label.textContent = `${t.toFixed(3)}s  f${Math.round(t * fps)}/${engine.frames}`;
    return t;
  };
  const loop = () => {
    let t = now();
    if (!engine.loop && t >= D) { pause(); t = D - 1e-6; }
    show(t);
    if (playing) raf = requestAnimationFrame(loop);
  };
  function play() {
    if (playing) return;
    playing = true;
    t0 = performance.now();
    if (audio) { audio.currentTime = offset; audio.play().catch(() => {}); }
    playBtn.textContent = '❚❚';
    raf = requestAnimationFrame(loop);
  }
  function pause() {
    offset = now();
    playing = false;
    if (audio) audio.pause();
    cancelAnimationFrame(raf);
    playBtn.textContent = '▶';
    show(offset);
  }
  function seek(t) {
    offset = show(t);
    t0 = performance.now();
    if (audio) audio.currentTime = offset;
  }
  playBtn.onclick = () => (playing ? pause() : play());
  hqBtn.onclick = () => { hq = !hq; hqBtn.style.color = hq ? '#fff' : '#666'; if (!playing) show(offset); };
  hqBtn.style.color = '#666';
  range.oninput = () => { if (playing) pause(); seek(Number(range.value)); };
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
    else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      if (playing) pause();
      const step = e.shiftKey ? 60 / (engine.bpm || 120) : 1 / fps;
      seek(offset + (e.code === 'ArrowRight' ? step : -step));
    } else if (e.code === 'KeyH') hqBtn.onclick();
    else if (e.code === 'Home') seek(0);
  });
  if (audio) { audio.currentTime = 0; audio.play().catch(() => { playing = false; playBtn.textContent = '▶'; }); }
  raf = requestAnimationFrame(loop);
  return { play, pause, seek, get time() { return now(); } };
}
