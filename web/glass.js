// glass.js — Liquid Glass for Web: physical Snell displacement filter (Chromium)
// + interactive touch specular glow & graceful WebKit/Firefox fallback.

const bevel = (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25);

function sdRoundRect(px, py, hw, hh, r) {
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

export function glassDisplacementMap({ width, height, radius, bezel: bz = 14, thickness = 14, ior = 1.5 }) {
  const w = Math.max(16, Math.round(width));
  const h = Math.max(16, Math.round(height));
  const r = Math.min(radius, w / 2, h / 2);
  const hw = w / 2;
  const hh = h / 2;
  const dx = new Float32Array(w * h);
  const dy = new Float32Array(w * h);
  let maxShift = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw;
      const py = y + 0.5 - hh;
      const d = -sdRoundRect(px, py, hw, hh, r);
      if (d <= 0 || d >= bz) continue;
      const u = d / bz;
      const e = 1e-3;
      const slope = (thickness / bz) * (bevel(Math.min(1, u + e)) - bevel(Math.max(0, u - e))) / (2 * e);
      const t1 = Math.atan(slope);
      const t2 = Math.asin(Math.sin(t1) / ior);
      const shift = thickness * bevel(u) * Math.tan(t1 - t2);
      const gx = sdRoundRect(px + 0.5, py, hw, hh, r) - sdRoundRect(px - 0.5, py, hw, hh, r);
      const gy = sdRoundRect(px, py + 0.5, hw, hh, r) - sdRoundRect(px, py - 0.5, hw, hh, r);
      const gl = Math.hypot(gx, gy) || 1;
      const idx = y * w + x;
      dx[idx] = (-gx / gl) * shift;
      dy[idx] = (-gy / gl) * shift;
      if (shift > maxShift) maxShift = shift;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const k = maxShift > 0 ? 127 / maxShift : 0;
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4 + 0] = Math.round(128 + dx[i] * k);
    img.data[i * 4 + 1] = Math.round(128 + dy[i] * k);
    img.data[i * 4 + 2] = 128;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), scale: 2 * maxShift, maxShift };
}

export function supportsBackdropUrl() {
  const brands = navigator.userAgentData?.brands ?? [];
  return brands.some((b) => b.brand === 'Chromium') && CSS.supports('backdrop-filter', 'blur(1px)');
}

export async function installGlassFilter(id, opts) {
  const { url, scale } = glassDisplacementMap(opts);
  // Pre-decode map image so Chromium never paints an empty first frame
  const probe = new Image();
  probe.src = url;
  try {
    await probe.decode();
  } catch {}

  const NS = 'http://www.w3.org/2000/svg';
  let svg = document.getElementById(`${id}-svg`);
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.id = `${id}-svg`;
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';
    document.body.appendChild(svg);
  }
  const w = Math.round(opts.width);
  const h = Math.round(opts.height);
  svg.innerHTML = `
    <filter id="${id}" x="0" y="0" width="${w}" height="${h}"
            filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feImage href="${url}" x="0" y="0" width="${w}" height="${h}"
               preserveAspectRatio="none" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale.toFixed(2)}"
                         xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;
  return id;
}

/**
 * Enhances a `.lg` functional surface with Chromium refraction (when supported)
 * and interactive touch-point inner glow (spreading from fingertip).
 */
export function enhanceLiquidGlass(el, filterId) {
  if (!el) return;
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const contrastMQ = window.matchMedia('(prefers-contrast: more)');
  const transMQ = window.matchMedia('(prefers-reduced-transparency: reduce)');

  const updateGlow = (e, active) => {
    if (reduceMQ.matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && e) {
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty('--glow-x', `${Math.max(0, Math.min(100, x)).toFixed(1)}%`);
      el.style.setProperty('--glow-y', `${Math.max(0, Math.min(100, y)).toFixed(1)}%`);
    }
    el.style.setProperty('--glow', active ? '1' : '0');
  };

  el.addEventListener('pointerdown', (e) => updateGlow(e, true));
  el.addEventListener('pointermove', (e) => {
    if (e.buttons > 0) updateGlow(e, true);
  });
  const clear = () => el.style.setProperty('--glow', '0');
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointercancel', clear);
  el.addEventListener('pointerleave', clear);

  // Install Snell refraction filter on Chromium (limit to key functional chrome)
  if (filterId && supportsBackdropUrl() && !contrastMQ.matches && !transMQ.matches) {
    let resizeTimer = 0;
    const build = async () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 32 || rect.height < 32) return;
      await installGlassFilter(filterId, {
        width: rect.width,
        height: rect.height,
        radius: rect.height / 2,
        bezel: 14,
        thickness: 14,
        ior: 1.5,
      });
      el.style.setProperty('--lg-filter', `url(#${filterId})`);
      el.classList.add('has-refraction');
    };
    requestAnimationFrame(build);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(build, 220);
      });
      ro.observe(el);
    }
  }
}
