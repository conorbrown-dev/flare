import { useEffect, useRef } from "react";

/**
 * The default Flare background: deep space with a drifting star field, nebula
 * glow, a ringed gas giant lit by a distant sun, and a small self-replicating
 * probe cruising past with its drone escort and the occasional sensor ping.
 * (Inspired by the feel of the Bobiverse books; all artwork is original.)
 *
 * Runs at up to 30 frames a second, pauses while the tab is hidden, and draws a
 * single still frame for people who prefer reduced motion.
 */

type Star = { x: number; y: number; z: number; r: number; phase: number; hue: number };
type Streak = { x: number; y: number; vx: number; vy: number; life: number };

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Pre-renders the static parts (sun, planet, rings) once per screen size. */
function paintScenery(w: number, h: number, dpr: number) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);

  // Distant sun, upper left: soft glow plus a thin lens flare.
  const sx = w * 0.14, sy = h * 0.16;
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.45);
  glow.addColorStop(0, "rgba(255,240,220,0.55)");
  glow.addColorStop(0.04, "rgba(255,200,140,0.28)");
  glow.addColorStop(0.25, "rgba(245,124,31,0.06)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,250,240,0.95)";
  g.beginPath(); g.arc(sx, sy, 2.6, 0, TAU); g.fill();
  g.strokeStyle = "rgba(255,220,180,0.25)";
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(sx - 70, sy); g.lineTo(sx + 70, sy); g.moveTo(sx, sy - 40); g.lineTo(sx, sy + 40); g.stroke();

  // Gas giant, lower right, lit from the sun's direction.
  const R = Math.max(110, Math.min(w, h) * 0.27);
  const px = w * 0.86, py = h * 0.8;
  const tilt = -0.32;
  const ringIn = R * 1.35, ringOut = R * 2.05, squash = 0.22;

  const drawRing = (front: boolean) => {
    g.save();
    g.translate(px, py);
    g.rotate(tilt);
    g.beginPath();
    // Back half is the top of the ellipse (behind the planet), front half the bottom.
    if (front) g.rect(-ringOut - 2, 0, ringOut * 2 + 4, ringOut);
    else g.rect(-ringOut - 2, -ringOut, ringOut * 2 + 4, ringOut);
    g.clip();
    g.scale(1, squash);
    for (let r = ringIn; r < ringOut; r += 1.5) {
      const t = (r - ringIn) / (ringOut - ringIn);
      const gap = t > 0.55 && t < 0.6 ? 0.15 : 1; // a Cassini-style gap
      const a = (0.1 + 0.22 * Math.sin(t * 9) ** 2) * gap * (front ? 1 : 0.75);
      g.strokeStyle = `rgba(${Math.round(225 - t * 60)},${Math.round(200 - t * 70)},${Math.round(170 - t * 60)},${a})`;
      g.lineWidth = 1.6;
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
    }
    g.restore();
  };

  drawRing(false);

  // Planet body: many soft horizontal cloud bands in ambers, roses and creams.
  g.save();
  g.beginPath(); g.arc(px, py, R, 0, TAU); g.clip();
  g.translate(px, py); g.rotate(tilt * 0.6); g.translate(-px, -py);
  const palette: [number, number, number][] = [[92, 58, 44], [140, 92, 62], [184, 128, 86], [222, 178, 128], [200, 140, 96], [160, 98, 72], [232, 196, 150], [170, 112, 80], [116, 72, 54]];
  const count = 26;
  const bandH = (R * 2) / count;
  g.fillStyle = "#8a5a3c";
  g.fillRect(px - R, py - R, R * 2, R * 2);
  g.filter = "blur(1.5px)"; // softens band edges where supported
  for (let i = 0; i < count; i++) {
    const [r, gr, b] = palette[(i * 5 + Math.floor(i / 3)) % palette.length];
    const jitter = Math.sin(i * 12.9898) * 14;
    g.fillStyle = `rgb(${r + jitter},${gr + jitter * 0.7},${b + jitter * 0.5})`;
    const y = py - R + i * bandH;
    g.beginPath();
    g.moveTo(px - R - 10, y);
    for (let x = -R - 10; x <= R + 10; x += 10) g.lineTo(px + x, y + Math.sin(x / (18 + i % 5 * 6) + i) * (1.5 + (i % 4)));
    g.lineTo(px + R + 10, y + bandH + 2);
    g.lineTo(px - R - 10, y + bandH + 2);
    g.fill();
  }
  g.filter = "none";
  // A storm, because every good gas giant has one.
  g.fillStyle = "rgba(240,170,120,0.55)";
  g.beginPath(); g.ellipse(px - R * 0.25, py + R * 0.18, R * 0.16, R * 0.07, 0, 0, TAU); g.fill();
  g.restore();

  // Day side faces the sun; the far side falls into night.
  const ang = Math.atan2(sy - py, sx - px);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const shade = g.createLinearGradient(px + dx * R, py + dy * R, px - dx * R, py - dy * R);
  shade.addColorStop(0, "rgba(255,230,190,0.10)");
  shade.addColorStop(0.35, "rgba(4,5,12,0)");
  shade.addColorStop(0.62, "rgba(4,5,12,0.55)");
  shade.addColorStop(0.8, "rgba(4,5,12,0.9)");
  shade.addColorStop(1, "rgba(4,5,12,0.97)");
  g.fillStyle = shade;
  g.beginPath(); g.arc(px, py, R, 0, TAU); g.fill();
  // Limb darkening: edges of a sphere look darker than its middle.
  const limb = g.createRadialGradient(px, py, R * 0.55, px, py, R);
  limb.addColorStop(0, "rgba(0,0,0,0)"); limb.addColorStop(1, "rgba(0,0,0,0.45)");
  g.fillStyle = limb;
  g.beginPath(); g.arc(px, py, R, 0, TAU); g.fill();
  const rim = g.createRadialGradient(px + dx * R * 0.12, py + dy * R * 0.12, R * 0.92, px, py, R * 1.12);
  rim.addColorStop(0, "rgba(255,170,100,0)");
  rim.addColorStop(0.45, "rgba(255,170,100,0.22)");
  rim.addColorStop(1, "rgba(255,170,100,0)");
  g.fillStyle = rim;
  g.beginPath(); g.arc(px, py, R * 1.12, 0, TAU); g.fill();

  drawRing(true);

  // A small icy moon.
  const mx = px - R * 1.9, my = py - R * 0.75, mr = Math.max(7, R * 0.07);
  const moon = g.createRadialGradient(mx - mr * 0.4, my - mr * 0.4, 1, mx, my, mr);
  moon.addColorStop(0, "#dfe7ef"); moon.addColorStop(0.7, "#7b8796"); moon.addColorStop(1, "#1a1f29");
  g.fillStyle = moon;
  g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();

  return c;
}

/** The probe: a long spine, a forward dust shield, a habitat ring, radiator fins and a fusion drive. */
function drawProbe(g: CanvasRenderingContext2D, x: number, y: number, angle: number, t: number, s: number) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(s, s);

  // Drive plume (behind the ship, so drawn first).
  const flick = 0.85 + Math.sin(t * 31) * 0.08 + Math.sin(t * 17) * 0.07;
  const plume = g.createLinearGradient(-22, 0, -22 - 60 * flick, 0);
  plume.addColorStop(0, "rgba(220,245,255,0.95)");
  plume.addColorStop(0.15, "rgba(120,200,255,0.6)");
  plume.addColorStop(1, "rgba(60,120,255,0)");
  g.fillStyle = plume;
  g.beginPath(); g.moveTo(-21, -3); g.lineTo(-22 - 60 * flick, 0); g.lineTo(-21, 3); g.closePath(); g.fill();
  const core = g.createRadialGradient(-22, 0, 0, -22, 0, 9);
  core.addColorStop(0, "rgba(255,255,255,0.9)"); core.addColorStop(1, "rgba(120,200,255,0)");
  g.fillStyle = core;
  g.beginPath(); g.arc(-22, 0, 9, 0, TAU); g.fill();

  // Radiator fins.
  g.fillStyle = "#3b4352";
  g.beginPath(); g.moveTo(-14, -2); g.lineTo(-6, -11); g.lineTo(-2, -11); g.lineTo(-6, -2); g.fill();
  g.beginPath(); g.moveTo(-14, 2); g.lineTo(-6, 11); g.lineTo(-2, 11); g.lineTo(-6, 2); g.fill();
  g.strokeStyle = "rgba(245,124,31,0.6)"; g.lineWidth = 0.6;
  g.beginPath(); g.moveTo(-6, -10.5); g.lineTo(-3, -10.5); g.moveTo(-6, 10.5); g.lineTo(-3, 10.5); g.stroke();

  // Spine and drive housing.
  g.fillStyle = "#8c96a6";
  g.fillRect(-20, -1.6, 34, 3.2);
  g.fillStyle = "#5b6475";
  g.beginPath(); g.moveTo(-22, -4); g.lineTo(-16, -3); g.lineTo(-16, 3); g.lineTo(-22, 4); g.fill();

  // Habitat / fabrication ring, seen edge-on.
  g.strokeStyle = "#c3cad6"; g.lineWidth = 1.4;
  g.beginPath(); g.ellipse(2, 0, 2.2, 7.5, 0, 0, TAU); g.stroke();

  // Forward dust shield.
  const shield = g.createLinearGradient(14, -6, 20, 6);
  shield.addColorStop(0, "#e4e9f1"); shield.addColorStop(1, "#6d7686");
  g.fillStyle = shield;
  g.beginPath(); g.ellipse(17, 0, 3, 6.5, 0, 0, TAU); g.fill();

  // Nav lights.
  const blink = Math.sin(t * 3) > 0.6;
  g.fillStyle = blink ? "rgba(255,80,60,1)" : "rgba(255,80,60,0.25)";
  g.beginPath(); g.arc(-4, -11, 1.1, 0, TAU); g.fill();
  g.fillStyle = !blink ? "rgba(80,255,140,1)" : "rgba(80,255,140,0.25)";
  g.beginPath(); g.arc(-4, 11, 1.1, 0, TAU); g.fill();
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
    let scenery: HTMLCanvasElement | null = null;
    const streaks: Streak[] = [];
    let raf = 0, last = 0, t = rand(0, 60);
    let nextStreak = rand(6, 14);

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      const count = Math.min(700, Math.round((w * h) / 1700));
      stars = Array.from({ length: count }, () => {
        const z = Math.random() ** 2.2; // mostly faint, distant stars
        return { x: rand(0, w), y: rand(0, h), z, r: 0.35 + z * 1.4, phase: rand(0, TAU), hue: Math.random() };
      });
      scenery = paintScenery(w, h, dpr);
      draw(0);
    }

    function draw(dt: number) {
      t += dt;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      // Stars: nearer ones drift faster (parallax) and twinkle.
      for (const s of stars) {
        s.x -= (2 + s.z * 9) * dt;
        if (s.x < -2) { s.x = w + 2; s.y = rand(0, h); }
        const twinkle = 0.55 + 0.45 * Math.sin(t * (0.6 + s.z * 2.4) + s.phase);
        const a = (0.25 + s.z * 0.75) * twinkle;
        g.fillStyle = s.hue < 0.12 ? `rgba(255,190,140,${a})` : s.hue > 0.88 ? `rgba(170,200,255,${a})` : `rgba(235,240,255,${a})`;
        g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.fill();
        if (s.z > 0.85) { // a cross flare on the brightest few
          g.strokeStyle = `rgba(230,240,255,${a * 0.35})`; g.lineWidth = 0.5;
          g.beginPath(); g.moveTo(s.x - 5, s.y); g.lineTo(s.x + 5, s.y); g.moveTo(s.x, s.y - 5); g.lineTo(s.x, s.y + 5); g.stroke();
        }
      }

      if (scenery) g.drawImage(scenery, 0, 0, w, h);

      // Now and then a distant ship streaks across.
      nextStreak -= dt;
      if (nextStreak <= 0 && !reduced) {
        const fromLeft = Math.random() < 0.5;
        streaks.push({ x: fromLeft ? -20 : w + 20, y: rand(h * 0.05, h * 0.5), vx: (fromLeft ? 1 : -1) * rand(260, 420), vy: rand(-30, 30), life: 1 });
        nextStreak = rand(10, 22);
      }
      for (let i = streaks.length - 1; i >= 0; i--) {
        const k = streaks[i];
        k.x += k.vx * dt; k.y += k.vy * dt; k.life -= dt * 0.4;
        if (k.life <= 0 || k.x < -60 || k.x > w + 60) { streaks.splice(i, 1); continue; }
        const tail = g.createLinearGradient(k.x, k.y, k.x - k.vx * 0.12, k.y - k.vy * 0.12);
        tail.addColorStop(0, `rgba(200,230,255,${0.8 * k.life})`); tail.addColorStop(1, "rgba(200,230,255,0)");
        g.strokeStyle = tail; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(k.x, k.y); g.lineTo(k.x - k.vx * 0.12, k.y - k.vy * 0.12); g.stroke();
      }

      // The probe crosses the sky on a gentle arc about every 80 seconds.
      const period = 80;
      const p = reduced ? 0.42 : (t % period) / period;
      const span = w + 240;
      const x = -120 + p * span;
      const y = h * 0.34 + Math.sin(p * Math.PI) * -h * 0.08 + Math.sin(t * 0.7) * 3;
      const angle = Math.atan2(Math.cos(p * Math.PI) * -h * 0.08 * Math.PI / span, 1) + Math.sin(t * 0.5) * 0.02;
      const scale = Math.max(0.9, Math.min(1.6, w / 700));

      // Sensor ping: a ring expanding from the probe every few seconds.
      const ping = (t % 6) / 2.6;
      if (ping < 1 && !reduced) {
        g.strokeStyle = `rgba(120,220,255,${0.45 * (1 - ping)})`;
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(x, y, 12 + ping * 170 * scale, 0, TAU); g.stroke();
        g.strokeStyle = `rgba(120,220,255,${0.18 * (1 - ping)})`;
        g.beginPath(); g.arc(x, y, 6 + ping * 120 * scale, 0, TAU); g.stroke();
      }

      // Drone escort orbiting the probe.
      for (let i = 0; i < 3; i++) {
        const a = t * (0.9 + i * 0.25) + i * 2.1;
        const r = (22 + i * 7) * scale;
        const dx = x + Math.cos(a) * r, dy = y + Math.sin(a) * r * 0.45;
        g.fillStyle = `rgba(255,190,120,${0.55 + 0.45 * Math.sin(t * 5 + i)})`;
        g.beginPath(); g.arc(dx, dy, 1.3, 0, TAU); g.fill();
      }
      drawProbe(g, x, y, angle, t, scale);
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const dt = (now - last) / 1000;
      if (dt < 1 / 30) return; // cap at 30 fps to go easy on phone batteries
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
    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150); };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", start);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 60% 45% at 22% 38%, rgba(110,70,210,0.30), transparent 70%)",
            "radial-gradient(ellipse 50% 40% at 78% 28%, rgba(0,150,170,0.20), transparent 70%)",
            "radial-gradient(ellipse 45% 35% at 55% 70%, rgba(245,124,31,0.10), transparent 70%)",
            "radial-gradient(ellipse 30% 25% at 35% 85%, rgba(200,60,140,0.10), transparent 70%)",
            "linear-gradient(170deg, #03040b 0%, #070917 55%, #04050c 100%)",
          ].join(","),
        }}
      />
      <canvas ref={canvas} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
