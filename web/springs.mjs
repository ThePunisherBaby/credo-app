// springs.mjs — Verified Apple-grade spring physics (WWDC18/WWDC23/SwiftUI.Spring)
// Mass = 1.0 (matches SwiftUI Spring and Jetpack Compose).

const TAU = 2 * Math.PI;

/** Apple (duration, bounce) -> physical { mass, stiffness, damping, dampingRatio, response }. */
export function fromDurationBounce(duration, bounce = 0) {
  const stiffness = (TAU / duration) ** 2;
  const dampingRatio = bounce >= 0 ? 1 - bounce : 1 / (1 + bounce);
  const damping =
    bounce >= 0
      ? ((1 - bounce) * 4 * Math.PI) / duration
      : (4 * Math.PI) / (duration * (1 + bounce));
  return { mass: 1, stiffness, damping, dampingRatio, response: duration };
}

/** Apple classic (response, dampingFraction) -> physical. */
export function fromResponseDamping(response, dampingRatio) {
  const stiffness = (TAU / response) ** 2;
  const damping = (4 * Math.PI * dampingRatio) / response;
  const bounce = dampingRatio <= 1 ? 1 - dampingRatio : 1 / dampingRatio - 1;
  return { mass: 1, stiffness, damping, dampingRatio, response, duration: response, bounce };
}

/** Momentum projection (WWDC18). velocity in px/s; decelerationRate = 0.998 normal, 0.99 fast. */
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** UIScrollView rubber band resistance (c = 0.55). */
export function rubberBand(x, d, c = 0.55) {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  return sign * (1 - 1 / ((ax * c) / d + 1)) * d;
}

/** Analytical damped harmonic oscillator state { y, v } relative to target. */
export function springState(t, y0, v0, { stiffness, damping, mass = 1 }) {
  if (t <= 0) return { y: y0, v: v0 };
  const w = Math.sqrt(stiffness / mass);
  const z = damping / (2 * Math.sqrt(stiffness * mass));
  if (Math.abs(z - 1) < 1e-6) {
    const e = Math.exp(-w * t);
    const C = v0 + w * y0;
    return { y: (y0 + C * t) * e, v: (C - w * (y0 + C * t)) * e };
  }
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const A = y0;
    const B = (v0 + z * w * y0) / wd;
    const e = Math.exp(-z * w * t);
    const c = Math.cos(wd * t);
    const s = Math.sin(wd * t);
    const y = e * (A * c + B * s);
    const v = e * ((B * wd - z * w * A) * c - (A * wd + z * w * B) * s);
    return { y, v };
  }
  const q = Math.sqrt(z * z - 1);
  const r1 = -w * (z - q);
  const r2 = -w * (z + q);
  const C1 = (v0 - r2 * y0) / (r1 - r2);
  const C2 = y0 - C1;
  return {
    y: C1 * Math.exp(r1 * t) + C2 * Math.exp(r2 * t),
    v: C1 * r1 * Math.exp(r1 * t) + C2 * r2 * Math.exp(r2 * t),
  };
}

/** Interruptible 1D spring animator with velocity-preserving retargeting. */
export class SpringValue {
  constructor(value, params = fromDurationBounce(0.5, 0)) {
    this.params = params;
    this.target = value;
    this.y0 = 0;
    this.v0 = 0;
    this.t0 = 0;
  }

  sample(now) {
    const { y, v } = springState(now - this.t0, this.y0, this.v0, this.params);
    return { value: this.target + y, velocity: v };
  }

  retarget(target, now, params = this.params, velocityOverride) {
    const { value, velocity } = this.sample(now);
    this.params = params;
    this.target = target;
    this.t0 = now;
    this.y0 = value - target;
    this.v0 = velocityOverride ?? velocity;
  }

  set(value, now) {
    this.target = value;
    this.y0 = 0;
    this.v0 = 0;
    this.t0 = now;
  }

  isSettled(now, eps = 0.5, vEps = 5) {
    const { value, velocity } = this.sample(now);
    return Math.abs(value - this.target) < eps && Math.abs(velocity) < vEps;
  }
}

export const MOTION = {
  standard: fromDurationBounce(0.5, 0),
  snappy: fromDurationBounce(0.46, 0.16),
  bouncy: fromDurationBounce(0.48, 0.28),
  interactive: fromResponseDamping(0.15, 0.86),
  momentum: fromResponseDamping(0.45, 0.8),
  micro: fromDurationBounce(0.28, 0),
  microSnappy: fromDurationBounce(0.3, 0.18),
  large: fromDurationBounce(0.56, 0),
  island: fromDurationBounce(0.44, 0.2),
};

/**
 * Apple Dynamic Island Liquid Glass Sliding Pill Indicator.
 * Glides on GPU compositor (translate3d + subtle velocity-based elastic stretch)
 * with 100% interruptible velocity-preserving spring retargeting.
 */
export function createSpringPill(containerEl, indicatorEl) {
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sx = new SpringValue(0, MOTION.island);
  const sw = new SpringValue(0, MOTION.snappy);
  let initialized = false;
  let raf = 0;

  const paint = (x, w, vx = 0) => {
    if (w <= 0) return;
    const speed = Math.abs(vx);
    // Subtle Apple motion-stretching (area-conserving) while flying between tabs
    const stretch = reduceMQ.matches ? 1 : 1 + 0.065 * Math.min(speed / 1500, 1);
    const squash = 1 / stretch;
    indicatorEl.style.width = `${w.toFixed(1)}px`;
    indicatorEl.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0) scale(${stretch.toFixed(4)}, ${squash.toFixed(4)})`;
    indicatorEl.style.opacity = '1';
  };

  const tick = (ms) => {
    const now = ms / 1000;
    const xS = sx.sample(now);
    const wS = sw.sample(now);
    if (sx.isSettled(now, 0.25, 3) && sw.isSettled(now, 0.25, 3)) {
      paint(sx.target, sw.target, 0);
      raf = 0;
      return;
    }
    paint(xS.value, wS.value, xS.velocity);
    raf = requestAnimationFrame(tick);
  };

  return {
    moveTo(targetEl, immediate = false) {
      if (!targetEl || !containerEl || !indicatorEl) return;
      const cRect = containerEl.getBoundingClientRect();
      const tRect = targetEl.getBoundingClientRect();
      if (tRect.width < 10 || cRect.width < 10) return;
      const targetX = tRect.left - cRect.left;
      const targetW = tRect.width;
      const now = performance.now() / 1000;

      if (!initialized || immediate || reduceMQ.matches) {
        initialized = true;
        cancelAnimationFrame(raf);
        raf = 0;
        sx.set(targetX, now);
        sw.set(targetW, now);
        paint(targetX, targetW, 0);
        return;
      }

      sx.retarget(targetX, now, MOTION.island);
      sw.retarget(targetW, now, MOTION.snappy);
      if (!raf) raf = requestAnimationFrame(tick);
    },
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/**
 * Delegated 120Hz Apple touch-down tactile micro-spring compression.
 * Instant frame-0 press feedback without layout thrash.
 */
export function attachSpringPress(rootEl = document.body) {
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const selector = '.btn, .chip, .station-card, .entity-row, .story-item, .pray-candle-btn, .act-btn';
  let activeEl = null;

  const release = () => {
    if (!activeEl) return;
    activeEl.classList.remove('is-pressed');
    activeEl = null;
  };

  rootEl.addEventListener(
    'pointerdown',
    (e) => {
      if (reduceMQ.matches || (e.button && e.button !== 0)) return;
      const el = e.target.closest(selector);
      if (!el) return;
      activeEl = el;
      el.classList.add('is-pressed');
    },
    { passive: true }
  );
  rootEl.addEventListener('pointerup', release, { passive: true });
  rootEl.addEventListener('pointercancel', release, { passive: true });
}

/**
 * Interactive 1:1 drag-to-dismiss sheet with 10pt hysteresis, rubber band,
 * momentum projection, and velocity-preserving spring handoff.
 */
export function attachDismissableSheet(sheetEl, handleEl, { onDismiss, onProgress } = {}) {
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sv = new SpringValue(0, MOTION.large);
  let dragging = false;
  let engaged = false;
  let startY = 0;
  let raw = 0;
  let lastY = 0;
  let samples = [];
  let raf = 0;

  const paint = (y) => {
    sheetEl.style.transform = `translate3d(0, ${y}px, 0)`;
    if (onProgress) {
      const h = Math.max(sheetEl.offsetHeight || window.innerHeight, 300);
      onProgress(Math.max(0, Math.min(1, y / h)));
    }
  };

  const stopAnim = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const animateTo = (target, velocity = 0, dismissAfter = false) => {
    stopAnim();
    const now = performance.now() / 1000;
    const current = sv.sample(now).value;
    const toward = (target - current) * velocity > 0;
    const params = reduceMQ.matches
      ? MOTION.micro
      : fromDurationBounce(0.46, toward ? 0.16 : 0);
    sv.retarget(target, now, params, reduceMQ.matches ? 0 : velocity);

    const tick = (ms) => {
      const t = ms / 1000;
      if (sv.isSettled(t, 0.75, 8)) {
        paint(sv.target);
        raf = 0;
        if (dismissAfter && onDismiss) onDismiss();
        return;
      }
      paint(sv.sample(t).value);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  handleEl.style.touchAction = 'none';

  const onDown = (e) => {
    if (e.button && e.button !== 0) return;
    stopAnim();
    const now = performance.now() / 1000;
    const cur = sv.sample(now).value;
    sv.set(cur, now);
    dragging = true;
    engaged = false;
    startY = e.clientY;
    raw = cur;
    lastY = e.clientY;
    samples = [{ t: e.timeStamp, y: raw }];
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {}
  };

  const onMove = (e) => {
    if (!dragging) return;
    const dyTotal = e.clientY - startY;
    if (!engaged && Math.abs(dyTotal) < 10) return;
    engaged = true;

    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events) {
      raw += ev.clientY - lastY;
      lastY = ev.clientY;
      samples.push({ t: ev.timeStamp, y: raw });
    }
    samples = samples.filter((s) => e.timeStamp - s.t <= 100);
    const dim = Math.max(window.innerHeight, 600);
    const y = raw < 0 ? rubberBand(raw, dim * 0.45) : raw;
    sv.set(y, performance.now() / 1000);
    paint(y);
  };

  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    if (!engaged) return;

    const recent = samples.filter((s) => e.timeStamp - s.t <= 100);
    const a = recent[0];
    const b = recent[recent.length - 1];
    const stopped = !b || e.timeStamp - b.t > 55;
    const v = stopped || !a || b.t === a.t ? 0 : ((b.y - a.y) / (b.t - a.t)) * 1000;

    const now = performance.now() / 1000;
    const cur = sv.sample(now).value;
    const h = Math.max(sheetEl.offsetHeight || window.innerHeight, 400);
    const projected = cur + project(v, 0.992);

    if (projected > h * 0.38 || v > 650) {
      animateTo(h + 24, v, true);
    } else {
      animateTo(0, v, false);
    }
  };

  handleEl.addEventListener('pointerdown', onDown);
  handleEl.addEventListener('pointermove', onMove);
  handleEl.addEventListener('pointerup', onUp);
  handleEl.addEventListener('pointercancel', onUp);

  return {
    open() {
      stopAnim();
      const h = Math.max(sheetEl.offsetHeight || window.innerHeight, 500);
      const now = performance.now() / 1000;
      if (reduceMQ.matches) {
        sv.set(0, now);
        paint(0);
      } else {
        sv.set(h * 0.35, now);
        paint(h * 0.35);
        animateTo(0, -180, false);
      }
    },
    close() {
      const h = Math.max(sheetEl.offsetHeight || window.innerHeight, 500);
      if (reduceMQ.matches) {
        if (onDismiss) onDismiss();
      } else {
        animateTo(h + 24, 300, true);
      }
    },
    reset() {
      stopAnim();
      sv.set(0, performance.now() / 1000);
      paint(0);
    },
    destroy() {
      stopAnim();
      handleEl.removeEventListener('pointerdown', onDown);
      handleEl.removeEventListener('pointermove', onMove);
      handleEl.removeEventListener('pointerup', onUp);
      handleEl.removeEventListener('pointercancel', onUp);
    },
  };
}
