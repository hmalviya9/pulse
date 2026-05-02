'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Search, Loader2, Download, RotateCcw, AlertCircle, Info, ChevronDown, ChevronUp,
  Sparkles, ExternalLink, Database, Newspaper, MessageSquare, TrendingUp, DollarSign,
  Activity, GitBranch, BookOpen
} from 'lucide-react';
import { COUNTRIES, type Country } from '@/lib/countries';

const TRENDING = ['AI regulation', 'cost of living', 'climate change', 'elections', 'cryptocurrency', 'remote work', 'housing crisis', 'immigration'];

const LOADING_MESSAGES = [
  'Authenticating with Reddit…',
  'Querying GDELT global news…',
  'Fetching Wikipedia pageviews…',
  'Searching prediction markets…',
  'Running multilingual classifier…',
  'Computing source weights…',
  'Measuring divergence…',
  'Synthesizing themes…',
];

const C = {
  bg: '#FAFAF5', bgWarm: '#F4F1E8',
  ink: '#1A1A1A', inkSoft: '#3A3A3A', inkMute: '#7A7A7A',
  rule: '#D8D4C7', accent: '#C44536',
  positive: '#4A7C59', negative: '#A8392E', neutral: '#8B8680',
  reddit: '#FF4500', gdelt: '#3B5BDB', wiki: '#36454F', poly: '#0EA5E9',
};

interface SourceContribution { source: 'reddit' | 'gdelt'; pulse_score: number; weight: number; sample_n: number; }

interface AnalyzeResult {
  ok: true;
  country: { code: string; name: string; flag: string };
  topic: string;
  pulse_index: number;
  pulse_index_low: number;
  pulse_index_high: number;
  blend: {
    contributions: SourceContribution[];
    divergence: number;
    divergence_label: 'aligned' | 'mixed' | 'split';
    divergence_note: string;
    sources_used: number;
    sources_attempted: number;
    insufficient: string[];
  };
  sources: {
    reddit: any;
    gdelt: any;
    wikipedia: any;
    polymarket: any;
  };
  confidence: 'high' | 'medium' | 'low';
  themes: Array<{ theme: string; sentiment: string; description: string; example_count: number }>;
  surprise_finding: string;
  headline_verdict: string;
  summary: string;
  methodology: { sentiment_model: string; formula: string; timing_ms: { parallel_fetch: number; themes: number; total: number } };
}

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
const fmtDate = (utc: number) => { if (!utc) return '—'; return new Date(utc * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtNum = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
const fmtMoney = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

// ============================================================================
// COMMON
// ============================================================================

function Wordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.accent, boxShadow: `0 0 0 3px ${C.accent}22` }} />
      <span style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 600, fontStyle: 'italic', fontSize: 18, letterSpacing: '-0.02em', color: C.ink }}>Pulse</span>
      <span style={{ marginLeft: 6, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', padding: '2px 6px', background: C.ink, color: C.bg, letterSpacing: '0.1em' }}>v3</span>
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
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 80 }}>
          <Wordmark />
          <span style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.inkMute }}>Multi-Source Sentiment</span>
        </div>

        <div style={{ marginBottom: 48 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.accent, fontWeight: 600, marginBottom: 24 }}>
            Issue No. 03 · Triangulation
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(40px, 7vw, 76px)', lineHeight: 1.02, fontWeight: 400, letterSpacing: '-0.02em', marginBottom: 24 }}>
            What does <span style={{ fontStyle: 'italic', color: C.accent }}>{country ? country.name : 'the world'}</span><br />
            actually think<br />
            about <span style={{ fontStyle: 'italic' }}>{topic.trim() || '___'}</span>?
          </h1>
          <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, lineHeight: 1.5, color: C.inkSoft, fontStyle: 'italic', maxWidth: 600 }}>
            Reddit's grassroots voice, GDELT's global news tone, Wikipedia's attention curve, Polymarket's money-on-the-line conviction — read together, then the disagreements explained.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 32 }}>
          <SourceBadge color={C.reddit} icon={<MessageSquare size={14} />} name="Reddit" desc="Conversation" sample="~200 comments" />
          <SourceBadge color={C.gdelt} icon={<Newspaper size={14} />} name="GDELT" desc="News tone" sample="~50–500 articles" />
          <SourceBadge color={C.wiki} icon={<BookOpen size={14} />} name="Wikipedia" desc="Attention" sample="30-day curve" />
          <SourceBadge color={C.poly} icon={<DollarSign size={14} />} name="Polymarket" desc="Conviction" sample="When relevant" />
        </div>

        <div style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 32, marginBottom: 32 }}>
          <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.inkMute, marginBottom: 12, fontWeight: 600 }}>01 — Pick a country</label>
          <button onClick={() => setShow(!show)} style={{ width: '100%', padding: '20px 24px', background: 'transparent', border: `1.5px solid ${country ? C.ink : C.rule}`, fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontStyle: country ? 'normal' : 'italic', color: country ? C.ink : C.inkMute, textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{country ? `${country.flag}  ${country.name}` : 'Select a country…'}</span>
            {show ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
          {show && (
            <div style={{ border: `1.5px solid ${C.ink}`, borderTop: 'none', maxHeight: 320, overflowY: 'auto', background: C.bg }}>
              <div style={{ padding: 12, borderBottom: `1px solid ${C.rule}`, position: 'sticky', top: 0, background: C.bg }}>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.inkMute }} />
                  <input autoFocus type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search countries"
                    style={{ width: '100%', padding: '8px 12px 8px 32px', border: `1px solid ${C.rule}`, background: C.bg, fontSize: 14, color: C.ink, outline: 'none' }} />
                </div>
              </div>
              {filtered.map(c => (
                <button key={c.code} onClick={() => { setCountry(c); setShow(false); setSearch(''); }}
                  style={{ width: '100%', padding: '12px 24px', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.rule}`, fontFamily: 'Fraunces, Georgia, serif', fontSize: 17, color: C.ink, textAlign: 'left', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.bgWarm)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  {c.flag}  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 48 }}>
          <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.inkMute, marginBottom: 12, fontWeight: 600 }}>02 — Enter a topic</label>
          <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. AI regulation, the housing market…"
            style={{ width: '100%', padding: '20px 24px', background: 'transparent', border: `1.5px solid ${topic ? C.ink : C.rule}`, fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, color: C.ink, outline: 'none' }} />
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkMute, alignSelf: 'center', marginRight: 4 }}>Try:</span>
            {TRENDING.map(t => (
              <button key={t} onClick={() => setTopic(t)}
                style={{ padding: '4px 10px', background: 'transparent', border: `1px solid ${C.rule}`, fontSize: 12, color: C.inkSoft, cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.ink; e.currentTarget.style.color = C.bg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.inkSoft; }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => canSubmit && onSubmit(country!, topic.trim())} disabled={!canSubmit}
          style={{ width: '100%', padding: '24px', background: canSubmit ? C.ink : C.rule, color: C.bg, border: 'none', fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 500, cursor: canSubmit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}
          onMouseEnter={(e) => { if (canSubmit) e.currentTarget.style.background = C.accent; }}
          onMouseLeave={(e) => { if (canSubmit) e.currentTarget.style.background = C.ink; }}>
          Read the Pulse <span style={{ fontStyle: 'italic' }}>→</span>
        </button>

        <p style={{ marginTop: 20, fontSize: 12, color: C.inkMute, textAlign: 'center', fontStyle: 'italic' }}>
          Four sources fetched in parallel. Typical query: 30–50 seconds.
        </p>
      </div>
    </div>
  );
}

function SourceBadge({ color, icon, name, desc, sample }: any) {
  return (
    <div style={{ padding: 16, background: C.bgWarm, border: `1px solid ${C.rule}`, borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color }}>
        {icon}
        <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13, letterSpacing: '0.02em' }}>{name}</span>
      </div>
      <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontStyle: 'italic', fontSize: 14, color: C.ink, marginBottom: 4 }}>{desc}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: C.inkMute }}>{sample}</div>
    </div>
  );
}

// ============================================================================
// LOADING
// ============================================================================

function Loading({ country, topic }: { country: Country; topic: string }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % LOADING_MESSAGES.length), 3500);
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
        <div style={{ marginTop: 40, fontSize: 11, color: C.inkMute, fontFamily: 'JetBrains Mono, monospace' }}>
          4 sources · running in parallel
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
  const themes = result.themes.slice(0, 3);
  const sourcesLine = result.blend.contributions.map(c => `${c.source}:${c.pulse_score}`).join('  ·  ');

  return (
    <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <rect width={W} height={H} fill={C.bg} />
      <line x1={pad} y1={120} x2={W - pad} y2={120} stroke={C.rule} strokeWidth="2" />
      <circle cx={pad + 8} cy={90} r="9" fill={C.accent} />
      <text x={pad + 28} y={98} fontFamily="Fraunces, serif" fontStyle="italic" fontSize="32" fontWeight="600" fill={C.ink}>Pulse</text>
      <rect x={pad + 110} y={75} width="50" height="28" fill={C.ink} />
      <text x={pad + 135} y={95} fontFamily="JetBrains Mono, monospace" fontSize="14" fill={C.bg} textAnchor="middle" fontWeight="600" letterSpacing="2">v3</text>
      <text x={W - pad} y={98} fontFamily="Inter, sans-serif" fontSize="18" fill={C.inkMute} textAnchor="end" letterSpacing="3">MULTI-SOURCE INDEX</text>

      <text x={pad} y={200} fontFamily="Inter, sans-serif" fontSize="20" letterSpacing="4" fill={C.accent} fontWeight="600">
        {result.country.name.toUpperCase()} · ON
      </text>
      <text x={pad} y={290} fontFamily="Fraunces, serif" fontSize="76" fontStyle="italic" fill={C.ink} fontWeight="400">
        {result.topic.length > 28 ? result.topic.slice(0, 28) + '…' : result.topic}
      </text>

      <text x={pad} y={500} fontFamily="Fraunces, serif" fontSize="280" fontWeight="300" fill={C.ink} letterSpacing="-12">{score}</text>
      <text x={pad + 420} y={460} fontFamily="JetBrains Mono, monospace" fontSize="22" fill={C.inkMute} fontWeight="500">
        ±{Math.round((result.pulse_index_high - result.pulse_index_low) / 2)}
      </text>
      <text x={pad + 420} y={490} fontFamily="Inter, sans-serif" fontSize="14" fill={C.inkMute} letterSpacing="2">
        {result.pulse_index_low}–{result.pulse_index_high}
      </text>
      <text x={pad + 20} y={560} fontFamily="Inter, sans-serif" fontSize="20" letterSpacing="3" fill={C.inkMute} fontWeight="600">
        BLENDED PULSE · 0–100
      </text>

      <text x={pad} y={650} fontFamily="Fraunces, serif" fontSize="36" fontStyle="italic" fill={C.accent} fontWeight="500">
        {(result.headline_verdict || '').slice(0, 60)}
      </text>

      <text x={pad} y={730} fontFamily="Inter, sans-serif" fontSize="14" letterSpacing="3" fill={C.inkMute} fontWeight="600">SOURCE BREAKDOWN</text>
      {result.blend.contributions.map((c, i) => (
        <g key={i} transform={`translate(${pad + i * 250}, 760)`}>
          <rect width="220" height="80" fill={C.bgWarm} stroke={C.rule} />
          <rect width="6" height="80" fill={c.source === 'reddit' ? C.reddit : C.gdelt} />
          <text x={20} y={28} fontFamily="Inter, sans-serif" fontSize="12" letterSpacing="2" fill={C.inkMute} fontWeight="600">{c.source.toUpperCase()}</text>
          <text x={20} y={62} fontFamily="Fraunces, serif" fontSize="36" fill={C.ink} fontWeight="500">{c.pulse_score}</text>
          <text x={130} y={62} fontFamily="JetBrains Mono, monospace" fontSize="11" fill={C.inkMute}>n={c.sample_n}</text>
        </g>
      ))}

      {result.blend.divergence_label !== 'aligned' && (
        <g transform={`translate(${pad}, 880)`}>
          <text fontFamily="Inter, sans-serif" fontSize="12" letterSpacing="2" fill={C.accent} fontWeight="600">
            DIVERGENCE: {result.blend.divergence_label.toUpperCase()} (σ={result.blend.divergence})
          </text>
        </g>
      )}

      <line x1={pad} y1={920} x2={W - pad} y2={920} stroke={C.rule} strokeWidth="1" />
      <text x={pad} y={970} fontFamily="Inter, sans-serif" fontSize="14" letterSpacing="3" fill={C.inkMute} fontWeight="600">DOMINANT THEMES</text>
      {themes.map((th, i) => (
        <g key={i} transform={`translate(${pad}, ${1010 + i * 70})`}>
          <circle cx="10" cy="14" r="8" fill={sentimentColor(th.sentiment)} />
          <text x="36" y="22" fontFamily="Fraunces, serif" fontSize="28" fill={C.ink} fontWeight="500">{(th.theme || '').slice(0, 38)}</text>
        </g>
      ))}

      <line x1={pad} y1={H - 100} x2={W - pad} y2={H - 100} stroke={C.rule} strokeWidth="1" />
      <text x={pad} y={H - 50} fontFamily="JetBrains Mono, monospace" fontSize="14" fill={C.inkMute} fontWeight="500">
        {result.blend.sources_used}/{result.blend.sources_attempted} sources · {result.confidence} confidence
      </text>
      <text x={W - pad} y={H - 50} fontFamily="Inter, sans-serif" fontSize="18" fill={C.accent} fontWeight="600" textAnchor="end" letterSpacing="2">pulse.index</text>
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
        setDownload('done'); setTimeout(() => setDownload('idle'), 2000);
      }, 'image/png');
    } catch (e) { console.error(e); setDownload('idle'); }
  };

  const reddit = result.sources.reddit;
  const gdelt = result.sources.gdelt;
  const wiki = result.sources.wikipedia;
  const poly = result.sources.polymarket;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, padding: '40px 20px 80px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
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
              <div>RANGE</div>
              <div style={{ fontSize: 22, color: C.ink, fontWeight: 600 }}>{result.pulse_index_low}–{result.pulse_index_high}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkMute, marginTop: 16, marginBottom: 32, fontWeight: 600 }}>
            Blended Pulse · {result.blend.sources_used} of {result.blend.sources_attempted} sources
          </div>
          {result.headline_verdict && (
            <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(28px, 4.5vw, 40px)', fontStyle: 'italic', fontWeight: 400, lineHeight: 1.2, color: C.accent, letterSpacing: '-0.01em' }}>
              "{result.headline_verdict}"
            </h2>
          )}
        </div>

        {/* SOURCE BREAKDOWN — the v3 signature move */}
        <div style={{ marginBottom: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <GitBranch size={14} color={C.accent} />
            <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.accent, fontWeight: 600 }}>The Triangulation</span>
          </div>
          <div style={{ fontSize: 13, color: C.inkMute, fontStyle: 'italic', marginBottom: 24 }}>
            How each source scored the topic. Disagreement is itself a signal.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 24 }}>
            {/* Reddit card */}
            <SourceCard color={C.reddit} icon={<MessageSquare size={14} />} name="REDDIT"
              score={reddit.found ? reddit.pulse_score : null}
              sample={reddit.found ? `${reddit.sample_size} comments · ${reddit.thread_count} threads` : 'Insufficient data'}
              weight={result.blend.contributions.find(c => c.source === 'reddit')?.weight} />
            {/* GDELT card */}
            <SourceCard color={C.gdelt} icon={<Newspaper size={14} />} name="GDELT NEWS"
              score={gdelt.found ? gdelt.pulse_score : null}
              sample={gdelt.found ? `${gdelt.article_count} articles · tone ${gdelt.mean_tone > 0 ? '+' : ''}${gdelt.mean_tone.toFixed(1)}` : 'Insufficient data'}
              weight={result.blend.contributions.find(c => c.source === 'gdelt')?.weight} />
            {/* Wikipedia card */}
            <SourceCard color={C.wiki} icon={<BookOpen size={14} />} name="WIKIPEDIA"
              score={null}
              sample={wiki.found ? `${fmtNum(wiki.total_views_30d)} views · ${wiki.momentum}` : 'No article matched'}
              indicator={wiki.found ? wiki.momentum : null}
              note="attention, not sentiment" />
            {/* Polymarket card */}
            <SourceCard color={C.poly} icon={<DollarSign size={14} />} name="POLYMARKET"
              score={poly.found ? poly.pulse_score_indicative : null}
              sample={poly.found ? `${poly.markets.length} markets · ${fmtMoney(poly.total_volume_24h)}/24h` : 'No matching markets'}
              note={poly.found ? 'event probability, indicative only' : null} />
          </div>

          {/* Divergence note */}
          {result.blend.sources_used >= 2 && (
            <div style={{
              padding: 20,
              background: result.blend.divergence_label === 'split' ? `${C.accent}11` :
                          result.blend.divergence_label === 'mixed' ? C.bgWarm : `${C.positive}11`,
              border: `1px solid ${result.blend.divergence_label === 'split' ? C.accent :
                          result.blend.divergence_label === 'mixed' ? C.rule : C.positive}`,
              borderLeft: `4px solid ${result.blend.divergence_label === 'split' ? C.accent :
                          result.blend.divergence_label === 'mixed' ? C.neutral : C.positive}`,
            }}>
              <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600,
                color: result.blend.divergence_label === 'split' ? C.accent :
                       result.blend.divergence_label === 'mixed' ? C.inkSoft : C.positive,
                marginBottom: 6 }}>
                Sources are {result.blend.divergence_label} (σ={result.blend.divergence})
              </div>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, lineHeight: 1.4, fontStyle: 'italic' }}>
                {result.blend.divergence_note}
              </div>
            </div>
          )}
        </div>

        {/* SUMMARY */}
        {result.summary && (
          <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkMute, fontWeight: 600, marginBottom: 20 }}>The Conversation</div>
            <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, lineHeight: 1.5 }}>{result.summary}</p>
          </div>
        )}

        {/* WIKIPEDIA ATTENTION CHART */}
        {wiki.found && wiki.daily.length > 0 && (
          <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Activity size={14} color={C.wiki} />
              <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.wiki, fontWeight: 600 }}>Attention · Last 30 Days</span>
            </div>
            <div style={{ fontSize: 13, color: C.inkMute, fontStyle: 'italic', marginBottom: 16 }}>
              Wikipedia daily pageviews on <a href={wiki.url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>{wiki.article_title}</a> ({wiki.language_project})
            </div>
            <SparkChart data={wiki.daily} momentum={wiki.momentum} ratio={wiki.momentum_ratio} />
          </div>
        )}

        {/* GDELT ARTICLES */}
        {gdelt.found && gdelt.articles.length > 0 && (
          <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Newspaper size={14} color={C.gdelt} />
              <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.gdelt, fontWeight: 600 }}>Recent News Coverage</span>
            </div>
            <div style={{ fontSize: 13, color: C.inkMute, fontStyle: 'italic', marginBottom: 16 }}>
              {gdelt.article_count} articles tracked. Showing {gdelt.articles.length} most recent.
            </div>
            <div>
              {gdelt.articles.slice(0, 6).map((a: any, i: number) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                   style={{ display: 'block', padding: '12px 0', borderBottom: i < 5 ? `1px solid ${C.rule}` : 'none', textDecoration: 'none', color: C.ink }}>
                  <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 16, marginBottom: 4, lineHeight: 1.3 }}>
                    {a.title || '(no title)'}
                  </div>
                  <div style={{ fontSize: 11, color: C.inkMute, fontFamily: 'JetBrains Mono, monospace', display: 'flex', gap: 12 }}>
                    <span>{a.domain}</span>
                    <span>{a.sourcecountry}</span>
                    <span>{a.language}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* POLYMARKET CARDS */}
        {poly.found && poly.markets.length > 0 && (
          <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <DollarSign size={14} color={C.poly} />
              <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.poly, fontWeight: 600 }}>Money on the Line</span>
            </div>
            <div style={{ fontSize: 13, color: C.inkMute, fontStyle: 'italic', marginBottom: 20 }}>
              Polymarket events matching this topic. Probability = current "Yes" price.
            </div>
            {poly.markets.map((m: any, i: number) => (
              <a key={i} href={m.url} target="_blank" rel="noopener noreferrer"
                 style={{ display: 'block', padding: 16, marginBottom: 12, background: C.bgWarm, border: `1px solid ${C.rule}`, borderLeft: `3px solid ${C.poly}`, textDecoration: 'none', color: C.ink }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, flex: 1, lineHeight: 1.3 }}>
                    {m.question}
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 28, fontWeight: 600, color: C.poly }}>
                    {Math.round(m.yes_probability * 100)}%
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: C.inkMute, fontFamily: 'JetBrains Mono, monospace', display: 'flex', gap: 12 }}>
                  <span>24h vol: {fmtMoney(m.volume_24h)}</span>
                  <span>match: {Math.round(m.match_score * 100)}%</span>
                </div>
              </a>
            ))}
          </div>
        )}

        {/* THEMES */}
        {result.themes.length > 0 && (
          <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkMute, fontWeight: 600, marginBottom: 24 }}>Dominant Themes</div>
            {result.themes.map((th, i) => (
              <div key={i} style={{ display: 'flex', gap: 20, marginBottom: 24, paddingBottom: 24, borderBottom: i < result.themes.length - 1 ? `1px solid ${C.rule}` : 'none' }}>
                <div style={{ flexShrink: 0, marginTop: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: sentimentColor(th.sentiment) }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 500, marginBottom: 6 }}>{th.theme}</div>
                  <div style={{ fontSize: 15, lineHeight: 1.5, color: C.inkSoft }}>{th.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* REDDIT VOICES */}
        {reddit.found && reddit.voices && reddit.voices.length > 0 && (
          <div style={{ marginBottom: 56, paddingTop: 32, borderTop: `1px solid ${C.rule}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <MessageSquare size={14} color={C.reddit} />
              <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.reddit, fontWeight: 600 }}>Top Reddit Voices</span>
            </div>
            <div style={{ fontSize: 12, color: C.inkMute, fontStyle: 'italic', marginBottom: 24 }}>
              Excerpts only. Click to read full comment on Reddit.
            </div>
            {reddit.voices.map((v: any, i: number) => (
              <a key={i} href={v.permalink} target="_blank" rel="noopener noreferrer"
                 style={{ display: 'block', marginBottom: 16, paddingLeft: 20, borderLeft: `3px solid ${sentimentColor(v.sentiment)}`, textDecoration: 'none' }}>
                <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, lineHeight: 1.45, color: C.ink, fontStyle: 'italic', margin: 0 }}>
                  "{v.excerpt}"
                </p>
                <div style={{ marginTop: 6, display: 'flex', gap: 14, fontSize: 11, color: C.inkMute, fontFamily: 'JetBrains Mono, monospace' }}>
                  <span>r/{v.subreddit}</span>
                  <span>↑ {v.upvotes}</span>
                  <span style={{ color: sentimentColor(v.sentiment) }}>● {v.sentiment} {Math.round(v.confidence * 100)}%</span>
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
              <Method title="Sources & weights">
                <strong>Reddit</strong>: live OAuth, top comments classified by XLM-RoBERTa multilingual sentiment. Weight ∝ min(1, N/200).<br />
                <strong>GDELT</strong>: 2.0 DOC API, country-filtered news tone histogram. Weight ∝ min(1, articles/100).<br />
                <strong>Wikipedia</strong>: REST pageviews API, last 30 days, country-language project. Surfaced as attention signal — does NOT enter the blended Pulse Index.<br />
                <strong>Polymarket</strong>: Gamma API public-search. Surfaced as a separate "money on the line" signal, NOT blended (event probability ≠ topic sentiment).
              </Method>
              <Method title="Pulse Index formula">
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, background: C.bgWarm, padding: 12, lineHeight: 1.6 }}>
                  pulse = round(Σ source_score × weight / Σ weight)<br />
                  divergence = round(stddev(source_scores))<br />
                  CI half-width = max(reddit_bootstrap_ci/2, divergence)
                </div>
              </Method>
              <Method title="Why we don't blend Polymarket / Wikipedia">
                Polymarket prices are <em>event probabilities</em> ("Will X happen by Y?"), not <em>topic sentiment</em> ("Do people feel positive about X?"). Blending them would be a category error. Same for Wikipedia: pageviews measure <em>attention</em>, not <em>opinion</em>. We surface these as parallel signals so you can read them in context — divergence between attention and sentiment is itself useful.
              </Method>
              <Method title="Known biases (still here in v3)">
                Reddit users skew young/male/urban/English-fluent. Country subreddits skew expat/diaspora. GDELT's source-country attribution is based on publication country and isn't perfect. Wikipedia language-project ≠ country (e.g. en.wikipedia is read worldwide). All four sources skew toward issues with English-language footprints.
              </Method>
              <Method title="What's better than v2">
                Single-source v2 had no way to know if Reddit was telling you the typical story or an outlier story. v3 makes that visible: when Reddit and news media disagree by 15+ points, it shows up as <em>divergence: split</em> with an explanation. The headline number is still imperfect — but you can see when it's likely to be wrong.
              </Method>
              <Method title="Performance">
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.inkSoft }}>
                  Parallel fetch (4 sources): {result.methodology.timing_ms.parallel_fetch}ms<br />
                  Theme synthesis: {result.methodology.timing_ms.themes}ms<br />
                  Total: {result.methodology.timing_ms.total}ms<br />
                  Sources used: {result.blend.sources_used} / {result.blend.sources_attempted} sentiment-bearing
                  {result.blend.insufficient.length > 0 && <><br />Insufficient: {result.blend.insufficient.join(', ')}</>}
                </div>
              </Method>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceCard({ color, icon, name, score, sample, weight, indicator, note }: any) {
  const isUnavailable = score === null && !indicator;
  return (
    <div style={{ padding: 18, background: isUnavailable ? 'transparent' : C.bgWarm, border: `1px solid ${C.rule}`, borderTop: `3px solid ${color}`, opacity: isUnavailable ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, color }}>
        {icon}
        <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 11, letterSpacing: '0.1em' }}>{name}</span>
      </div>
      {score !== null && score !== undefined && (
        <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 44, fontWeight: 400, lineHeight: 1, marginBottom: 6, color: C.ink }}>
          {score}
        </div>
      )}
      {indicator && !score && (
        <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontStyle: 'italic', fontWeight: 500, lineHeight: 1, marginBottom: 8, color, textTransform: 'capitalize' }}>
          {indicator}
        </div>
      )}
      {isUnavailable && (
        <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 16, fontStyle: 'italic', color: C.inkMute, marginBottom: 8 }}>—</div>
      )}
      <div style={{ fontSize: 11, color: C.inkMute, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.4 }}>{sample}</div>
      {weight !== undefined && (
        <div style={{ marginTop: 8, fontSize: 9, color: C.inkMute, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          weight {(weight * 100).toFixed(0)}%
        </div>
      )}
      {note && (
        <div style={{ marginTop: 8, fontSize: 10, color: C.inkMute, fontStyle: 'italic' }}>{note}</div>
      )}
    </div>
  );
}

function SparkChart({ data, momentum, ratio }: { data: Array<{ date: string; views: number }>; momentum: string; ratio: number }) {
  const W = 700, H = 120, pad = 8;
  const max = Math.max(...data.map(d => d.views), 1);
  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = H - pad - (d.views / max) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const momColor = momentum === 'surging' ? C.accent : momentum === 'rising' ? C.positive : momentum === 'fading' ? C.negative : C.neutral;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', maxHeight: 160 }}>
        <polyline points={points} fill="none" stroke={momColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => {
          const x = pad + (i / (data.length - 1)) * (W - pad * 2);
          const y = H - pad - (d.views / max) * (H - pad * 2);
          return <circle key={i} cx={x} cy={y} r="1.5" fill={momColor} />;
        })}
        {/* split line at last 7 days */}
        {data.length >= 7 && (
          <line x1={pad + ((data.length - 7) / (data.length - 1)) * (W - pad * 2)} y1={pad} x2={pad + ((data.length - 7) / (data.length - 1)) * (W - pad * 2)} y2={H - pad} stroke={C.rule} strokeDasharray="3,3" />
        )}
      </svg>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.inkMute, fontFamily: 'JetBrains Mono, monospace' }}>
        <span>{data[0]?.date} → {data[data.length - 1]?.date}</span>
        <span style={{ color: momColor, fontWeight: 600, textTransform: 'uppercase' }}>{momentum} · ×{ratio.toFixed(2)}</span>
      </div>
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

interface ErrorState {
  kind: 'config' | 'insufficient' | 'network' | 'unknown';
  message: string;
  fatal_errors?: string[];
  diagnostics?: any;
  debug_url?: string;
}

function ErrorScreen({ err, onReset }: { err: ErrorState; onReset: () => void }) {
  const isConfig = err.kind === 'config';
  const isInsufficient = err.kind === 'insufficient';

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, padding: '40px 20px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ marginBottom: 48 }}><Wordmark /></div>

        <AlertCircle size={48} color={C.accent} style={{ marginBottom: 24 }} />

        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 40, fontStyle: 'italic', marginBottom: 16, lineHeight: 1.1 }}>
          {isConfig ? 'Configuration problem.' : isInsufficient ? 'Not enough data.' : 'Something broke.'}
        </h2>

        <p style={{ fontSize: 16, color: C.inkSoft, marginBottom: 32, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
          {err.message}
        </p>

        {err.fatal_errors && err.fatal_errors.length > 0 && (
          <div style={{ marginBottom: 32, padding: 20, background: `${C.accent}11`, border: `1px solid ${C.accent}`, borderLeft: `4px solid ${C.accent}` }}>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, color: C.accent, marginBottom: 12 }}>
              Fatal errors detected
            </div>
            {err.fatal_errors.map((e, i) => (
              <div key={i} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: C.ink, marginBottom: 8, lineHeight: 1.5 }}>
                {e}
              </div>
            ))}
          </div>
        )}

        {err.diagnostics && (
          <div style={{ marginBottom: 32, padding: 20, background: C.bgWarm, border: `1px solid ${C.rule}` }}>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600, color: C.inkMute, marginBottom: 12 }}>
              Per-source results
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.inkSoft, lineHeight: 1.7 }}>
              {err.diagnostics.reddit && (
                <div>
                  <strong style={{ color: C.ink }}>Reddit</strong>: {err.diagnostics.reddit.auth_succeeded === false ? '❌ auth failed' : `${err.diagnostics.reddit.total_comments_after_filter ?? 0} comments`}
                  {err.diagnostics.reddit.per_subreddit && err.diagnostics.reddit.per_subreddit.length > 0 && (
                    <div style={{ marginLeft: 16, marginTop: 4, fontSize: 11 }}>
                      {err.diagnostics.reddit.per_subreddit.map((s: any, i: number) => (
                        <div key={i}>r/{s.subreddit}: {s.posts_after_filter} posts ({s.time_window_used}){s.error ? ` · err: ${s.error.slice(0, 60)}` : ''}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {err.diagnostics.gdelt && (
                <div style={{ marginTop: 8 }}>
                  <strong style={{ color: C.ink }}>GDELT</strong>: HTTP {err.diagnostics.gdelt.http_status ?? '?'} · country filter "{err.diagnostics.gdelt.country_filter_attempted ?? 'none'}" → {err.diagnostics.gdelt.country_filter_articles} articles · fallback {err.diagnostics.gdelt.fallback_used ? 'used' : 'not needed/skipped'}
                  {err.diagnostics.gdelt.raw_error && <div style={{ marginLeft: 16, color: C.negative }}>err: {err.diagnostics.gdelt.raw_error}</div>}
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <strong style={{ color: C.ink }}>Wikipedia</strong>: {err.diagnostics.wiki_found ? '✓ found article' : '— no match'}
                {' · '}
                <strong style={{ color: C.ink }}>Polymarket</strong>: {err.diagnostics.polymarket_found ? '✓ matched markets' : '— no markets'}
              </div>
            </div>
          </div>
        )}

        {err.debug_url && (
          <div style={{ marginBottom: 24 }}>
            <a href={err.debug_url} target="_blank" rel="noopener noreferrer"
               style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', background: 'transparent', border: `1px solid ${C.ink}`, color: C.ink, textDecoration: 'none', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
              <Database size={14} /> Open /api/debug for full diagnostics →
            </a>
          </div>
        )}

        {isConfig && (
          <div style={{ marginBottom: 32, padding: 20, background: C.bgWarm, border: `1px solid ${C.rule}` }}>
            <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.7 }}>
              <strong style={{ color: C.ink }}>Most likely fix:</strong><br />
              1. Open <code style={{ fontFamily: 'JetBrains Mono, monospace', background: C.bg, padding: '1px 5px' }}>.env.local</code><br />
              2. Verify <code style={{ fontFamily: 'JetBrains Mono, monospace', background: C.bg, padding: '1px 5px' }}>REDDIT_CLIENT_ID</code> and <code style={{ fontFamily: 'JetBrains Mono, monospace', background: C.bg, padding: '1px 5px' }}>REDDIT_CLIENT_SECRET</code> match your script app at <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>reddit.com/prefs/apps</a><br />
              3. Make sure <code style={{ fontFamily: 'JetBrains Mono, monospace', background: C.bg, padding: '1px 5px' }}>REDDIT_USER_AGENT</code> includes your username, e.g. <code style={{ fontFamily: 'JetBrains Mono, monospace', background: C.bg, padding: '1px 5px' }}>pulse-sentiment/1.0 by /u/yourname</code><br />
              4. Restart <code style={{ fontFamily: 'JetBrains Mono, monospace', background: C.bg, padding: '1px 5px' }}>npm run dev</code>
            </div>
          </div>
        )}

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
  const [error, setError] = useState<ErrorState | null>(null);

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
      const debugUrl = `/api/debug?country=${c.code}&topic=${encodeURIComponent(t)}`;

      if (data.error) {
        if (data.error === 'CONFIGURATION_ERROR') {
          setError({ kind: 'config', message: data.message, fatal_errors: data.fatal_errors, diagnostics: data.diagnostics, debug_url: debugUrl });
        } else if (data.error === 'INSUFFICIENT_DATA') {
          setError({ kind: 'insufficient', message: data.message, diagnostics: data.diagnostics, debug_url: debugUrl });
        } else {
          setError({ kind: 'unknown', message: data.message || 'Something went wrong.', debug_url: debugUrl });
        }
        setStage('error'); return;
      }
      const elapsed = Date.now() - t0;
      if (elapsed < 3000) await new Promise(r => setTimeout(r, 3000 - elapsed));
      setResult(data); setStage('result');
    } catch (e: any) {
      setError({ kind: 'network', message: e.message || 'Network error' });
      setStage('error');
    }
  };

  const reset = () => { setStage('landing'); setResult(null); setError(null); };

  return (
    <main>
      {stage === 'landing' && <Landing onSubmit={submit} />}
      {stage === 'loading' && country && <Loading country={country} topic={topic} />}
      {stage === 'result' && result && <Result result={result} onReset={reset} />}
      {stage === 'error' && <ErrorScreen err={error || { kind: 'unknown', message: 'Unknown error' }} onReset={reset} />}
    </main>
  );
}
