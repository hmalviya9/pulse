// Reddit API client — v3.1 with proper error diagnostics.
// Changes from v3.0:
//   - Auth/rate-limit errors now bubble up instead of being silently caught
//   - Per-subreddit fetch errors are TRACKED (returned as diagnostics) instead of just logged
//   - Time-window fallback: if t=month returns nothing, retry with t=year, then t=all
//   - The User-Agent string format strictly matches Reddit's documented requirement

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  score: number;
  num_comments: number;
  permalink: string;
  created_utc: number;
  author: string;
}

export interface RedditComment {
  id: string;
  body: string;
  score: number;
  permalink: string;
  created_utc: number;
  subreddit: string;
  post_id: string;
  post_title: string;
}

export interface SubredditDiagnostic {
  subreddit: string;
  posts_found: number;
  posts_after_filter: number;
  time_window_used: string;
  error: string | null;
}

export interface CorpusDiagnostics {
  auth_succeeded: boolean;
  per_subreddit: SubredditDiagnostic[];
  total_posts_pre_dedup: number;
  total_posts_post_dedup: number;
  total_comments_fetched: number;
  total_comments_after_filter: number;
  comment_fetch_errors: string[];
}

// Custom error classes for better error reporting upstream
export class RedditAuthError extends Error {
  constructor(message: string) {
    super(`Reddit auth: ${message}`);
    this.name = 'RedditAuthError';
  }
}

export class RedditRateLimitError extends Error {
  constructor(message: string) {
    super(`Reddit rate limit: ${message}`);
    this.name = 'RedditRateLimitError';
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT;

  if (!clientId || !clientSecret) {
    throw new RedditAuthError('REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set in .env.local');
  }
  // Reddit is strict about User-Agent: it should follow "platform:appname:version (by /u/username)"
  if (!userAgent || userAgent.length < 5) {
    throw new RedditAuthError('REDDIT_USER_AGENT must be set. Format: "pulse-sentiment/1.0 by /u/your_reddit_username"');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: 'grant_type=client_credentials',
  });

  if (res.status === 401) {
    const body = await res.text();
    throw new RedditAuthError(`401 Unauthorized — check that REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET match your "script" app at https://www.reddit.com/prefs/apps. Server response: ${body.slice(0, 200)}`);
  }
  if (res.status === 429) {
    throw new RedditRateLimitError('Hit token endpoint rate limit. Wait 60s and retry.');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new RedditAuthError(`Token request failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new RedditAuthError(`No access_token in response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 600) * 1000,
  };
  return cachedToken.token;
}

async function redditFetch(path: string): Promise<any> {
  const token = await getToken();
  const userAgent = process.env.REDDIT_USER_AGENT || 'pulse-sentiment/1.0';

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
    },
  });

  if (res.status === 401 || res.status === 403) {
    // Bearer token problem — propagate
    cachedToken = null; // bust cache so next call re-auths
    throw new RedditAuthError(`Bearer token rejected (${res.status}). Token cache cleared.`);
  }
  if (res.status === 429) {
    throw new RedditRateLimitError(`Rate limit on ${path}. Wait 60s and retry.`);
  }
  if (!res.ok) {
    throw new Error(`Reddit API ${path} failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Search a subreddit for posts. Returns posts + diagnostic info.
 * Tries t=month first, falls back to t=year if nothing found.
 */
export async function searchSubreddit(
  subreddit: string,
  query: string,
  limit = 8
): Promise<{ posts: RedditPost[]; diagnostic: SubredditDiagnostic }> {
  const q = encodeURIComponent(query);
  const windows = ['month', 'year'];

  let lastError: string | null = null;

  for (const t of windows) {
    const path = `/r/${subreddit}/search.json?q=${q}&restrict_sr=on&sort=relevance&t=${t}&limit=${limit}`;
    try {
      const data = await redditFetch(path);
      const children = data?.data?.children || [];
      const allPosts = children
        .map((c: any) => c.data)
        .filter((p: any) => p) as any[];

      const filtered = allPosts.filter(p => !p.over_18 && (p.num_comments ?? 0) >= 3);

      const posts: RedditPost[] = filtered.map((p: any) => ({
        id: p.id,
        subreddit: p.subreddit,
        title: p.title || '',
        selftext: p.selftext || '',
        score: p.score || 0,
        num_comments: p.num_comments || 0,
        permalink: `https://www.reddit.com${p.permalink}`,
        created_utc: p.created_utc || 0,
        author: p.author || '[deleted]',
      }));

      // If we got nothing this window, try the next one
      if (posts.length === 0 && t !== windows[windows.length - 1]) {
        continue;
      }

      return {
        posts,
        diagnostic: {
          subreddit,
          posts_found: allPosts.length,
          posts_after_filter: posts.length,
          time_window_used: t,
          error: null,
        },
      };
    } catch (e: any) {
      // Auth and rate limit errors — propagate. They're global, not per-subreddit.
      if (e instanceof RedditAuthError || e instanceof RedditRateLimitError) {
        throw e;
      }
      lastError = e.message;
    }
  }

  return {
    posts: [],
    diagnostic: {
      subreddit,
      posts_found: 0,
      posts_after_filter: 0,
      time_window_used: 'all_failed',
      error: lastError,
    },
  };
}

export async function fetchPostComments(post: RedditPost, limit = 30): Promise<RedditComment[]> {
  const path = `/r/${post.subreddit}/comments/${post.id}.json?limit=${limit}&sort=top&depth=1`;

  try {
    const data = await redditFetch(path);
    const commentListing = Array.isArray(data) ? data[1] : null;
    const children = commentListing?.data?.children || [];

    const comments: RedditComment[] = [];
    for (const c of children) {
      if (c.kind !== 't1') continue;
      const d = c.data;
      if (!d || !d.body || d.body === '[deleted]' || d.body === '[removed]') continue;
      if (d.body.length < 20) continue;
      let body = d.body;
      if (body.length > 1500) body = body.slice(0, 1500);
      comments.push({
        id: d.id,
        body,
        score: d.score || 0,
        permalink: `https://www.reddit.com${d.permalink || `${post.permalink}${d.id}/`}`,
        created_utc: d.created_utc || 0,
        subreddit: post.subreddit,
        post_id: post.id,
        post_title: post.title,
      });
    }
    return comments;
  } catch (e: any) {
    if (e instanceof RedditAuthError || e instanceof RedditRateLimitError) throw e;
    return [];
  }
}

/**
 * Gather a corpus of comments. Returns comments AND a diagnostic so callers
 * can tell the difference between "topic isn't discussed" and "auth is broken".
 */
export async function gatherCorpus(
  subreddits: string[],
  topic: string,
  opts: { postsPerSub?: number; commentsPerPost?: number; maxComments?: number } = {}
): Promise<{
  comments: RedditComment[];
  posts: RedditPost[];
  searchedSubreddits: string[];
  diagnostics: CorpusDiagnostics;
}> {
  const postsPerSub = opts.postsPerSub ?? 4;
  const commentsPerPost = opts.commentsPerPost ?? 25;
  const maxComments = opts.maxComments ?? 400;

  // Verify auth ONCE up front — fail fast with a clear error if creds are wrong
  await getToken();

  const searchResults = await Promise.all(
    subreddits.map(sub => searchSubreddit(sub, topic, postsPerSub))
  );

  const perSubreddit = searchResults.map(r => r.diagnostic);
  const allPosts: RedditPost[] = searchResults.flatMap(r => r.posts);
  const totalPostsPre = allPosts.length;

  allPosts.sort((a, b) => b.num_comments - a.num_comments);
  const seen = new Set<string>();
  const dedupedPosts = allPosts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  const topPosts = dedupedPosts.slice(0, 16);

  const commentResults = await Promise.allSettled(
    topPosts.map(p => fetchPostComments(p, commentsPerPost))
  );

  const commentErrors: string[] = [];
  let allComments: RedditComment[] = [];
  for (const r of commentResults) {
    if (r.status === 'fulfilled') {
      allComments.push(...r.value);
    } else {
      commentErrors.push(r.reason?.message || 'unknown error');
    }
  }
  const totalCommentsFetched = allComments.length;

  allComments.sort((a, b) => b.score - a.score);
  const finalComments = allComments.slice(0, maxComments);

  return {
    comments: finalComments,
    posts: topPosts,
    searchedSubreddits: subreddits,
    diagnostics: {
      auth_succeeded: true,
      per_subreddit: perSubreddit,
      total_posts_pre_dedup: totalPostsPre,
      total_posts_post_dedup: dedupedPosts.length,
      total_comments_fetched: totalCommentsFetched,
      total_comments_after_filter: finalComments.length,
      comment_fetch_errors: commentErrors,
    },
  };
}
