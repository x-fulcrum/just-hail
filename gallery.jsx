/* Gallery section with real shop photos + lightbox */

function Gallery({ accent }) {
  const isMobile = useIsMobile(900);
  const shots = [
    { src: 'img/damage-closeup.webp', label: 'Pre-repair · Hail damage to black coupe hood', w: 2, h: 1 },
    { src: 'img/before-after.webp', label: 'Reflected-light inspection · F250 hood', w: 2, h: 1 },
    { src: 'img/repair-bay.jpeg', label: 'Charlie & Chad · Since 2009 — still making dents disappear', caption: 'Charlie and Chad, back in 2009. The same two guys are still at it here in 2026, making dents disappear. True craftsmen.', w: 4, h: 1 },
  ];
  const [lightbox, setLightbox] = React.useState(null); // index or null

  React.useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') setLightbox(i => (i + 1) % shots.length);
      if (e.key === 'ArrowLeft') setLightbox(i => (i - 1 + shots.length) % shots.length);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [lightbox, shots.length]);

  return (
    <section style={{ padding: isMobile ? '96px 0' : '160px 0', borderBottom: '1px solid var(--hair)', background: 'var(--surface-alt)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '0 20px' : '0 40px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '360px 1fr',
          gap: isMobile ? 36 : 56,
          alignItems: 'start',
        }}>
          {/* LEFT — copy column */}
          <Reveal>
            <div style={{ position: isMobile ? 'static' : 'sticky', top: 120 }}>
              <Eyebrow>· The shop</Eyebrow>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(40px, 4.2vw, 64px)', lineHeight: 1.02, margin: '14px 0 24px', fontWeight: 400, letterSpacing: '-0.02em' }}>
                Real work. <em style={{ color: accent, fontStyle: 'italic' }}>Real cars.</em>
              </h2>
              <p style={{ color: 'var(--ink-dim)', fontSize: 16, lineHeight: 1.6, margin: '0 0 24px' }}>
                No stock photography. Every frame here rolled through our bay in Leander — before, during, and after a storm made it ours for a few days.
              </p>
              <p style={{ color: 'var(--ink-dim)', fontSize: 14, lineHeight: 1.65, margin: '0 0 28px' }}>
                Click any photo to view full resolution. Use <kbd style={kbdStyle}>←</kbd> <kbd style={kbdStyle}>→</kbd> to browse, <kbd style={kbdStyle}>Esc</kbd> to close.
              </p>

            </div>
          </Reveal>

          {/* RIGHT — photo stack */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: 14,
          }}>
            {shots.map((s, i) => (
              <Reveal key={i} delay={i * 70} style={{
                gridColumn: isMobile ? 'auto' : `span ${Math.min(s.w, 2)}`,
                aspectRatio: isMobile ? '4 / 3' : (s.w >= 2 ? (s.w === 4 ? '16 / 7' : '16 / 9') : '4 / 3'),
              }}>
                <GalleryTile src={s.src} label={s.label} accent={accent} onClick={() => setLightbox(i)} />
              </Reveal>
            ))}
          </div>
        </div>
      </div>

      {lightbox !== null && (
        <Lightbox
          shot={shots[lightbox]}
          accent={accent}
          index={lightbox}
          total={shots.length}
          onClose={() => setLightbox(null)}
          onPrev={() => setLightbox(i => (i - 1 + shots.length) % shots.length)}
          onNext={() => setLightbox(i => (i + 1) % shots.length)}
        />
      )}
    </section>
  );
}

function GalleryTile({ src, label, accent, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
        background: '#000', cursor: 'zoom-in', border: 0, padding: 0, display: 'block',
      }}
    >
      <img src={src} alt={label} loading="lazy" style={{
        width: '100%', height: '100%', objectFit: 'cover',
        imageRendering: 'auto',
        transform: hover ? 'scale(1.04)' : 'scale(1)',
        transition: 'transform 900ms cubic-bezier(.2,.7,.2,1), filter 500ms',
        filter: hover ? 'saturate(1.05) contrast(1.02)' : 'saturate(0.92) contrast(0.98)',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, transparent 40%, rgba(0,0,0,${hover ? 0.75 : 0.55}) 100%)`,
        transition: 'background 400ms',
      }} />
      {/* zoom glyph */}
      <div style={{
        position: 'absolute', top: 14, right: 14,
        width: 36, height: 36, borderRadius: 999,
        background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.3)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: hover ? 1 : 0, transform: hover ? 'scale(1)' : 'scale(0.85)',
        transition: 'opacity 300ms, transform 300ms',
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.6">
          <circle cx="7" cy="7" r="4.5"/>
          <line x1="10.5" y1="10.5" x2="14" y2="14"/>
          <line x1="5" y1="7" x2="9" y2="7"/>
          <line x1="7" y1="5" x2="7" y2="9"/>
        </svg>
      </div>
      <div style={{
        position: 'absolute', left: 16, bottom: 14, right: 16,
        color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 11,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
        transform: hover ? 'translateY(0)' : 'translateY(4px)',
        transition: 'transform 400ms',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, flexShrink: 0 }} />
        <span>{label}</span>
      </div>
    </button>
  );
}

function Lightbox({ shot, accent, index, total, onClose, onPrev, onNext }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(6,7,10,0.94)',
        backdropFilter: 'blur(18px)',
        display: 'flex', flexDirection: 'column',
        animation: 'lightboxIn 260ms cubic-bezier(.2,.7,.2,1)',
      }}
    >
      {/* top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '22px 32px', color: '#e9ecf2',
        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent }} />
          <span style={{ opacity: 0.8 }}>Just Hail · Shop photo {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.18)',
            color: '#fff', padding: '8px 16px', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 10,
          }}
        >
          Close
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1 L9 9 M9 1 L1 9" stroke="#fff" strokeWidth="1.2" fill="none"/></svg>
        </button>
      </div>

      {/* image stage */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 80px',
        }}
      >
        <img
          src={shot.src}
          alt={shot.label}
          style={{
            maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto',
            objectFit: 'contain', display: 'block',
            boxShadow: '0 40px 120px rgba(0,0,0,0.6)',
            animation: 'lightboxImg 380ms cubic-bezier(.2,.7,.2,1)',
          }}
        />

        {/* prev / next */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          aria-label="Previous photo"
          style={navBtnStyle('left')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M9 2 L4 7 L9 12" stroke="#fff" strokeWidth="1.4" fill="none"/></svg>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          aria-label="Next photo"
          style={navBtnStyle('right')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M5 2 L10 7 L5 12" stroke="#fff" strokeWidth="1.4" fill="none"/></svg>
        </button>
      </div>

      {/* caption */}
      <div style={{
        padding: '22px 32px 30px', color: '#e9ecf2',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap',
      }}>
        <div style={{ maxWidth: 760 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8a8f9a', marginBottom: 8 }}>
            {shot.caption ? 'Story' : 'Caption'}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: shot.caption ? 24 : 22, letterSpacing: '-0.01em', lineHeight: 1.25, textWrap: 'pretty' }}>
            {shot.caption || shot.label}
          </div>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8a8f9a' }}>
          Esc to close · ← → to browse
        </div>
      </div>
    </div>
  );
}

function navBtnStyle(side) {
  return {
    position: 'absolute', top: '50%', [side]: 20, transform: 'translateY(-50%)',
    width: 52, height: 52, borderRadius: 999,
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.22)',
    color: '#fff', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(8px)',
    transition: 'background 200ms, transform 200ms',
  };
}

const kbdStyle = {
  fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
  border: '1px solid var(--hair-strong)', borderRadius: 3,
  color: 'var(--ink)', background: 'var(--bg)',
  letterSpacing: '0.05em',
};

window.Gallery = Gallery;
