import { buildPath } from './path.js';

export const SPEEDS = [0.1, 0.5, 1, 2, 5, 10, 30, 60];

export class Player {
  constructor() {
    this.log = null;
    this.path = null;
    this.t = 0;
    this.speed = 1;
    this.playing = false;
    this.keepAlive = false;
    this.kickUntil = 0;
    this.listeners = [];
    this.last = 0;
    this.raf = 0;
    this.onState = null;
    this.frame = this.frame.bind(this);
  }

  onUpdate(fn) {
    this.listeners.push(fn);
  }

  load(log) {
    this.pause();
    this.log = log;
    this.path = buildPath(log);
    this.t = 0;
  }

  get duration() {
    return this.log ? this.log.duration : 0;
  }

  play() {
    if (!this.log || this.playing) return;
    if (this.t >= this.duration) this.t = 0;
    this.playing = true;
    this.ensureLoop();
    this.emitState();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.emitState();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t) {
    if (!this.log) return;
    this.t = Math.min(this.duration, Math.max(0, t));
    this.emit(0, true);
    this.ensureLoop();
  }

  setSpeed(v) {
    this.speed = v;
    this.emitState();
  }

  setKeepAlive(on) {
    this.keepAlive = on;
    if (on) this.ensureLoop();
  }

  kick(ms) {
    this.kickUntil = performance.now() + ms;
    this.ensureLoop();
  }

  ensureLoop() {
    if (this.raf || !this.log) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.raf = 0;
    if (!this.log) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    let moved = false;
    if (this.playing) {
      this.t += dt * this.speed;
      moved = true;
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.playing = false;
        this.emitState();
      }
    }
    this.emit(dt, moved);
    if (this.playing || this.keepAlive || now < this.kickUntil) this.raf = requestAnimationFrame(this.frame);
  }

  emit(dt, moved) {
    const state = this.sample(this.t);
    for (const fn of this.listeners) fn(state, dt, moved);
  }

  emitState() {
    if (this.onState) this.onState(this);
  }

  sample(t) {
    return this.path.at(t);
  }
}
