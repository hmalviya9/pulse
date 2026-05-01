// Reddit source: wraps the existing reddit fetch + classifier + aggregator
// into a normalized output shape, so the blender can treat all sources uniformly.

import { gatherCorpus } from './reddit';
import { classifyAll } from '../sentiment';
import { aggregate, pickVoices, type ClassifiedComment, type VoiceExcerpt } from '../aggregate';
import type { Country } from '../countries';

export interface RedditSourceResult {
  found: boolean;
  pulse_score: number;            // 0-100
  pulse_score_low: number;
  pulse_score_high: number;
  breakdown: { positive: number; neutral: number; negative: number };
  sample_size: number;
  thread_count: number;
  total_upvotes: number;
  classifier_confidence_avg: number;
  voices: VoiceExcerpt[];
  threads: Array<{ title: string; subreddit: string; score: number; num_comments: number; permalink: string; created_utc: number }>;
  subreddits_searched: string[];
  oldest_comment_utc: number;
  newest_comment_utc: number;
  classified: ClassifiedComment[];  // for downstream theme extraction
}

export async function fetchReddit(country: Country, topic: string): Promise<RedditSourceResult> {
  const corpus = await gatherCorpus(country.subreddits, topic, {
    postsPerSub: 4,
    commentsPerPost: 25,
    maxComments: 300,
  });

  if (corpus.comments.length < 10) {
    return {
      found: false,
      pulse_score: 50,
      pulse_score_low: 50,
      pulse_score_high: 50,
      breakdown: { positive: 33, neutral: 34, negative: 33 },
      sample_size: corpus.comments.length,
      thread_count: corpus.posts.length,
      total_upvotes: 0,
      classifier_confidence_avg: 0,
      voices: [],
      threads: corpus.posts.map(p => ({
        title: p.title, subreddit: p.subreddit, score: p.score,
        num_comments: p.num_comments, permalink: p.permalink, created_utc: p.created_utc,
      })),
      subreddits_searched: corpus.searchedSubreddits,
      oldest_comment_utc: 0,
      newest_comment_utc: 0,
      classified: [],
    };
  }

  const sentiments = await classifyAll(corpus.comments.map(c => c.body));
  const classified: ClassifiedComment[] = corpus.comments.map((c, i) => ({
    comment: c,
    sentiment: sentiments[i] || { positive: 0, neutral: 1, negative: 0 },
  }));

  const stats = aggregate(classified);
  const voices = pickVoices(classified, 2);

  return {
    found: true,
    pulse_score: stats.pulse_index,
    pulse_score_low: stats.pulse_index_low,
    pulse_score_high: stats.pulse_index_high,
    breakdown: stats.breakdown,
    sample_size: stats.sample_size,
    thread_count: stats.thread_count,
    total_upvotes: stats.total_upvotes,
    classifier_confidence_avg: stats.classifier_confidence_avg,
    voices,
    threads: corpus.posts.slice(0, 10).map(p => ({
      title: p.title, subreddit: p.subreddit, score: p.score,
      num_comments: p.num_comments, permalink: p.permalink, created_utc: p.created_utc,
    })),
    subreddits_searched: corpus.searchedSubreddits,
    oldest_comment_utc: stats.oldest_comment_utc,
    newest_comment_utc: stats.newest_comment_utc,
    classified,
  };
}
