// POST /api/analyze
// Body: { country_code: string, topic: string }
// Returns the complete sentiment reading, grounded in real Reddit data + classifier.

import { NextRequest, NextResponse } from 'next/server';
import { findCountry } from '@/lib/countries';
import { gatherCorpus } from '@/lib/reddit';
import { classifyAll, SENTIMENT_MODEL_NAME } from '@/lib/sentiment';
import { aggregate, pickVoices, type ClassifiedComment } from '@/lib/aggregate';
import { extractThemes } from '@/lib/themes';

// Vercel: extend timeout (Hobby max = 60s, Pro max = 300s)
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

    // 1. Gather corpus from Reddit
    const tReddit = Date.now();
    const corpus = await gatherCorpus(country.subreddits, topic.trim(), {
      postsPerSub: 4,
      commentsPerPost: 25,
      maxComments: 300,
    });

    if (corpus.comments.length < 10) {
      return NextResponse.json({
        error: 'INSUFFICIENT_DATA',
        message: `Only found ${corpus.comments.length} relevant comments. Try a broader topic or a different country.`,
        debug: {
          posts_found: corpus.posts.length,
          comments_found: corpus.comments.length,
          subreddits_searched: corpus.searchedSubreddits,
        },
      }, { status: 200 });
    }

    const redditMs = Date.now() - tReddit;

    // 2. Classify each comment
    const tClassify = Date.now();
    const sentiments = await classifyAll(corpus.comments.map(c => c.body));
    const classified: ClassifiedComment[] = corpus.comments.map((c, i) => ({
      comment: c,
      sentiment: sentiments[i] || { positive: 0, neutral: 1, negative: 0 },
    }));
    const classifyMs = Date.now() - tClassify;

    // 3. Aggregate
    const stats = aggregate(classified);
    const voices = pickVoices(classified, 2);

    // 4. Extract themes (Claude over the measured corpus)
    const tThemes = Date.now();
    let themeData;
    try {
      themeData = await extractThemes(classified, topic.trim(), country.name);
    } catch (e: any) {
      // Themes are nice-to-have. If Claude fails, we still return the measured numbers.
      console.warn('Theme extraction failed:', e.message);
      themeData = {
        themes: [],
        surprise_finding: '',
        headline_verdict: '',
        summary: 'Theme extraction temporarily unavailable. Numbers below are from the classifier.',
      };
    }
    const themesMs = Date.now() - tThemes;

    // Confidence band based on sample size
    const confidence: 'high' | 'medium' | 'low' =
      stats.sample_size >= 200 ? 'high' :
      stats.sample_size >= 80 ? 'medium' : 'low';

    return NextResponse.json({
      ok: true,
      country: { code: country.code, name: country.name, flag: country.flag },
      topic: topic.trim(),

      // The measured numbers
      pulse_index: stats.pulse_index,
      pulse_index_low: stats.pulse_index_low,
      pulse_index_high: stats.pulse_index_high,
      breakdown: stats.breakdown,

      // Real provenance
      sample_size: stats.sample_size,
      thread_count: stats.thread_count,
      total_upvotes: stats.total_upvotes,
      oldest_comment_utc: stats.oldest_comment_utc,
      newest_comment_utc: stats.newest_comment_utc,
      classifier_confidence_avg: stats.classifier_confidence_avg,
      confidence,

      // Per-thread sources (so users can verify)
      threads: corpus.posts.slice(0, 10).map(p => ({
        title: p.title,
        subreddit: p.subreddit,
        score: p.score,
        num_comments: p.num_comments,
        permalink: p.permalink,
        created_utc: p.created_utc,
      })),

      subreddits_searched: corpus.searchedSubreddits,

      // Real comment excerpts with permalinks
      voices,

      // Themes from measured corpus
      themes: themeData.themes,
      surprise_finding: themeData.surprise_finding,
      headline_verdict: themeData.headline_verdict,
      summary: themeData.summary,

      // Methodology metadata
      methodology: {
        sentiment_model: SENTIMENT_MODEL_NAME,
        formula: stats.formula_version,
        timing_ms: {
          reddit: redditMs,
          classify: classifyMs,
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
