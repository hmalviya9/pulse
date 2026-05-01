// Wikipedia pageviews — attention/interest momentum signal.
// NOT sentiment. We treat this as a separate "is anyone paying attention" indicator.
// Surfaced in the UI as a momentum curve, not blended into the Pulse Index directly.
// Docs: https://wikimedia.org/api/rest_v1/

const WIKI_BASE = 'https://wikimedia.org/api/rest_v1';
const WIKI_USER_AGENT = 'pulse-sentiment/3.0 (https://github.com)';

// Country code → preferred Wikipedia language project for that country.
// Falls back to en.wikipedia if not listed.
const COUNTRY_TO_WIKI: Record<string, string> = {
  IN: 'en.wikipedia',  // English-language for India (largest readership)
  US: 'en.wikipedia',
  GB: 'en.wikipedia',
  CA: 'en.wikipedia',
  AU: 'en.wikipedia',
  DE: 'de.wikipedia',
  FR: 'fr.wikipedia',
  BR: 'pt.wikipedia',
  JP: 'ja.wikipedia',
  KR: 'ko.wikipedia',
  MX: 'es.wikipedia',
  IT: 'it.wikipedia',
  ES: 'es.wikipedia',
  NL: 'nl.wikipedia',
  SE: 'sv.wikipedia',
  PL: 'pl.wikipedia',
  TR: 'tr.wikipedia',
  ID: 'id.wikipedia',
  PH: 'en.wikipedia',
  PK: 'en.wikipedia',
  BD: 'bn.wikipedia',
  NG: 'en.wikipedia',
  ZA: 'en.wikipedia',
  EG: 'ar.wikipedia',
  AE: 'ar.wikipedia',
  SG: 'en.wikipedia',
  AR: 'es.wikipedia',
  IL: 'he.wikipedia',
};

export interface WikiResult {
  article_title: string;        // title that matched
  language_project: string;     // e.g. en.wikipedia
  total_views_30d: number;
  views_last_7d: number;
  views_prior_23d: number;
  momentum: 'surging' | 'rising' | 'stable' | 'fading';
  momentum_ratio: number;       // (last_7d / 7) ÷ (prior_23d / 23)
  daily: Array<{ date: string; views: number }>;
  url: string;
  found: boolean;
}

/**
 * Resolve a topic to an actual Wikipedia article using the Wikipedia search API.
 * Returns the canonical article title, or null if no good match.
 */
async function resolveTitle(topic: string, project: string): Promise<{ title: string; project: string } | null> {
  const lang = project.split('.')[0];
  const searchUrl = `https://${project}.org/w/api.php?action=opensearch&search=${encodeURIComponent(topic)}&limit=3&namespace=0&format=json`;

  try {
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': WIKI_USER_AGENT },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Format: [searchterm, [titles], [descriptions], [urls]]
    const titles = data[1];
    if (!titles || titles.length === 0) {
      // Fall back to English
      if (project !== 'en.wikipedia') {
        return resolveTitle(topic, 'en.wikipedia');
      }
      return null;
    }
    return { title: titles[0], project };
  } catch (e) {
    return null;
  }
}

function formatDate(d: Date): string {
  // YYYYMMDD
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function formatTimestampToDate(ts: string): string {
  // Wikipedia returns YYYYMMDDHH; we want YYYY-MM-DD
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

export async function fetchWiki(topic: string, isoCountry: string): Promise<WikiResult | null> {
  const project = COUNTRY_TO_WIKI[isoCountry] || 'en.wikipedia';
  const resolved = await resolveTitle(topic, project);
  if (!resolved) {
    return {
      article_title: topic,
      language_project: project,
      total_views_30d: 0,
      views_last_7d: 0,
      views_prior_23d: 0,
      momentum: 'stable',
      momentum_ratio: 1,
      daily: [],
      url: '',
      found: false,
    };
  }

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);

  const titleEncoded = encodeURIComponent(resolved.title.replace(/ /g, '_'));
  const url = `${WIKI_BASE}/metrics/pageviews/per-article/${resolved.project}.org/all-access/user/${titleEncoded}/daily/${formatDate(start)}/${formatDate(end)}`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': WIKI_USER_AGENT } });
    if (!res.ok) {
      // 404 is common when the article exists but has no recorded views
      return null;
    }
    const data = await res.json();
    const items: Array<{ timestamp: string; views: number }> = data.items || [];
    if (items.length === 0) return null;

    const daily = items.map(it => ({
      date: formatTimestampToDate(it.timestamp),
      views: it.views,
    }));

    const total = daily.reduce((s, d) => s + d.views, 0);
    // Last 7 days (most recent), prior 23 days
    const last7 = daily.slice(-7).reduce((s, d) => s + d.views, 0);
    const prior23 = daily.slice(0, -7).reduce((s, d) => s + d.views, 0);

    const last7Avg = last7 / 7;
    const prior23Avg = prior23 / Math.max(1, daily.length - 7);
    const ratio = prior23Avg > 0 ? last7Avg / prior23Avg : 1;

    let momentum: WikiResult['momentum'];
    if (ratio >= 2) momentum = 'surging';
    else if (ratio >= 1.25) momentum = 'rising';
    else if (ratio >= 0.75) momentum = 'stable';
    else momentum = 'fading';

    const articleUrl = `https://${resolved.project}.org/wiki/${titleEncoded}`;

    return {
      article_title: resolved.title,
      language_project: resolved.project,
      total_views_30d: total,
      views_last_7d: last7,
      views_prior_23d: prior23,
      momentum,
      momentum_ratio: Number(ratio.toFixed(2)),
      daily,
      url: articleUrl,
      found: true,
    };
  } catch (e: any) {
    console.warn(`Wiki failed: ${e.message}`);
    return null;
  }
}
