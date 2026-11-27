#!/usr/bin/env python3
"""Tempo, beats, downbeats, onsets and an energy envelope for kinetype.

Uses beat_this (MIT, SOTA beats+downbeats) when installed, else librosa
(ISC) with a downbeat-phase estimate. Output times are seconds from the
start of the file. Usage: audio_analyze.py <audio> <out.json>
"""
import json, sys
import numpy as np


def _grid_fit(beats, dur):
    """Robust steady-tempo fit with sub-frame period precision.

    Beat trackers place beats on the analysis-frame grid, so inter-beat
    intervals are quantised (e.g. alternating 36/37 frames). Seeding the period
    with the median interval and rounding (t - t0)/period to number the beats
    accumulates that quantisation error over a long track and the fit drifts.
    Instead: number beats by accumulating the ROUNDED RATIO of each interval to
    the median (robust to skipped/doubled beats), then least-squares fit
    offset+period over all beats, drop outliers (>35 ms) and refit.
    Returns (inlier_fraction, rms_ms_of_inliers, period, offset)."""
    b = np.asarray(beats, dtype=float)
    if len(b) < 8:
        return 0.0, 1e9, None, None
    d = np.diff(b)
    per0 = float(np.median(d))
    k = np.concatenate([[0], np.cumsum(np.maximum(1, np.round(d / per0)))])
    keep = np.ones(len(b), bool)
    off = per = None
    for _ in range(3):
        A = np.vstack([np.ones(keep.sum()), k[keep]]).T
        (off, per), *_ = np.linalg.lstsq(A, b[keep], rcond=None)
        res = b - (off + k * per)
        keep = np.abs(res) < 0.035
        if keep.sum() < 6:
            return 0.0, 1e9, None, None
    res = b - (off + k * per)
    inl = np.abs(res) < 0.025
    rms = float(np.sqrt(np.mean(res[inl] ** 2)) * 1000) if inl.any() else 1e9
    return float(inl.mean()), rms, float(per), float(off)


def _track(env, sr, hop):
    import librosa
    tempo, bf = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=hop, tightness=120)
    beats = librosa.frames_to_time(bf, sr=sr, hop_length=hop)
    on = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop, units="time", backtrack=True)
    snapped = []
    for t in beats:  # snap to the attack of the same envelope (tracker lag)
        if len(on):
            j = int(np.argmin(np.abs(on - t)))
            snapped.append(float(on[j]) if abs(on[j] - t) <= 0.07 else float(t))
        else:
            snapped.append(float(t))
    return snapped, bf, beats.tolist()


def analyze(path):
    import librosa
    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = 256  # 11.6 ms resolution
    dur = float(len(y) / sr)
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    env_full = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    # Candidate envelopes. Vocals add onsets that drag a full-band tracker off
    # the drums; the kick band is often cleaner; HPSS helps on some mixes and
    # hurts on others (consonants read as percussive). Measure, don't assume:
    # keep the candidate whose beats sit most consistently on a tempo grid.
    env_low = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S[freqs < 150] + 1e-9), sr=sr, hop_length=hop)
    env_perc = librosa.onset.onset_strength(y=librosa.effects.percussive(y, margin=3.0), sr=sr, hop_length=hop)
    method, beats, downbeats, chosen, raw_beats = None, None, None, None, None
    try:  # optional, best quality on real music
        from beat_this.inference import File2Beats  # type: ignore
        f2b = File2Beats(checkpoint_path="final0", device="cpu", dbn=False)
        b, d = f2b(path)
        beats, downbeats = [float(x) for x in b], [float(x) for x in d]
        method = "beat_this"
    except Exception:
        pass
    if beats is None:
        cands = []
        for name, env in (("full", env_full), ("kick", env_low), ("percussive", env_perc)):
            bt, bf, raw = _track(env, sr, hop)
            frac, rms, per, off = _grid_fit(raw, dur)
            cands.append((frac - rms / 100.0, name, bt, bf, env, raw))
        cands.sort(key=lambda c: -c[0])
        _, chosen, beats, bf, env, raw_beats = cands[0]
        # downbeat phase: beat position (mod 4) carrying the most kick energy
        low = S[freqs < 150].sum(axis=0)
        low = low / (low.max() + 1e-9)
        oe = env_full / (env_full.max() + 1e-9)
        score = []
        for ph in range(4):
            idx = [f for k, f in enumerate(bf) if k % 4 == ph and f < len(low)]
            score.append(float(np.mean([low[f] * 0.7 + oe[f] * 0.3 for f in idx])) if idx else 0.0)
        phase = int(np.argmax(score))
        downbeats = [t for k, t in enumerate(beats) if k % 4 == phase]
        method = "librosa:" + chosen
    grid = None
    frac, rms, per, off = _grid_fit(raw_beats if method.startswith('librosa') else beats, dur)
    if per and method.startswith('librosa') and beats:
        # period from raw tracker beats (unbiased), PHASE from attack-snapped
        # beats: raw beats lag the attack by ~one frame+, snapped ones do not
        sb = np.asarray(beats)
        kk = np.round((sb - off) / per)
        r = sb - (off + kk * per)
        r = r[np.abs(r) < 0.05]
        if len(r) >= 4:
            off += float(np.median(r))
    if per and frac >= 0.75 and rms < 15:
        kmin = int(np.ceil(-off / per - 1e-9))
        kmax = int(np.floor((dur - off) / per))
        fitted = [float(off + i * per) for i in range(kmin, kmax + 1)]
        if downbeats:
            ph = int(round((downbeats[0] - off) / per))
            downbeats = [t for i, t in zip(range(kmin, kmax + 1), fitted) if (i - ph) % 4 == 0]
        beats = fitted
        grid = {"bpm": round(60.0 / per, 4), "offset": round(fitted[0], 4), "inliers": round(frac, 3), "residual_ms": round(rms, 2)}
    bpm = float(60.0 / np.median(np.diff(beats))) if len(beats) > 1 else 0.0
    # Beat salience: onset strength ON the beats vs half a beat off. A real beat
    # track sits on the energy (ratio well above 1); a wrong one does not.
    conf = None
    if len(beats) > 4:
        fr = lambda ts: np.clip(librosa.time_to_frames(np.asarray(ts), sr=sr, hop_length=hop), 0, len(env_full) - 1)
        half = np.median(np.diff(beats)) / 2
        w = max(1, int(round(0.05 * sr / hop)))  # beats sit on the attack; the onset peak follows within ~50 ms
        peak = lambda ts: np.array([env_full[i:i + w + 1].max() for i in fr(ts)])
        on = float(np.mean(peak(beats)))
        off_ = float(np.mean(peak(np.asarray(beats) + half)))
        conf = {"salience_ratio": round(on / (off_ + 1e-9), 3), "grade": "strong" if on / (off_ + 1e-9) >= 1.5 else "ok" if on / (off_ + 1e-9) >= 1.15 else "weak"}
    onsets = librosa.onset.onset_detect(onset_envelope=env_full, sr=sr, hop_length=hop, units="time", backtrack=True).tolist()
    rms_e = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
    db = librosa.amplitude_to_db(rms_e, ref=np.max)
    e = np.clip((db + 40.0) / 40.0, 0, 1)
    e = np.convolve(e, np.ones(5) / 5, mode="same")
    return {
        "kind": "kinetype.audio_analysis.v1",
        "file": path,
        "method": method,
        "duration": round(dur, 4),
        "bpm": round(bpm, 3),
        "grid": grid,
        "confidence": conf,
        "beats": [round(t, 4) for t in beats],
        "downbeats": [round(t, 4) for t in downbeats],
        "onsets": [round(t, 4) for t in onsets],
        "energy": {"hop": hop / sr, "t0": 0.0, "values": [round(float(v), 4) for v in e]},
    }


def write_clicks(path, res, out):
    """The song with a click on every detected beat (downbeats accented):
    the ten-second listening test that decides whether the beats are right."""
    import librosa, soundfile as sf
    y, sr = librosa.load(path, sr=44100, mono=True)
    n = int(0.03 * sr)
    tt = np.arange(n) / sr
    down = set(round(x, 3) for x in res["downbeats"])
    for b in res["beats"]:
        i = int(b * sr)
        if i < 0 or i + n > len(y):
            continue
        f, a = (1800.0, 0.6) if round(b, 3) in down else (1100.0, 0.35)
        y[i:i + n] += a * np.sin(2 * np.pi * f * tt) * np.exp(-tt * 120)
    y = y / max(1.0, float(np.abs(y).max()))
    sf.write(out, y, sr)


if __name__ == "__main__":
    res = analyze(sys.argv[1])
    if len(sys.argv) > 3 and sys.argv[3]:
        write_clicks(sys.argv[1], res, sys.argv[3])
    with open(sys.argv[2], "w") as f:
        json.dump(res, f)
    print(json.dumps({k: res[k] for k in ("method", "bpm", "duration", "grid", "confidence")} | {"beats": len(res["beats"]), "downbeats": len(res["downbeats"])}))
