// POST /api/analyze
// Orchestrates the four sources in parallel, blends sentiment, surfaces divergence.

import { NextRequest, NextResponse } from 'next/server';
import { findCountry } from '@/lib/countries';
import { fetchReddit } from '@/lib/sources/redditSource';
import { fetchGdelt } from '@/lib/sources/gdelt';
import { fetchWiki } from '@/lib/sources/wikipedia';
import { fetchPolymarket } from '@/lib/sources/polymarket';
import { blend } from '@/lib/blend';
import { extractThemes } from '@/lib/themes';
import { SENTIMENT_MODEL_NAME } from '@/lib/sentiment';

export const maxDuration = 60;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await req.json();
    const { country_code, topic } = body;

    if (!country_code || !topic || typeof topic !== 'string' || topic.trim().length < 2) {
      return NextResponse.json({ error: 'country_code and topic required' }, { status: 400 });
    }

    const country = findCountry(country_code);
    if (!country) {
      return NextResponse.json({ error: `Unknown country code: ${country_code}` }, { status: 400 });
    }
    const topicTrimmed = topic.trim();

    // 🔥 ALL FOUR SOURCES IN PARALLEL
    // Use Promise.allSettled so one failing source doesn't kill the whole thing.
    const tFetch = Date.now();
    const [redditR, gdeltR, wikiR, polyR] = await Promise.allSettled([
      fetchReddit(country, topicTrimmed),
      fetchGdelt(topicTrimmed, country.code),
      fetchWiki(topicTrimmed, country.code),
      fetchPolymarket(topicTrimmed),
    ]);
    const fetchMs = Date.now() - tFetch;

    const reddit = redditR.status === 'fulfilled' ? redditR.value : null;
    const gdelt = gdeltR.status === 'fulfilled' ? gdeltR.value : null;
    const wiki = wikiR.status === 'fulfilled' ? wikiR.value : null;
    const poly = polyR.status === 'fulfilled' ? polyR.value : null;

    if ((!reddit || !reddit.found) && (!gdelt || !gdelt.found)) {
      return NextResponse.json({
        error: 'INSUFFICIENT_DATA',
        message: `Couldn't find enough data for "${topicTrimmed}" in ${country.name}. Try a broader topic or more globally-discussed framing.`,
        debug: {
          reddit_comments: reddit?.sample_size ?? 0,
          gdelt_articles: gdelt?.article_count ?? 0,
          wiki_found: wiki?.found ?? false,
          polymarket_found: poly?.found ?? false,
        },
      }, { status: 200 });
    }

    const blended = blend({
      reddit: reddit?.found ? {
        found: true,
        pulse_score: reddit.pulse_score,
        sample_size: reddit.sample_size,
        ci_width: reddit.pulse_score_high - reddit.pulse_score_low,
      } : null,
      gdelt: gdelt?.found ? {
        found: true,
        pulse_score: gdelt.pulse_score,
        article_count: gdelt.article_count,
      } : null,
    });

    // Themes: only run if Reddit was the dominant source (richest text)
    const tThemes = Date.now();
    let themeData: any = { themes: [], surprise_finding: '', headline_verdict: '', summary: '' };
    if (reddit && reddit.found && reddit.classified.length >= 30) {
      try {
        themeData = await extractThemes(reddit.classified, topicTrimmed, country.name);
      } catch (e: any) {
        console.warn('Theme extraction failed:', e.message);
      }
    } else if (gdelt?.found && gdelt.articles.length > 0) {
      themeData.summary = `${gdelt.article_count} news articles tracked. Mean tone ${gdelt.mean_tone.toFixed(1)} (range -10 to +10). ${gdelt.positive_pct}% positive coverage, ${gdelt.negative_pct}% negative.`;
      themeData.headline_verdict = gdelt.pulse_score >= 60 ? 'News coverage skews positive' :
                                    gdelt.pulse_score <= 40 ? 'News coverage skews negative' :
                                    'News coverage is mixed';
    }
    const themesMs = Date.now() - tThemes;

    const confidence: 'high' | 'medium' | 'low' =
      (reddit?.sample_size || 0) >= 200 || (gdelt?.article_count || 0) >= 100 ? 'high' :
      (reddit?.sample_size || 0) >= 80  || (gdelt?.article_count || 0) >= 30  ? 'medium' : 'low';

    return NextResponse.json({
      ok: true,
      country: { code: country.code, name: country.name, flag: country.flag },
      topic: topicTrimmed,

      pulse_index: blended.pulse_index,
      pulse_index_low: blended.pulse_index_low,
      pulse_index_high: blended.pulse_index_high,

      blend: {
        contributions: blended.contributions,
        divergence: blended.divergence,
        divergence_label: blended.divergence_label,
        divergence_note: blended.divergence_note,
        sources_used: blended.sources_used,
        sources_attempted: blended.sources_attempted,
        insufficient: blended.insufficient_sources,
      },

      sources: {
        reddit: reddit?.found ? {
          found: true,
          pulse_score: reddit.pulse_score,
          pulse_score_low: reddit.pulse_score_low,
          pulse_score_high: reddit.pulse_score_high,
          breakdown: reddit.breakdown,
          sample_size: reddit.sample_size,
          thread_count: reddit.thread_count,
          total_upvotes: reddit.total_upvotes,
          classifier_confidence_avg: reddit.classifier_confidence_avg,
          oldest_comment_utc: reddit.oldest_comment_utc,
          newest_comment_utc: reddit.newest_comment_utc,
          subreddits_searched: reddit.subreddits_searched,
          voices: reddit.voices,
          threads: reddit.threads,
        } : { found: false, sample_size: reddit?.sample_size ?? 0 },

        gdelt: gdelt?.found ? {
          found: true,
          pulse_score: gdelt.pulse_score,
          mean_tone: gdelt.mean_tone,
          article_count: gdelt.article_count,
          positive_pct: gdelt.positive_pct,
          neutral_pct: gdelt.neutral_pct,
          negative_pct: gdelt.negative_pct,
          articles: gdelt.articles,
          oldest_seendate: gdelt.oldest_seendate,
          newest_seendate: gdelt.newest_seendate,
          query_used: gdelt.query_used,
        } : { found: false },

        wikipedia: wiki?.found ? {
          found: true,
          article_title: wiki.article_title,
          language_project: wiki.language_project,
          total_views_30d: wiki.total_views_30d,
          views_last_7d: wiki.views_last_7d,
          views_prior_23d: wiki.views_prior_23d,
          momentum: wiki.momentum,
          momentum_ratio: wiki.momentum_ratio,
          daily: wiki.daily,
          url: wiki.url,
        } : { found: false },

        polymarket: poly?.found ? {
          found: true,
          weighted_yes_probability: poly.weighted_yes_probability,
          pulse_score_indicative: poly.pulse_score_indicative,
          total_volume_24h: poly.total_volume_24h,
          markets: poly.markets,
        } : { found: false },
      },

      confidence,

      themes: themeData.themes,
      surprise_finding: themeData.surprise_finding,
      headline_verdict: themeData.headline_verdict,
      summary: themeData.summary,

      methodology: {
        sentiment_model: SENTIMENT_MODEL_NAME,
        formula: 'pulse-v3.0: weighted blend of Reddit + GDELT pulse scores. Polymarket and Wikipedia surfaced as separate signals.',
        timing_ms: {
          parallel_fetch: fetchMs,
          themes: themesMs,
          total: Date.now() - t0,
        },
      },
    });
  } catch (e: any) {
    console.error('Analyze error:', e);
    return NextResponse.json(
      { error: 'ANALYSIS_FAILED', message: e.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
