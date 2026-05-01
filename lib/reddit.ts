// Reddit API client.
// Uses OAuth client_credentials flow (app-only, no user context).
// Docs: https://github.com/reddit-archive/reddit/wiki/OAuth2

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

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  // Cache token for 50 minutes (Reddit tokens last 1 hour)
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT || 'pulse-sentiment/1.0';

  if (!clientId || !clientSecret) {
    throw new Error('REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set in .env.local');
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

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Reddit auth failed (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 600) * 1000, // refresh 10min before expiry
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

  // Reddit returns rate-limit headers; we respect 429 by surfacing it
  if (res.status === 429) {
    throw new Error('Reddit rate limit hit. Wait a minute and retry.');
  }
  if (!res.ok) {
    throw new Error(`Reddit API ${path} failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Search a subreddit for posts matching the topic.
 * Time window: past month (`t=month`). Sort by relevance, then we'll re-rank by comment count.
 */
export async function searchSubreddit(subreddit: string, query: string, limit = 8): Promise<RedditPost[]> {
  const q = encodeURIComponent(query);
  const path = `/r/${subreddit}/search.json?q=${q}&restrict_sr=on&sort=relevance&t=month&limit=${limit}`;

  try {
    const data = await redditFetch(path);
    const children = data?.data?.children || [];
    return children
      .map((c: any) => c.data)
      .filter((p: any) => p && !p.over_18 && (p.num_comments ?? 0) >= 3) // skip thin/NSFW posts
      .map((p: any) => ({
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
  } catch (e: any) {
    // One bad subreddit shouldn't kill the whole analysis
    console.warn(`Search failed for r/${subreddit}: ${e.message}`);
    return [];
  }
}

/**
 * Fetch top comments for a post.
 * `depth=1` keeps it shallow (top-level + immediate replies, not full nested trees).
 */
export async function fetchPostComments(post: RedditPost, limit = 30): Promise<RedditComment[]> {
  const path = `/r/${post.subreddit}/comments/${post.id}.json?limit=${limit}&sort=top&depth=1`;

  try {
    const data = await redditFetch(path);
    // Reddit returns [postListing, commentListing]
    const commentListing = Array.isArray(data) ? data[1] : null;
    const children = commentListing?.data?.children || [];

    const comments: RedditComment[] = [];
    for (const c of children) {
      if (c.kind !== 't1') continue; // skip "more" links
      const d = c.data;
      if (!d || !d.body || d.body === '[deleted]' || d.body === '[removed]') continue;
      if (d.body.length < 20) continue; // too short to classify reliably
      if (d.body.length > 1500) {
        // Truncate very long comments to keep classifier input bounded
        d.body = d.body.slice(0, 1500);
      }
      comments.push({
        id: d.id,
        body: d.body,
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
    console.warn(`Comments fetch failed for ${post.id}: ${e.message}`);
    return [];
  }
}

/**
 * High-level: search across subreddits, fetch comments, return flat list.
 * Returns metadata so the UI can show real numbers.
 */
export async function gatherCorpus(
  subreddits: string[],
  topic: string,
  opts: { postsPerSub?: number; commentsPerPost?: number; maxComments?: number } = {}
): Promise<{
  comments: RedditComment[];
  posts: RedditPost[];
  searchedSubreddits: string[];
}> {
  const postsPerSub = opts.postsPerSub ?? 4;
  const commentsPerPost = opts.commentsPerPost ?? 25;
  const maxComments = opts.maxComments ?? 400;

  // Search all subreddits in parallel
  const searchResults = await Promise.all(
    subreddits.map(sub => searchSubreddit(sub, topic, postsPerSub))
  );

  const allPosts: RedditPost[] = searchResults.flat();
  // Sort by num_comments desc — richer threads first
  allPosts.sort((a, b) => b.num_comments - a.num_comments);
  // Dedupe by id
  const seen = new Set<string>();
  const dedupedPosts = allPosts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // Cap to top 16 threads to stay under timeout
  const topPosts = dedupedPosts.slice(0, 16);

  // Fetch comments in parallel
  const commentResults = await Promise.all(
    topPosts.map(p => fetchPostComments(p, commentsPerPost))
  );

  let comments: RedditComment[] = commentResults.flat();
  // Sort by score desc and cap
  comments.sort((a, b) => b.score - a.score);
  comments = comments.slice(0, maxComments);

  return {
    comments,
    posts: topPosts,
    searchedSubreddits: subreddits,
  };
}
