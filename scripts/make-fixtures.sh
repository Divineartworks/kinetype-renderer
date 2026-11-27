#!/usr/bin/env bash
# Regenerates fixtures/click-100bpm.wav and fixtures/footage-abstract.mp4.
# click-100bpm.wav: a 20 s, 44.1 kHz, mono, 16-bit click
# track at 100 BPM. Clicks fall at 0.3 s + 0.6 s * n; every 4th click (the
# downbeat) is louder. Needs ffmpeg only.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ffmpeg -y -v error -f lavfi \
  -i "aevalsrc='if(gte(t,0.3), (0.4+0.6*eq(mod(floor((t-0.3)/0.6),4),0))*exp(-60*mod(t-0.3,0.6))*sin(2*PI*1500*t), 0)':s=44100:d=20" \
  -ac 1 -c:a pcm_s16le "$here/../fixtures/click-100bpm.wav"
echo "wrote fixtures/click-100bpm.wav"

# footage-abstract.mp4: 10 s, 1080x1920, 30 fps, slowly drifting soft colour gradients (no camera footage), used by the
# ascii-cam and kinetic-captions examples as stand-in background video.
ffmpeg -y -v error -f lavfi \
  -i "gradients=s=1080x1920:r=30:d=10:n=4:c0=0x2a1a8a:c1=0x6a1a9a:c2=0x1a3a4a:c3=0xf0d8b0:speed=0.02:seed=7" \
  -vf "gblur=sigma=40,format=yuv420p" -c:v libx264 -preset slow -crf 28 -movflags +faststart \
  "$here/../fixtures/footage-abstract.mp4"
echo "wrote fixtures/footage-abstract.mp4"
