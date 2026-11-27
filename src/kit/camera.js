// One orthographic camera per scene: zoom (punch-ins) and pan (smash-pans)
// are Tracks, so camera moves are beat-timed springs, never random drift.
import { Track } from './spring.js';

export class Camera {
  constructor({ width, height }) {
    this.w = width;
    this.h = height;
    this.zoom = new Track(1);
    this.x = new Track(0);
    this.y = new Track(0);
    this.rot = new Track(0);
    this.cx = width / 2;
    this.cy = height / 2;
  }
  /** Apply the camera to g at time t (call inside save/restore). */
  apply(g, t, extraZoom = 1) {
    const z = this.zoom.at(t) * extraZoom, r = this.rot.at(t);
    g.translate(this.cx, this.cy);
    if (r) g.rotate(r);
    g.scale(z, z);
    g.translate(-this.cx - this.x.at(t), -this.cy - this.y.at(t));
  }
}
