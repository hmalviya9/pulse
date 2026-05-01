// GDELT 2.0 DOC API — news media tone for a topic, optionally filtered by source country.
// Free, no auth, real-time. Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
//
// What we use:
//   - mode=tonechart  → histogram of articles binned by tone score [-100, +100]
//   - mode=artlist    → up to 75 article URLs/titles for source citation
// Tone score interpretation: GDELT scores articles using its own tone analysis;
// in practice most scores fall in [-10, +10]. We normalize to a 0-100 Pulse-compatible scale.

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

// Subset of GDELT's source-country codes. They use FIPS 10-4 country codes.
// Mapped from our Country.code (ISO 3166-1 alpha-2). Some don't match — we drop the filter for those.
const ISO_TO_GDELT: Record<string, string> = {
  IN: 'IN', US: 'US', GB: 'UK', CA: 'CA', AU: 'AS', DE: 'GM', FR: 'FR',
  BR: 'BR', JP: 'JA', KR: 'KS', MX: 'MX', IT: 'IT', ES: 'SP', NL: 'NL',
  SE: 'SW', PL: 'PL', TR: 'TU', ID: 'ID', PH: 'RP', PK: 'PK', BD: 'BG',
  NG: 'NI', ZA: 'SF', EG: 'EG', AE: 'AE', SG: 'SN', AR: 'AR', IL: 'IS',
};

export interface GdeltArticle {
  url: string;
  title: string;
  domain: string;
  language: string;
  seendate: string;
  sourcecountry: string;
}

export interface GdeltResult {
  found: boolean;
  // Tone histogram → mean tone weighted by article count
  mean_tone: number;          // typically -10 to +10
  pulse_score: number;        // 0-100 normalized
  article_count: number;      // total articles matching
  positive_pct: number;       // % articles with tone > +1
  neutral_pct: number;        // % with tone in [-1, +1]
  negative_pct: number;       // % with tone < -1
  articles: GdeltArticle[];   // sample for sources display
  oldest_seendate: string;
  newest_seendate: string;
  query_used: string;
}

/**
 * Convert GDELT mean tone (typically [-10, +10]) to Pulse 0-100 scale.
 * Linear: -10 → 0, 0 → 50, +10 → 100. Clamped beyond.
 */
function toneToPulse(meanTone: number): number {
  const clamped = Math.max(-10, Math.min(10, meanTone));
  return Math.round(50 + clamped * 5);
}

async function gdeltFetch(query: string, mode: string, extraParams: Record<string, string> = {}): Promise<any> {
  const params = new URLSearchParams({
    query,
    mode,
    format: 'json',
    timespan: '1month',
    ...extraParams,
  });
  const url = `${GDELT_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'pulse-sentiment/3.0' },
  });
  if (!res.ok) {
    throw new Error(`GDELT ${mode} failed: ${res.status}`);
  }
  // GDELT sometimes returns an empty body for queries with no matches
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // GDELT occasionally returns HTML error pages instead of JSON
    return null;
  }
}

/**
 * Run a GDELT analysis for a topic + country.
 * Returns null if not enough data is available — caller decides whether to drop this source.
 */
export async function fetchGdelt(topic: string, isoCountry: string): Promise<GdeltResult | null> {
  // Build query: keyword + optional source country filter
  const gdeltCountry = ISO_TO_GDELT[isoCountry];
  const baseQuery = `"${topic}"`;
  const query = gdeltCountry ? `${baseQuery} sourcecountry:${gdeltCountry}` : baseQuery;

  try {
    // 1. Tonechart for histogram → mean tone
    const tonechart = await gdeltFetch(query, 'tonechart');
    // Articles list (capped to 75 by GDELT)
    const artlist = await gdeltFetch(query, 'artlist', { maxrecords: '75', sort: 'datedesc' });

    if (!tonechart || !tonechart.tonechart || !Array.isArray(tonechart.tonechart)) {
      return null;
    }

    const bins: Array<{ bin: number; count: number; toparts?: any[] }> = tonechart.tonechart;
    if (bins.length === 0) return null;

    let totalArticles = 0;
    let weightedToneSum = 0;
    let pos = 0, neu = 0, neg = 0;

    for (const b of bins) {
      totalArticles += b.count;
      weightedToneSum += b.bin * b.count;
      if (b.bin > 1) pos += b.count;
      else if (b.bin < -1) neg += b.count;
      else neu += b.count;
    }

    if (totalArticles < 5) {
      // Too thin — drop this source for this query
      return null;
    }

    const meanTone = weightedToneSum / totalArticles;
    const pulseScore = toneToPulse(meanTone);

    const articles: GdeltArticle[] = (artlist?.articles || []).slice(0, 12).map((a: any) => ({
      url: a.url || '',
      title: a.title || '',
      domain: a.domain || '',
      language: a.language || '',
      seendate: a.seendate || '',
      sourcecountry: a.sourcecountry || '',
    }));

    const dates = articles.map(a => a.seendate).filter(Boolean).sort();

    return {
      found: true,
      mean_tone: Number(meanTone.toFixed(2)),
      pulse_score: pulseScore,
      article_count: totalArticles,
      positive_pct: Math.round(100 * pos / totalArticles),
      neutral_pct: Math.round(100 * neu / totalArticles),
      negative_pct: Math.round(100 * neg / totalArticles),
      articles,
      oldest_seendate: dates[0] || '',
      newest_seendate: dates[dates.length - 1] || '',
      query_used: query,
    };
  } catch (e: any) {
    console.warn(`GDELT failed: ${e.message}`);
    return null;
  }
}
