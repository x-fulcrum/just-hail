/* Sections: marquee, metrics, features, testimonials, FAQ, resources, CTA, footer */

function useInView(options = {}) {
  const ref = React.useRef(null);
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); io.disconnect(); }
    }, { threshold: 0.15, ...options });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView];
}

function Reveal({ children, delay = 0, y = 24, style = {} }) {
  const [ref, inView] = useInView();
  return (
    <div ref={ref} style={{
      opacity: inView ? 1 : 0,
      transform: inView ? 'translateY(0)' : `translateY(${y}px)`,
      transition: `opacity 900ms cubic-bezier(.2,.7,.2,1) ${delay}ms, transform 900ms cubic-bezier(.2,.7,.2,1) ${delay}ms`,
      ...style,
    }}>{children}</div>
  );
}

function CountUp({ to, suffix = '', duration = 1800, decimals = 0 }) {
  const [ref, inView] = useInView();
  const [val, setVal] = React.useState(0);
  React.useEffect(() => {
    if (!inView) return;
    let start; 
    const step = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(to * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [inView, to, duration]);
  return <span ref={ref}>{val.toFixed(decimals)}{suffix}</span>;
}

const INSURERS = [
  'State Farm', 'Allstate', 'Geico', 'USAA', 'Progressive', 'Farmers',
  'Liberty Mutual', 'Nationwide', 'American Family', 'Travelers', 'Safeco', 'Erie',
];

const INSURER_LOGOS = [
  'https://irp.cdn-website.com/2c96bc3b/dms3rep/multi/download+%286%29.png',
  'https://irp.cdn-website.com/2c96bc3b/dms3rep/multi/download+%287%29.png',
  'https://irp.cdn-website.com/2c96bc3b/dms3rep/multi/download.jpeg',
  'https://irp.cdn-website.com/2c96bc3b/dms3rep/multi/download.png',
  'https://irp.cdn-website.com/2c96bc3b/dms3rep/multi/download+%281%29.png',
  'https://irp.cdn-website.com/2c96bc3b/dms3rep/multi/download+%282%29.png',
  'https://irp.cdn-website.com/2c96bc3b/dms3rep/multi/download+%283%29.png',
  'https://irp.cdn-website.com/2c96bc3b/dms3rep/multi/download+%284%29.png',
  'https://irp.cdn-website.com/2c96bc3b/dms3rep/multi/download+%285%29.png',
];

function Marquee({ items, accent }) {
  const logos = [...INSURER_LOGOS, ...INSURER_LOGOS];
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      padding: '56px 0 64px', borderTop: '1px solid var(--hair)', borderBottom: '1px solid var(--hair)',
    }}>
      <p style={{
        textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11,
        color: 'var(--ink-dim)', letterSpacing: '0.22em', textTransform: 'uppercase',
        margin: '0 0 40px',
      }}>
        Trusted by every major insurance provider
      </p>
      <div style={{
        position: 'relative', overflow: 'hidden',
        maskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)',
      }}>
        <div style={{
          display: 'flex', gap: 80, alignItems: 'center',
          animation: 'insuranceScroll 40s linear infinite', width: 'max-content',
        }}>
          {logos.map((src, i) => (
            <div
              key={i}
              style={{
                flexShrink: 0,
                background: 'var(--logo-chip-bg, rgba(255,255,255,0.96))',
                border: 'var(--logo-chip-border, 1px solid transparent)',
                borderRadius: 10,
                padding: '14px 22px',
                height: 82,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                transition: 'transform 200ms, box-shadow 200ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px) scale(1.03)'; e.currentTarget.style.boxShadow = '0 14px 30px rgba(0,0,0,0.14)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0) scale(1)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'; }}
            >
              <img
                src={src}
                alt=""
                style={{ height: 54, width: 'auto', display: 'block' }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metrics({ accent }) {
  const stats = [
    { label: 'Years in business', value: 17, suffix: '' },
    { label: 'Vehicles restored', value: 24800, suffix: '+' },
    { label: 'Avg. insurance claim approval', value: 97.4, suffix: '%', decimals: 1 },
    { label: 'Typical out-of-pocket', value: 0, suffix: '$', prefix: true },
  ];
  return (
    <section style={{ padding: '140px 0', borderBottom: '1px solid var(--hair)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 40px' }}>
        <Reveal>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 80, flexWrap: 'wrap', gap: 24 }}>
            <div>
              <Eyebrow>02 — Receipts</Eyebrow>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(40px, 5vw, 72px)', lineHeight: 1, margin: '14px 0 0', fontWeight: 400, letterSpacing: '-0.02em' }}>
                The numbers behind <em style={{ color: accent, fontStyle: 'italic' }}>the promise.</em>
              </h2>
            </div>
            <p style={{ maxWidth: 360, color: 'var(--ink-dim)', fontSize: 16, lineHeight: 1.6 }}>
              Live from our shop floor in Leander, TX. Updated as each vehicle rolls out.
            </p>
          </div>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 0, borderTop: '1px solid var(--hair)' }}>
          {stats.map((s, i) => (
            <Reveal key={i} delay={i * 80}>
              <div style={{
                padding: '44px 32px', borderBottom: '1px solid var(--hair)',
                borderRight: i < stats.length - 1 ? '1px solid var(--hair)' : 'none',
                minHeight: 200, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.08em' }}>
                  0{i+1} / {stats.length.toString().padStart(2,'0')}
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(56px, 7vw, 96px)', lineHeight: 0.95, letterSpacing: '-0.03em', fontWeight: 400 }}>
                    {s.prefix && s.suffix}<CountUp to={s.value} suffix={!s.prefix ? s.suffix : ''} decimals={s.decimals || 0} />
                  </div>
                  <div style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Eyebrow({ children }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-dim)',
      textTransform: 'uppercase', letterSpacing: '0.12em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
      {children}
    </div>
  );
}

function Features({ accent }) {
  const items = [
    {
      title: 'Paintless Dent Repair',
      body: 'Micro-precision push rods reshape metal from the inside. Zero paint, zero filler, zero evidence.',
      meta: 'Preserves factory finish',
      glyph: 'pdr',
    },
    {
      title: 'Insurance Direct-Billing',
      body: 'We negotiate the claim with your carrier. Most customers pay $0 out of pocket after deductible waivers.',
      meta: '38 carriers supported',
      glyph: 'insurance',
    },
    {
      title: 'Lifetime Workmanship Warranty',
      body: "If a repaired panel ever fails, we fix it free—for as long as you own the car. That's the paperwork, not the pitch.",
      meta: 'Transferable on request',
      glyph: 'warranty',
    },
    {
      title: 'Real-Time Repair Tracking',
      body: 'Every stage photographed and logged. Watch the work happen from your phone—inspection, planning, execution, QC.',
      meta: 'SMS + web dashboard',
      glyph: 'track',
    },
    {
      title: 'OEM-Certified Glass',
      body: 'Cracked windshield? We replace with manufacturer-spec glass and recalibrate ADAS sensors on-site.',
      meta: 'Acura → Volvo',
      glyph: 'glass',
    },
    {
      title: 'Free Mobile Estimates',
      body: 'Snap six photos in our app; receive a bonded estimate in 24 hours. No shop visit, no obligation.',
      meta: 'Avg. response: 4.2 hrs',
      glyph: 'estimate',
    },
  ];
  return (
    <section id="services" style={{ padding: '160px 0', borderBottom: '1px solid var(--hair)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 40px' }}>
        <Reveal>
          <Eyebrow>03 — Services</Eyebrow>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(48px, 6vw, 88px)', lineHeight: 1, margin: '14px 0 80px', fontWeight: 400, letterSpacing: '-0.02em', maxWidth: 900 }}>
            A full-stack restoration shop, <em style={{ color: accent, fontStyle: 'italic' }}>not a dent brigade.</em>
          </h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 0, borderTop: '1px solid var(--hair)', borderLeft: '1px solid var(--hair)' }}>
          {items.map((it, i) => (
            <Reveal key={i} delay={i * 60}>
              <FeatureCard {...it} accent={accent} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ title, body, meta, glyph, accent }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', padding: '48px 36px 40px',
        borderRight: '1px solid var(--hair)', borderBottom: '1px solid var(--hair)',
        minHeight: 380, display: 'flex', flexDirection: 'column',
        background: hover ? 'var(--surface-hover)' : 'transparent',
        transition: 'background 400ms ease',
        cursor: 'pointer',
      }}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accent,
        transform: hover ? 'scaleX(1)' : 'scaleX(0)', transformOrigin: 'left',
        transition: 'transform 500ms cubic-bezier(.2,.7,.2,1)',
      }} />
      <div style={{ marginBottom: 40 }}><Glyph name={glyph} accent={accent} hover={hover} /></div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 400, margin: '0 0 14px', letterSpacing: '-0.01em' }}>{title}</h3>
      <p style={{ color: 'var(--ink-dim)', fontSize: 15, lineHeight: 1.6, flex: 1, margin: 0 }}>{body}</p>
      <div style={{
        marginTop: 28, paddingTop: 18, borderTop: '1px solid var(--hair)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>
        <span>{meta}</span>
        <span style={{ color: hover ? accent : 'var(--ink-dim)', transition: 'color 300ms', transform: hover ? 'translateX(4px)' : 'none', transitionProperty: 'color, transform' }}>→</span>
      </div>
    </div>
  );
}

function Glyph({ name, accent, hover }) {
  const s = {
    width: 56, height: 56,
    transform: hover ? 'rotate(-4deg) scale(1.05)' : 'none',
    transition: 'transform 500ms cubic-bezier(.2,.7,.2,1)',
  };
  const strokeColor = hover ? accent : 'var(--ink)';
  const common = { fill: 'none', stroke: strokeColor, strokeWidth: 1.2, style: { transition: 'stroke 300ms' } };
  switch (name) {
    case 'pdr': return (
      <svg viewBox="0 0 56 56" style={s}>
        <ellipse cx="28" cy="34" rx="22" ry="6" {...common} />
        <circle cx="28" cy="32" r="3" fill={accent} />
        <circle cx="18" cy="34" r="1.5" {...common} />
        <circle cx="38" cy="34" r="1.5" {...common} />
        <line x1="28" y1="14" x2="28" y2="29" {...common} />
        <polyline points="24,18 28,14 32,18" {...common} />
      </svg>
    );
    case 'insurance': return (
      <svg viewBox="0 0 56 56" style={s}>
        <path d="M28 6 L48 14 V30 C48 40 38 48 28 50 C18 48 8 40 8 30 V14 Z" {...common} />
        <polyline points="19,28 26,35 38,21" {...common} stroke={accent} strokeWidth="1.5" />
      </svg>
    );
    case 'warranty': return (
      <svg viewBox="0 0 56 56" style={s}>
        <circle cx="28" cy="26" r="14" {...common} />
        <path d="M20 34 L18 48 L28 42 L38 48 L36 34" {...common} />
        <text x="28" y="30" textAnchor="middle" fill={accent} fontSize="10" fontFamily="monospace">∞</text>
      </svg>
    );
    case 'track': return (
      <svg viewBox="0 0 56 56" style={s}>
        <rect x="6" y="12" width="44" height="28" rx="2" {...common} />
        <line x1="6" y1="20" x2="50" y2="20" {...common} />
        <circle cx="11" cy="16" r="1" fill={accent}/>
        <polyline points="12,32 20,26 28,30 36,22 44,28" stroke={accent} strokeWidth="1.5" fill="none" />
        <line x1="28" y1="40" x2="28" y2="46" {...common} />
        <line x1="22" y1="46" x2="34" y2="46" {...common} />
      </svg>
    );
    case 'glass': return (
      <svg viewBox="0 0 56 56" style={s}>
        <path d="M10 36 L14 18 L42 18 L46 36 Z" {...common} />
        <polyline points="14,18 20,36 26,18 32,36 38,18" {...common} />
        <path d="M22 28 L26 24 L30 30 L34 26" stroke={accent} strokeWidth="1.5" fill="none" />
      </svg>
    );
    case 'estimate': return (
      <svg viewBox="0 0 56 56" style={s}>
        <rect x="14" y="10" width="28" height="36" rx="2" {...common} />
        <line x1="20" y1="20" x2="36" y2="20" {...common} />
        <line x1="20" y1="26" x2="36" y2="26" {...common} />
        <line x1="20" y1="32" x2="30" y2="32" {...common} />
        <circle cx="40" cy="38" r="6" fill={accent}/>
        <text x="40" y="41" textAnchor="middle" fill="#0a0b10" fontSize="7" fontFamily="monospace" fontWeight="700">$0</text>
      </svg>
    );
    default: return null;
  }
}

function Process({ accent }) {
  const steps = [
    { n: '01', t: 'Estimate', b: 'Upload photos or swing by. We map every dent with a 3D panel scan and bond a price within 24 hours.' },
    { n: '02', t: 'Claim', b: 'We file with your carrier directly. Deductible often waived under "act of nature" coverage.' },
    { n: '03', t: 'Repair', b: 'Technician matched to your vehicle. Paintless dent repair by certified rod masters—avg. 3–5 days.' },
    { n: '04', t: 'Quality Check', b: '47-point QC under daylight-spectrum lamps. Factory finish restored or we redo it.' },
    { n: '05', t: 'Delivery', b: 'Hand-washed, detailed, and walked through with you. Lifetime warranty attached before you leave.' },
  ];
  return (
    <section style={{ padding: '160px 0', borderBottom: '1px solid var(--hair)', background: 'var(--surface-alt)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 40px' }}>
        <Reveal>
          <Eyebrow>04 — How it works</Eyebrow>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(48px, 6vw, 88px)', lineHeight: 1, margin: '14px 0 24px', fontWeight: 400, letterSpacing: '-0.02em' }}>
            Five steps. <em style={{ color: accent, fontStyle: 'italic' }}>No surprises.</em>
          </h2>
        </Reveal>
        <div style={{ marginTop: 64, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 0 }}>
          {steps.map((s, i) => (
            <Reveal key={i} delay={i*80}>
              <div style={{ padding: '36px 24px 36px 0', borderRight: i < steps.length-1 ? '1px solid var(--hair)' : 'none', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'var(--hair)' }} />
                <div style={{ position: 'absolute', top: -4, left: 0, width: 9, height: 9, borderRadius: '50%', background: accent }} />
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', marginTop: 24, letterSpacing: '0.08em' }}>{s.n}</div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, margin: '10px 0 14px' }}>{s.t}</h3>
                <p style={{ fontSize: 14, color: 'var(--ink-dim)', lineHeight: 1.6, margin: 0, paddingRight: 16 }}>{s.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials({ accent }) {
  const quotes = [
    {
      q: "Truck came out of the North Texas storm looking like a golf ball. Just Hail's crew had it flawless in four days and I paid nothing. Photographs at every step. Unreal.",
      n: 'Marcus Delgado',
      r: '2022 Ford F-150 Lightning',
      loc: 'Round Rock, TX',
    },
    {
      q: "I've owned four cars and never had a body shop experience like this. They walked me through the insurance side in a way my own adjuster couldn't. Repair status on my phone, live.",
      n: 'Priya Chen',
      r: '2021 Tesla Model Y',
      loc: 'Cedar Park, TX',
    },
    {
      q: "Lifetime warranty is not a marketing bullet here—it's on paper, signed, notarized. Took a stone chip back three years later and they handled it no questions.",
      n: 'Don Whitaker',
      r: '2019 GMC Sierra 1500',
      loc: 'Leander, TX',
    },
    {
      q: "I was quoted $8,400 at a dealership. Just Hail did better work for what the insurance paid and I walked out at zero. The paintless repair on my hood is invisible.",
      n: 'Alicia Moreno',
      r: '2023 Honda CR-V Hybrid',
      loc: 'Austin, TX',
    },
  ];
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setIdx(i => (i+1) % quotes.length), 7000);
    return () => clearInterval(t);
  }, []);
  return (
    <section id="reviews" style={{ padding: '160px 0', borderBottom: '1px solid var(--hair)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 40px' }}>
        <Reveal>
          <Eyebrow>05 — Reviews</Eyebrow>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 24, marginTop: 14, marginBottom: 64 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(48px, 6vw, 88px)', lineHeight: 1, margin: 0, fontWeight: 400, letterSpacing: '-0.02em' }}>
              Told straight, <em style={{ color: accent, fontStyle: 'italic' }}>from the driveway.</em>
            </h2>
            <div style={{ display: 'flex', gap: 6 }}>
              {quotes.map((_, i) => (
                <button key={i} onClick={() => setIdx(i)} aria-label={`Review ${i+1}`} style={{
                  width: i === idx ? 36 : 10, height: 4, border: 'none', padding: 0,
                  background: i === idx ? accent : 'var(--hair-strong)',
                  cursor: 'pointer', transition: 'width 400ms, background 400ms',
                }} />
              ))}
            </div>
          </div>
        </Reveal>
        <div style={{ position: 'relative', minHeight: 340 }}>
          {quotes.map((qu, i) => (
            <div key={i} style={{
              position: i === idx ? 'relative' : 'absolute', inset: 0,
              opacity: i === idx ? 1 : 0, transition: 'opacity 600ms',
              pointerEvents: i === idx ? 'auto' : 'none',
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 3.4vw, 48px)', lineHeight: 1.2, fontWeight: 400, letterSpacing: '-0.01em', maxWidth: 1100 }}>
                <span style={{ color: accent, marginRight: 8 }}>“</span>
                {qu.q}
                <span style={{ color: accent, marginLeft: 4 }}>”</span>
              </div>
              <div style={{ marginTop: 40, display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, #2a2d35, #0e0f13)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: 20, color: accent, border: '1px solid var(--hair-strong)' }}>
                  {qu.n.split(' ').map(w=>w[0]).join('')}
                </div>
                <div>
                  <div style={{ fontSize: 16 }}>{qu.n}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>{qu.r} · {qu.loc}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[...Array(5)].map((_,k) => <span key={k} style={{ color: '#e6b800', fontSize: 16 }}>★</span>)}
                  <span style={{ marginLeft: 10, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-dim)' }}>Google Reviews — 4.9 / 832</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ({ accent }) {
  const items = [
    { q: 'What exactly is paintless dent repair?', a: 'A certified technician uses specialty rods and pullers to massage the metal back to its factory shape from behind the panel. Because we never grind, fill, or repaint, your original finish stays intact—so the car retains its original-paint value at resale.' },
    { q: 'Do I really pay nothing out of pocket?', a: 'In most hail claims in Texas, yes. Comprehensive coverage usually carries a deductible, and we routinely negotiate a waiver as part of the "act of nature" clause. If any cost remains, we tell you in writing before work begins.' },
    { q: 'How long will my car be in the shop?', a: 'Small storms: 2–3 days. Heavy hail with 200+ dents: 5–8 days. You get a bonded timeline at estimate, plus live SMS updates so you are never waiting for a callback.' },
    { q: 'Is the lifetime warranty actually transferable?', a: 'It follows the VIN, not the owner, on request. If you sell the vehicle, contact us and we file a transfer with the new owner—no charge, no questions.' },
    { q: 'Will the repair affect my resale value?', a: 'Paintless dent repair is the only method that preserves original-paint status. CarFax and dealer inspection systems will not flag a properly documented PDR repair as body damage.' },
    { q: 'What if my car also needs glass or paint work?', a: 'We are a full collision center. Cracked windshields are replaced with OEM glass and recalibrated for ADAS on-site. If a panel is too damaged for PDR, we color-match paint to within Delta-E 0.8 of factory.' },
  ];
  const [open, setOpen] = React.useState(0);
  return (
    <section id="faq" style={{ padding: '160px 0', borderBottom: '1px solid var(--hair)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 40px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 80 }}>
        <Reveal>
          <div style={{ position: 'sticky', top: 120 }}>
            <Eyebrow>06 — Questions</Eyebrow>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(40px, 5vw, 72px)', lineHeight: 1, margin: '14px 0 24px', fontWeight: 400, letterSpacing: '-0.02em' }}>
              Everything <em style={{ color: accent, fontStyle: 'italic' }}>you'd ask</em> a friend in the business.
            </h2>
            <p style={{ color: 'var(--ink-dim)', fontSize: 15, lineHeight: 1.6 }}>
              Not finding yours? Text the shop — a real estimator answers, weekdays 9–5.
            </p>
            <a href="tel:+15122213013" style={{
              marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 10,
              fontFamily: 'var(--font-mono)', fontSize: 13, color: accent, textDecoration: 'none',
              borderBottom: `1px solid ${accent}`, paddingBottom: 4,
            }}>+1 (512) 221-3013 →</a>
          </div>
        </Reveal>
        <div>
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={i} delay={i*50}>
                <div
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  style={{ borderTop: '1px solid var(--hair)', padding: '28px 0', cursor: 'pointer', userSelect: 'none' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24 }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 2vw, 26px)', fontWeight: 400, margin: 0, letterSpacing: '-0.01em' }}>{it.q}</h3>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--hair-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: isOpen ? accent : 'var(--ink)', transition: 'transform 400ms, color 300ms', transform: isOpen ? 'rotate(45deg)' : 'none' }}>+</div>
                  </div>
                  <div style={{
                    maxHeight: isOpen ? 400 : 0, overflow: 'hidden',
                    transition: 'max-height 500ms cubic-bezier(.2,.7,.2,1), margin-top 500ms',
                    marginTop: isOpen ? 18 : 0,
                  }}>
                    <p style={{ color: 'var(--ink-dim)', fontSize: 16, lineHeight: 1.65, margin: 0, maxWidth: 700 }}>{it.a}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
          <div style={{ borderTop: '1px solid var(--hair)' }} />
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { Marquee, Metrics, Features, Process, Testimonials, FAQ, Reveal, Eyebrow, INSURERS, useInView, CountUp });
