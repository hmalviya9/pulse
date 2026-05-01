// Polymarket Gamma API — public, no auth required.
// Docs: https://docs.polymarket.com/api-reference/introduction
//
// What we use:
//   GET /public-search?q={topic}  → search markets by keyword
//   Each result has lastTradePrice (∈ [0, 1]), volume24hr, question text
//
// Polymarket is global, not country-specific. We surface this as a separate
// "what does money think" signal — only when relevant markets exist.
// Note: no clean topic→market match exists for most queries. We're honest about that.

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

export interface PolymarketMatch {
  question: string;
  slug: string;
  url: string;
  yes_probability: number;        // 0-1, last trade price for "Yes" outcome
  volume_24h: number;             // USDC volume in last 24h
  volume_total: number;
  end_date: string;               // ISO date
  active: boolean;
  closed: boolean;
  match_score: number;            // simple keyword overlap score
}

export interface PolymarketResult {
  markets: PolymarketMatch[];
  total_volume_24h: number;
  // Aggregate "yes" probability across matched markets, weighted by 24h volume
  weighted_yes_probability: number | null;
  // 0-100 Pulse-compatible: how bullish is the market on the topic generally?
  // Caveat: this is interpretation. We DON'T blend it into the main Pulse Index by default
  // because "yes probability on a specific event" ≠ "sentiment about the topic."
  pulse_score_indicative: number | null;
  found: boolean;
}

function tokenize(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function matchScore(topic: string, question: string): number {
  const topicTokens = new Set(tokenize(topic));
  const qTokens = tokenize(question);
  if (topicTokens.size === 0) return 0;
  let hits = 0;
  for (const t of qTokens) if (topicTokens.has(t)) hits++;
  return hits / topicTokens.size;
}

export async function fetchPolymarket(topic: string): Promise<PolymarketResult> {
  const url = `${GAMMA_BASE}/public-search?q=${encodeURIComponent(topic)}&limit_per_type=10`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'pulse-sentiment/3.0' },
    });
    if (!res.ok) {
      return emptyResult();
    }
    const data = await res.json();

    // Public-search returns multiple types: events, profiles, tags, etc.
    // We want events/markets. The exact shape varies — try both `events` and `markets` keys.
    const eventList: any[] = data.events || [];
    const collected: PolymarketMatch[] = [];

    for (const ev of eventList) {
      // Each event has a `markets` array; for binary events use the first market
      const markets: any[] = Array.isArray(ev.markets) ? ev.markets : [];
      for (const m of markets) {
        if (!m || m.closed) continue; // skip resolved markets — they're history
        const question = m.question || ev.title || '';
        if (!question) continue;
        const score = matchScore(topic, question);
        if (score < 0.3) continue; // ignore weak matches

        // outcomePrices is sometimes a stringified JSON array
        let yesProb: number | null = null;
        if (typeof m.outcomePrices === 'string') {
          try {
            const arr = JSON.parse(m.outcomePrices);
            yesProb = parseFloat(arr[0]);
          } catch (e) { /* ignore */ }
        } else if (Array.isArray(m.outcomePrices)) {
          yesProb = parseFloat(m.outcomePrices[0]);
        } else if (typeof m.lastTradePrice === 'number') {
          yesProb = m.lastTradePrice;
        }
        if (yesProb == null || isNaN(yesProb)) continue;

        const slug = ev.slug || m.slug || '';
        collected.push({
          question,
          slug,
          url: slug ? `https://polymarket.com/event/${slug}` : 'https://polymarket.com',
          yes_probability: yesProb,
          volume_24h: parseFloat(m.volume24hr || ev.volume24hr || '0') || 0,
          volume_total: parseFloat(m.volume || ev.volume || '0') || 0,
          end_date: m.endDate || ev.endDate || '',
          active: m.active !== false,
          closed: m.closed === true,
          match_score: score,
        });
      }
    }

    if (collected.length === 0) return emptyResult();

    // Sort by match_score then volume_24h
    collected.sort((a, b) => (b.match_score - a.match_score) || (b.volume_24h - a.volume_24h));
    const top = collected.slice(0, 5);

    const totalVol = top.reduce((s, m) => s + m.volume_24h, 0);
    let weightedYes: number | null = null;
    if (totalVol > 0) {
      weightedYes = top.reduce((s, m) => s + m.yes_probability * m.volume_24h, 0) / totalVol;
    } else {
      weightedYes = top.reduce((s, m) => s + m.yes_probability, 0) / top.length;
    }

    return {
      markets: top,
      total_volume_24h: totalVol,
      weighted_yes_probability: Number(weightedYes.toFixed(3)),
      // Probability of "Yes" mapped to 0-100. Only indicative — see explanation in UI.
      pulse_score_indicative: Math.round(weightedYes * 100),
      found: true,
    };
  } catch (e: any) {
    console.warn(`Polymarket failed: ${e.message}`);
    return emptyResult();
  }
}

function emptyResult(): PolymarketResult {
  return {
    markets: [],
    total_volume_24h: 0,
    weighted_yes_probability: null,
    pulse_score_indicative: null,
    found: false,
  };
}
