import { useEffect, useRef, useState, useMemo } from "react";

// ─── Viewport tier ───────────────────────────────────────────────
function useViewportTier() {
  const [tier, setTier] = useState("desktop");
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setTier(w < 768 ? "mobile" : w < 1100 ? "tablet" : "desktop");
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return tier;
}

// ─── Atmospheric dust (keep from original) ───────────────────────
function DustParticles({ count }) {
  const dots = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 1.5 + 0.5,
        dur: Math.random() * 30 + 20,
        delay: Math.random() * -30,
        drift: (Math.random() - 0.5) * 40,
      })),
    [count]
  );

  return (
    <div className="lh-dust" aria-hidden="true">
      {dots.map((d) => (
        <div
          key={d.id}
          className="lh-dust-dot"
          style={{
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.size,
            height: d.size,
            "--dur": `${d.dur}s`,
            "--delay": `${d.delay}s`,
            "--drift": `${d.drift}px`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Particle network ─────────────────────────────────────────────
// Brand-matched colour palette pulled from --accent / --teal / --text
const PALETTE = [
  [80, 155, 215],   // accent blue
  [76, 168, 160],   // teal  (#4CA8A0)
  [95, 140, 185],   // slate-blue
  [62, 120, 165],   // deeper blue
  [110, 180, 175],  // light teal
];

const CONN_DIST   = 125;  // max px between connected nodes
const MOUSE_RANGE = 145;  // px radius of mouse attraction
const PKT_INTERVAL = 2000; // ms between data packets
const MAX_PKTS    = 5;

function ParticleNetwork({ count }) {
  const canvasRef = useRef(null);
  const mouseRef  = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, animId = null;

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width  = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    resize();

    // ── Build nodes ──
    const nodes = Array.from({ length: count }, () => {
      const isHub = Math.random() < 0.1;
      const col   = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      return {
        x:  Math.random() * W,
        y:  Math.random() * H,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r:  isHub ? Math.random() + 3.8 : Math.random() * 1.3 + 0.9,
        isHub,
        col,
        baseAlpha: isHub ? 0.95 : Math.random() * 0.35 + 0.5,
        phase: Math.random() * Math.PI * 2,
      };
    });

    // ── Data packets ──
    const packets = [];
    let lastPktTime = 0;

    // ── Animation loop ──
    const tick = (now) => {
      ctx.clearRect(0, 0, W, H);

      const { x: mx, y: my } = mouseRef.current;

      // Update nodes
      nodes.forEach((n) => {
        // Subtle mouse attraction
        const dx = mx - n.x, dy = my - n.y;
        const md = Math.sqrt(dx * dx + dy * dy);
        if (md < MOUSE_RANGE && md > 1) {
          const f = (1 - md / MOUSE_RANGE) * 0.013;
          n.vx += (dx / md) * f;
          n.vy += (dy / md) * f;
        }

        n.vx *= 0.987;
        n.vy *= 0.987;
        // Speed cap
        const spd = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (spd > 0.5) { n.vx *= 0.5 / spd; n.vy *= 0.5 / spd; }

        n.x += n.vx;
        n.y += n.vy;
        n.phase += 0.012;

        // Soft wrap
        if (n.x < -30)     n.x = W + 30;
        else if (n.x > W + 30) n.x = -30;
        if (n.y < -30)     n.y = H + 30;
        else if (n.y > H + 30) n.y = -30;
      });

      // Spawn data packet
      if (now - lastPktTime > PKT_INTERVAL && packets.length < MAX_PKTS) {
        const i  = Math.floor(Math.random() * nodes.length);
        const ni = nodes[i];
        let best = -1, bd = CONN_DIST;
        nodes.forEach((nj, j) => {
          if (j === i) return;
          const d = Math.hypot(ni.x - nj.x, ni.y - nj.y);
          if (d < bd && d > 28) { bd = d; best = j; }
        });
        if (best >= 0) {
          packets.push({ a: i, b: best, p: 0 });
          lastPktTime = now;
        }
      }

      // ── Draw connections ──
      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const n2  = nodes[j];
          const ddx = n2.x - n1.x, ddy = n2.y - n1.y;
          const d   = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d > CONN_DIST) continue;

          const distAlpha = (1 - d / CONN_DIST) * 0.17;
          const nearMouse =
            Math.hypot(n1.x - mx, n1.y - my) < MOUSE_RANGE ||
            Math.hypot(n2.x - mx, n2.y - my) < MOUSE_RANGE;
          const alpha = Math.min(distAlpha * (nearMouse ? 3.2 : 1), 0.48);

          const [r1, g1, b1] = n1.col;
          const [r2, g2, b2] = n2.col;
          const cr = (r1 + r2) >> 1, cg = (g1 + g2) >> 1, cb = (b1 + b2) >> 1;

          ctx.beginPath();
          ctx.moveTo(n1.x, n1.y);
          ctx.lineTo(n2.x, n2.y);
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
          ctx.lineWidth   = alpha > 0.22 ? 0.85 : 0.5;
          ctx.stroke();
        }
      }

      // ── Draw + update packets ──
      for (let i = packets.length - 1; i >= 0; i--) {
        const pk = packets[i];
        pk.p += 0.007;
        if (pk.p >= 1) { packets.splice(i, 1); continue; }

        const na = nodes[pk.a], nb = nodes[pk.b];
        if (Math.hypot(na.x - nb.x, na.y - nb.y) > CONN_DIST) {
          packets.splice(i, 1);
          continue;
        }

        const px = na.x + (nb.x - na.x) * pk.p;
        const py = na.y + (nb.y - na.y) * pk.p;

        // Outer glow
        const gr = ctx.createRadialGradient(px, py, 0, px, py, 10);
        gr.addColorStop(0, "rgba(76,168,160,0.75)");
        gr.addColorStop(1, "rgba(76,168,160,0)");
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.fillStyle = gr;
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(150,228,218,1)";
        ctx.fill();
      }

      // ── Draw nodes ──
      nodes.forEach((n) => {
        const pulse     = 0.72 + Math.sin(n.phase) * 0.28;
        const [r, g, b] = n.col;
        const nearMouse = Math.hypot(n.x - mx, n.y - my) < MOUSE_RANGE;

        // Glow / ring for hub or mouse-near nodes
        if (n.isHub || nearMouse) {
          const glowR = n.isHub ? n.r * 4.2 : n.r * 3.2;
          const grd   = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR);
          grd.addColorStop(0, `rgba(${r},${g},${b},${(n.isHub ? 0.32 : 0.2) * pulse})`);
          grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();

          if (n.isHub) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r + 3.2, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${r},${g},${b},${0.24 * pulse})`;
            ctx.lineWidth   = 0.8;
            ctx.stroke();
          }
        }

        // Core dot
        const alpha = n.baseAlpha * (nearMouse ? 1 : 0.78 + pulse * 0.22);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fill();
      });

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    // Mouse tracking on the canvas element
    const onMove  = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onLeave = () => { mouseRef.current = { x: -9999, y: -9999 }; };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    const onResize = () => {
      resize();
      nodes.forEach((n) => {
        if (n.x > W) n.x = Math.random() * W;
        if (n.y > H) n.y = Math.random() * H;
      });
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", onResize);
    };
  }, [count]);

  return (
    <canvas
      ref={canvasRef}
      className="lh-particle-canvas"
      aria-hidden="true"
    />
  );
}

// ─── Hero text — fade in once, stay visible ───────────────────────
function HeroText() {
  return (
    <div className="lh-text">
      <h2 className="lh-headline">Compliance Made Clear</h2>
      <div className="lh-underline" />
      <p className="lh-subtitle">
        Your privacy and security posture,
        <br />
        unified in one intelligent dashboard.
      </p>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────
export default function LoginHero() {
  const tier       = useViewportTier();
  const dustCount  = tier === "mobile" ? 15 : tier === "tablet" ? 25 : 40;
  const nodeCount  = tier === "tablet" ? 38 : 65;

  return (
    <div className="lh-root">
      <div className="lh-bg" />
      <div className="lh-bg-glow" />
      <div className="lh-vignette" />

      <DustParticles count={dustCount} />
      <ParticleNetwork count={nodeCount} />

      <div className="lh-bottom-fade" />
      <HeroText />
    </div>
  );
}
