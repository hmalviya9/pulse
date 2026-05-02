// GET /api/debug?country=IN&topic=cryptocurrency
// Runs each source independently, returns raw diagnostics including HTTP statuses,
// per-subreddit breakdowns, and the actual queries sent. Use this when /api/analyze
// returns "0 comments, 0 articles" to figure out which source is broken and why.

import { NextRequest, NextResponse } from 'next/server';
import { findCountry } from '@/lib/countries';
import { gatherCorpus, RedditAuthError, RedditRateLimitError } from '@/lib/sources/reddit';
import { fetchGdelt } from '@/lib/sources/gdelt';
import { fetchWiki } from '@/lib/sources/wikipedia';
import { fetchPolymarket } from '@/lib/sources/polymarket';

export const maxDuration = 60;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const country_code = url.searchParams.get('country') || 'IN';
  const topic = url.searchParams.get('topic') || 'cryptocurrency';

  const country = findCountry(country_code);
  if (!country) {
    return NextResponse.json({ error: `Unknown country: ${country_code}` }, { status: 400 });
  }

  // Check env vars first
  const env_check = {
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID ? `set (${process.env.REDDIT_CLIENT_ID.length} chars)` : '❌ MISSING',
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET ? `set (${process.env.REDDIT_CLIENT_SECRET.length} chars)` : '❌ MISSING',
    REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT || '❌ MISSING',
    HF_TOKEN: process.env.HF_TOKEN ? `set (${process.env.HF_TOKEN.length} chars)` : '❌ MISSING',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? `set (${process.env.ANTHROPIC_API_KEY.length} chars)` : '❌ MISSING',
  };

  // Run each source with its own try/catch so one failure doesn't hide others
  const reddit_diag: any = { ok: false };
  try {
    const corpus = await gatherCorpus(country.subreddits, topic, {
      postsPerSub: 4,
      commentsPerPost: 25,
      maxComments: 300,
    });
    reddit_diag.ok = true;
    reddit_diag.summary = {
      auth_succeeded: corpus.diagnostics.auth_succeeded,
      total_posts_pre_dedup: corpus.diagnostics.total_posts_pre_dedup,
      total_posts_post_dedup: corpus.diagnostics.total_posts_post_dedup,
      total_comments_fetched: corpus.diagnostics.total_comments_fetched,
      total_comments_after_filter: corpus.diagnostics.total_comments_after_filter,
      comment_fetch_errors: corpus.diagnostics.comment_fetch_errors,
    };
    reddit_diag.per_subreddit = corpus.diagnostics.per_subreddit;
    reddit_diag.sample_post_titles = corpus.posts.slice(0, 5).map(p => `r/${p.subreddit}: ${p.title} (${p.num_comments} comments)`);
  } catch (e: any) {
    reddit_diag.ok = false;
    reddit_diag.error_class = e.constructor?.name || 'Error';
    reddit_diag.error_message = e.message;
    if (e instanceof RedditAuthError) {
      reddit_diag.diagnosis = '❌ AUTH FAILURE — your Reddit credentials are wrong, or User-Agent is malformed. Fix REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT in .env.local.';
    } else if (e instanceof RedditRateLimitError) {
      reddit_diag.diagnosis = '⚠️  Rate limited — wait 60s and retry.';
    } else {
      reddit_diag.diagnosis = '❌ Unexpected Reddit error.';
    }
  }

  const gdelt_diag: any = { ok: false };
  try {
    const result = await fetchGdelt(topic, country.code);
    gdelt_diag.ok = true;
    gdelt_diag.found = result.found;
    gdelt_diag.is_global_coverage = result.is_global_coverage;
    gdelt_diag.article_count = result.article_count;
    gdelt_diag.diagnostic = result.diagnostic;
    gdelt_diag.sample_articles = result.articles.slice(0, 3).map(a => `${a.domain} [${a.sourcecountry}]: ${a.title?.slice(0, 80)}`);
  } catch (e: any) {
    gdelt_diag.error_message = e.message;
  }

  const wiki_diag: any = { ok: false };
  try {
    const result = await fetchWiki(topic, country.code);
    wiki_diag.ok = true;
    wiki_diag.found = result?.found ?? false;
    if (result?.found) {
      wiki_diag.article_title = result.article_title;
      wiki_diag.language_project = result.language_project;
      wiki_diag.total_views_30d = result.total_views_30d;
      wiki_diag.momentum = result.momentum;
    }
  } catch (e: any) {
    wiki_diag.error_message = e.message;
  }

  const poly_diag: any = { ok: false };
  try {
    const result = await fetchPolymarket(topic);
    poly_diag.ok = true;
    poly_diag.found = result.found;
    poly_diag.matches = result.markets.length;
    poly_diag.sample_markets = result.markets.slice(0, 3).map(m => `${m.question} → ${Math.round(m.yes_probability * 100)}% (match ${Math.round(m.match_score * 100)}%)`);
  } catch (e: any) {
    poly_diag.error_message = e.message;
  }

  return NextResponse.json({
    query: { country: country.code, country_name: country.name, topic, subreddits_to_search: country.subreddits },
    env_check,
    sources: {
      reddit: reddit_diag,
      gdelt: gdelt_diag,
      wikipedia: wiki_diag,
      polymarket: poly_diag,
    },
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
