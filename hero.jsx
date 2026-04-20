/* Hero canvas — three variants: "storm", "dent-to-smooth", "panel-xray" */

function HeroCanvas({ variant, accent, theme }) {
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(0);
  const mouseRef = React.useRef({ x: 0.5, y: 0.5, active: false });
  const isLight = theme === 'light';

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      if (w < 2 || h < 2) return false;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = (e.clientX - rect.left) / rect.width;
      mouseRef.current.y = (e.clientY - rect.top) / rect.height;
      mouseRef.current.active = true;
    };
    const onLeave = () => { mouseRef.current.active = false; };
    window.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);

    // Hail particles
    const hail = Array.from({ length: 140 }, () => ({
      x: Math.random(), y: Math.random() * -1, 
      s: Math.random() * 2 + 1,
      v: Math.random() * 0.4 + 0.5,
      o: Math.random() * 0.5 + 0.3,
    }));

    // Ripples on hood impact
    const ripples = [];

    // Dent points on the car hood (normalized coords)
    const dents = Array.from({ length: 24 }, () => ({
      x: 0.25 + Math.random() * 0.5,
      y: 0.55 + Math.random() * 0.15,
      r: Math.random() * 14 + 6,
      depth: Math.random() * 0.6 + 0.4,
      heal: 1, // 0 = fully smooth, 1 = full dent
    }));

    // Xray grid
    const t0 = performance.now();

    function draw(t) {
      if (!w || !h) { if (!resize()) { rafRef.current = requestAnimationFrame(draw); return; } }
      const elapsed = (t - t0) / 1000;
      ctx.clearRect(0, 0, w, h);

      // backdrop: radial wash
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      if (isLight) {
        grad.addColorStop(0, '#f6f4ee');
        grad.addColorStop(0.55, '#ffffff');
        grad.addColorStop(1, '#eeece4');
      } else {
        grad.addColorStop(0, '#0a0b10');
        grad.addColorStop(0.55, '#121318');
        grad.addColorStop(1, '#0a0b10');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Mouse-reactive light
      const mx = mouseRef.current.active ? mouseRef.current.x : 0.5 + Math.sin(elapsed * 0.3) * 0.1;
      const my = mouseRef.current.active ? mouseRef.current.y : 0.5;

      const light = ctx.createRadialGradient(mx * w, my * h, 0, mx * w, my * h, Math.max(w, h) * 0.6);
      light.addColorStop(0, accent + '22');
      light.addColorStop(0.4, accent + '08');
      light.addColorStop(1, 'transparent');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, w, h);

      // Horizon / ground glow
      const ground = ctx.createLinearGradient(0, h * 0.72, 0, h);
      ground.addColorStop(0, 'transparent');
      ground.addColorStop(1, accent + '10');
      ctx.fillStyle = ground;
      ctx.fillRect(0, h * 0.72, w, h * 0.28);

      // === Car silhouette (profile view) ===
      drawCar(ctx, w, h, accent, variant, elapsed, dents, isLight);

      // Hail
      if (variant !== 'xray') {
        ctx.save();
        for (const p of hail) {
          p.y += p.v * 0.006;
          p.x += Math.sin(elapsed + p.y * 10) * 0.0008;
          if (p.y > 1) {
            // impact test over hood region
            if (p.x > 0.22 && p.x < 0.78 && Math.random() < 0.08) {
              ripples.push({ x: p.x, y: 0.6 + Math.random() * 0.08, r: 0, life: 1 });
              // refresh a random dent
              const d = dents[Math.floor(Math.random() * dents.length)];
              if (variant === 'heal') d.heal = Math.min(1, d.heal + 0.4);
            }
            p.y = -0.05; p.x = Math.random();
          }
          const px = p.x * w, py = p.y * h;
          ctx.globalAlpha = p.o;
          ctx.fillStyle = isLight ? '#6b7280' : '#e8ecf2';
          ctx.beginPath();
          ctx.ellipse(px, py, p.s * 0.6, p.s * 1.6, 0, 0, Math.PI * 2);
          ctx.fill();
          // streak
          ctx.globalAlpha = p.o * 0.3;
          ctx.strokeStyle = isLight ? '#9ca3af' : '#8994a8';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - 1, py - p.s * 8);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Ripples
      ctx.save();
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.r += 0.8; r.life -= 0.02;
        if (r.life <= 0) { ripples.splice(i, 1); continue; }
        ctx.strokeStyle = accent;
        ctx.globalAlpha = r.life * 0.6;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(r.x * w, r.y * h, r.r, r.r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Heal dents over time in 'heal' variant
      if (variant === 'heal') {
        for (const d of dents) d.heal = Math.max(0, d.heal - 0.003);
      }

      // Scanning line for xray
      if (variant === 'xray') {
        const sy = (Math.sin(elapsed * 0.6) * 0.5 + 0.5);
        const lineY = h * 0.3 + sy * h * 0.4;
        ctx.save();
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.08;
        ctx.fillRect(0, lineY - 40, w, 80);
        ctx.globalAlpha = 0.6;
        ctx.fillRect(0, lineY, w, 1);
        ctx.restore();
      }

      // Lightning flash occasionally
      if (variant === 'storm' && Math.random() < 0.003) {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.08;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }

      // Vignette
      const vg = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.2, w/2, h/2, Math.max(w,h)*0.7);
      vg.addColorStop(0, 'transparent');
      vg.addColorStop(1, isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, [variant, accent, isLight]);

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />;
}

function drawCar(ctx, w, h, accent, variant, t, dents, isLight) {
  // 3/4 profile sedan silhouette built from beziers
  const cx = w * 0.5, cy = h * 0.62;
  const cw = Math.min(w * 0.78, 1100), ch = cw * 0.32;
  const x = cx - cw / 2, y = cy - ch / 2;

  ctx.save();
  // subtle floor reflection
  ctx.save();
  ctx.translate(cx, cy + ch * 0.55);
  ctx.scale(1, -0.3);
  ctx.globalAlpha = isLight ? 0.1 : 0.18;
  drawCarBody(ctx, -cw/2, -ch/2, cw, ch, isLight ? '#1f2129' : '#1a1c22', accent, isLight);
  ctx.restore();
  ctx.globalAlpha = 0.18 * 0;

  // Car body
  drawCarBody(ctx, x, y, cw, ch, isLight ? '#1f2129' : '#1a1c22', accent, isLight);

  // Hood shimmer (paint reflection)
  const shimmer = ctx.createLinearGradient(x, y, x + cw, y + ch);
  shimmer.addColorStop(0, 'transparent');
  shimmer.addColorStop(0.4 + Math.sin(t * 0.5) * 0.1, accent + '18');
  shimmer.addColorStop(0.6 + Math.sin(t * 0.5) * 0.1, 'transparent');
  ctx.save();
  carClip(ctx, x, y, cw, ch);
  ctx.fillStyle = shimmer;
  ctx.fillRect(x, y, cw, ch);
  ctx.restore();

  // Dents on hood
  if (variant !== 'xray') {
    ctx.save();
    carClip(ctx, x, y, cw, ch);
    for (const d of dents) {
      const dx = x + cw * d.x, dy = y + ch * d.y;
      const rad = d.r * d.heal;
      if (rad < 0.5) continue;
      // dent = dark radial blob with highlight ring
      const rg = ctx.createRadialGradient(dx - rad*0.3, dy - rad*0.3, 0, dx, dy, rad);
      rg.addColorStop(0, `rgba(0,0,0,${0.55 * d.depth * d.heal})`);
      rg.addColorStop(0.7, `rgba(0,0,0,${0.15 * d.depth * d.heal})`);
      rg.addColorStop(1, 'transparent');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(dx, dy, rad, 0, Math.PI*2); ctx.fill();
      // highlight
      ctx.strokeStyle = `rgba(255,255,255,${0.12 * d.heal})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.arc(dx + rad*0.15, dy + rad*0.15, rad * 0.8, 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }

  // Xray: wireframe panels
  if (variant === 'xray') {
    ctx.save();
    carClip(ctx, x, y, cw, ch);
    ctx.strokeStyle = accent + 'aa';
    ctx.lineWidth = 0.6;
    ctx.globalAlpha = 0.8;
    const cols = 28, rows = 8;
    for (let i = 0; i <= cols; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (i/cols)*cw, y);
      ctx.lineTo(x + (i/cols)*cw, y + ch);
      ctx.stroke();
    }
    for (let j = 0; j <= rows; j++) {
      ctx.beginPath();
      ctx.moveTo(x, y + (j/rows)*ch);
      ctx.lineTo(x + cw, y + (j/rows)*ch);
      ctx.stroke();
    }
    // hot spots
    for (const d of dents) {
      const dx = x + cw * d.x, dy = y + ch * d.y;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.3 + Math.sin(t*2 + d.x*10) * 0.2;
      ctx.beginPath(); ctx.arc(dx, dy, 3 + d.depth*4, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.12;
      ctx.beginPath(); ctx.arc(dx, dy, 10 + d.depth*8, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();
}

// Car silhouette path (profile of sedan)
function carPath(ctx, x, y, w, h) {
  ctx.beginPath();
  // baseline
  ctx.moveTo(x + w*0.02, y + h*0.95);
  // front bumper
  ctx.quadraticCurveTo(x, y + h*0.85, x + w*0.04, y + h*0.7);
  ctx.lineTo(x + w*0.06, y + h*0.55);
  // hood rise
  ctx.quadraticCurveTo(x + w*0.08, y + h*0.45, x + w*0.2, y + h*0.42);
  // windshield
  ctx.quadraticCurveTo(x + w*0.28, y + h*0.15, x + w*0.42, y + h*0.08);
  // roof
  ctx.lineTo(x + w*0.62, y + h*0.08);
  // rear window
  ctx.quadraticCurveTo(x + w*0.78, y + h*0.15, x + w*0.82, y + h*0.42);
  // trunk
  ctx.quadraticCurveTo(x + w*0.9, y + h*0.45, x + w*0.94, y + h*0.55);
  // rear bumper
  ctx.lineTo(x + w*0.97, y + h*0.7);
  ctx.quadraticCurveTo(x + w, y + h*0.85, x + w*0.98, y + h*0.95);
  ctx.closePath();
}

function carClip(ctx, x, y, w, h) {
  carPath(ctx, x, y, w, h);
  ctx.clip();
}

function drawCarBody(ctx, x, y, w, h, color, accent, isLight) {
  ctx.save();
  // body fill
  carPath(ctx, x, y, w, h);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  if (isLight) {
    g.addColorStop(0, '#3a3d47');
    g.addColorStop(0.5, color);
    g.addColorStop(1, '#0b0c10');
  } else {
    g.addColorStop(0, '#2a2d35');
    g.addColorStop(0.5, color);
    g.addColorStop(1, '#0e0f13');
  }
  ctx.fillStyle = g;
  ctx.fill();

  // top highlight
  ctx.save();
  carClip(ctx, x, y, w, h);
  const hl = ctx.createLinearGradient(0, y, 0, y + h*0.4);
  hl.addColorStop(0, 'rgba(255,255,255,0.08)');
  hl.addColorStop(1, 'transparent');
  ctx.fillStyle = hl;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  // windows (darker region)
  ctx.save();
  carClip(ctx, x, y, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.moveTo(x + w*0.22, y + h*0.4);
  ctx.quadraticCurveTo(x + w*0.3, y + h*0.12, x + w*0.44, y + h*0.09);
  ctx.lineTo(x + w*0.6, y + h*0.09);
  ctx.quadraticCurveTo(x + w*0.76, y + h*0.13, x + w*0.8, y + h*0.4);
  ctx.closePath();
  ctx.fill();
  // pillar
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x + w*0.5, y + h*0.08, w*0.015, h*0.32);
  ctx.restore();

  // Wheels
  const wy = y + h*0.92;
  const wr = h*0.22;
  for (const wx of [x + w*0.18, x + w*0.82]) {
    // wheel well shadow
    ctx.fillStyle = '#05060a';
    ctx.beginPath(); ctx.arc(wx, wy, wr*1.15, 0, Math.PI*2); ctx.fill();
    // tire
    ctx.fillStyle = '#0c0d11';
    ctx.beginPath(); ctx.arc(wx, wy, wr, 0, Math.PI*2); ctx.fill();
    // rim
    ctx.fillStyle = '#1a1c22';
    ctx.beginPath(); ctx.arc(wx, wy, wr*0.55, 0, Math.PI*2); ctx.fill();
    // rim detail
    ctx.strokeStyle = accent + '66';
    ctx.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const a = k * (Math.PI*2/5);
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + Math.cos(a)*wr*0.5, wy + Math.sin(a)*wr*0.5);
      ctx.stroke();
    }
    ctx.fillStyle = '#2a2d35';
    ctx.beginPath(); ctx.arc(wx, wy, wr*0.12, 0, Math.PI*2); ctx.fill();
  }

  // Headlight
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.ellipse(x + w*0.05, y + h*0.62, 4, 2, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.ellipse(x + w*0.05, y + h*0.62, 14, 5, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Taillight
  ctx.fillStyle = '#ff5a3c';
  ctx.beginPath();
  ctx.ellipse(x + w*0.96, y + h*0.62, 3, 1.5, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.restore();
}

window.HeroCanvas = HeroCanvas;
