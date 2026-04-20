/* Tweaks panel + main app */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "accent": "#b00020",
  "heroVariant": "heal"
}/*EDITMODE-END*/;

const THEMES = {
  light: { bg:'#ffffff', surface:'#ffffff', surfaceAlt:'#f5f4f0', surfaceHover:'#ecebe5', ink:'#0b0c10', inkDim:'#55575f', hair:'#e4e2db', hairStrong:'#b8b5ac' },
  dark:  { bg:'#0a0b10', surface:'#101218', surfaceAlt:'#0d0f14', surfaceHover:'#14161d', ink:'#f2f0ea', inkDim:'#8b8d96', hair:'#1a1c24', hairStrong:'#2a2d35' },
  storm: { bg:'#0f1318', surface:'#141a22', surfaceAlt:'#0b0e13', surfaceHover:'#17202c', ink:'#e8f1fa', inkDim:'#7f8ea0', hair:'#1c232d', hairStrong:'#2b3542' },
};

const ACCENT_SWATCHES = ['#b00020','#e94f37','#f3a83a','#39d7aa','#5fa8ff','#c48cff'];
const HERO_VARIANTS = [
  { k: 'heal', n: 'Dent → Smooth', d: 'Hail falls, dents form, paintless repair heals them.' },
  { k: 'storm', n: 'Storm over car', d: 'Continuous hail + ripple impact on the hood.' },
  { k: 'xray', n: 'Panel X-Ray', d: 'Wireframe scan highlighting each damage hotspot.' },
];

function App() {
  const [cfg, setCfg] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('jh-cfg')||'null') || {};
      // migrate old peach/orange accent to blood red
      if (saved.accent && /^#(d97316|f3a83a|f56ea0|e94f37)$/i.test(saved.accent)) saved.accent = '#b00020';
      return { ...TWEAK_DEFAULTS, ...saved };
    } catch { return TWEAK_DEFAULTS; }
  });
  const [editMode, setEditMode] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);

  const theme = THEMES[cfg.theme] || THEMES.dark;

  // Apply theme to document
  React.useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty('--bg', theme.bg);
    r.style.setProperty('--surface', theme.surface);
    r.style.setProperty('--surface-alt', theme.surfaceAlt);
    r.style.setProperty('--surface-hover', theme.surfaceHover);
    r.style.setProperty('--ink', theme.ink);
    r.style.setProperty('--ink-dim', theme.inkDim);
    r.style.setProperty('--hair', theme.hair);
    r.style.setProperty('--hair-strong', theme.hairStrong);
    r.style.setProperty('--accent', cfg.accent);
    r.style.setProperty('--logo-filter', cfg.theme === 'light' ? 'none' : 'invert(1)');
    r.style.setProperty('--logo-chip-bg', cfg.theme === 'light' ? '#ffffff' : 'rgba(255,255,255,0.96)');
    r.style.setProperty('--logo-chip-border', cfg.theme === 'light' ? '1px solid var(--hair)' : '1px solid transparent');
    document.body.style.background = theme.bg;
    document.body.style.color = theme.ink;
    localStorage.setItem('jh-cfg', JSON.stringify(cfg));
  }, [cfg, theme]);

  // Edit mode protocol
  React.useEffect(() => {
    function onMsg(e) {
      if (e.data?.type === '__activate_edit_mode') setEditMode(true);
      else if (e.data?.type === '__deactivate_edit_mode') setEditMode(false);
    }
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Scroll state
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const update = (patch) => {
    setCfg(c => {
      const next = { ...c, ...patch };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: patch }, '*');
      return next;
    });
  };

  return (
    <>
      <StormAlert accent={cfg.accent} />
      <Nav accent={cfg.accent} scrolled={scrolled} />

      {/* HERO */}
      <section style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', borderBottom: '1px solid var(--hair)', background: '#0a0b10' }}>
        {/* Video background */}
        <video
          autoPlay muted loop playsInline
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center',
            zIndex: 0,
            animation: 'heroZoom 24s ease-out infinite alternate',
            filter: 'saturate(0.88) contrast(1.05)',
          }}
        >
          <source src="video/hero.mp4" type="video/mp4" />
        </video>

        {/* Film grain */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
          backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
          opacity: 0.18, mixBlendMode: 'overlay',
        }} />

        {/* Cinematic vignette: dark everywhere except slight brightness mid, heavy at bottom for text legibility */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 30% 40%, rgba(10,11,16,0.25) 0%, rgba(10,11,16,0.55) 45%, rgba(10,11,16,0.82) 80%, rgba(10,11,16,0.95) 100%)',
        }} />
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
          background: 'linear-gradient(180deg, rgba(10,11,16,0.55) 0%, rgba(10,11,16,0) 25%, rgba(10,11,16,0) 55%, rgba(10,11,16,0.88) 92%, var(--bg) 100%)',
        }} />
        {/* Accent bloom */}
        <div style={{
          position: 'absolute', right: '-10%', top: '20%', width: '55%', height: '55%',
          background: `radial-gradient(circle, ${cfg.accent}22 0%, transparent 65%)`,
          zIndex: 2, pointerEvents: 'none', mixBlendMode: 'screen',
        }} />
        <div style={{
          position: 'relative', zIndex: 3, maxWidth: 1280, margin: '0 auto',
          padding: '180px 40px 120px', minHeight: '100vh',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          color: '#f5f3ee',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.accent, boxShadow: `0 0 10px ${cfg.accent}`, animation: 'pulse 1.6s ease-in-out infinite' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'rgba(245,243,238,0.7)', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
                Central Texas · Hail season active · Openings available now
              </span>
            </div>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: 'clamp(64px, 10vw, 168px)',
              lineHeight: 0.9, margin: 0, fontWeight: 400, letterSpacing: '-0.035em',
              maxWidth: 1200,
              textShadow: '0 4px 40px rgba(0,0,0,0.4)',
            }}>
              The storm <em style={{ color: cfg.accent, fontStyle: 'italic' }}>took it.</em><br />
              We give it <em style={{ fontStyle: 'italic' }}>back.</em>
            </h1>
            <p style={{
              marginTop: 40, maxWidth: 580, color: 'rgba(245,243,238,0.82)',
              fontSize: 19, lineHeight: 1.5,
              textShadow: '0 2px 20px rgba(0,0,0,0.5)',
            }}>
              Paintless dent repair, insurance direct-billing, lifetime warranty. Since 2008, we've returned 24,800+ vehicles to factory finish — usually at zero out-of-pocket to the owner.
            </p>
            <div style={{ marginTop: 48, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <a href="#contact" style={{
                padding: '18px 30px', background: cfg.accent, color: '#0a0b10',
                textDecoration: 'none', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 500,
                borderRadius: 2, display: 'inline-flex', alignItems: 'center', gap: 10,
              }}>Request a free estimate <span>→</span></a>
              <a href="tel:+15122213013" style={{
                padding: '18px 30px', background: 'rgba(255,255,255,0.06)', color: '#f5f3ee',
                border: '1px solid rgba(245,243,238,0.25)',
                backdropFilter: 'blur(8px)',
                textDecoration: 'none', fontFamily: 'var(--font-ui)', fontSize: 15,
                borderRadius: 2, display: 'inline-flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.accent }} />
                (512) 221-3013
              </a>
            </div>
          </div>

          {/* Floating hero data strip */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1,
            background: 'rgba(245,243,238,0.15)',
            border: '1px solid rgba(245,243,238,0.18)',
            marginTop: 64,
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
          }}>
            {[
              { k: 'A+ BBB', v: 'Accreditation since 2009', img: 'img/bbb-accredited.png' },
              { k: 'Lifetime', v: 'Workmanship warranty' },
              { k: '38 Carriers', v: 'Insurance direct-bill' },
              { k: '4.9', v: '832 Google reviews', stars: true },
            ].map((item, i) => (
              <div key={i} style={{
                background: 'rgba(10,11,16,0.55)',
                padding: '24px 24px',
                display: 'flex', alignItems: 'center', gap: 16,
              }}>
                {item.img && <img src={item.img} alt="BBB Accredited Business" style={{ height: 52, width: 'auto', flexShrink: 0, filter: 'brightness(1.1)' }} />}
                <div>
                  {item.stars && (
                    <div style={{ display: 'flex', gap: 3, marginBottom: 6 }} aria-label="5 out of 5 stars">
                      {[0,1,2,3,4].map(s => (
                        <svg key={s} width="16" height="16" viewBox="0 0 20 20" fill="#f5b301" style={{ filter: 'drop-shadow(0 1px 2px rgba(245,179,1,0.35))' }}>
                          <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z"/>
                        </svg>
                      ))}
                    </div>
                  )}
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, letterSpacing: '-0.01em', color: '#f5f3ee' }}>{item.k}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(245,243,238,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 8 }}>{item.v}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* scroll cue */}
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(245,243,238,0.6)', letterSpacing: '0.16em',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, zIndex: 3,
        }}>
          SCROLL
          <div style={{ width: 1, height: 40, background: 'rgba(245,243,238,0.2)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 10, background: cfg.accent, animation: 'scrollCue 2s ease-in-out infinite' }} />
          </div>
        </div>
      </section>

      <div style={{ padding: '28px 40px 12px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            01 — Insurance partners
          </div>
          <div style={{ flex: 1, height: 1, background: 'var(--hair)' }} />
        </div>
      </div>
      <Marquee items={INSURERS} accent={cfg.accent} />

      <Metrics accent={cfg.accent} />
      <Features accent={cfg.accent} />
      <Gallery accent={cfg.accent} />
      <section id="process"><Process accent={cfg.accent} /></section>
      <Testimonials accent={cfg.accent} />
      <FAQ accent={cfg.accent} />
      <Resources accent={cfg.accent} />
      <ContactBlock accent={cfg.accent} />
      <CTABanner accent={cfg.accent} />
      <Footer accent={cfg.accent} />

      <ChatWidget accent={cfg.accent} />

      {editMode && <TweaksPanel cfg={cfg} update={update} />}
    </>
  );
}

function TweaksPanel({ cfg, update }) {
  return (
    <div style={{
      position: 'fixed', top: 80, right: 24, zIndex: 100,
      width: 300, background: 'var(--surface)',
      border: '1px solid var(--hair-strong)',
      padding: 20, fontFamily: 'var(--font-ui)',
      boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
      borderRadius: 2,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 400 }}>Tweaks</div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em' }}>LIVE</span>
      </div>

      <TweakSection label="Theme">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {Object.keys(THEMES).map(k => (
            <button key={k} onClick={() => update({ theme: k })} style={{
              padding: '10px 8px', fontSize: 12, fontFamily: 'var(--font-mono)',
              background: cfg.theme === k ? 'var(--accent)' : 'transparent',
              color: cfg.theme === k ? '#0a0b10' : 'var(--ink)',
              border: `1px solid ${cfg.theme === k ? 'var(--accent)' : 'var(--hair-strong)'}`,
              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em',
              borderRadius: 2,
            }}>{k}</button>
          ))}
        </div>
      </TweakSection>

      <TweakSection label="Accent">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ACCENT_SWATCHES.map(c => (
            <button key={c} onClick={() => update({ accent: c })} style={{
              width: 32, height: 32, border: cfg.accent === c ? '2px solid var(--ink)' : '1px solid var(--hair-strong)',
              background: c, cursor: 'pointer', padding: 0, borderRadius: 2,
            }} aria-label={c} />
          ))}
        </div>
      </TweakSection>

      <TweakSection label="Hero variant">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {HERO_VARIANTS.map(v => (
            <button key={v.k} onClick={() => update({ heroVariant: v.k })} style={{
              padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
              background: cfg.heroVariant === v.k ? 'var(--surface-alt)' : 'transparent',
              color: 'var(--ink)',
              border: `1px solid ${cfg.heroVariant === v.k ? 'var(--accent)' : 'var(--hair)'}`,
              borderRadius: 2,
            }}>
              <div style={{ fontSize: 13 }}>{v.n}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', marginTop: 3 }}>{v.d}</div>
            </button>
          ))}
        </div>
      </TweakSection>
    </div>
  );
}

function TweakSection({ label, children }) {
  return (
    <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--hair)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>{label}</div>
      {children}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
