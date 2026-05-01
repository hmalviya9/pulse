// Aggregation: turn classified comments into a single Pulse Index + breakdown + CI.
// Formula is documented inline AND surfaced in the UI methodology section.

import type { RedditComment } from './sources/reddit';
import type { SentimentResult } from './sentiment';

export interface ClassifiedComment {
  comment: RedditComment;
  sentiment: SentimentResult;
}

export interface AggregateResult {
  pulse_index: number;        // 0-100 (50 = perfectly mixed)
  pulse_index_low: number;    // bootstrap p25
  pulse_index_high: number;   // bootstrap p75
  breakdown: {
    positive: number;         // weighted % [0, 100]
    neutral: number;
    negative: number;
  };
  sample_size: number;        // N comments
  thread_count: number;       // M unique threads
  total_upvotes: number;      // sum of comment scores
  oldest_comment_utc: number;
  newest_comment_utc: number;
  classifier_confidence_avg: number; // avg max-prob across comments [0, 1]
  formula_version: string;
}

/**
 * Per-comment weight: log(2 + max(0, upvotes))
 * - log scale so a 5000-upvote comment doesn't dominate 100 normal ones
 * - +2 floor so even a 0-upvote comment has weight log(2) ≈ 0.69 (still counts)
 * - max(0, ...) because Reddit allows negative scores; we treat downvoted ones as floor
 */
function weight(upvotes: number): number {
  return Math.log(2 + Math.max(0, upvotes));
}

/**
 * Per-comment signed sentiment: positive_prob - negative_prob ∈ [-1, +1]
 * Neutral probability isn't subtracted — it pulls toward 0 naturally.
 */
function signedSentiment(s: SentimentResult): number {
  return s.positive - s.negative;
}

function computePulseIndex(items: ClassifiedComment[]): number {
  if (items.length === 0) return 50;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const it of items) {
    const w = weight(it.comment.score);
    weightedSum += w * signedSentiment(it.sentiment);
    totalWeight += w;
  }
  if (totalWeight === 0) return 50;
  const meanSigned = weightedSum / totalWeight; // ∈ [-1, +1]
  return Math.round(50 * (1 + meanSigned));     // ∈ [0, 100]
}

/**
 * Bootstrap CI: resample N items with replacement B times, take percentiles.
 */
function bootstrapCI(items: ClassifiedComment[], B = 500): { p25: number; p75: number } {
  if (items.length < 5) {
    const v = computePulseIndex(items);
    return { p25: v, p75: v };
  }
  const N = items.length;
  const samples: number[] = [];
  for (let b = 0; b < B; b++) {
    const resample: ClassifiedComment[] = [];
    for (let i = 0; i < N; i++) {
      resample.push(items[Math.floor(Math.random() * N)]);
    }
    samples.push(computePulseIndex(resample));
  }
  samples.sort((a, b) => a - b);
  return {
    p25: samples[Math.floor(B * 0.25)],
    p75: samples[Math.floor(B * 0.75)],
  };
}

export function aggregate(items: ClassifiedComment[]): AggregateResult {
  const pulse = computePulseIndex(items);
  const ci = bootstrapCI(items);

  // Weighted breakdown
  let totalWeight = 0;
  let posSum = 0, neuSum = 0, negSum = 0;
  let confSum = 0;
  let totalUpvotes = 0;
  let oldest = Infinity, newest = 0;
  const threads = new Set<string>();

  for (const it of items) {
    const w = weight(it.comment.score);
    totalWeight += w;
    posSum += w * it.sentiment.positive;
    neuSum += w * it.sentiment.neutral;
    negSum += w * it.sentiment.negative;
    confSum += Math.max(it.sentiment.positive, it.sentiment.neutral, it.sentiment.negative);
    totalUpvotes += Math.max(0, it.comment.score);
    if (it.comment.created_utc < oldest) oldest = it.comment.created_utc;
    if (it.comment.created_utc > newest) newest = it.comment.created_utc;
    threads.add(it.comment.post_id);
  }

  const posPct = totalWeight > 0 ? Math.round(100 * posSum / totalWeight) : 33;
  const neuPct = totalWeight > 0 ? Math.round(100 * neuSum / totalWeight) : 34;
  const negPct = 100 - posPct - neuPct;

  return {
    pulse_index: pulse,
    pulse_index_low: ci.p25,
    pulse_index_high: ci.p75,
    breakdown: { positive: posPct, neutral: neuPct, negative: Math.max(0, negPct) },
    sample_size: items.length,
    thread_count: threads.size,
    total_upvotes: totalUpvotes,
    oldest_comment_utc: oldest === Infinity ? 0 : oldest,
    newest_comment_utc: newest,
    classifier_confidence_avg: items.length > 0 ? confSum / items.length : 0,
    formula_version: 'pulse-v2.1: weighted_mean(p_pos - p_neg, w=log(2+max(0,upvotes))), CI via 500-sample bootstrap',
  };
}

/**
 * Pick representative comments per sentiment bucket, ranked by upvotes within bucket.
 * Returns short excerpts (≤12 words) with permalinks for verification.
 */
export interface VoiceExcerpt {
  excerpt: string;       // ≤12 words, ends with "…" if truncated
  full_length: number;   // length of original body
  upvotes: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;    // model's prob for this label
  permalink: string;
  subreddit: string;
}

function dominantLabel(s: SentimentResult): 'positive' | 'neutral' | 'negative' {
  if (s.positive >= s.neutral && s.positive >= s.negative) return 'positive';
  if (s.negative >= s.neutral) return 'negative';
  return 'neutral';
}

function truncateWords(text: string, maxWords = 12): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ');
  if (words.length <= maxWords) return cleaned;
  return words.slice(0, maxWords).join(' ') + '…';
}

export function pickVoices(items: ClassifiedComment[], perBucket = 2): VoiceExcerpt[] {
  const buckets: Record<'positive' | 'neutral' | 'negative', ClassifiedComment[]> = {
    positive: [],
    neutral: [],
    negative: [],
  };
  for (const it of items) {
    buckets[dominantLabel(it.sentiment)].push(it);
  }
  // Sort each bucket by upvotes desc
  for (const k of Object.keys(buckets) as Array<keyof typeof buckets>) {
    buckets[k].sort((a, b) => b.comment.score - a.comment.score);
  }

  const voices: VoiceExcerpt[] = [];
  for (const sentiment of ['positive', 'negative', 'neutral'] as const) {
    for (const it of buckets[sentiment].slice(0, perBucket)) {
      voices.push({
        excerpt: truncateWords(it.comment.body, 12),
        full_length: it.comment.body.length,
        upvotes: it.comment.score,
        sentiment,
        confidence: it.sentiment[sentiment],
        permalink: it.comment.permalink,
        subreddit: it.comment.subreddit,
      });
    }
  }
  return voices;
}
