// GDELT 2.0 DOC API — v3.1 with country-filter fallback.
// If sourcecountry: returns nothing, retry without the filter and flag the result
// as "global coverage, not country-specific." Better than zero.

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

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

export interface GdeltDiagnostic {
  country_filter_attempted: string | null;
  country_filter_articles: number;
  fallback_used: boolean;
  query_string: string;
  http_status: number | null;
  raw_error: string | null;
}

export interface GdeltResult {
  found: boolean;
  is_global_coverage: boolean; // true if we fell back to dropping the country filter
  mean_tone: number;
  pulse_score: number;
  article_count: number;
  positive_pct: number;
  neutral_pct: number;
  negative_pct: number;
  articles: GdeltArticle[];
  oldest_seendate: string;
  newest_seendate: string;
  query_used: string;
  diagnostic: GdeltDiagnostic;
}

function toneToPulse(meanTone: number): number {
  const clamped = Math.max(-10, Math.min(10, meanTone));
  return Math.round(50 + clamped * 5);
}

interface GdeltFetchResult {
  ok: boolean;
  status: number;
  data: any | null;
  error: string | null;
}

async function gdeltFetch(query: string, mode: string, extraParams: Record<string, string> = {}): Promise<GdeltFetchResult> {
  const params = new URLSearchParams({
    query,
    mode,
    format: 'json',
    timespan: '1month',
    ...extraParams,
  });
  const url = `${GDELT_BASE}?${params.toString()}`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'pulse-sentiment/3.1' } });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    if (!text || text.trim() === '') {
      return { ok: true, status: res.status, data: null, error: 'empty response body' };
    }
    try {
      return { ok: true, status: res.status, data: JSON.parse(text), error: null };
    } catch (e: any) {
      return { ok: false, status: res.status, data: null, error: `JSON parse failed: ${text.slice(0, 200)}` };
    }
  } catch (e: any) {
    return { ok: false, status: 0, data: null, error: e.message };
  }
}

function parseTonechart(data: any): { totalArticles: number; meanTone: number; pos: number; neu: number; neg: number } | null {
  if (!data || !data.tonechart || !Array.isArray(data.tonechart)) return null;
  const bins: Array<{ bin: number; count: number }> = data.tonechart;
  if (bins.length === 0) return null;

  let total = 0, weighted = 0, pos = 0, neu = 0, neg = 0;
  for (const b of bins) {
    total += b.count;
    weighted += b.bin * b.count;
    if (b.bin > 1) pos += b.count;
    else if (b.bin < -1) neg += b.count;
    else neu += b.count;
  }
  if (total === 0) return null;
  return { totalArticles: total, meanTone: weighted / total, pos, neu, neg };
}

export async function fetchGdelt(topic: string, isoCountry: string): Promise<GdeltResult> {
  const gdeltCountry = ISO_TO_GDELT[isoCountry] || null;
  const baseQuery = `"${topic}"`;
  const countryQuery = gdeltCountry ? `${baseQuery} sourcecountry:${gdeltCountry}` : baseQuery;

  const diagnostic: GdeltDiagnostic = {
    country_filter_attempted: gdeltCountry,
    country_filter_articles: 0,
    fallback_used: false,
    query_string: countryQuery,
    http_status: null,
    raw_error: null,
  };

  // Try country-filtered first
  let queryToUse = countryQuery;
  let isGlobal = false;

  let toneRes = await gdeltFetch(queryToUse, 'tonechart');
  diagnostic.http_status = toneRes.status;
  diagnostic.raw_error = toneRes.error;

  let parsed = parseTonechart(toneRes.data);
  diagnostic.country_filter_articles = parsed?.totalArticles ?? 0;

  // Fallback: if country filter returned <5 articles, drop the filter
  if ((!parsed || parsed.totalArticles < 5) && gdeltCountry) {
    queryToUse = baseQuery;
    isGlobal = true;
    diagnostic.fallback_used = true;
    diagnostic.query_string = baseQuery;

    toneRes = await gdeltFetch(queryToUse, 'tonechart');
    diagnostic.http_status = toneRes.status;
    diagnostic.raw_error = toneRes.error;
    parsed = parseTonechart(toneRes.data);
  }

  if (!parsed || parsed.totalArticles < 5) {
    return {
      found: false,
      is_global_coverage: isGlobal,
      mean_tone: 0, pulse_score: 50, article_count: parsed?.totalArticles ?? 0,
      positive_pct: 0, neutral_pct: 0, negative_pct: 0,
      articles: [],
      oldest_seendate: '', newest_seendate: '',
      query_used: queryToUse,
      diagnostic,
    };
  }

  const artRes = await gdeltFetch(queryToUse, 'artlist', { maxrecords: '75', sort: 'datedesc' });
  const articles: GdeltArticle[] = (artRes.data?.articles || []).slice(0, 12).map((a: any) => ({
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
    is_global_coverage: isGlobal,
    mean_tone: Number(parsed.meanTone.toFixed(2)),
    pulse_score: toneToPulse(parsed.meanTone),
    article_count: parsed.totalArticles,
    positive_pct: Math.round(100 * parsed.pos / parsed.totalArticles),
    neutral_pct: Math.round(100 * parsed.neu / parsed.totalArticles),
    negative_pct: Math.round(100 * parsed.neg / parsed.totalArticles),
    articles,
    oldest_seendate: dates[0] || '',
    newest_seendate: dates[dates.length - 1] || '',
    query_used: queryToUse,
    diagnostic,
  };
}
