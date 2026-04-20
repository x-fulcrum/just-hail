/* AI-powered features: photo triage, chat widget, voice input, storm radar */
/* Uses /api/claude proxy (Vercel serverless), Web Speech API, NWS public API */

async function claudeComplete({ messages, max_tokens }) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Claude proxy error (${res.status}): ${err || res.statusText}`);
  }
  const data = await res.json();
  return data.text;
}

async function claudeCompleteStream({ messages, max_tokens, onDelta }) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens, stream: true }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Claude stream error (${res.status}): ${err || res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    if (onDelta) onDelta(full);
  }
  return full;
}

/* =========================================================
   1. AI PHOTO TRIAGE — Claude Vision estimates dent severity
   ========================================================= */

function PhotoTriage({ accent, onEstimate }) {
  const [photos, setPhotos] = React.useState([]); // [{ file, dataUrl, id }]
  const [analyzing, setAnalyzing] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState('');
  const inputRef = React.useRef(null);

  const readAsDataUrl = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const addFiles = async (files) => {
    const arr = Array.from(files).slice(0, 5 - photos.length);
    const parsed = await Promise.all(arr.map(async f => ({
      file: f, dataUrl: await readAsDataUrl(f), id: Math.random().toString(36).slice(2),
    })));
    setPhotos(p => [...p, ...parsed]);
    setResult(null);
  };

  const removePhoto = (id) => setPhotos(p => p.filter(x => x.id !== id));

  const analyze = async () => {
    if (photos.length === 0) return;
    setAnalyzing(true);
    setError('');
    try {
      const content = [
        { type: 'text', text: `You are a paintless dent repair (PDR) estimator for an auto hail repair shop. Analyze these ${photos.length} photo(s) of a vehicle with hail damage. Return ONLY a JSON object with this exact shape (no prose, no markdown, no code fences):
{
  "severity": 1-5 (1=minor 1-10 dents, 2=light 10-30, 3=moderate 30-80, 4=heavy 80-200, 5=total 200+),
  "visibleDents": estimated integer,
  "panelsAffected": ["hood","roof","trunk","fender","door"],
  "largestDentSize": "dime"|"nickel"|"quarter"|"half-dollar"|"baseball",
  "paintCracked": boolean,
  "glassDamage": boolean,
  "priceRange": "$350 - $900" style string,
  "confidence": 0-1 decimal,
  "notes": "one short sentence for the estimator"
}` },
        ...photos.map(p => ({
          type: 'image',
          source: { type: 'base64', media_type: p.file.type, data: p.dataUrl.split(',')[1] },
        })),
      ];
      const text = await claudeComplete({ messages: [{ role: 'user', content }] });
      // Extract JSON even if model wrapped it
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('No JSON found in response');
      const parsed = JSON.parse(m[0]);
      setResult(parsed);
      if (onEstimate) onEstimate(parsed);
    } catch (e) {
      console.error(e);
      setError('Could not analyze photos. Try again or skip — you can fill in severity manually.');
    } finally {
      setAnalyzing(false);
    }
  };

  const severityLabels = ['Minor (1–10)','Light (10–30)','Moderate (30–80)','Heavy (80–200)','Total (200+)'];

  return (
    <div style={{
      border: `1px dashed var(--hair-strong)`,
      background: 'var(--surface-alt)',
      padding: 24,
      marginBottom: 32,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{
          padding: '3px 8px', background: accent, color: '#0a0b10',
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
          fontWeight: 600,
        }}>AI</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Instant damage analysis
        </div>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginBottom: 6, lineHeight: 1.2 }}>
        Upload 2–5 photos of your damage.
      </div>
      <div style={{ color: 'var(--ink-dim)', fontSize: 13, marginBottom: 18, lineHeight: 1.5 }}>
        Our AI pre-scores the severity and pre-fills your estimate in ~10 seconds. Take them outside in daylight, one wide shot + closeups of the worst panels.
      </div>

      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, marginBottom: 14 }}>
          {photos.map(p => (
            <div key={p.id} style={{ position: 'relative', aspectRatio: '1', border: '1px solid var(--hair-strong)' }}>
              <img src={p.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button type="button" onClick={() => removePhoto(p.id)} style={{
                position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%',
                background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', cursor: 'pointer',
                fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>×</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => addFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={photos.length >= 5 || analyzing}
          style={{
            padding: '10px 16px', background: 'transparent', color: 'var(--ink)',
            border: '1px solid var(--hair-strong)', cursor: photos.length >= 5 ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-ui)', fontSize: 13, opacity: photos.length >= 5 ? 0.5 : 1,
          }}>
          {photos.length === 0 ? '+ Add photos' : `+ Add more (${photos.length}/5)`}
        </button>
        {photos.length > 0 && !result && (
          <button
            type="button"
            onClick={analyze}
            disabled={analyzing}
            style={{
              padding: '10px 16px', background: accent, color: '#0a0b10', border: 'none',
              cursor: analyzing ? 'wait' : 'pointer', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
            {analyzing ? <><Spinner /> Analyzing…</> : 'Analyze damage →'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(176,0,32,0.08)', border: '1px solid rgba(176,0,32,0.3)', fontSize: 12, color: '#b00020' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 18, padding: 18, background: 'var(--surface)', border: `1px solid ${accent}33` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}` }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Analysis complete · {Math.round(result.confidence * 100)}% confidence
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', textTransform: 'uppercase' }}>Severity</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 2 }}>{severityLabels[result.severity - 1]}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', textTransform: 'uppercase' }}>Est. dents</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 2 }}>{result.visibleDents}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', textTransform: 'uppercase' }}>Price range</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 2, color: accent }}>{result.priceRange}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', textTransform: 'uppercase' }}>Panels</div>
              <div style={{ fontSize: 13, marginTop: 2 }}>{result.panelsAffected?.join(', ') || '—'}</div>
            </div>
          </div>
          {result.notes && (
            <div style={{ fontSize: 13, color: 'var(--ink-dim)', fontStyle: 'italic', borderTop: '1px solid var(--hair)', paddingTop: 10, lineHeight: 1.5 }}>
              "{result.notes}"
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-dim)' }}>
            ✓ Applied to your estimate. Final price confirmed after in-person inspection.
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return <span style={{
    display: 'inline-block', width: 12, height: 12,
    border: '2px solid rgba(10,11,16,0.3)', borderTopColor: '#0a0b10',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  }} />;
}

/* =========================================================
   2. AI CHAT WIDGET — 24/7 Q&A + lead capture
   ========================================================= */

function ChatWidget({ accent }) {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState([
    { role: 'assistant', content: "Hi! I'm the Just Hail assistant. Ask me about hail repair, insurance, or timelines — or I can start an estimate for you. What's up?" },
  ]);
  const [input, setInput] = React.useState('');
  const [thinking, setThinking] = React.useState(false);
  const [unread, setUnread] = React.useState(0);
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  React.useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  const SYSTEM = `You are the friendly, concise assistant for Just Hail, a paintless dent repair (PDR) shop in Leander, TX. Founded 2008 by Charlie and Chad. Specialties: hail damage, insurance direct-billing (38 carriers), lifetime workmanship warranty, 24,800+ cars repaired. Phone: (512) 221-3013. Most claims are $0 out-of-pocket after deductible. Typical repair: 3-7 days. If a user seems ready to book, encourage them to fill out the estimate form (scroll to the "Request an estimate" section) or call. Never quote exact prices — always say "a free estimate will give you an exact number." Keep replies under 3 sentences unless they asked for detail.`;

  const send = async () => {
    const q = input.trim();
    if (!q || thinking) return;
    const newMessages = [...messages, { role: 'user', content: q }];
    setMessages(newMessages);
    setInput('');
    setThinking(true);
    let firstDelta = true;
    try {
      await claudeCompleteStream({
        messages: [
          { role: 'user', content: SYSTEM + '\n\n---\n\nConversation so far:\n' + newMessages.map(m => `${m.role}: ${m.content}`).join('\n') + '\n\nassistant:' },
        ],
        onDelta: (full) => {
          if (firstDelta) {
            firstDelta = false;
            setThinking(false);
            setMessages(m => [...m, { role: 'assistant', content: full }]);
          } else {
            setMessages(m => {
              const next = [...m];
              next[next.length - 1] = { role: 'assistant', content: full };
              return next;
            });
          }
        },
      });
      if (!open) setUnread(u => u + 1);
    } catch (e) {
      console.error(e);
      setMessages(m => {
        if (firstDelta) return [...m, { role: 'assistant', content: "Sorry, I hit a snag. Please call us at (512) 221-3013 or fill out the estimate form." }];
        const next = [...m];
        next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + "\n\n(connection dropped — please try again or call (512) 221-3013.)" };
        return next;
      });
    } finally {
      setThinking(false);
    }
  };

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 80,
          width: 60, height: 60, borderRadius: '50%',
          background: accent, color: '#0a0b10', border: 'none', cursor: 'pointer',
          boxShadow: `0 10px 40px rgba(0,0,0,0.4), 0 0 0 6px ${accent}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 200ms',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.06)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        aria-label="Open chat"
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        )}
        {unread > 0 && !open && (
          <span style={{ position: 'absolute', top: -2, right: -2, background: '#b00020', color: '#fff', borderRadius: '50%', width: 22, height: 22, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{unread}</span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 100, right: 24, zIndex: 80,
          width: 380, maxWidth: 'calc(100vw - 48px)', height: 540, maxHeight: 'calc(100vh - 140px)',
          background: 'var(--bg)', border: '1px solid var(--hair-strong)',
          borderRadius: 4, display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          animation: 'chatIn 240ms cubic-bezier(0.2, 0.9, 0.3, 1)',
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hair)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3fcf7c', boxShadow: '0 0 8px #3fcf7c', animation: 'pulse 2s ease-in-out infinite' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 500 }}>Just Hail Assistant</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>AI · replies in seconds</div>
            </div>
          </div>
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '82%', padding: '10px 14px',
                  background: m.role === 'user' ? accent : 'var(--surface)',
                  color: m.role === 'user' ? '#0a0b10' : 'var(--ink)',
                  fontSize: 14, lineHeight: 1.5,
                  border: m.role === 'assistant' ? '1px solid var(--hair)' : 'none',
                  borderRadius: 4,
                }}>{m.content}</div>
              </div>
            ))}
            {thinking && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--hair)', display: 'flex', gap: 4 }}>
                  {[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink-dim)', animation: `typing 1.2s ease-in-out ${i*0.15}s infinite` }} />)}
                </div>
              </div>
            )}
          </div>
          <div style={{ borderTop: '1px solid var(--hair)', padding: 12, display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
              placeholder="Ask anything — insurance, timing, dent size…"
              style={{
                flex: 1, padding: '10px 14px', background: 'var(--surface)',
                border: '1px solid var(--hair)', color: 'var(--ink)',
                fontFamily: 'var(--font-ui)', fontSize: 14, outline: 'none',
              }}
            />
            <button onClick={send} disabled={!input.trim() || thinking} style={{
              padding: '10px 16px', background: accent, color: '#0a0b10', border: 'none',
              cursor: !input.trim() || thinking ? 'not-allowed' : 'pointer', opacity: !input.trim() ? 0.5 : 1,
              fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 500,
            }}>Send</button>
          </div>
        </div>
      )}
    </>
  );
}

/* =========================================================
   3. VOICE-TO-FORM — Web Speech API transcription
   ========================================================= */

function VoiceInput({ onTranscript, accent }) {
  const [listening, setListening] = React.useState(false);
  const [supported, setSupported] = React.useState(true);
  const recognitionRef = React.useRef(null);

  React.useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      onTranscript((finalText + interim).trim());
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recognitionRef.current = r;
  }, [onTranscript]);

  if (!supported) return null;

  const toggle = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); }
    else { recognitionRef.current?.start(); setListening(true); }
  };

  return (
    <button type="button" onClick={toggle} title={listening ? 'Stop recording' : 'Describe with voice'} style={{
      position: 'absolute', right: 8, top: 8,
      width: 32, height: 32, borderRadius: '50%',
      background: listening ? accent : 'transparent', color: listening ? '#0a0b10' : 'var(--ink-dim)',
      border: `1px solid ${listening ? accent : 'var(--hair-strong)'}`,
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: listening ? 'pulse 1.6s ease-in-out infinite' : 'none',
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
      </svg>
    </button>
  );
}

/* =========================================================
   4. STORM RADAR — NWS public API (no key needed)
   ========================================================= */

function StormAlert({ accent }) {
  const [alert, setAlert] = React.useState(null);
  const [dismissed, setDismissed] = React.useState(() => {
    try { return localStorage.getItem('jh-storm-dismissed') === new Date().toDateString(); }
    catch { return false; }
  });

  React.useEffect(() => {
    if (dismissed) return;
    // Leander, TX — Williamson County zone
    fetch('https://api.weather.gov/alerts/active?area=TX&event=Severe%20Thunderstorm%20Warning,Hail')
      .then(r => r.json())
      .then(data => {
        const relevant = (data.features || []).find(f => {
          const desc = (f.properties?.description || '').toLowerCase();
          const area = (f.properties?.areaDesc || '').toLowerCase();
          return (area.includes('williamson') || area.includes('travis') || area.includes('burnet') || area.includes('leander'))
            && (desc.includes('hail') || desc.includes('thunderstorm'));
        });
        if (relevant) setAlert(relevant.properties);
      })
      .catch(() => {});
  }, [dismissed]);

  if (dismissed || !alert) return null;

  const dismiss = () => {
    try { localStorage.setItem('jh-storm-dismissed', new Date().toDateString()); } catch {}
    setDismissed(true);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
      background: '#b00020', color: '#f5f3ee',
      padding: '10px 20px',
      fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.04em',
      display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'center',
      animation: 'slideUp 400ms ease-out',
    }}>
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#fff', animation: 'pulse 1.2s ease-in-out infinite' }} />
      <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>Active storm watch</span>
      <span style={{ opacity: 0.85 }}>— {alert.headline || alert.event}</span>
      <a href="#contact" style={{ color: '#fff', textDecoration: 'underline', fontWeight: 600 }}>Priority booking →</a>
      <button onClick={dismiss} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18, padding: '0 6px', opacity: 0.7 }}>×</button>
    </div>
  );
}

// Export to window
window.PhotoTriage = PhotoTriage;
window.ChatWidget = ChatWidget;
window.VoiceInput = VoiceInput;
window.StormAlert = StormAlert;
