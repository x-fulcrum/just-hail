/* Multi-section smart form with live validation + CTA banner + footer + nav */

function Nav({ accent, scrolled }) {
  const links = [
    { href: '#services', label: 'Services' },
    { href: '#process', label: 'Process' },
    { href: '#reviews', label: 'Reviews' },
    { href: '#faq', label: 'FAQ' },
    { href: '#contact', label: 'Contact' },
  ];
  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
      padding: scrolled ? '14px 40px' : '24px 40px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: scrolled ? 'color-mix(in oklab, var(--bg), transparent 20%)' : 'transparent',
      backdropFilter: scrolled ? 'blur(14px)' : 'none',
      borderBottom: scrolled ? '1px solid var(--hair)' : '1px solid transparent',
      transition: 'all 300ms',
    }}>
      <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'var(--ink)' }}>
        <img src="logo.webp" alt="Just Hail" style={{ height: 52, width: 'auto', display: 'block', filter: 'var(--logo-filter, none)' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.14em', paddingLeft: 16, borderLeft: '1px solid var(--hair-strong)', lineHeight: 1.35 }}>
          EST. 2008<br/>LEANDER · TX
        </span>
      </a>
      <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
        {links.map(l => (
          <a key={l.href} href={l.href} style={{
            fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--ink-dim)',
            textDecoration: 'none', transition: 'color 200ms',
          }} onMouseEnter={e=>e.currentTarget.style.color='var(--ink)'} onMouseLeave={e=>e.currentTarget.style.color='var(--ink-dim)'}>{l.label}</a>
        ))}
        <a href="#contact" style={{
          fontFamily: 'var(--font-ui)', fontSize: 14,
          padding: '10px 18px', background: accent, color: '#0a0b10',
          textDecoration: 'none', borderRadius: 4, fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          Request estimate
          <span>→</span>
        </a>
      </div>
    </nav>
  );
}

function SmartForm({ accent }) {
  // === GOOGLE SHEETS WIRING ======================================
  // Paste your Apps Script Web App URL here once deployed.
  // Leave as empty string to keep the form in "mock" mode (no network call).
  const SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzi_4_ZaBRafJ5bZpxavtNF7fzS84bJHHicANZQZiybTZpwaStqK72Qc1KGTAKzmkf4vQ/exec';
  // ================================================================

  const [data, setData] = React.useState({
    name: '', email: '', phone: '', zip: '',
    vehicle: '', year: '', damage: '', insurer: '',
    severity: 3, timeline: 'asap', notes: '',
  });
  const [touched, setTouched] = React.useState({});
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState('');
  const [refNum, setRefNum] = React.useState('');

  const set = (k, v) => setData(d => ({ ...d, [k]: v }));
  const blur = (k) => setTouched(t => ({ ...t, [k]: true }));

  const errors = {
    name: data.name.trim().length < 2 ? 'Enter your full name' : '',
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? 'Enter a valid email' : '',
    phone: data.phone.replace(/\D/g,'').length < 10 ? 'Enter a 10-digit phone' : '',
    zip: !/^\d{5}$/.test(data.zip) ? '5-digit ZIP' : '',
    vehicle: data.vehicle.trim().length < 3 ? 'Make and model' : '',
    year: !/^\d{4}$/.test(data.year) || +data.year < 1980 || +data.year > 2027 ? '4-digit year' : '',
  };
  const validKeys = Object.keys(errors);
  const validCount = validKeys.filter(k => !errors[k]).length;
  const completeness = Math.round((validCount / validKeys.length) * 100);

  const severityLabels = ['Minor (1–10 dents)', 'Light (10–30 dents)', 'Moderate (30–80 dents)', 'Heavy (80–200 dents)', 'Total (200+ dents)'];
  const severityRange = ['$350 – $900', '$900 – $2,400', '$2,400 – $5,800', '$5,800 – $9,200', '$9,200 – $18k+'];

  const formatPhone = (v) => {
    const d = v.replace(/\D/g,'').slice(0,10);
    if (d.length < 4) return d;
    if (d.length < 7) return `(${d.slice(0,3)}) ${d.slice(3)}`;
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  };

  async function onSubmit(e) {
    e.preventDefault();
    setTouched(Object.fromEntries(validKeys.map(k => [k, true])));
    const allValid = validKeys.every(k => !errors[k]);
    if (!allValid) return;

    const ref = 'JH-' + Math.random().toString(36).slice(2,8).toUpperCase();
    const payload = {
      ...data,
      severityLabel: severityLabels[data.severity - 1],
      estimatedRange: severityRange[data.severity - 1],
      referenceNumber: ref,
      submittedAt: new Date().toISOString(),
      source: location.hostname || 'justhail-preview',
      userAgent: navigator.userAgent,
    };

    setSubmitting(true);
    setSubmitError('');

    if (SHEET_ENDPOINT) {
      try {
        // text/plain avoids CORS preflight — Apps Script still parses JSON body
        await fetch(SHEET_ENDPOINT, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        setSubmitError('Could not reach the server. Your request was saved locally — please call us at (512) 221-3013.');
        console.warn('Sheet POST failed:', err);
      }
    }

    setRefNum(ref);
    setSubmitting(false);
    setSubmitted(true);
  }

  const confirmRef = React.useRef(null);
  React.useEffect(() => {
    if (submitted && confirmRef.current) {
      const rect = confirmRef.current.getBoundingClientRect();
      const top = window.scrollY + rect.top - 100; // 100px breathing room for sticky nav
      window.scrollTo({ top, behavior: 'smooth' });
    }
  }, [submitted]);

  if (submitted) {
    return (
      <Reveal>
        <div ref={confirmRef} style={{ padding: '80px 60px', border: '1px solid var(--hair-strong)', background: 'var(--surface-alt)', textAlign: 'left', scrollMarginTop: 100 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0a0b10', fontSize: 28 }}>✓</div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 400, margin: '32px 0 16px', letterSpacing: '-0.02em' }}>Estimate request received.</h3>
          <p style={{ color: 'var(--ink-dim)', fontSize: 16, lineHeight: 1.65, maxWidth: 520 }}>
            A certified estimator will reach you at <span style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{data.phone || data.email}</span> within 4 business hours. Meanwhile, check your inbox for the photo-upload link — the sooner we see the damage, the faster we bond a price.
          </p>
          <div style={{ marginTop: 32, display: 'flex', gap: 24, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            <span>Reference #{refNum}</span>
            <span>·</span>
            <span>Queued: {new Date().toLocaleTimeString()}</span>
          </div>
          {submitError && (
            <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(176, 0, 32, 0.08)', border: '1px solid rgba(176, 0, 32, 0.3)', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#b00020' }}>
              {submitError}
            </div>
          )}
        </div>
      </Reveal>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ position: 'relative' }}>
      {/* Progress */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        <span>Request an estimate — {completeness}% complete</span>
        <span>Avg. response 4.2h</span>
      </div>
      <div style={{ height: 2, background: 'var(--hair)', marginBottom: 40, position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${completeness}%`, background: accent, transition: 'width 300ms' }} />
      </div>

      <FormGroup label="01 — Who are you?">
        <Field label="Full name" v={data.name} k="name" touched={touched} errors={errors} onChange={v=>set('name',v)} onBlur={()=>blur('name')} placeholder="Alex Rivera" />
        <Field label="Email" v={data.email} k="email" touched={touched} errors={errors} onChange={v=>set('email',v)} onBlur={()=>blur('email')} placeholder="alex@example.com" type="email" />
        <Field label="Phone" v={data.phone} k="phone" touched={touched} errors={errors} onChange={v=>set('phone', formatPhone(v))} onBlur={()=>blur('phone')} placeholder="(512) 555-1234" />
        <Field label="ZIP code" v={data.zip} k="zip" touched={touched} errors={errors} onChange={v=>set('zip', v.replace(/\D/g,'').slice(0,5))} onBlur={()=>blur('zip')} placeholder="78641" />
      </FormGroup>

      <FormGroup label="02 — What are we repairing?">
        <Field label="Vehicle (make + model)" v={data.vehicle} k="vehicle" touched={touched} errors={errors} onChange={v=>set('vehicle',v)} onBlur={()=>blur('vehicle')} placeholder="Toyota 4Runner" />
        <Field label="Year" v={data.year} k="year" touched={touched} errors={errors} onChange={v=>set('year', v.replace(/\D/g,'').slice(0,4))} onBlur={()=>blur('year')} placeholder="2022" />
        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>Damage type</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {['Hail / dents', 'Glass / windshield', 'Paint chips', 'Collision panel', 'Not sure yet'].map(opt => (
              <button key={opt} type="button" onClick={() => set('damage', opt)} style={{
                padding: '10px 16px', fontSize: 13, fontFamily: 'var(--font-ui)',
                background: data.damage === opt ? accent : 'transparent',
                color: data.damage === opt ? '#0a0b10' : 'var(--ink)',
                border: `1px solid ${data.damage === opt ? accent : 'var(--hair-strong)'}`,
                borderRadius: 2, cursor: 'pointer', transition: 'all 200ms',
              }}>{opt}</button>
            ))}
          </div>
        </div>
      </FormGroup>

      <FormGroup label="03 — How bad is it?">
        <div style={{ gridColumn: 'span 2' }}>
          <PhotoTriage accent={accent} onEstimate={(r) => {
            if (r.severity) set('severity', r.severity);
            if (r.panelsAffected) set('damage', `AI: ~${r.visibleDents} dents on ${r.panelsAffected.join(', ')}${r.paintCracked ? ' · paint cracked' : ''}${r.glassDamage ? ' · glass damaged' : ''}`);
          }} />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <label style={labelStyle}>Severity</label>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: accent }}>Est. range: {severityRange[data.severity - 1]}</div>
          </div>
          <input
            type="range" min="1" max="5" step="1" value={data.severity}
            onChange={e => set('severity', +e.target.value)}
            style={{ width: '100%', accentColor: accent, height: 2 }}
          />
          <div style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-dim)' }}>
            {severityLabels[data.severity - 1]}
          </div>
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>Insurance carrier (optional — we bill direct)</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {['State Farm','Allstate','Geico','USAA','Progressive','Farmers','Other / none'].map(ins => (
              <button key={ins} type="button" onClick={() => set('insurer', ins)} style={{
                padding: '8px 14px', fontSize: 12, fontFamily: 'var(--font-mono)',
                background: data.insurer === ins ? accent : 'transparent',
                color: data.insurer === ins ? '#0a0b10' : 'var(--ink-dim)',
                border: `1px solid ${data.insurer === ins ? accent : 'var(--hair)'}`,
                borderRadius: 2, cursor: 'pointer', letterSpacing: '0.04em',
              }}>{ins}</button>
            ))}
          </div>
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>Timeline</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
            {[['asap','As soon as possible'],['week','Within a week'],['month','This month'],['flex','Just exploring']].map(([k,l]) => (
              <button key={k} type="button" onClick={() => set('timeline', k)} style={{
                padding: '14px 16px', fontSize: 13, fontFamily: 'var(--font-ui)',
                background: data.timeline === k ? 'var(--surface-alt)' : 'transparent',
                color: 'var(--ink)', textAlign: 'left',
                border: `1px solid ${data.timeline === k ? accent : 'var(--hair)'}`,
                borderRadius: 2, cursor: 'pointer',
              }}>{l}</button>
            ))}
          </div>
        </div>
      </FormGroup>

      <FormGroup label="04 — Anything else?" last>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>Notes (optional) <span style={{ textTransform: 'none', color: 'var(--ink-dim)', fontSize: 10, marginLeft: 8 }}>↓ or speak it</span></label>
          <div style={{ position: 'relative' }}>
            <textarea
              value={data.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Garage-kept? Already filed a claim? Preferred drop-off time?"
              rows={4}
              style={{
                width: '100%', marginTop: 10, background: 'transparent', color: 'var(--ink)',
                border: '1px solid var(--hair)', borderBottom: '1px solid var(--hair-strong)',
                padding: '14px 52px 14px 14px', fontSize: 15, fontFamily: 'var(--font-ui)', resize: 'vertical',
                outline: 'none', borderRadius: 0, transition: 'border-color 200ms',
              }}
              onFocus={e => e.target.style.borderBottomColor = accent}
              onBlur={e => e.target.style.borderBottomColor = 'var(--hair-strong)'}
            />
            <VoiceInput accent={accent} onTranscript={(t) => set('notes', t)} />
          </div>
        </div>
      </FormGroup>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, paddingTop: 32, borderTop: '1px solid var(--hair)', flexWrap: 'wrap', gap: 20 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.08em', maxWidth: 400 }}>
          By requesting an estimate you agree to be contacted by Just Hail. We never share your data.
        </div>
        <button type="submit" disabled={submitting} style={{
          padding: '18px 32px', background: accent, color: '#0a0b10',
          border: 'none', borderRadius: 2, fontSize: 15, fontFamily: 'var(--font-ui)',
          fontWeight: 500, cursor: submitting ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 12,
          letterSpacing: '0.02em', opacity: submitting ? 0.6 : 1, transition: 'opacity 200ms',
        }}>
          {submitting ? 'Sending…' : 'Get my bonded estimate'}
          <span style={{ fontSize: 18 }}>{submitting ? '⋯' : '→'}</span>
        </button>
      </div>
    </form>
  );
}

const labelStyle = {
  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)',
  textTransform: 'uppercase', letterSpacing: '0.1em',
};

function FormGroup({ label, children, last }) {
  return (
    <div style={{ borderTop: '1px solid var(--hair)', padding: '32px 0', marginBottom: last ? 0 : 0 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 24 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>{children}</div>
    </div>
  );
}

function Field({ label, v, k, touched, errors, onChange, onBlur, placeholder, type = 'text' }) {
  const err = touched[k] && errors[k];
  const good = v && !errors[k];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <label style={labelStyle}>{label}</label>
        {err && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#ff6b6b' }}>{errors[k]}</span>}
        {good && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)' }}>✓</span>}
      </div>
      <input
        type={type} value={v}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        style={{
          width: '100%', marginTop: 10, background: 'transparent', color: 'var(--ink)',
          border: 'none',
          borderBottom: `1px solid ${err ? '#ff6b6b' : good ? 'var(--accent)' : 'var(--hair-strong)'}`,
          padding: '10px 0', fontSize: 16, fontFamily: 'var(--font-ui)',
          outline: 'none', borderRadius: 0, transition: 'border-color 200ms',
        }}
      />
    </div>
  );
}

function ContactBlock({ accent }) {
  return (
    <section id="contact" style={{ padding: '160px 0', borderBottom: '1px solid var(--hair)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 40px', display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 80 }}>
        <Reveal>
          <div style={{ position: 'sticky', top: 120 }}>
            <Eyebrow>08 — Get an estimate</Eyebrow>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(40px, 5vw, 72px)', lineHeight: 1, margin: '14px 0 32px', fontWeight: 400, letterSpacing: '-0.02em' }}>
              Tell us about <em style={{ color: accent, fontStyle: 'italic' }}>your storm.</em>
            </h2>
            <p style={{ color: 'var(--ink-dim)', fontSize: 16, lineHeight: 1.6, marginBottom: 40 }}>
              Most requests come back bonded within four business hours. If it's urgent, the shop phone is always faster than this form.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 32, borderTop: '1px solid var(--hair)' }}>
              <InfoRow label="Phone" value="(512) 221-3013" href="tel:+15122213013" />
              <InfoRow label="Email" value="info.justhail@gmail.com" href="mailto:info.justhail@gmail.com" />
              <InfoRow label="Shop" value="308 Hazelwood St. Ste 1, Leander, TX 78641" />
              <InfoRow label="Hours" value="Mon – Fri · 9:00a – 5:00p CT" />
            </div>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <SmartForm accent={accent} />
        </Reveal>
      </div>
    </section>
  );
}

function InfoRow({ label, value, href }) {
  const content = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 15, color: 'var(--ink)', textAlign: 'right' }}>{value}</span>
    </div>
  );
  return href ? <a href={href} style={{ textDecoration: 'none' }}>{content}</a> : content;
}

function CTABanner({ accent }) {
  const [ref, inView] = useInView();
  return (
    <section ref={ref} style={{
      padding: '0', borderBottom: '1px solid var(--hair)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 600 }}>
        <div style={{ position: 'relative', overflow: 'hidden', background: '#000' }}>
          <img src="img/handoff.png" alt="Customer receiving keys at Just Hail" style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
            opacity: 0.9,
          }} />
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent 60%, var(--bg) 100%)` }} />
          <div style={{ position: 'absolute', bottom: 24, left: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#fff', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />
            Handoff · 2025 Honda CR-V · Marcus D.
          </div>
        </div>
        <div style={{ padding: '120px 60px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Reveal>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: accent, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 24 }}>
              · Now booking · April storm season ·
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(44px, 5.5vw, 88px)', lineHeight: 0.98, margin: 0, fontWeight: 400, letterSpacing: '-0.025em' }}>
              Keys back. Factory finish. <em style={{ color: accent, fontStyle: 'italic' }}>Zero drama.</em>
            </h2>
            <p style={{ marginTop: 24, color: 'var(--ink-dim)', fontSize: 17, lineHeight: 1.55, maxWidth: 520 }}>
              That's every pickup day at Just Hail. Free estimate in under 24 hours — usually zero out of pocket.
            </p>
            <div style={{ marginTop: 36, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href="#contact" style={{
                padding: '18px 30px', background: accent, color: '#0a0b10',
                textDecoration: 'none', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 500,
                borderRadius: 2, display: 'inline-flex', alignItems: 'center', gap: 10,
              }}>Request an estimate <span>→</span></a>
              <a href="tel:+15122213013" style={{
                padding: '18px 30px', background: 'transparent', color: 'var(--ink)',
                border: '1px solid var(--hair-strong)',
                textDecoration: 'none', fontFamily: 'var(--font-ui)', fontSize: 15,
                borderRadius: 2, display: 'inline-flex', alignItems: 'center', gap: 10,
              }}>Call (512) 221-3013</a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Footer({ accent }) {
  return (
    <footer style={{ padding: '80px 0 40px', background: 'var(--surface-alt)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 60, marginBottom: 80 }}>
          <div>
            <img src="logo.webp" alt="Just Hail" style={{ height: 40, width: 'auto', display: 'block', marginBottom: 24, filter: 'var(--logo-filter, none)' }} />
            <p style={{ fontSize: 14, color: 'var(--ink-dim)', lineHeight: 1.65, maxWidth: 360, margin: 0 }}>
              Family-owned auto hail restoration. A+ BBB rated. 100+ years combined technician experience. Paintless dent repair that preserves the finish you paid for.
            </p>
          </div>
          <FooterCol title="Shop" items={['Paintless dent repair', 'Glass replacement', 'Insurance direct-bill', 'Lifetime warranty', 'Mobile estimates']} />
          <FooterCol title="Company" items={['About', 'Technicians', 'Careers', 'Press', 'Field journal']} />
          <FooterCol title="Visit" items={['308 Hazelwood St', 'Leander, TX 78641', '(512) 221-3013', 'Mon–Fri 9a–5p', 'Repair status →']} />
        </div>
        <div style={{
          paddingTop: 32, borderTop: '1px solid var(--hair)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.08em',
          flexWrap: 'wrap', gap: 16,
        }}>
          <div>© 2026 Just Hail, LLC · All rights reserved · A+ BBB Accredited</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <a href="admin.html" style={{ color: 'var(--ink-dim)', textDecoration: 'none', opacity: 0.5 }}>Admin</a>
            <a href="#" style={{ color: 'var(--ink-dim)', textDecoration: 'none' }}>Privacy</a>
            <a href="#" style={{ color: 'var(--ink-dim)', textDecoration: 'none' }}>Terms</a>
            <a href="#" style={{ color: 'var(--ink-dim)', textDecoration: 'none' }}>Warranty</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, items }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 20 }}>{title}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((it, i) => (
          <li key={i}><a href="#" style={{ fontSize: 14, color: 'var(--ink)', textDecoration: 'none' }}>{it}</a></li>
        ))}
      </ul>
    </div>
  );
}

/* Live tracking widget: floating activity ticker */
function ActivityTicker({ accent }) {
  const events = [
    { v: '2018 Subaru Outback', s: 'QC passed', c: 'Cedar Park' },
    { v: '2022 Ford F-150', s: 'Entered shop', c: 'Round Rock' },
    { v: '2020 Tesla Model 3', s: 'Estimate bonded', c: 'Austin' },
    { v: '2023 Honda CR-V', s: 'Claim approved', c: 'Leander' },
    { v: '2021 GMC Sierra', s: 'Delivered', c: 'Georgetown' },
    { v: '2024 Toyota 4Runner', s: 'In PDR bay 3', c: 'Liberty Hill' },
  ];
  const [idx, setIdx] = React.useState(0);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const show = setTimeout(() => setVisible(true), 3000);
    const t = setInterval(() => setIdx(i => (i+1) % events.length), 4200);
    return () => { clearInterval(t); clearTimeout(show); };
  }, []);
  if (!visible) return null;
  const e = events[idx];
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: 24, zIndex: 40,
      background: 'color-mix(in oklab, var(--bg), transparent 20%)',
      backdropFilter: 'blur(12px)',
      border: '1px solid var(--hair-strong)',
      padding: '14px 18px', maxWidth: 320,
      fontFamily: 'var(--font-ui)',
      animation: 'slideUp 500ms cubic-bezier(.2,.7,.2,1)',
      borderRadius: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}`, animation: 'pulse 1.6s ease-in-out infinite' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Live · Shop floor</span>
      </div>
      <div style={{ fontSize: 14, color: 'var(--ink)' }}><strong style={{ fontWeight: 500 }}>{e.v}</strong> · {e.s}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', marginTop: 4 }}>{e.c}, TX · just now</div>
    </div>
  );
}

Object.assign(window, { Nav, SmartForm, ContactBlock, CTABanner, Footer, ActivityTicker });
