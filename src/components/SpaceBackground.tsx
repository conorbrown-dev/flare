import { useEffect, useRef } from "react";

/**
 * The default Flare background, drawn like a panel from a cosmic sci-fi comic:
 * a posterized nebula with inked contours and halftone edges, "Kirby crackle"
 * energy clusters, a starburst sun, a cel-shaded ringed gas giant with halftone
 * and cross-hatched shadows, and an inked self-replicating probe with its drone
 * escort and sensor pings. (Inspired by the feel of the Bobiverse books; all
 * artwork is original and generated in code.)
 *
 * Static art is painted once per screen size; only stars, the probe and effects
 * animate. Runs at up to 30 fps, pauses in hidden tabs, and draws one still
 * frame for people who prefer reduced motion.
 */

const TAU = Math.PI * 2;
const INK = "#07050d";

// ---------- deterministic noise (same sky every visit) ----------

function makeRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function makeNoise(seed: number) {
  const rnd = makeRandom(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const hash = (x: number, y: number) => perm[(perm[x & 255] + y) & 255] / 255;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x: number, y: number, octaves = 5) => {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += noise(x * freq, y * freq) * amp; norm += amp; amp *= 0.5; freq *= 2.03; }
    return sum / norm;
  };
}

// ---------- the painted (static) layer ----------

type Level = { r: number; g: number; b: number; a: number };
const WARM: Level[] = [
  { r: 46, g: 18, b: 74, a: 0.5 },    // deep violet
  { r: 112, g: 26, b: 96, a: 0.6 },   // magenta
  { r: 196, g: 62, b: 86, a: 0.68 },  // hot rose
  { r: 236, g: 138, b: 74, a: 0.72 }, // amber
  { r: 250, g: 206, b: 150, a: 0.75 }, // bright core (rare)
];
const COOL: Level[] = [
  { r: 18, g: 22, b: 70, a: 0.5 },    // indigo
  { r: 20, g: 64, b: 112, a: 0.6 },   // deep teal
  { r: 30, g: 132, b: 160, a: 0.66 }, // cyan
  { r: 110, g: 200, b: 214, a: 0.7 }, // ice
  { r: 200, g: 240, b: 240, a: 0.74 },
];
const THRESHOLDS = [0.5, 0.57, 0.63, 0.69, 0.75];

function paintNebula(g: CanvasRenderingContext2D, w: number, h: number) {
  const fbm = makeNoise(7);
  // Work at reduced resolution; the contours and posterized tones still read crisply.
  const k = Math.min(0.8, Math.sqrt(700_000 / (w * h)));
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
  const aspect = W / H;
  const band = aspect < 1 ? 0.3 : 0.2; // wider band on tall phone screens so it stays visible
  const density = new Float32Array(W * H);
  const level = new Int8Array(W * H);
  const cool = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      // Scale by the longest side so phones and desktops get the same cloud density.
      const nx = (x / Math.max(W, H)) * 2.6 + 0.4, ny = (y / Math.max(W, H)) * 2.6 + 0.4;
      // Domain warping makes the clouds swirl instead of looking like plain noise.
      const q = fbm(nx + 1.7, ny + 9.2, 4);
      const r = fbm(nx + 4.0 * q + 8.3, ny + 4.0 * q + 2.8, 4);
      let d = fbm(nx + 3.0 * r, ny + 3.0 * r, 5);
      // Concentrate the nebula in a band from lower left to upper right.
      const dist = Math.abs(u + v * 0.9 - 0.95) / 1.35;
      d = d * (0.35 + 0.8 * Math.exp(-((dist / band) ** 2)));
      const i = y * W + x;
      density[i] = d;
      cool[i] = fbm(nx * 0.6 + 40, ny * 0.6 + 12, 3) > 0.52 ? 1 : 0;
      let L = -1;
      for (let t = 0; t < THRESHOLDS.length; t++) if (d > THRESHOLDS[t]) L = t;
      level[i] = L;
    }
  }
  const img = new ImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, L = level[i];
      const o = i * 4;
      // Ink contour wherever the tone steps up or down (the comic "flat color with linework" look).
      const right = x + 1 < W ? level[i + 1] : L, down = y + 1 < H ? level[i + W] : L;
      if ((right !== L || down !== L) && Math.max(L, right, down) >= 1) {
        img.data[o] = 6; img.data[o + 1] = 3; img.data[o + 2] = 14; img.data[o + 3] = 175;
        continue;
      }
      if (L < 0) continue;
      const c = (cool[i] ? COOL : WARM)[L];
      img.data[o] = c.r; img.data[o + 1] = c.g; img.data[o + 2] = c.b; img.data[o + 3] = Math.round(c.a * 255);
    }
  }
  const small = document.createElement("canvas");
  small.width = W; small.height = H;
  small.getContext("2d")!.putImageData(img, 0, 0);
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(small, 0, 0, w, h);
  g.restore();

  // Halftone dots where the clouds thin out into space.
  const step = 7;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2 + ((y / step) % 2) * (step / 2); x < w; x += step) {
      const sx = Math.min(W - 1, Math.floor(x * k)), sy = Math.min(H - 1, Math.floor(y * k));
      const i = sy * W + sx, d = density[i];
      const lo = THRESHOLDS[0] - 0.09;
      if (d <= lo || d >= THRESHOLDS[0]) continue;
      const rad = ((d - lo) / 0.09) * step * 0.38;
      const c = (cool[i] ? COOL : WARM)[0];
      g.fillStyle = `rgba(${c.r + 30},${c.g + 20},${c.b + 40},0.6)`;
      g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    }
  }
}

/** "Kirby crackle": clusters of inked energy bubbles drifting in the nebula. */
function paintCrackle(g: CanvasRenderingContext2D, cx: number, cy: number, spread: number, seed: number) {
  const rnd = makeRandom(seed);
  for (let n = 0; n < 30; n++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * spread;
    const x = cx + Math.cos(a) * d * 1.4, y = cy + Math.sin(a) * d * 0.8;
    const r = 1.2 + rnd() ** 3 * spread * 0.11;
    g.fillStyle = INK;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    if (rnd() < 0.45) {
      g.strokeStyle = rnd() < 0.5 ? "rgba(255,90,170,0.9)" : "rgba(90,230,255,0.9)";
      g.lineWidth = 1.4;
      g.beginPath(); g.arc(x, y, r + 1.6, 0, TAU); g.stroke();
    }
  }
}

/** Comic starburst sun. */
function paintSun(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const glow = g.createRadialGradient(x, y, 0, x, y, size * 5);
  glow.addColorStop(0, "rgba(255,236,190,0.55)");
  glow.addColorStop(0.2, "rgba(255,150,70,0.18)");
  glow.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = glow;
  g.beginPath(); g.arc(x, y, size * 5, 0, TAU); g.fill();
  // Alternating long and short spikes, like a comic "flash".
  const spikes = 18;
  g.beginPath();
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
    const r = i % 2 === 0 ? size * (i % 4 === 0 ? 3.1 : 2.1) : size * 0.95;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = "rgba(255,196,96,0.9)";
  g.fill();
  g.strokeStyle = "rgba(120,40,10,0.6)"; g.lineWidth = 1; g.stroke();
  g.fillStyle = "#fff6dc";
  g.beginPath(); g.arc(x, y, size * 0.9, 0, TAU); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 1.5;
  g.beginPath(); g.arc(x, y, size * 1.5, 0, TAU); g.stroke();
}

/** Cel-shaded ringed gas giant with halftone, hatching, rim light and ink outline. */
function paintPlanet(g: CanvasRenderingContext2D, px: number, py: number, R: number, sunX: number, sunY: number) {
  const ink = Math.max(2, R * 0.016);
  const tilt = -0.3;
  const ang = Math.atan2(sunY - py, sunX - px);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const rings: [number, number, string][] = [[1.32, 1.52, "#8a5c48"], [1.55, 1.78, "#e3b98a"], [1.84, 2.02, "#b3826a"]];

  const ring = (front: boolean) => {
    g.save();
    g.translate(px, py); g.rotate(tilt);
    g.beginPath();
    if (front) g.rect(-R * 2.2, 0, R * 4.4, R * 2.2); else g.rect(-R * 2.2, -R * 2.2, R * 4.4, R * 2.2);
    g.clip();
    g.scale(1, 0.22);
    for (const [a, b, col] of rings) {
      g.beginPath(); g.arc(0, 0, R * b, 0, TAU); g.arc(0, 0, R * a, 0, TAU, true);
      g.fillStyle = col; g.globalAlpha = front ? 0.95 : 0.75; g.fill();
    }
    g.globalAlpha = 1;
    g.strokeStyle = INK; g.lineWidth = ink / 0.22 * 0.35;
    for (const [a, b] of rings) {
      g.beginPath(); g.arc(0, 0, R * a, 0, TAU); g.stroke();
      g.beginPath(); g.arc(0, 0, R * b, 0, TAU); g.stroke();
    }
    g.restore();
  };

  ring(false);

  g.save();
  g.beginPath(); g.arc(px, py, R, 0, TAU); g.clip();

  // Flat color bands with wavy inked borders.
  g.save();
  g.translate(px, py); g.rotate(tilt * 0.6); g.translate(-px, -py);
  const bands = ["#5e2a3a", "#c4583c", "#f2a65a", "#f6d49a", "#d2703f", "#8f3a3c", "#f0b878", "#e48a4c", "#b04a3a", "#f7cf8e", "#c9653e", "#6e2f3c"];
  const bandH = (R * 2) / bands.length;
  bands.forEach((col, i) => {
    const y0 = py - R + i * bandH;
    const wave = (x: number) => Math.sin(x / (R * 0.12) + i * 1.7) * bandH * 0.18 + Math.sin(x / (R * 0.05) + i) * bandH * 0.06;
    g.beginPath();
    g.moveTo(px - R - 4, y0 + wave(-R));
    for (let x = -R; x <= R; x += 4) g.lineTo(px + x, y0 + wave(x));
    g.lineTo(px + R + 4, y0 + bandH * 1.5);
    g.lineTo(px - R - 4, y0 + bandH * 1.5);
    g.closePath();
    g.fillStyle = col; g.fill();
    if (i % 3 === 1) {
      g.strokeStyle = "rgba(40,10,20,0.55)"; g.lineWidth = ink * 0.5;
      g.beginPath();
      for (let x = -R; x <= R; x += 4) (x === -R ? g.moveTo : g.lineTo).call(g, px + x, y0 + wave(x));
      g.stroke();
    }
  });
  // The great storm, inked.
  const stx = px - R * 0.2, sty = py + R * 0.22;
  g.fillStyle = "#f7e2b8";
  g.beginPath(); g.ellipse(stx, sty, R * 0.17, R * 0.075, 0, 0, TAU); g.fill();
  g.fillStyle = "#d9603f";
  g.beginPath(); g.ellipse(stx, sty, R * 0.1, R * 0.04, 0, 0, TAU); g.fill();
  g.strokeStyle = INK; g.lineWidth = ink * 0.6;
  g.beginPath(); g.ellipse(stx, sty, R * 0.17, R * 0.075, 0, 0, TAU); g.stroke();
  g.restore();

  // Cel shading: shadow = the planet minus a "lit" circle shifted toward the sun.
  const shadow = (offset: number, fill: string) => {
    g.beginPath();
    g.arc(px, py, R * 1.02, 0, TAU);
    g.arc(px + dx * R * offset, py + dy * R * offset, R, 0, TAU, true);
    g.fillStyle = fill;
    g.fill("evenodd");
  };
  const inside = (x: number, y: number, offset: number) => Math.hypot(x - (px + dx * R * offset), y - (py + dy * R * offset)) < R;

  // Halftone dots across the half-shadow, growing toward the dark side.
  const step = Math.max(4, R * 0.03);
  for (let y = py - R; y < py + R; y += step) {
    for (let x = px - R + ((Math.round((y - py) / step) % 2) * step) / 2; x < px + R; x += step) {
      if (inside(x, y, 0.72)) continue; // fully lit
      const along = ((x - px) * dx + (y - py) * dy) / R; // 1 = facing sun, -1 = away
      const rad = Math.min(step * 0.55, Math.max(0.4, (0.55 - along) * step * 0.5));
      g.fillStyle = "rgba(60,16,70,0.55)";
      g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    }
  }
  shadow(0.42, "rgba(44,14,64,0.55)"); // mid tone
  shadow(0.16, "rgba(12,6,28,0.88)");  // deep night side

  // Cross-hatching in the deepest shadow.
  g.save();
  g.beginPath();
  g.arc(px, py, R * 1.02, 0, TAU);
  g.arc(px + dx * R * 0.3, py + dy * R * 0.3, R, 0, TAU, true);
  g.clip("evenodd");
  g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = Math.max(0.8, R * 0.006);
  const gap = Math.max(4, R * 0.035);
  for (let o = -R * 2; o < R * 2; o += gap) {
    g.beginPath(); g.moveTo(px + o - R, py - R); g.lineTo(px + o + R, py + R); g.stroke();
  }
  g.restore();
  g.restore();

  // Rim light on the night side (bounced light from the nebula) and a sunlit highlight.
  const away = ang + Math.PI;
  g.lineCap = "round";
  g.strokeStyle = "rgba(90,230,255,0.9)"; g.lineWidth = ink * 1.3;
  g.beginPath(); g.arc(px, py, R - ink * 1.2, away - 0.9, away + 0.9); g.stroke();
  g.strokeStyle = "rgba(255,246,220,0.85)"; g.lineWidth = ink * 1.1;
  g.beginPath(); g.arc(px, py, R - ink * 2.4, ang - 0.5, ang + 0.5); g.stroke();
  g.lineCap = "butt";

  // Heavy ink outline.
  g.strokeStyle = INK; g.lineWidth = ink * 1.6;
  g.beginPath(); g.arc(px, py, R, 0, TAU); g.stroke();

  ring(true);

  // A small inked moon, cel-shaded the same way.
  const mx = px - R * 1.85, my = py - R * 0.8, mr = Math.max(8, R * 0.075);
  g.fillStyle = "#cfd8e6";
  g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
  g.save();
  g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.clip();
  g.beginPath(); g.arc(mx, my, mr * 1.05, 0, TAU); g.arc(mx + dx * mr * 0.5, my + dy * mr * 0.5, mr, 0, TAU, true);
  g.fillStyle = "rgba(20,14,44,0.85)"; g.fill("evenodd");
  g.fillStyle = "rgba(120,130,160,0.8)";
  g.beginPath(); g.arc(mx + mr * 0.25, my - mr * 0.1, mr * 0.22, 0, TAU); g.fill();
  g.restore();
  g.strokeStyle = INK; g.lineWidth = Math.max(1.5, ink);
  g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.stroke();
}

function paintScene(w: number, h: number, dpr: number) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  paintNebula(g, w, h);
  const m = Math.min(w, h);
  paintCrackle(g, w * 0.3, h * 0.6, m * 0.1, 3);
  paintCrackle(g, w * 0.7, h * 0.2, m * 0.07, 11);
  const sunX = w * 0.13, sunY = h * 0.15;
  paintSun(g, sunX, sunY, Math.max(10, m * 0.022));
  paintPlanet(g, w * 0.85, h * 0.8, Math.max(110, m * 0.27), sunX, sunY);
  // Vignette, like the edge of a printed panel.
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(2,1,8,0.65)");
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  return c;
}

// ---------- animated pieces ----------

type Star = { x: number; y: number; z: number; r: number; phase: number; tint: number; sparkle: boolean };
type Streak = { x: number; y: number; vx: number; vy: number; life: number };

function sparkle(g: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) {
  g.fillStyle = `rgba(240,250,255,${alpha})`;
  g.beginPath();
  g.moveTo(x, y - size); g.lineTo(x + size * 0.18, y - size * 0.18); g.lineTo(x + size, y); g.lineTo(x + size * 0.18, y + size * 0.18);
  g.lineTo(x, y + size); g.lineTo(x - size * 0.18, y + size * 0.18); g.lineTo(x - size, y); g.lineTo(x - size * 0.18, y - size * 0.18);
  g.closePath(); g.fill();
}

/** The probe, inked and cel-shaded: fusion drive, radiators, spine, habitat ring, sensor mast, dust shield. */
function drawProbe(g: CanvasRenderingContext2D, x: number, y: number, angle: number, t: number, s: number) {
  g.save();
  g.translate(x, y); g.rotate(angle); g.scale(s, s);
  g.lineJoin = "round";
  const lw = 1.15;

  // Speed lines trailing behind.
  g.strokeStyle = "rgba(220,240,255,0.35)"; g.lineWidth = 0.8;
  for (let i = 0; i < 6; i++) {
    const yy = -10 + i * 4 + Math.sin(t * 2 + i) * 0.6;
    const len = 30 + ((i * 37) % 40);
    g.beginPath(); g.moveTo(-60 - ((t * 120 + i * 23) % 50), yy); g.lineTo(-60 - len - ((t * 120 + i * 23) % 50), yy); g.stroke();
  }

  // Jagged fusion flame: outer blue, cyan, white core.
  const flame = (len: number, half: number, color: string, jag: number) => {
    g.beginPath();
    g.moveTo(-34, -half);
    const n = 7;
    for (let i = 1; i <= n; i++) {
      const fx = -34 - (len * i) / n;
      const fy = -half * (1 - i / n) + Math.sin(t * 40 + i * 2.1) * jag;
      g.lineTo(fx, fy);
    }
    for (let i = n; i >= 1; i--) {
      const fx = -34 - (len * i) / n + 2;
      const fy = half * (1 - i / n) + Math.sin(t * 37 + i * 1.7) * jag;
      g.lineTo(fx, fy);
    }
    g.lineTo(-34, half);
    g.closePath();
    g.fillStyle = color; g.fill();
  };
  const flick = 1 + Math.sin(t * 29) * 0.08;
  flame(46 * flick, 6, "rgba(50,100,255,0.75)", 1.6);
  flame(32 * flick, 4.2, "rgba(110,225,255,0.95)", 1.1);
  flame(18 * flick, 2.4, "#ffffff", 0.5);

  const part = (path: () => void, fill: string) => { g.beginPath(); path(); g.fillStyle = fill; g.fill(); g.strokeStyle = INK; g.lineWidth = lw; g.stroke(); };

  // Radiator fins (orange, the Flare color), with panel lines.
  part(() => { g.moveTo(-24, -6); g.lineTo(-14, -24); g.lineTo(-4, -24); g.lineTo(-10, -6); g.closePath(); }, "#d8692e");
  part(() => { g.moveTo(-24, 6); g.lineTo(-14, 24); g.lineTo(-4, 24); g.lineTo(-10, 6); g.closePath(); }, "#9c4220");
  g.strokeStyle = "rgba(7,5,13,0.6)"; g.lineWidth = 0.6;
  for (const sgn of [-1, 1]) for (let k = 1; k < 4; k++) {
    g.beginPath(); g.moveTo(-24 + k * 3.5, sgn * 6); g.lineTo(-14 + k * 3.3, sgn * 24); g.stroke();
  }

  // Drive section.
  part(() => { g.moveTo(-36, -7); g.lineTo(-24, -9); g.lineTo(-24, 9); g.lineTo(-36, 7); g.closePath(); }, "#4a5068");
  part(() => { g.rect(-24, -4, 4, 8); }, "#2c3044");

  // Main spine with cel shading (lit top, shadowed bottom).
  part(() => { g.rect(-20, -3.5, 44, 7); }, "#9aa4ba");
  g.fillStyle = "#e6edf8"; g.fillRect(-19.4, -2.9, 42.8, 2);
  g.fillStyle = "#545c76"; g.fillRect(-19.4, 1.2, 42.8, 1.8);
  g.strokeStyle = INK; g.lineWidth = 0.6;
  for (const px of [-8, 0, 16]) { g.beginPath(); g.moveTo(px, -3.5); g.lineTo(px, 3.5); g.stroke(); }

  // Fabrication modules.
  part(() => { g.rect(9, -8, 6, 16); }, "#6b7490");
  g.fillStyle = "#c7d0e2"; g.fillRect(9.6, -7.4, 4.8, 3);

  // Habitat ring seen almost edge-on, with spokes.
  g.lineWidth = lw;
  g.beginPath(); g.ellipse(0, 0, 4, 16, 0, 0, TAU); g.ellipse(0, 0, 2.2, 13, 0, 0, TAU, true);
  g.fillStyle = "#c3cbdb"; g.fill("evenodd"); g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.ellipse(0, 0, 4, 16, 0, -Math.PI / 2, Math.PI / 2); g.ellipse(0, 0, 2.2, 13, 0, Math.PI / 2, -Math.PI / 2, true);
  g.fillStyle = "rgba(60,66,90,0.7)"; g.fill();
  g.strokeStyle = INK; g.lineWidth = 0.6;
  g.beginPath(); g.moveTo(0, -13); g.lineTo(0, -3.5); g.moveTo(0, 13); g.lineTo(0, 3.5); g.stroke();

  // Sensor mast and dish.
  g.strokeStyle = INK; g.lineWidth = 1;
  g.beginPath(); g.moveTo(18, -3.5); g.lineTo(22, -15); g.stroke();
  part(() => { g.ellipse(22.5, -16.5, 1.4, 3.6, -0.5, 0, TAU); }, "#e6edf8");

  // Forward dust shield, cel-shaded dish.
  part(() => { g.ellipse(28, 0, 5, 12, 0, 0, TAU); }, "#e9eef7");
  g.beginPath(); g.ellipse(28, 0, 5, 12, 0, 0, Math.PI); g.fillStyle = "#8a93aa"; g.fill();
  g.strokeStyle = INK; g.lineWidth = lw;
  g.beginPath(); g.ellipse(28, 0, 5, 12, 0, 0, TAU); g.stroke();
  g.lineWidth = 0.6; g.beginPath(); g.ellipse(28, 0, 2.5, 7, 0, 0, TAU); g.stroke();

  // Running lights.
  const blink = Math.sin(t * 3) > 0.55;
  g.fillStyle = blink ? "#ff4b3a" : "rgba(255,75,58,0.3)";
  g.beginPath(); g.arc(-9, -24, 1.4, 0, TAU); g.fill();
  g.fillStyle = !blink ? "#4bff8f" : "rgba(75,255,143,0.3)";
  g.beginPath(); g.arc(-9, 24, 1.4, 0, TAU); g.fill();
  g.restore();
}

export function SpaceBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const g = el.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1;
    let stars: Star[] = [];
    let scene: HTMLCanvasElement | null = null;
    const streaks: Streak[] = [];
    let raf = 0, last = 0, t = 20 + Math.random() * 40;
    let nextStreak = 6 + Math.random() * 8;

    function resize() {
      const nw = window.innerWidth, nh = window.innerHeight;
      // The phone keyboard only shrinks the height: keep the painted scene and let it crop.
      if (scene && nw === w && nh <= h) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = nw; h = nh;
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      el.style.width = `${w}px`; el.style.height = `${h}px`;
      const rnd = makeRandom(42);
      const count = Math.min(650, Math.round((w * h) / 1900));
      stars = Array.from({ length: count }, () => {
        const z = rnd() ** 2.4;
        return { x: rnd() * w, y: rnd() * h, z, r: 0.4 + z * 1.3, phase: rnd() * TAU, tint: rnd(), sparkle: z > 0.8 };
      });
      scene = paintScene(w, h, dpr);
      draw(0);
    }

    function draw(dt: number) {
      t += dt;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#04030b";
      g.fillRect(0, 0, w, h);

      for (const s of stars) {
        s.x -= (1.5 + s.z * 8) * dt;
        if (s.x < -6) { s.x = w + 6; }
        const tw = 0.55 + 0.45 * Math.sin(t * (0.5 + s.z * 2.2) + s.phase);
        const a = (0.3 + s.z * 0.7) * tw;
        if (s.sparkle) { sparkle(g, s.x, s.y, 2.5 + s.z * 3.5 * tw, a); continue; }
        g.fillStyle = s.tint < 0.15 ? `rgba(255,190,140,${a})` : s.tint > 0.85 ? `rgba(150,220,255,${a})` : `rgba(240,244,255,${a})`;
        g.fillRect(s.x - s.r / 2, s.y - s.r / 2, s.r, s.r);
      }

      if (scene) g.drawImage(scene, 0, 0, w, h);

      // Distant ships: a bundle of inked speed lines.
      nextStreak -= dt;
      if (nextStreak <= 0 && !reduced) {
        const left = Math.random() < 0.5;
        streaks.push({ x: left ? -40 : w + 40, y: h * (0.06 + Math.random() * 0.4), vx: (left ? 1 : -1) * (300 + Math.random() * 160), vy: (Math.random() - 0.5) * 50, life: 1 });
        nextStreak = 10 + Math.random() * 12;
      }
      for (let i = streaks.length - 1; i >= 0; i--) {
        const k = streaks[i];
        k.x += k.vx * dt; k.y += k.vy * dt; k.life -= dt * 0.35;
        if (k.life <= 0 || k.x < -120 || k.x > w + 120) { streaks.splice(i, 1); continue; }
        const nx = -k.vx * 0.15, ny = -k.vy * 0.15;
        for (let j = -1; j <= 1; j++) {
          g.strokeStyle = j === 0 ? `rgba(255,255,255,${0.9 * k.life})` : `rgba(120,220,255,${0.5 * k.life})`;
          g.lineWidth = j === 0 ? 1.4 : 0.7;
          g.beginPath(); g.moveTo(k.x, k.y + j * 2.5); g.lineTo(k.x + nx * (j === 0 ? 1 : 0.6), k.y + j * 2.5 + ny); g.stroke();
        }
        g.fillStyle = `rgba(255,255,255,${k.life})`;
        g.beginPath(); g.arc(k.x, k.y, 1.6, 0, TAU); g.fill();
      }

      // The probe's slow pass across the sky.
      const period = 90;
      const p = reduced ? 0.4 : (t % period) / period;
      const span = w + 320;
      const x = -160 + p * span;
      const y = h * 0.33 - Math.sin(p * Math.PI) * h * 0.07 + Math.sin(t * 0.6) * 2.5;
      const angle = Math.atan2(-Math.cos(p * Math.PI) * h * 0.07 * Math.PI / span, 1) + Math.sin(t * 0.45) * 0.015;
      const scale = Math.max(0.85, Math.min(1.7, w / 820));

      // Sensor ping: an inked ripple with a cyan core.
      const ping = (t % 7) / 3;
      if (ping < 1 && !reduced) {
        const r = 20 + ping * 190 * scale;
        g.strokeStyle = `rgba(7,5,13,${0.6 * (1 - ping)})`; g.lineWidth = 4;
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
        g.strokeStyle = `rgba(110,235,255,${0.8 * (1 - ping)})`; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
        for (let i = 0; i < 12; i++) { // tick marks, like a sensor display
          const a = (i / 12) * TAU;
          g.beginPath(); g.moveTo(x + Math.cos(a) * (r - 5), y + Math.sin(a) * (r - 5)); g.lineTo(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5)); g.stroke();
        }
      }

      // Drone escort: small inked diamonds with glowing cores.
      for (let i = 0; i < 3; i++) {
        const a = t * (0.8 + i * 0.22) + i * 2.1;
        const r = (36 + i * 9) * scale;
        const dx = x + Math.cos(a) * r, dy = y + Math.sin(a) * r * 0.42;
        const d = 3.2 * scale;
        g.beginPath(); g.moveTo(dx, dy - d); g.lineTo(dx + d, dy); g.lineTo(dx, dy + d); g.lineTo(dx - d, dy); g.closePath();
        g.fillStyle = "#b9c2d6"; g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke();
        g.fillStyle = `rgba(255,170,80,${0.6 + 0.4 * Math.sin(t * 6 + i)})`;
        g.beginPath(); g.arc(dx, dy, 1.1 * scale, 0, TAU); g.fill();
      }
      drawProbe(g, x, y, angle, t, scale);
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const dt = (now - last) / 1000;
      if (dt < 1 / 30) return;
      last = now;
      draw(Math.min(dt, 0.1));
    }
    function start() {
      cancelAnimationFrame(raf);
      if (reduced || document.visibilityState !== "visible") return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    resize();
    start();
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(resize, 200); };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", start);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-[#04030b]" aria-hidden="true">
      <canvas ref={canvas} className="absolute left-0 top-0" />
    </div>
  );
}
