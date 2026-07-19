import { useEffect, useRef, useCallback } from "react";

/* ── Types ─────────────────────────────────────────────────────── */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  color: string;
}

/* ── Thanos Snap Canvas Overlay ────────────────────────────────── */

export default function ThemeTransition() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animatingRef = useRef(false);

  /* ── The public API: trigger a Thanos snap ─────────────────── */
  const snap = useCallback((nextTheme: string) => {
    if (animatingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    animatingRef.current = true;

    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;

    // ── Mobile / low-power fallback: simple fade ───────────
    const isMobile =
      "ontouchstart" in window &&
      window.matchMedia("(max-width: 768px)").matches;
    if (isMobile) {
      canvas.style.opacity = "1";
      canvas.style.transition = "opacity 300ms ease-in";
      requestAnimationFrame(() => {
        canvas.style.opacity = "0";
        setTimeout(() => {
          document.documentElement.dataset.theme = nextTheme;
          localStorage.setItem("paun-theme", nextTheme);
          canvas.style.display = "none";
          animatingRef.current = false;
        }, 350);
      });
      return;
    }

    // ── Desktop: capture the screen snapshot ────────────────
    // We use ctx.drawImage on a detached canvas for the snapshot.
    // Draw a synthetic "screen grab" by filling the canvas with the
    // current theme's surface colour and overlaying grid dots.

    // Read current theme accent colour
    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue("--theme-accent").trim() || "#00e676";
    const surface = style.getPropertyValue("--theme-surface").trim() || "#0d1117";
    const gridDot = style.getPropertyValue("--theme-grid-dot").trim() || "rgba(0,188,212,0.06)";

    // Fill with surface colour
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, w, h);

    // Draw dot grid to match theme look
    ctx.fillStyle = gridDot;
    const gridSize = 40;
    for (let gx = 0; gx < w; gx += gridSize) {
      for (let gy = 0; gy < h; gy += gridSize) {
        ctx.beginPath();
        ctx.arc(gx, gy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Create 200 dissolving squares ───────────────────────
    const particleCount = 200;
    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6 - 1.5,
        size: Math.random() * 6 + 2,
        opacity: Math.random() * 0.8 + 0.2,
        color: accent,
      });
    }

    // ── Animation loop ──────────────────────────────────────
    const start = performance.now();
    const DURATION = 600; // ms

    function frame(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / DURATION, 1);

      ctx!.clearRect(0, 0, w, h);

      // Ease-out: particles slow down over time
      const ease = 1 - Math.pow(1 - progress, 3);

      for (const p of particles) {
        p.x += p.vx * (1 - ease * 0.3);
        p.y += p.vy * (1 + ease * 0.5);
        // fade out gradually
        const alpha = p.opacity * (1 - ease);
        if (alpha <= 0) continue;

        // Rotation effect for the square
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate(ease * Math.PI * 2);

        ctx!.fillStyle = p.color.replace(")", `, ${alpha.toFixed(2)})`).replace("rgb", "rgba");
        if (p.color.startsWith("#")) {
          const hex = p.color;
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          ctx!.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
        }

        ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx!.restore();
      }

      // Overall overlay fade
      canvas!.style.opacity = `${1 - ease}`;

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        // ── Complete: apply new theme ──────────────────────
        document.documentElement.dataset.theme = nextTheme;
        localStorage.setItem("paun-theme", nextTheme);
        ctx!.clearRect(0, 0, w, h);
        canvas!.style.opacity = "0";
        canvas!.style.display = "none";
        animatingRef.current = false;
      }
    }

    canvas.style.display = "block";
    canvas.style.opacity = "1";
    requestAnimationFrame(() => requestAnimationFrame(frame));
  }, []);

  /* ── Expose snap to the window so settings page can call it ── */
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__thanosSnap = snap;
    return () => {
      delete (window as unknown as Record<string, unknown>).__thanosSnap;
    };
  }, [snap]);

  return (
    <canvas
      ref={canvasRef}
      className="thanos-overlay"
      style={{ display: "none" }}
      aria-hidden="true"
    />
  );
}

/* ── Helper: trigger theme change with Thanos transition ──────── */

export function changeTheme(nextTheme: string) {
  const snap = (window as unknown as Record<string, unknown>).__thanosSnap as
    | ((t: string) => void)
    | undefined;
  if (snap) {
    snap(nextTheme);
  } else {
    // Fallback: direct theme switch
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("paun-theme", nextTheme);
  }
}
