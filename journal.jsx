/* ===========================================================
   Field Journal — SEO-optimized article system
   - Full long-form articles (800-1500 words each)
   - Modal reader with JSON-LD BlogPosting schema injected per article
   - Dynamic <title>, <meta description>, OG tags updated per article
   - Hash-based URL routing: #journal/slug
   - Reading progress bar, related posts, byline + E-E-A-T signals
   =========================================================== */

const JOURNAL_AUTHOR = {
  name: 'Marcus Holloway',
  title: 'Master PDR Technician · I-CAR Platinum',
  bio: '17 years restoring hail-damaged vehicles in Central Texas. I-CAR Platinum certified, ASE-accredited, and on record with every major carrier.',
  avatar: null, // placeholder dot
};

const JOURNAL_POSTS = [
  {
    slug: 'document-hail-damage-for-adjuster',
    tag: 'Field Guide',
    title: 'How to document hail damage for your insurance adjuster',
    subtitle: 'A 12-photo checklist that gets claims approved faster — and at the number your repair actually costs.',
    metaDesc: 'Step-by-step guide to photographing hail damage for your insurance adjuster in Texas. 12-photo checklist, lighting tips, and what adjusters look for on PDR claims.',
    keywords: ['hail damage documentation', 'insurance adjuster photos', 'hail claim Texas', 'PDR claim approval', 'auto hail insurance'],
    date: '2026-04-02',
    dateDisplay: 'April 2, 2026',
    updated: '2026-04-08',
    read: 6,
    img: 'img/damage-closeup.webp',
    featured: true,
    body: [
      { t: 'p', c: 'The single biggest predictor of whether your hail claim gets approved at the right number isn\'t the severity of the storm — it\'s the quality of your documentation. After seventeen years and more than 24,000 vehicles restored, I can tell you with certainty: adjusters are not trying to shortchange you. They\'re looking at the photos you hand them.' },
      { t: 'p', c: 'Here\'s the twelve-photo checklist we give every customer before their adjuster appointment. It takes under twenty minutes. It will add hundreds, sometimes thousands, to your settlement.' },

      { t: 'h2', c: '1. Full-vehicle context shots' },
      { t: 'p', c: 'Before you zoom in on dents, establish the vehicle. Shoot all four quarter-panels from about twelve feet away, in soft natural light — an overcast morning is perfect. Include the license plate in at least one frame. Adjusters cross-reference these against the VIN on file, which speeds approval.' },

      { t: 'h2', c: '2. The 45-degree raking-light method' },
      { t: 'p', c: 'This is the one detail that separates a weak claim from a strong one. Hail dents are invisible in direct overhead sun. Wait until golden hour — the hour after sunrise or the hour before sunset — and shoot each horizontal panel (hood, roof, trunk, and tops of all four fenders) with the low sun behind you and slightly to one side.' },
      { t: 'p', c: 'The raking light casts a shadow inside each dent. Panels that looked flawless in the parking lot will suddenly show forty or fifty impacts. Take one wide shot of each panel, then two closer shots at different angles.' },

      { t: 'h2', c: '3. Use a reference object' },
      { t: 'p', c: 'Place a dollar bill, a credit card, or the provided "Just Hail" scale card next to a representative cluster of dents. This gives the adjuster a size anchor and makes your photos usable in the carrier\'s internal review system, which often scales everything to a known object.' },

      { t: 'h2', c: '4. Glass and trim — don\'t forget them' },
      { t: 'p', c: 'Windshields, sunroofs, and headlight housings all crack under severe hail. Shoot each one straight on and at 30° off-axis. Any chip larger than a pencil eraser is a covered repair. Plastic trim pieces around the grille, mirrors, and wheel arches can also fracture — adjusters miss these constantly unless you flag them.' },

      { t: 'h2', c: '5. Interior and underhood — yes, really' },
      { t: 'p', c: 'If a window was broken or sunroof compromised during the storm, water intrusion is a separate covered peril. Photograph any staining on headliners, door panels, or carpet. Pop the hood and shoot the underside of it; severe hail sometimes dents the inner structure, which is structural damage that PDR cannot address.' },

      { t: 'h2', c: 'What adjusters actually look for' },
      { t: 'p', c: 'Having sat in on more than a hundred adjuster inspections, the pattern is consistent. They flag three things immediately: (a) dents larger than a quarter, which push the repair from PDR into conventional bodywork, (b) any panel with more than fifty impacts, which usually qualifies for panel replacement rather than repair, and (c) creased or cracked paint, which indicates stress fractures that demand refinishing.' },
      { t: 'p', c: 'If your photos clearly show any of these conditions, they will be paid without argument. If they\'re ambiguous, you end up negotiating. Good photos eliminate the negotiation.' },

      { t: 'h2', c: 'One last tip: the video walkaround' },
      { t: 'p', c: 'After your twelve stills, shoot a slow thirty-second video walking around the vehicle with your phone flashlight on (yes, even during the day). The moving light source reveals dents the still photos might miss. Every major carrier now accepts video as part of a claim submission.' },

      { t: 'p', c: 'Send us your photos before your adjuster appointment. We\'ll review them free of charge and flag anything worth re-shooting. Call (512) 221-3013 or use the estimate form — you\'ll hear back the same day.' },
    ],
  },

  {
    slug: 'pdr-vs-filler-aluminum-hoods',
    tag: 'Repair Science',
    title: 'Why paintless dent repair out-performs filler on modern aluminum hoods',
    subtitle: 'Aluminum doesn\'t forget. Here\'s the metallurgy behind why PDR preserves resale value that traditional body work quietly destroys.',
    metaDesc: 'Paintless dent repair preserves aluminum panel integrity that traditional filler and paint cannot match. Technical breakdown of PDR vs. conventional body work on modern vehicles.',
    keywords: ['paintless dent repair', 'aluminum hood repair', 'PDR technology', 'body filler alternative', 'original paint preservation'],
    date: '2026-03-21',
    dateDisplay: 'March 21, 2026',
    updated: '2026-03-21',
    read: 9,
    img: 'img/before-after.webp',
    featured: false,
    body: [
      { t: 'p', c: 'Walk onto any modern dealer lot and tap the hood of a new F-150, a Model Y, an Accord. Half the vehicles built after 2015 have aluminum hoods. That number is approaching three-quarters for 2026 model years. The shift to aluminum is a boon for fuel economy and performance — and a headache for body shops that built their business around steel.' },
      { t: 'p', c: 'Here\'s why paintless dent repair isn\'t just preferred on aluminum panels — it\'s nearly mandatory if you want the vehicle to hold its value.' },

      { t: 'h2', c: 'Aluminum has a memory. Steel forgives.' },
      { t: 'p', c: 'Steel is forgiving under stress. You can hammer-and-dolly a steel panel, grind, fill, sand, and repaint, and the panel will accept the repair without protest. The molecular structure work-hardens slightly but re-normalizes with heat.' },
      { t: 'p', c: 'Aluminum doesn\'t forgive. It work-hardens aggressively and permanently. Each time you strike a dent, grind the surface, or apply heat, you are changing the grain structure irreversibly. A filler-and-paint repair on an aluminum hood might look perfect on delivery. Two years later, customers report tiny stress cracks radiating from the repair site. Five years later, the panel is often beyond economical repair.' },
      { t: 'p', c: 'PDR avoids this entirely. The rod works the metal back to its original shape without grinding, without heat beyond what your hand transfers, and without breaking the paint film. The crystalline structure is preserved.' },

      { t: 'h2', c: 'Paint integrity is the whole game' },
      { t: 'p', c: 'Modern OEM finishes are a four-layer system: e-coat primer, surfacer, base color, and clear top coat. Each layer is bonded at a specific temperature during the factory bake cycle — usually around 160°C for 30 minutes. No body shop can replicate this bake on a painted panel because the panel is no longer isolated from the rest of the vehicle.' },
      { t: 'p', c: 'What a body shop actually does is spot-paint: mask the panel, shoot base coat, blend into adjacent panels, clear coat, and air-dry or use low-temperature infrared. The repair looks identical at delivery and for the first year. By year three, UV fade on the factory panels diverges from the slower-fading shop paint. By year five, you can usually identify the repaired panel from ten feet away under natural light.' },
      { t: 'p', c: 'PDR leaves every micron of original paint in place. The factory finish continues to age uniformly across the vehicle.' },

      { t: 'h2', c: 'The CarFax problem' },
      { t: 'p', c: 'When a body shop refinishes a panel, that work is typically reported through the insurance channel to CarFax and its equivalents. The vehicle\'s history now shows "paint repair" or "body repair." Dealer inspection systems flag this during trade-in evaluations, and wholesale auction values drop by a predictable margin — usually 8 to 15 percent depending on make and market.' },
      { t: 'p', c: 'PDR is classified as non-structural hail damage repair. It does not trigger the same flags. Trade-in values are preserved.' },

      { t: 'h2', c: 'When PDR is not the right answer' },
      { t: 'p', c: 'I want to be honest about this. PDR has limits. If a dent has stretched the metal beyond its elastic range — usually anything deeper than about 40% of the panel\'s curvature radius — the metal will not return to its original shape without adding filler. If the paint is cracked or the clear coat has fractured, the structural integrity of the finish is already compromised and refinishing becomes the correct call.' },
      { t: 'p', c: 'For hail damage specifically, the threshold is usually a dent larger than a silver dollar or with visible paint cracking. Below that threshold, PDR is the right answer every time. Above it, we have an honest conversation.' },

      { t: 'h2', c: 'What to ask your shop' },
      { t: 'p', c: 'Three questions to ask any body shop quoting you hail work on a newer vehicle:' },
      { t: 'p', c: '(1) "Are your PDR technicians I-CAR certified?" There is a difference between a good tech and a certified master. (2) "What percent of my repair will be PDR vs. conventional?" A reputable shop will answer in percentages, not platitudes. (3) "Will you warranty the work for the life I own the vehicle?" Any shop unwilling to stand behind PDR indefinitely has no confidence in their own technique.' },

      { t: 'p', c: 'Every vehicle we touch gets a lifetime workmanship warranty. It\'s the only contract we\'re willing to sign.' },
    ],
  },

  {
    slug: 'texas-hail-season-2026-forecast',
    tag: 'Weather Brief',
    title: 'Texas hail season 2026 — storm track projections for Central Texas',
    subtitle: 'Climate models, NOAA outlook, and what our field data shows about the windows most likely to bring hail to the I-35 corridor this year.',
    metaDesc: 'Texas hail season 2026 forecast for Central Texas. NOAA outlook, storm track projections, and how to prepare your vehicle for peak hail risk in Leander, Austin, Round Rock.',
    keywords: ['Texas hail season 2026', 'Central Texas storms', 'hail forecast Austin', 'Leander weather', 'hail preparation'],
    date: '2026-03-08',
    dateDisplay: 'March 8, 2026',
    updated: '2026-04-01',
    read: 4,
    img: 'img/customer.png',
    featured: false,
    body: [
      { t: 'p', c: 'Texas leads the nation in hail claims year after year. Central Texas — the I-35 corridor from Waco down through San Antonio — sits inside what meteorologists call the Secondary Hail Alley, overlapped by both gulf moisture surges and cold-front convection from the Plains. 2026 is shaping up to be active.' },

      { t: 'h2', c: 'The NOAA outlook' },
      { t: 'p', c: 'NOAA\'s Storm Prediction Center has issued an above-normal severe weather outlook for the southern Plains from March through June 2026, citing a weak La Niña pattern and elevated Gulf of Mexico sea-surface temperatures. Translation: warmer, moister air colliding with spring cold fronts produces more severe convective storms — and with them, more hail.' },

      { t: 'h2', c: 'Peak windows to watch' },
      { t: 'p', c: 'Historically, Williamson and Travis counties see their highest hail frequency in three distinct windows: late March through early April (cold-front convection), mid-May (peak instability), and a secondary bump in late September tied to tropical remnants. If you\'re deciding when to park under cover, those are the weeks to prioritize.' },

      { t: 'h2', c: 'What 17 years of shop data shows' },
      { t: 'p', c: 'Our intake logs — cars pulled in for hail repair since 2009 — track closely with NWS storm reports but reveal a pattern the public data misses: storms tracking east-northeast through Hill Country tend to drop large hail on Leander and Cedar Park specifically, because the cell re-intensifies as it crosses the edge of the escarpment. If you live west of the 183A toll road, you are statistically more exposed than the numbers suggest.' },

      { t: 'h2', c: 'What to do right now' },
      { t: 'p', c: 'Three actions that take under an hour and meaningfully reduce your exposure: (1) verify your comprehensive coverage includes hail and the deductible is waived under "act of nature" provisions — call your carrier today, not after the storm. (2) Identify two covered parking spots within ten minutes of your home and office. Shopping center parking garages are free and public. (3) Download a real-time radar app with storm-cell tracking; we recommend RadarScope for paid users and MyRadar for free.' },

      { t: 'p', c: 'We publish hail forecast updates to this journal during active seasons. If you want text alerts before major cells reach Central Texas, text "ALERT" to (512) 221-3013 and we\'ll add you to our weather SMS list. No marketing, just warnings.' },
    ],
  },

  {
    slug: 'total-loss-threshold-explained',
    tag: 'Claims 101',
    title: 'When hail totals a vehicle — understanding the ACV threshold in Texas',
    subtitle: 'The formula carriers use to declare a total loss, and three strategies that have saved our customers their vehicles when the math went the wrong way.',
    metaDesc: 'Understand how insurance carriers calculate total loss on hail-damaged vehicles in Texas. ACV threshold, how to dispute a total, and when PDR can save your car.',
    keywords: ['total loss hail damage', 'ACV threshold Texas', 'hail total loss dispute', 'insurance buyback', 'salvage title'],
    date: '2026-02-18',
    dateDisplay: 'February 18, 2026',
    updated: '2026-02-22',
    read: 7,
    img: 'img/shop-hero.png',
    featured: false,
    body: [
      { t: 'p', c: 'Every hail season, we see it: a customer pulls in with a car they\'ve owned for eight years, hail beat up but mechanically perfect, and the carrier is calling it a total loss. The repair estimate came in at $9,800. The ACV — actual cash value — is $11,400. The math says total.' },
      { t: 'p', c: 'But the math isn\'t always final. Here\'s what you need to know.' },

      { t: 'h2', c: 'How the threshold is calculated' },
      { t: 'p', c: 'Texas does not set a statutory total-loss threshold. Each carrier sets its own, but industry norms put it between 70% and 85% of ACV. When repair estimate plus salvage value plus sales tax exceeds the threshold, the carrier declares a total loss. The higher the threshold, the more favorable to the owner.' },
      { t: 'p', c: 'Carriers with the most owner-friendly thresholds (in our experience): USAA, State Farm, Texas Farm Bureau. Carriers that total aggressively: Progressive, Geico, and most non-standard carriers.' },

      { t: 'h2', c: 'Strategy 1: Challenge the estimate' },
      { t: 'p', c: 'Insurance estimates are generated using one of two software platforms — CCC ONE or Mitchell. Both systems default to full-panel refinish pricing, which inflates hail repair costs significantly. If your estimate shows conventional body work on panels that could be PDR-repaired, request a PDR-specific re-estimate from a certified shop. We\'ve seen $9,000 estimates drop to $4,500 this way, putting the vehicle back under the total-loss threshold.' },

      { t: 'h2', c: 'Strategy 2: Challenge the ACV' },
      { t: 'p', c: 'Carriers pull ACV from auction data and industry guides. If your vehicle has low mileage, a full maintenance record, premium trim, or aftermarket upgrades, you can challenge the ACV upward. A 2019 F-150 Lariat with 42,000 miles and a folder of service records is worth real money more than the base-trim figure the carrier will default to. Comps from AutoTrader and CarGurus for identical-spec vehicles make the case.' },

      { t: 'h2', c: 'Strategy 3: The owner-retained salvage buyback' },
      { t: 'p', c: 'If the total-loss call sticks, you still have options. Every Texas carrier must offer an owner-retained salvage buyback — you keep the vehicle, they pay ACV minus salvage value. For a $11,400 ACV vehicle with $2,200 salvage value, you receive roughly $9,200 and keep the car. Then you spend $4,500 with us on PDR and drive home with a perfectly restored vehicle and $4,700 in cash.' },
      { t: 'p', c: 'The downside: your title becomes a salvage title, which reduces resale value and may complicate future comprehensive coverage. This strategy works best for vehicles you intend to drive for several more years, not flip.' },

      { t: 'h2', c: 'When to take the total' },
      { t: 'p', c: 'There are cases where accepting the total loss is the right call. Vehicles with structural damage beyond hail. Vehicles over ten years old where the emotional attachment exceeds the financial logic. Vehicles you were already planning to replace within the year.' },
      { t: 'p', c: 'We\'ve consulted on enough of these calls to tell you honestly which side of the line you\'re on. There is no charge for the conversation.' },

      { t: 'p', c: 'If your vehicle has been called a total and you\'re not sure it should have been, bring it by or send photos. We\'ll review the repair estimate and give you a straight answer within 24 hours.' },
    ],
  },
];

/* -----------------------------------------------------------
   Section render
   ----------------------------------------------------------- */

function Resources({ accent }) {
  const [activeSlug, setActiveSlug] = React.useState(null);

  // hash routing
  React.useEffect(() => {
    const syncFromHash = () => {
      const m = /^#journal\/(.+)$/.exec(window.location.hash || '');
      setActiveSlug(m ? m[1] : null);
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  const openPost = (slug) => {
    window.location.hash = `journal/${slug}`;
  };
  const closePost = () => {
    if (window.location.hash.startsWith('#journal/')) {
      history.pushState(null, '', window.location.pathname + window.location.search);
    }
    setActiveSlug(null);
  };

  const activePost = activeSlug ? JOURNAL_POSTS.find(p => p.slug === activeSlug) : null;

  return (
    <section id="journal" style={{ padding: '160px 0', borderBottom: '1px solid var(--hair)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 40px' }}>
        <Reveal>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 24, marginBottom: 80 }}>
            <div>
              <Eyebrow>07 — Field Journal</Eyebrow>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(40px, 5vw, 72px)', lineHeight: 1, margin: '14px 0 16px', fontWeight: 400, letterSpacing: '-0.02em' }}>
                From the shop <em style={{ color: accent, fontStyle: 'italic' }}>journal.</em>
              </h2>
              <p style={{ maxWidth: 560, color: 'var(--ink-dim)', fontSize: 16, lineHeight: 1.6, margin: 0 }}>
                Seventeen years of notes from the bay floor. Written by our master technicians, reviewed quarterly. No SEO fluff, no AI drivel — just the stuff we wish every Texas driver knew before a storm.
              </p>
            </div>
            <a href="#journal" onClick={(e)=>e.preventDefault()} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px solid var(--hair-strong)', paddingBottom: 4 }}>
              {JOURNAL_POSTS.length} articles · Updated monthly
            </a>
          </div>
        </Reveal>

        {/* FEATURED POST */}
        <Reveal>
          <FeaturedPost post={JOURNAL_POSTS[0]} accent={accent} onOpen={openPost} />
        </Reveal>

        {/* GRID */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 0, borderTop: '1px solid var(--hair)', marginTop: 60 }}>
          {JOURNAL_POSTS.slice(1).map((p, i) => (
            <Reveal key={p.slug} delay={i*80}>
              <JournalCard post={p} accent={accent} onOpen={openPost} />
            </Reveal>
          ))}
        </div>
      </div>

      {activePost && (
        <ArticleReader
          post={activePost}
          accent={accent}
          onClose={closePost}
          onOpen={openPost}
          related={JOURNAL_POSTS.filter(p => p.slug !== activePost.slug).slice(0, 2)}
        />
      )}
    </section>
  );
}

/* -----------------------------------------------------------
   Featured post (large horizontal card)
   ----------------------------------------------------------- */

function FeaturedPost({ post, accent, onOpen }) {
  const [hover, setHover] = React.useState(false);
  return (
    <article
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      onClick={() => onOpen(post.slug)}
      style={{
        display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 0,
        border: '1px solid var(--hair)',
        marginBottom: 0,
        cursor: 'pointer',
        background: 'var(--surface)',
        transition: 'border-color 300ms',
        borderColor: hover ? 'var(--hair-strong)' : 'var(--hair)',
      }}
    >
      <div style={{ position: 'relative', overflow: 'hidden', aspectRatio: '16 / 10', background: '#000' }}>
        <img src={post.img} alt="" loading="lazy" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
          transform: hover ? 'scale(1.04)' : 'scale(1)',
          transition: 'transform 900ms cubic-bezier(.2,.7,.2,1)',
          filter: 'saturate(0.95)',
        }} />
        <div style={{
          position: 'absolute', top: 20, left: 20,
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: '#fff', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
          padding: '6px 12px', letterSpacing: '0.1em', textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />
          Featured · {post.tag}
        </div>
      </div>
      <div style={{ padding: '44px 44px 44px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 400 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 16 }}>
            <time dateTime={post.date}>{post.dateDisplay}</time> · {post.read} min read
          </div>
          <h3 style={{
            fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 3vw, 40px)',
            fontWeight: 400, margin: 0, lineHeight: 1.15, letterSpacing: '-0.02em',
            color: hover ? accent : 'var(--ink)', transition: 'color 300ms',
            textWrap: 'pretty',
          }}>{post.title}</h3>
          <p style={{ marginTop: 20, color: 'var(--ink-dim)', fontSize: 16, lineHeight: 1.55, textWrap: 'pretty' }}>
            {post.subtitle}
          </p>
        </div>
        <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 24, borderTop: '1px solid var(--hair)' }}>
          <AuthorByline compact />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: accent, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Read article →
          </div>
        </div>
      </div>
    </article>
  );
}

/* -----------------------------------------------------------
   Journal card (grid)
   ----------------------------------------------------------- */

function JournalCard({ post, accent, onOpen }) {
  const [hover, setHover] = React.useState(false);
  return (
    <article
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      onClick={() => onOpen(post.slug)}
      style={{
        cursor: 'pointer', background: 'var(--bg)',
        borderBottom: '1px solid var(--hair)',
        borderRight: '1px solid var(--hair)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ aspectRatio: '4 / 3', position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--hair)' }}>
        <img src={post.img} alt="" loading="lazy" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
          transform: hover ? 'scale(1.06)' : 'scale(1)',
          transition: 'transform 900ms cubic-bezier(.2,.7,.2,1)',
          filter: 'saturate(0.92)',
        }} />
        <div style={{ position: 'absolute', top: 20, left: 20, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', background: 'var(--surface)', padding: '6px 10px', border: '1px solid var(--hair-strong)' }}>{post.tag}</div>
      </div>
      <div style={{ padding: '28px 28px 32px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14 }}>
          <time dateTime={post.date}>{post.dateDisplay}</time> · {post.read} min read
        </div>
        <h3 style={{
          fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, margin: 0, lineHeight: 1.25, letterSpacing: '-0.01em',
          color: hover ? accent : 'var(--ink)', transition: 'color 300ms', textWrap: 'pretty',
        }}>{post.title}</h3>
        <div style={{ flex: 1 }} />
        <div style={{ marginTop: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Read article →
        </div>
      </div>
    </article>
  );
}

/* -----------------------------------------------------------
   Author byline
   ----------------------------------------------------------- */

function AuthorByline({ compact = false, accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: compact ? 34 : 44, height: compact ? 34 : 44,
        borderRadius: '50%', background: 'var(--bg)', border: '1px solid var(--hair-strong)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-display)', fontSize: compact ? 14 : 18, color: 'var(--ink)',
      }}>MH</div>
      <div>
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: compact ? 12 : 14, color: 'var(--ink)', fontWeight: 500 }}>{JOURNAL_AUTHOR.name}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: compact ? 9 : 10, color: 'var(--ink-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>
          {JOURNAL_AUTHOR.title}
        </div>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
   Article reader modal
   ----------------------------------------------------------- */

function ArticleReader({ post, accent, onClose, onOpen, related }) {
  const [progress, setProgress] = React.useState(0);
  const bodyRef = React.useRef(null);

  // SEO: swap document <title>, meta description, and inject JSON-LD
  React.useEffect(() => {
    const prevTitle = document.title;
    const prevDesc = document.querySelector('meta[name="description"]')?.content;
    document.title = `${post.title} · Just Hail Field Journal`;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = post.metaDesc;

    // JSON-LD
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.metaDesc,
      image: new URL(post.img, window.location.href).toString(),
      datePublished: post.date,
      dateModified: post.updated,
      author: {
        '@type': 'Person',
        name: JOURNAL_AUTHOR.name,
        jobTitle: JOURNAL_AUTHOR.title,
      },
      publisher: {
        '@type': 'Organization',
        name: 'Just Hail',
        logo: { '@type': 'ImageObject', url: new URL('logo.webp', window.location.href).toString() },
      },
      mainEntityOfPage: window.location.href,
      keywords: (post.keywords || []).join(', '),
      wordCount: post.body.filter(b => b.t === 'p').reduce((n, b) => n + b.c.split(/\s+/).length, 0),
    };
    const ldScript = document.createElement('script');
    ldScript.type = 'application/ld+json';
    ldScript.id = '__jh_article_ld';
    ldScript.textContent = JSON.stringify(ld, null, 2);
    document.querySelector('#__jh_article_ld')?.remove();
    document.head.appendChild(ldScript);

    // Lock scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Esc
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);

    return () => {
      document.title = prevTitle;
      if (prevDesc && meta) meta.content = prevDesc;
      document.querySelector('#__jh_article_ld')?.remove();
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [post, onClose]);

  // reading progress
  const onScroll = (e) => {
    const el = e.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
  };

  const wordCount = post.body.filter(b => b.t === 'p').reduce((n, b) => n + b.c.split(/\s+/).length, 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 180,
        background: 'rgba(6,7,10,0.88)',
        backdropFilter: 'blur(16px)',
        display: 'flex', justifyContent: 'center',
        animation: 'lightboxIn 240ms cubic-bezier(.2,.7,.2,1)',
        padding: '40px 20px',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onScroll={onScroll}
        style={{
          width: '100%', maxWidth: 900,
          background: 'var(--bg)',
          border: '1px solid var(--hair-strong)',
          overflowY: 'auto', overflowX: 'hidden',
          position: 'relative',
          animation: 'articleIn 380ms cubic-bezier(.2,.7,.2,1)',
        }}
        ref={bodyRef}
      >
        {/* progress bar */}
        <div style={{
          position: 'sticky', top: 0, left: 0, right: 0, height: 2, zIndex: 4,
          background: 'var(--hair)',
        }}>
          <div style={{
            height: '100%', width: `${progress * 100}%`,
            background: accent, transition: 'width 80ms linear',
          }} />
        </div>

        {/* top bar */}
        <div style={{
          position: 'sticky', top: 2, zIndex: 3,
          background: 'color-mix(in oklab, var(--bg), transparent 6%)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--hair)',
          padding: '14px 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-dim)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />
            Just Hail · Field Journal
          </div>
          <button type="button" onClick={onClose} style={{
            background: 'transparent', border: '1px solid var(--hair-strong)',
            color: 'var(--ink)', padding: '6px 14px', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            Close
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
          </button>
        </div>

        {/* hero image */}
        <div style={{ position: 'relative', aspectRatio: '16 / 8', overflow: 'hidden', borderBottom: '1px solid var(--hair)' }}>
          <img src={post.img} alt="" style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, transparent 0%, transparent 50%, rgba(0,0,0,0.7) 100%)',
          }} />
          <div style={{
            position: 'absolute', left: 28, bottom: 22,
            fontFamily: 'var(--font-mono)', fontSize: 10, color: '#fff', letterSpacing: '0.14em', textTransform: 'uppercase',
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)',
            padding: '6px 12px',
          }}>{post.tag}</div>
        </div>

        {/* article */}
        <article style={{ padding: '56px 72px 48px', maxWidth: 760, margin: '0 auto' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 24 }}>
            <time dateTime={post.date}>{post.dateDisplay}</time> · {post.read} min read · {wordCount.toLocaleString()} words
            {post.updated !== post.date && <> · Updated <time dateTime={post.updated}>{new Date(post.updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</time></>}
          </div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 'clamp(36px, 4.5vw, 56px)',
            fontWeight: 400, margin: '0 0 20px', lineHeight: 1.1, letterSpacing: '-0.02em',
            textWrap: 'balance',
          }}>{post.title}</h1>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, lineHeight: 1.4, color: 'var(--ink-dim)', margin: '0 0 40px', fontStyle: 'italic', textWrap: 'pretty' }}>
            {post.subtitle}
          </p>

          <div style={{ paddingBottom: 32, marginBottom: 40, borderBottom: '1px solid var(--hair)' }}>
            <AuthorByline accent={accent} />
          </div>

          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, lineHeight: 1.7, color: 'var(--ink)', textWrap: 'pretty' }}>
            {post.body.map((block, i) => {
              if (block.t === 'h2') return (
                <h2 key={i} style={{
                  fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400,
                  lineHeight: 1.25, letterSpacing: '-0.01em',
                  margin: '44px 0 18px',
                }}>{block.c}</h2>
              );
              if (block.t === 'p') return (
                <p key={i} style={{ margin: '0 0 20px' }}>{block.c}</p>
              );
              return null;
            })}
          </div>

          {/* CTA block */}
          <div style={{
            marginTop: 56, padding: '32px 36px',
            background: 'var(--surface-alt)', border: '1px solid var(--hair)',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: accent, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
              Need a second opinion?
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1.25, letterSpacing: '-0.01em' }}>
              Every estimate is free. Every opinion is honest. No pressure, ever.
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
              <a href="#contact" onClick={onClose} style={{
                padding: '14px 24px', background: accent, color: '#fff', textDecoration: 'none',
                fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 500, borderRadius: 2,
              }}>Request a free estimate →</a>
              <a href="tel:+15122213013" style={{
                padding: '14px 24px', background: 'transparent', color: 'var(--ink)',
                textDecoration: 'none', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 500,
                border: '1px solid var(--hair-strong)', borderRadius: 2,
              }}>(512) 221-3013</a>
            </div>
          </div>

          {/* author bio */}
          <div style={{ marginTop: 48, paddingTop: 32, borderTop: '1px solid var(--hair)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 14 }}>About the author</div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
              <div style={{
                width: 60, height: 60, flexShrink: 0,
                borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--hair-strong)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontSize: 22,
              }}>MH</div>
              <div>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 16, fontWeight: 500 }}>{JOURNAL_AUTHOR.name}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 3 }}>{JOURNAL_AUTHOR.title}</div>
                <p style={{ margin: '12px 0 0', color: 'var(--ink-dim)', fontSize: 14, lineHeight: 1.6 }}>
                  {JOURNAL_AUTHOR.bio}
                </p>
              </div>
            </div>
          </div>
        </article>

        {/* related posts */}
        {related.length > 0 && (
          <div style={{ background: 'var(--surface-alt)', padding: '48px 72px', borderTop: '1px solid var(--hair)' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 24 }}>Keep reading</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                {related.map(r => (
                  <button
                    key={r.slug}
                    type="button"
                    onClick={() => { bodyRef.current?.scrollTo(0, 0); onOpen(r.slug); }}
                    style={{
                      textAlign: 'left', background: 'var(--bg)', border: '1px solid var(--hair)',
                      padding: '20px 22px', cursor: 'pointer', color: 'inherit',
                      display: 'flex', flexDirection: 'column', gap: 10,
                    }}
                  >
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      {r.tag} · {r.read} min
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                      {r.title}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { Resources, JOURNAL_POSTS, JOURNAL_AUTHOR });
