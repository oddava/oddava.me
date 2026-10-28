/**
 * Two canvases: the star field behind the page (twinkle, purr rings) and a
 * transparent layer in front of it for the sparkle when the paw catches the
 * cursor. Both cap their backing store at DPR 2 and only redraw when
 * something on them is changing. Starlight is the site's blue-white only.
 */

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  phase: number;
  speed: number;
  twinkles: boolean;
  sparkle: boolean;
}

interface Ring {
  x: number;
  y: number;
  born: number;
  life: number;
  strength: number;
  reach: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  r: number;
  delay: number;
  born: number;
  life: number;
  hold: number;
}

/** Sparkle dust and the sleeping cat's drifting "z"s. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  glyph?: string;
  sway: number;
}

/** --color-text-interactive-hover (#d6e4ff) and --color-brand (#7aa7ff). */
const STAR = '214, 228, 255';
const BRAND = '122, 167, 255';

/** Seeded PRNG so the sky is the same constellation on every visit. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fit(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function sparkleAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  a: number,
  rgb: string,
) {
  ctx.fillStyle = `rgba(${rgb}, ${(a * 0.22).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
  const k = r * 2.4;
  ctx.beginPath();
  ctx.moveTo(x, y - k);
  ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.quadraticCurveTo(x, y, x, y + k);
  ctx.quadraticCurveTo(x, y, x - k, y);
  ctx.quadraticCurveTo(x, y, x, y - k);
  ctx.fill();
}

export function createSky(
  skyCanvas: HTMLCanvasElement,
  fxCanvas: HTMLCanvasElement,
) {
  let w = 0;
  let h = 0;
  let sky: CanvasRenderingContext2D | null = null;
  let fx: CanvasRenderingContext2D | null = null;
  let stars: Star[] = [];
  const rings: Ring[] = [];
  const motes: Mote[] = [];
  const particles: Particle[] = [];
  let lastStars = -Infinity;
  /** The area the particles covered last frame: the only part to clear. */
  let fxBox: [number, number, number, number] | null = null;
  let box: [number, number, number, number] = [0, 0, 0, 0];
  const grow = (x: number, y: number, pad: number) => {
    box[0] = Math.min(box[0], x - pad);
    box[1] = Math.min(box[1], y - pad);
    box[2] = Math.max(box[2], x + pad);
    box[3] = Math.max(box[3], y + pad);
  };

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    sky = fit(skyCanvas, w, h);
    fx = fit(fxCanvas, w, h);
    const rand = mulberry32(7);
    const count = Math.round(Math.min(260, (w * h) / 6800));
    // The type column stays clear of bright sparkles: next to a line of
    // text one reads as a stray bullet, not a star.
    const column = Math.min(340, w * 0.46);
    stars = Array.from({ length: count }, () => {
      const x = rand() * w;
      const y = rand() * h;
      const big = rand() < 0.07 && Math.abs(x - w / 2) > column;
      return {
        x,
        y,
        r: big ? 1.1 + rand() * 0.8 : 0.35 + rand() ** 2 * 0.9,
        a: big ? 0.75 : 0.18 + rand() * 0.5,
        phase: rand() * Math.PI * 2,
        speed: 0.6 + rand() * 1.6,
        twinkles: rand() < 0.45,
        sparkle: big,
      };
    });
    lastStars = -Infinity;
    paintStill();
  }

  const ringRadius = (ring: Ring, age: number) =>
    ring.reach * (1 - (1 - age) ** 2.4);

  /** Stars that never change, drawn once; only twinklers redraw. */
  let fixedLayer: HTMLCanvasElement | null = null;

  function paintStill() {
    fixedLayer = document.createElement('canvas');
    fixedLayer.width = skyCanvas.width;
    fixedLayer.height = skyCanvas.height;
    const ctx = fixedLayer.getContext('2d')!;
    ctx.setTransform(skyCanvas.width / w, 0, 0, skyCanvas.height / h, 0, 0);
    const keep = sky;
    sky = ctx;
    drawStars(0, true, (s) => !s.twinkles);
    sky = keep;
  }

  function drawStars(
    now: number,
    frozen: boolean,
    only?: (s: Star) => boolean,
  ) {
    if (!sky) return;
    // No ring passing: blit the fixed stars and redraw only the twinklers.
    const cached = !only && !rings.length && fixedLayer && !frozen;
    sky.clearRect(0, 0, w, h);
    if (cached) sky.drawImage(fixedLayer!, 0, 0, w, h);
    const t = now / 1000;
    for (const s of stars) {
      if (only ? !only(s) : cached && !s.twinkles) continue;
      let a = s.a;
      if (s.twinkles && !frozen)
        a *= 0.62 + 0.38 * Math.sin(t * s.speed + s.phase);
      // A purr ring passing over a star makes it flare.
      let flare = 0;
      for (const ring of rings) {
        const age = (now - ring.born) / ring.life;
        if (age < 0 || age > 1) continue;
        const d =
          Math.hypot(s.x - ring.x, s.y - ring.y) - ringRadius(ring, age);
        flare += Math.exp(-(d * d) / 500) * (1 - age) * ring.strength;
      }
      a = Math.min(1, a + flare * 0.9);
      const r = s.r * (1 + flare * 1.3);
      sky.fillStyle = `rgba(${STAR}, ${a.toFixed(3)})`;
      if (s.sparkle || r > 1.6) {
        const k = r * 2.6;
        sky.beginPath();
        sky.moveTo(s.x, s.y - k);
        sky.quadraticCurveTo(s.x, s.y, s.x + k, s.y);
        sky.quadraticCurveTo(s.x, s.y, s.x, s.y + k);
        sky.quadraticCurveTo(s.x, s.y, s.x - k, s.y);
        sky.quadraticCurveTo(s.x, s.y, s.x, s.y - k);
        sky.fill();
      }
      sky.beginPath();
      sky.arc(s.x, s.y, r, 0, Math.PI * 2);
      sky.fill();
    }
    for (const ring of rings) {
      const age = (now - ring.born) / ring.life;
      if (age < 0 || age > 1) continue;
      // A hairline with a faint halo: felt more than seen.
      const fade = ring.strength * (1 - age) ** 1.8;
      sky.beginPath();
      sky.arc(ring.x, ring.y, ringRadius(ring, age), 0, Math.PI * 2);
      sky.strokeStyle = `rgba(${BRAND}, ${(0.05 * fade).toFixed(3)})`;
      sky.lineWidth = 10;
      sky.stroke();
      sky.strokeStyle = `rgba(${STAR}, ${(0.22 * fade).toFixed(3)})`;
      sky.lineWidth = 0.75;
      sky.stroke();
    }
  }

  function drawParticles(
    ctx: CanvasRenderingContext2D,
    now: number,
    dt: number,
  ) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      const age = (now - p.born) / p.life;
      if (age >= 1) {
        particles.splice(i, 1);
        continue;
      }
      if (age < 0) continue;
      if (!p.glyph) {
        p.vx *= Math.exp(-1.6 * dt);
        p.vy *= Math.exp(-1.6 * dt);
      }
      p.x += p.vx * dt + Math.sin(now / 520 + p.sway) * p.size * 0.012;
      p.y += p.vy * dt;
      const a = Math.min(1, age * 6) * (1 - age) ** 1.4;
      grow(p.x, p.y, p.glyph ? p.size * 1.6 : 10);
      if (p.glyph) {
        // A soft blue halo under a blue-white letter, growing as it rises.
        const size = p.size * (0.7 + age * 0.6);
        ctx.font = `700 ${size.toFixed(1)}px 'M PLUS Rounded 1c', system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = size * 0.22;
        ctx.strokeStyle = `rgba(${BRAND}, ${(a * 0.28).toFixed(3)})`;
        ctx.strokeText(p.glyph, p.x, p.y);
        ctx.fillStyle = `rgba(${STAR}, ${(a * 0.95).toFixed(3)})`;
        ctx.fillText(p.glyph, p.x, p.y);
      } else {
        sparkleAt(ctx, p.x, p.y, p.size, a, STAR);
      }
    }
  }

  function drawFx(now: number, dt: number) {
    if (!fx) return false;
    if (!motes.length && !particles.length) {
      if (fxBox)
        fx.clearRect(
          fxBox[0],
          fxBox[1],
          fxBox[2] - fxBox[0],
          fxBox[3] - fxBox[1],
        );
      fxBox = null;
      return false;
    }
    if (fxBox)
      fx.clearRect(
        fxBox[0],
        fxBox[1],
        fxBox[2] - fxBox[0],
        fxBox[3] - fxBox[1],
      );
    box = [Infinity, Infinity, -Infinity, -Infinity];
    drawParticles(fx, now, dt);
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i]!;
      const age = now - m.born - m.delay;
      if (age < 0) continue;
      if (age > m.life) {
        motes.splice(i, 1);
        continue;
      }
      if (age < m.hold) {
        // Burst out, then spring to a small ring.
        const k = 70;
        const c = 2 * 0.62 * Math.sqrt(k);
        m.vx += (-k * (m.x - m.tx) - c * m.vx) * dt;
        m.vy += (-k * (m.y - m.ty) - c * m.vy) * dt;
      } else {
        // Released: drift up and away like warm air.
        m.vx *= 0.96;
        m.vy = m.vy * 0.96 - 26 * dt;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const fadeIn = Math.min(1, age / 220);
      const fadeOut = 1 - Math.max(0, (age - m.hold) / (m.life - m.hold));
      const tw = 0.75 + 0.25 * Math.sin(now / 90 + m.r * 40);
      sparkleAt(fx, m.x, m.y, m.r, fadeIn * fadeOut * tw, STAR);
      grow(m.x, m.y, 12);
    }
    fxBox = box[0] < box[2] ? box : null;
    return true;
  }

  return {
    resize,
    /** Draw a frame. Returns true while anything is still animating. */
    frame(now: number, dt: number, still: boolean) {
      for (let i = rings.length - 1; i >= 0; i--)
        if (now - rings[i]!.born > rings[i]!.life) rings.splice(i, 1);
      const ringing = rings.length > 0;
      if (ringing || (!still && now - lastStars >= 90) || lastStars < 0) {
        drawStars(now, still);
        lastStars = now;
      }
      const busy = drawFx(now, dt);
      return ringing || busy;
    },
    ring(
      x: number,
      y: number,
      strength = 1,
      delay = 0,
      now = performance.now(),
    ) {
      rings.push({
        x,
        y,
        born: now + delay,
        life: 2600,
        strength,
        reach: Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 60,
      });
    },
    /** A puff of sparkle dust. */
    dust(
      x: number,
      y: number,
      count = 6,
      spread = 60,
      now = performance.now(),
    ) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = spread * (0.4 + Math.random() * 0.6);
        particles.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v * 0.6 - 12,
          born: now + Math.random() * 80,
          life: 700 + Math.random() * 500,
          size: 0.5 + Math.random() * 0.6,
          sway: Math.random() * 6,
        });
      }
    },
    /** One drifting "z" from a sleeping cat. */
    zee(
      x: number,
      y: number,
      size: number,
      glyph = 'z',
      now = performance.now(),
    ) {
      particles.push({
        x,
        y,
        vx: 6 + Math.random() * 6,
        vy: -22 - Math.random() * 6,
        born: now,
        life: 2600,
        size,
        glyph,
        sway: Math.random() * 6,
      });
    },
    sparkle(x: number, y: number, now = performance.now()) {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        motes.push({
          x,
          y,
          vx: Math.cos(a) * 160,
          vy: Math.sin(a) * 160,
          tx: x + Math.cos(a) * 26,
          ty: y + Math.sin(a) * 26,
          r: 0.9,
          delay: 0,
          born: now,
          hold: 260,
          life: 900,
        });
      }
    },
  };
}
