'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Search, Loader2, Download, RotateCcw, AlertCircle, Info, ChevronDown, ChevronUp,
  Sparkles, ExternalLink, BarChart3, FileText, Database
} from 'lucide-react';
import { COUNTRIES, type Country } from '@/lib/countries';

const TRENDING = [
  'AI regulation', 'cost of living', 'climate change', 'elections',
  'cryptocurrency', 'remote work', 'housing crisis', 'immigration',
];

const LOADING_MESSAGES = [
  'Authenticating with Reddit…',
  'Searching country subreddits…',
  'Fetching top threads…',
  'Pulling comment trees…',
  'Running multilingual classifier…',
  'Computing weighted aggregate…',
  'Bootstrapping confidence interval…',
  'Synthesizing themes…',
];

const C = {
  bg: '#FAFAF5', bgWarm: '#F4F1E8',
  ink: '#1A1A1A', inkSoft: '#3A3A3A', inkMute: '#7A7A7A',
  rule: '#D8D4C7', accent: '#C44536',
  positive: '#4A7C59', negative: '#A8392E', neutral: '#8B8680',
};

interface AnalyzeResult {
  ok: true;
  country: { code: string; name: string; flag: string };
  topic: string;
  pulse_index: number;
  pulse_index_low: number;
  pulse_index_high: number;
  breakdown: { positive: number; neutral: number; negative: number };
  sample_size: number;
  thread_count: number;
  total_upvotes: number;
  oldest_comment_utc: number;
  newest_comment_utc: number;
  classifier_confidence_avg: number;
  confidence: 'high' | 'medium' | 'low';
  threads: Array<{ title: string; subreddit: string; score: number; num_comments: number; permalink: string; created_utc: number }>;
  subreddits_searched: string[];
  voices: Array<{ excerpt: string; full_length: number; upvotes: number; sentiment: 'positive' | 'neutral' | 'negative'; confidence: number; permalink: string; subreddit: string }>;
  themes: Array<{ theme: string; sentiment: 'positive' | 'neutral' | 'negative'; description: string; example_count: number }>;
  surprise_finding: string;
  headline_verdict: string;
  summary: string;
  methodology: { sentiment_model: string; formula: string; timing_ms: { reddit: number; classify: number; themes: number; total: number } };
}

// ============================================================================
// HELPERS
// ============================================================================

function useCountUp(target: number, duration = 1200, run = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!run || target == null) return;
    const start = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, run]);
  return value;
}

const sentimentColor = (s: string) => s === 'positive' ? C.positive : s === 'negative' ? C.negative : C.neutral;

const fmtDate = (utc: number) => {
  if (!utc) return '—';
  const d = new Date(utc * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

// ============================================================================
// COMPONENTS
// ============================================================================

function Wordmark({ size = 'sm' as 'sm' | 'lg' }) {
  const isLg = size === 'lg';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.ink }}>
      <div style={{ width: isLg ? 14 : 10, height: isLg ? 14 : 10, borderRadius: '50%', background: C.accent, boxShadow: `0 0 0 ${isLg ? 4 : 3}px ${C.accent}22` }} />
      <span style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 600, fontStyle: 'italic', fontSize: isLg ? 28 : 18, letterSpacing: '-0.02em' }}>
        Pulse
      </span>
      <span style={{ marginLeft: 6, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', padding: '2px 6px', background: C.ink, color: C.bg, letterSpacing: '0.1em' }}>
        v2
      </span>
    </div>
  );
}

function SentimentBar({ breakdown, animated = true }: { breakdown: any; animated?: boolean }) {
  const [w, setW] = useState(animated ? { p: 0, n: 0, neg: 0 } : { p: breakdown.positive, n: breakdown.neutral, neg: breakdown.negative });
  useEffect(() => {
    if (!animated) return;
    const t = setTimeout(() => setW({ p: breakdown.positive, n: breakdown.neutral, neg: breakdown.negative }), 100);
    return () => clearTimeout(t);
  }, [breakdown, animated]);

  return (
    <div>
      <div style={{ width: '100%', height: 12, display: 'flex', overflow: 'hidden', background: C.rule }}>
        <div style={{ width: `${w.p}%`, background: C.positive, transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)' }} />
        <div style={{ width: `${w.n}%`, background: C.neutral, transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)' }} />
        <div style={{ width: `${w.neg}%`, background: C.negative, transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: C.inkMute, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        <span style={{ color: C.positive, fontWeight: 600 }}>● Positive {breakdown.positive}%</span>
        <span style={{ color: C.neutral, fontWeight: 600 }}>● Neutral {breakdown.neutral}%</span>
        <span style={{ color: C.negative, fontWeight: 600 }}>● Negative {breakdown.negative}%</span>
      </div>
    </div>
  );
}

// ============================================================================
// LANDING
// ============================================================================

function Landing({ onSubmit }: { onSubmit: (c: Country, t: string) => void }) {
  const [country, setCountry] = useState<Country | null>(null);
  const [topic, setTopic] = useState('');
  const [show, setShow] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = COUNTRIES.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  const canSubmit = country && topic.trim().length >= 2;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '40px 20px', color: C.ink }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 80 }}>
          <Wordmark />
          <span style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.inkMute }}>
            Public Sentiment Index
          </span>
        </div>

        <div style={{ marginBottom: 48 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.accent, fontWeight: 600, marginBottom: 24 }}>
            Issue No. 02 · Now With Real Math
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(40px, 7vw, 76px)', lineHeight: 1.02, fontWeight: 400, letterSpacing: '-0.02em', marginBottom: 24 }}>
            What does <span style={{ fontStyle: 'italic', color: C.accent }}>{country ? country.name : 'the world'}</span><br />
            actually think<br />
            about <span style={{ fontStyle: 'italic' }}>{topic.trim() || '___'}</span>?
          </h1>
          <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, lineHeight: 1.5, color: C.inkSoft, fontStyle: 'italic', maxWidth: 560 }}>
            Real Reddit comments. Real multilingual sentiment classifier. Real upvote-weighted aggregate. Confidence intervals. Source links.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32, padding: 20, background: C.bgWarm, border: `1px solid ${C.rule}` }}>
          {[
            { n: 'Reddit OAuth', s: 'Live API, not search' },
            { n: 'XLM-RoBERTa', s: 'Multilingual classifier' },
            { n: 'Bootstrap CI', s: '500 resamples per query' },
            { n: 'Source links', s: 'Verify every comment' },
          ].map((x, i) => (
            <div key={i} style={{ flex: '1 1 140px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.inkMute, marginBottom: 4 }}>
                {x.n}
              </div>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 15, fontStyle: 'italic', color: C.ink }}>
                {x.s}
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 32, marginBottom: 32 }}>
          <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.inkMute, marginBottom: 12, fontWeight: 600 }}>
            01 — Pick a country
          </label>
          <button
            onClick={() => setShow(!show)}
            style={{
              width: '100%', padding: '20px 24px', background: 'transparent',
              border: `1.5px solid ${country ? C.ink : C.rule}`,
              fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontStyle: country ? 'normal' : 'italic',
              color: country ? C.ink : C.inkMute, textAlign: 'left', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <span>{country ? `${country.flag}  ${country.name}` : 'Select a country…'}</span>
            {show ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>

          {show && (
            <div style={{ border: `1.5px solid ${C.ink}`, borderTop: 'none', maxHeight: 320, overflowY: 'auto', background: C.bg }}>
              <div style={{ padding: 12, borderBottom: `1px solid ${C.rule}`, position: 'sticky', top: 0, background: C.bg }}>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.inkMute }} />
                  <input
                    autoFocus type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search countries"
                    style={{ width: '100%', padding: '8px 12px 8px 32px', border: `1px solid ${C.rule}`, background: C.bg, fontSize: 14, color: C.ink, outline: 'none' }}
                  />
                </div>
              </div>
              {filtered.map(c => (
                <button
                  key={c.code}
                  onClick={() => { setCountry(c); setShow(false); setSearch(''); }}
                  style={{ width: '100%', padding: '12px 24px', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.rule}`, fontFamily: 'Fraunces, Georgia, serif', fontSize: 17, color: C.ink, textAlign: 'left', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.bgWarm)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {c.flag}  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 48 }}>
          <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.inkMute, marginBottom: 12, fontWeight: 600 }}>
            02 — Enter a topic
          </label>
          <input
            type="text" value={topic} onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. AI regulation, the housing market…"
            style={{ width: '100%', padding: '20px 24px', background: 'transparent', border: `1.5px solid ${topic ? C.ink : C.rule}`, fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, color: C.ink, outline: 'none' }}
          />
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkMute, alignSelf: 'center', marginRight: 4 }}>Try:</span>
            {TRENDING.map(t => (
              <button
                key={t} onClick={() => setTopic(t)}
                style={{ padding: '4px 10px', background: 'transparent', border: `1px solid ${C.rule}`, fontSize: 12, color: C.inkSoft, cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.ink; e.currentTarget.style.color = C.bg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.inkSoft; }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => canSubmit && onSubmit(country!, topic.trim())}
          disabled={!canSubmit}
          style={{ width: '100%', padding: '24px', background: canSubmit ? C.ink : C.rule, color: C.bg, border: 'none', fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 500, cursor: canSubmit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}
          onMouseEnter={(e) => { if (canSubmit) e.currentTarget.style.background = C.accent; }}
          onMouseLeave={(e) => { if (canSubmit) e.currentTarget.style.background = C.ink; }}
        >
          Read the Pulse <span style={{ fontStyle: 'italic' }}>→</span>
        </button>

        <p style={{ marginTop: 20, fontSize: 12, color: C.inkMute, textAlign: 'center', fontStyle: 'italic' }}>
          Typical query: 30–50 seconds. Pulls ~200–300 comments, classifies each, computes weighted aggregate.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// LOADING
// ============================================================================

function Loading({ country, topic }: { country: Country; topic: string }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % LOADING_MESSAGES.length), 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <div style={{ marginBottom: 48 }}><Wordmark /></div>
        <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 40px' }}>
          <div style={{ position: 'absolute', inset: 0, border: `2px solid ${C.rule}`, borderRadius: '50%' }} />
          <div style={{ position: 'absolute', inset: 0, border: `2px solid transparent`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1.4s linear infinite' }} />
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 12, height: 12, background: C.accent, borderRadius: '50%', animation: 'pulse 1.6s ease-in-out infinite' }} />
        </div>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkMute, marginBottom: 16, fontWeight: 600 }}>
          {country.flag} {country.name} · {topic}
        </div>
        <div style={{ minHeight: 60, fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontStyle: 'italic', lineHeight: 1.3 }}>
          {LOADING_MESSAGES[idx]}
        </div>
        <div style={{ marginTop: 40, fontSize: 12, color: C.inkMute, maxWidth: 380, margin: '40px auto 0', fontFamily: 'JetBrains Mono, monospace' }}>
          OAuth → Search → Fetch → Classify → Bootstrap → Synthesize<br />
          <span style={{ color: C.accent }}>~30–50s typical · classifier cold-start adds 5–10s</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SHARE CARD
// ============================================================================

function ShareCardSVG({ result, svgRef }: { result: AnalyzeResult; svgRef: React.RefObject<SVGSVGElement> }) {
  const W = 1080, H = 1350, pad = 80;
  const score = result.pulse_index;
  const b = result.breakdown;
  const themes = result.themes.slice(0, 3);
  const barY = 760, barW = W - pad * 2;
  const pW = (b.positive / 100) * barW;
  const nW = (b.neutral / 100) * barW;
  const negW = barW - pW - nW;

  return (
    <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <rect width={W} height={H} fill={C.bg} />
      <line x1={pad} y1={120} x2={W - pad} y2={120} stroke={C.rule} strokeWidth="2" />
      <circle cx={pad + 8} cy={90} r="9" fill={C.accent} />
      <text x={pad + 28} y={98} fontFamily="Fraunces, serif" fontStyle="italic" fontSize="32" fontWeight="600" fill={C.ink}>Pulse</text>
      <rect x={pad + 110} y={75} width="50" height="28" fill={C.ink} />
      <text x={pad + 135} y={95} fontFamily="JetBrains Mono, monospace" fontSize="14" fill={C.bg} textAnchor="middle" fontWeight="600" letterSpacing="2">v2</text>
      <text x={W - pad} y={98} fontFamily="Inter, sans-serif" fontSize="18" fill={C.inkMute} textAnchor="end" letterSpacing="3">PUBLIC SENTIMENT INDEX</text>

      <text x={pad} y={200} fontFamily="Inter, sans-serif" fontSize="20" letterSpacing="4" fill={C.accent} fontWeight="600">
        {result.country.name.toUpperCase()} · ON
      </text>
      <text x={pad} y={290} fontFamily="Fraunces, serif" fontSize="76" fontStyle="italic" fill={C.ink} fontWeight="400">
        {result.topic.length > 28 ? result.topic.slice(0, 28) + '…' : result.topic}
      </text>

      <text x={pad} y={500} fontFamily="Fraunces, serif" fontSize="280" fontWeight="300" fill={C.ink} letterSpacing="-12">
        {score}
      </text>
      <text x={pad + 420} y={460} fontFamily="JetBrains Mono, monospace" fontSize="22" fill={C.inkMute} fontWeight="500">
        ±{Math.round((result.pulse_index_high - result.pulse_index_low) / 2)}
      </text>
      <text x={pad + 420} y={490} fontFamily="Inter, sans-serif" fontSize="14" fill={C.inkMute} letterSpacing="2">
        50% CI: {result.pulse_index_low}–{result.pulse_index_high}
      </text>
      <text x={pad + 20} y={560} fontFamily="Inter, sans-serif" fontSize="20" letterSpacing="3" fill={C.inkMute} fontWeight="600">
        PULSE INDEX · 0–100
      </text>

      <text x={pad} y={650} fontFamily="Fraunces, serif" fontSize="36" fontStyle="italic" fill={C.accent} fontWeight="500">
        {(result.headline_verdict || '').slice(0, 60)}
      </text>

      <text x={pad} y={730} fontFamily="Inter, sans-serif" fontSize="14" letterSpacing="3" fill={C.inkMute} fontWeight="600">BREAKDOWN</text>
      <rect x={pad} y={barY} width={pW} height="20" fill={C.positive} />
      <rect x={pad + pW} y={barY} width={nW} height="20" fill={C.neutral} />
      <rect x={pad + pW + nW} y={barY} width={negW} height="20" fill={C.negative} />
      <text x={pad} y={815} fontFamily="Inter, sans-serif" fontSize="20" fill={C.positive} fontWeight="600">● {b.positive}% positive</text>
      <text x={pad + 280} y={815} fontFamily="Inter, sans-serif" fontSize="20" fill={C.neutral} fontWeight="600">● {b.neutral}% neutral</text>
      <text x={pad + 540} y={815} fontFamily="Inter, sans-serif" fontSize="20" fill={C.negative} fontWeight="600">● {b.negative}% negative</text>

      <line x1={pad} y1={880} x2={W - pad} y2={880} stroke={C.rule} strokeWidth="1" />
      <text x={pad} y={930} fontFamily="Inter, sans-serif" fontSize="14" letterSpacing="3" fill={C.inkMute} fontWeight="600">DOMINANT THEMES</text>
      {themes.map((th, i) => (
        <g key={i} transform={`translate(${pad}, ${980 + i * 90})`}>
          <circle cx="10" cy="14" r="8" fill={sentimentColor(th.sentiment)} />
          <text x="36" y="22" fontFamily="Fraunces, serif" fontSize="32" fill={C.ink} fontWeight="500">{(th.theme || '').slice(0, 38)}</text>
          <text x="36" y="56" fontFamily="Inter, sans-serif" fontSize="18" fill={C.inkSoft} fontStyle="italic">{(th.description || '').slice(0, 70)}</text>
        </g>
      ))}

      <line x1={pad} y1={H - 100} x2={W - pad} y2={H - 100} stroke={C.rule} strokeWidth="1" />
      <text x={pad} y={H - 50} fontFamily="JetBrains Mono, monospace" fontSize="16" fill={C.inkMute} fontWeight="500">
        N={result.sample_size} · {result.thread_count} threads · {result.confidence} conf
      </text>
      <text x={W - pad} y={H - 50} fontFamily="Inter, sans-serif" fontSize="18" fill={C.accent} fontWeight="600" textAnchor="end" letterSpacing="2">
        pulse.index
      </text>
    </svg>
  );
}

// ============================================================================
// RESULT
// ============================================================================

function Result({ result, onReset }: { result: AnalyzeResult; onReset: () => void }) {
  const score = result.pulse_index;
  const animScore = useCountUp(score, 1400);
  const [methodOpen, setMethodOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [download, setDownload] = useState<'idle' | 'preparing' | 'done'>('idle');
  const svgRef = useRef<SVGSVGElement>(null);

  const downloadCard = async () => {
    if (!svgRef.current) return;
    setDownload('preparing');
    try {
      const svgStr = new XMLSerializer().serializeToString(svgRef.current);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = url; });

      const canvas = document.createElement('canvas');
      canvas.width = 1080; canvas.height = 1350;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, 1080, 1350);
      ctx.drawImage(img, 0, 0, 1080, 1350);
      canvas.toBlob((png) => {
        if (!png) return;
        const pngUrl = URL.createObjectURL(png);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `pulse-${result.country.code}-${result.topic.replace(/\s+/g, '-').toLowerCase().slice(0, 24)}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(pngUrl); URL.revokeObjectURL(url);
        setDownload('done');
        setTimeout(() => setDownload('idle'), 2000);
      }, 'image/png');
    } catch (e) {
      console.error(e);
      setDownload('idle');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, padding: '40px 20px 80px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 48 }}>
          <Wordmark />
          <button onClick={onReset} style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${C.rule}`, fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkSoft, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <RotateCcw size={12} /> New Reading
          </button>
        </div>

        {/* HEADLINE */}
        <div style={{ marginBottom: 56 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.accent, fontWeight: 600, marginBottom: 16 }}>
            {result.country.flag} {result.country.name} · On {result.topic}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(120px, 20vw, 200px)', fontWeight: 300, lineHeight: 0.9, letterSpacing: '-0.05em' }}>
              {animScore}
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, color: C.inkMute }}>
              <div>50% CI</div>
              <div style={{ fontSize: 22, color: C.ink, fontWeight: 600 }}>{result.pulse_index_low}–{result.pulse_index_high}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkMute, marginTop: 16, marginBottom: 32, fontWeight: 600 }}>
            Pulse Index · 0–100
          </div>
          {result.headline_verdict && (
            <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(28px, 4.5vw, 40px)', fontStyle: 'italic', fontWeight: 400, lineHeight: 1.2, color: C.accent, letterSpacing: '-0.01em' }}>
              "{result.headline_verdict}"
            </h2>
          )}
        </div>

        {/* THE RECEIPTS — sample size grid */}
        <div style={{ marginBottom: 56, padding: 28, background: C.bgWarm, border: `1px solid ${C.rule}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <Database size={14} color={C.accent} />
            <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.accent, fontWeight: 600 }}>The Receipts</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 24 }}>
            <Stat label="Comments classified" value={result.sample_size.toString()} />
            <Stat label="Threads analyzed" value={result.thread_count.toString()} />
            <Stat label="Subreddits" value={result.subreddits_searched.length.toString()} />
            <Stat label="Total upvotes" value={fmtNum(result.total_upvotes)} />
            <Stat label="Confidence" value={result.confidence} colored />
            <Stat label="Classifier conf." value={`${Math.round(result.classifier_confidence_avg * 100)}%`} />
          </div>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.rule}`, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.inkSoft }}>
            Window: {fmtDate(result.oldest_comment_utc)} → {fmtDate(result.newest_comment_utc)}
          </div>
        </div>

        {/* BREAKDOWN */}
        <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkMute, fontWeight: 600, marginBottom: 8 }}>
            Sentiment Breakdown
          </div>
          <div style={{ fontSize: 12, color: C.inkMute, fontStyle: 'italic', marginBottom: 20 }}>
            Weighted by log(2 + upvotes) per comment.
          </div>
          <SentimentBar breakdown={result.breakdown} />
        </div>

        {/* SUMMARY */}
        {result.summary && (
          <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkMute, fontWeight: 600, marginBottom: 20 }}>
              The Conversation
            </div>
            <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, lineHeight: 1.5 }}>{result.summary}</p>
          </div>
        )}

        {/* THEMES */}
        {result.themes.length > 0 && (
          <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkMute, fontWeight: 600, marginBottom: 8 }}>
              Dominant Themes
            </div>
            <div style={{ fontSize: 12, color: C.inkMute, fontStyle: 'italic', marginBottom: 24 }}>
              Synthesized from the same {result.sample_size} comments measured above.
            </div>
            {result.themes.map((th, i) => (
              <div key={i} style={{ display: 'flex', gap: 20, marginBottom: 24, paddingBottom: 24, borderBottom: i < result.themes.length - 1 ? `1px solid ${C.rule}` : 'none' }}>
                <div style={{ flexShrink: 0, marginTop: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: sentimentColor(th.sentiment) }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 500 }}>{th.theme}</div>
                    <div style={{ fontSize: 11, letterSpacing: '0.1em', color: C.inkMute, fontFamily: 'JetBrains Mono, monospace' }}>
                      ~{th.example_count} comments
                    </div>
                  </div>
                  <div style={{ fontSize: 15, lineHeight: 1.5, color: C.inkSoft }}>{th.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* VOICES */}
        {result.voices.length > 0 && (
          <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkMute, fontWeight: 600, marginBottom: 8 }}>
              Top Voices
            </div>
            <div style={{ fontSize: 12, color: C.inkMute, fontStyle: 'italic', marginBottom: 24 }}>
              Highest-upvoted comments per sentiment bucket. Excerpts only — click to read in full on Reddit.
            </div>
            {result.voices.map((v, i) => (
              <a key={i} href={v.permalink} target="_blank" rel="noopener noreferrer"
                 style={{ display: 'block', marginBottom: 16, paddingLeft: 20, borderLeft: `3px solid ${sentimentColor(v.sentiment)}`, textDecoration: 'none', transition: 'transform 0.15s' }}
                 onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateX(4px)')}
                 onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateX(0)')}>
                <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 19, lineHeight: 1.45, color: C.ink, fontStyle: 'italic', margin: 0 }}>
                  "{v.excerpt}"
                </p>
                <div style={{ marginTop: 6, display: 'flex', gap: 14, fontSize: 11, color: C.inkMute, fontFamily: 'JetBrains Mono, monospace' }}>
                  <span>r/{v.subreddit}</span>
                  <span>↑ {v.upvotes}</span>
                  <span style={{ color: sentimentColor(v.sentiment) }}>● {v.sentiment} {Math.round(v.confidence * 100)}%</span>
                  <span style={{ color: C.accent, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                    Read full <ExternalLink size={11} />
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}

        {/* SURPRISE */}
        {result.surprise_finding && (
          <div style={{ marginBottom: 56, padding: 32, background: C.bgWarm, border: `1px solid ${C.rule}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Sparkles size={14} color={C.accent} />
              <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.accent, fontWeight: 600 }}>The Surprise</span>
            </div>
            <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, lineHeight: 1.45 }}>{result.surprise_finding}</p>
          </div>
        )}

        {/* SOURCES — collapsible */}
        <div style={{ marginBottom: 32, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
          <button onClick={() => setSourcesOpen(!sourcesOpen)} style={{ width: '100%', padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.inkMute, fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={14} /> Source Threads ({result.threads.length})
            </span>
            {sourcesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {sourcesOpen && (
            <div style={{ marginTop: 20 }}>
              {result.threads.map((t, i) => (
                <a key={i} href={t.permalink} target="_blank" rel="noopener noreferrer"
                   style={{ display: 'block', padding: '14px 0', borderBottom: i < result.threads.length - 1 ? `1px solid ${C.rule}` : 'none', textDecoration: 'none', color: C.ink }}>
                  <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 17, marginBottom: 4, lineHeight: 1.3 }}>
                    {t.title}
                  </div>
                  <div style={{ fontSize: 11, color: C.inkMute, fontFamily: 'JetBrains Mono, monospace', display: 'flex', gap: 12 }}>
                    <span>r/{t.subreddit}</span>
                    <span>↑ {t.score}</span>
                    <span>💬 {t.num_comments}</span>
                    <span>{fmtDate(t.created_utc)}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* SHARE */}
        <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `2px solid ${C.ink}` }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkMute, fontWeight: 600, marginBottom: 24 }}>Share This Reading</div>
          <div style={{ background: C.bgWarm, padding: 20, marginBottom: 20, border: `1px solid ${C.rule}` }}>
            <div style={{ width: '100%', maxWidth: 380, margin: '0 auto', boxShadow: '0 4px 30px rgba(0,0,0,0.08)' }}>
              <ShareCardSVG result={result} svgRef={svgRef} />
            </div>
          </div>
          <button onClick={downloadCard} disabled={download === 'preparing'}
                  style={{ width: '100%', padding: '20px', background: C.ink, color: C.bg, border: 'none', fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, cursor: download === 'preparing' ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            {download === 'preparing' ? <><Loader2 size={18} className="animate-spin" /> Preparing…</> :
             download === 'done' ? '✓ Downloaded' :
             <><Download size={18} /> Download Card (1080×1350)</>}
          </button>
        </div>

        {/* METHODOLOGY */}
        <div style={{ paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
          <button onClick={() => setMethodOpen(!methodOpen)} style={{ width: '100%', padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.inkMute, fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Info size={14} /> Methodology & Limitations</span>
            {methodOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {methodOpen && (
            <div style={{ marginTop: 24, fontSize: 14, lineHeight: 1.7, color: C.inkSoft }}>
              <Method title="Data source">
                Live Reddit OAuth API. Searched {result.subreddits_searched.length} subreddits ({result.subreddits_searched.map(s => `r/${s}`).join(', ')}) using Reddit's <code style={{ fontFamily: 'JetBrains Mono, monospace', background: C.bgWarm, padding: '1px 5px' }}>search.json</code> endpoint with <code style={{ fontFamily: 'JetBrains Mono, monospace', background: C.bgWarm, padding: '1px 5px' }}>t=month</code> filter. Top {result.thread_count} threads by comment count, then top comments by upvote score per thread. {result.sample_size} comments classified.
              </Method>
              <Method title="Sentiment classifier">
                <code style={{ fontFamily: 'JetBrains Mono, monospace', background: C.bgWarm, padding: '1px 5px' }}>{result.methodology.sentiment_model}</code> via Hugging Face Inference API. Multilingual XLM-RoBERTa fine-tuned on ~198M tweets in 8 languages, supports 30+ languages for inference. Output: 3-class probabilities (positive/neutral/negative) per comment.
              </Method>
              <Method title="Pulse Index formula">
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, background: C.bgWarm, padding: 12, marginTop: 8, lineHeight: 1.6 }}>
                  weight(c) = log(2 + max(0, upvotes_c))<br />
                  signed(c) = P(positive | c) − P(negative | c)<br />
                  score = round(50 × (1 + Σ weight(c)·signed(c) / Σ weight(c)))
                </div>
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  CI: 500-sample bootstrap, 25th/75th percentiles. Result: {result.pulse_index_low}–{result.pulse_index_high}.
                </div>
              </Method>
              <Method title="Confidence band">
                Sample size N={result.sample_size}: {result.confidence}. (≥200 = high · 80–199 = medium · &lt;80 = low)
              </Method>
              <Method title="Known biases">
                Reddit users skew younger, more male, more urban, and more English-fluent than the general population of {result.country.name}. Country-specific subreddits often skew toward expat / diaspora / educated-professional voices. Search relevance ranking favors threads engagement, so loud minority opinions are over-represented vs lurkers. <strong style={{ color: C.ink }}>This is a measurement of upvote-weighted Reddit-active opinion — not a national poll.</strong>
              </Method>
              <Method title="Performance">
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.inkSoft }}>
                  Reddit fetch: {result.methodology.timing_ms.reddit}ms<br />
                  Classification: {result.methodology.timing_ms.classify}ms<br />
                  Theme synthesis: {result.methodology.timing_ms.themes}ms<br />
                  Total: {result.methodology.timing_ms.total}ms
                </div>
              </Method>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, colored }: { label: string; value: string; colored?: boolean }) {
  let color = C.ink;
  if (colored) {
    if (value === 'high') color = C.positive;
    else if (value === 'low') color = C.negative;
    else color = C.inkSoft;
  }
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.inkMute, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 500, color, lineHeight: 1, textTransform: colored ? 'capitalize' as const : 'none' as const }}>{value}</div>
    </div>
  );
}

function Method({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <strong style={{ color: C.ink, display: 'block', marginBottom: 6 }}>{title}</strong>
      <div>{children}</div>
    </div>
  );
}

// ============================================================================
// ERROR
// ============================================================================

function ErrorScreen({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <AlertCircle size={48} color={C.accent} style={{ marginBottom: 32 }} />
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 36, fontStyle: 'italic', marginBottom: 16, lineHeight: 1.2 }}>
          The signal got lost.
        </h2>
        <p style={{ fontSize: 15, color: C.inkSoft, marginBottom: 32, lineHeight: 1.6 }}>{message}</p>
        <button onClick={onReset} style={{ padding: '16px 32px', background: C.ink, color: C.bg, border: 'none', fontFamily: 'Fraunces, Georgia, serif', fontSize: 17, cursor: 'pointer' }}>
          Try again →
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN
// ============================================================================

export default function Page() {
  const [stage, setStage] = useState<'landing' | 'loading' | 'result' | 'error'>('landing');
  const [country, setCountry] = useState<Country | null>(null);
  const [topic, setTopic] = useState('');
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (c: Country, t: string) => {
    setCountry(c); setTopic(t); setStage('loading'); setError(null);
    try {
      const t0 = Date.now();
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country_code: c.code, topic: t }),
      });
      const data = await res.json();

      if (data.error) {
        if (data.error === 'INSUFFICIENT_DATA') {
          setError(data.message + (data.debug ? `\n\nDiagnostic: ${data.debug.posts_found} posts, ${data.debug.comments_found} comments found.` : ''));
        } else {
          setError(data.message || 'Something went wrong.');
        }
        setStage('error');
        return;
      }

      // Min 3s ritual
      const elapsed = Date.now() - t0;
      if (elapsed < 3000) await new Promise(r => setTimeout(r, 3000 - elapsed));

      setResult(data); setStage('result');
    } catch (e: any) {
      setError(e.message || 'Network error'); setStage('error');
    }
  };

  const reset = () => { setStage('landing'); setResult(null); setError(null); };

  return (
    <main>
      {stage === 'landing' && <Landing onSubmit={submit} />}
      {stage === 'loading' && country && <Loading country={country} topic={topic} />}
      {stage === 'result' && result && <Result result={result} onReset={reset} />}
      {stage === 'error' && <ErrorScreen message={error || 'Unknown error'} onReset={reset} />}
    </main>
  );
}
