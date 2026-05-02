# Troubleshooting — when /api/analyze returns "0 comments, 0 articles"

## Quick diagnosis path

Hit the new debug endpoint first — it bypasses all the success-path requirements and tells you exactly which source is failing:

```
http://localhost:3000/api/debug?country=IN&topic=cryptocurrency
```

The response is plain JSON, designed to be readable. Look for:

- `env_check` — confirms which env vars are set (NEVER prints values, just lengths)
- `sources.reddit.diagnosis` — when auth fails, this tells you exactly what to fix
- `sources.reddit.per_subreddit` — which subreddits returned data, which errored
- `sources.gdelt.diagnostic` — HTTP status, country filter results, fallback usage

## The "0 + 0" pattern (what you saw)

Reddit returning **0 comments** for "cryptocurrency" in India is almost certainly **auth failure**, not absence of conversation. Three causes, in order of frequency:

### 1. `REDDIT_USER_AGENT` is missing or malformed (most common)

Reddit silently rejects requests with bad User-Agents. The format must be roughly:

```
REDDIT_USER_AGENT=pulse-sentiment/1.0 by /u/your_actual_reddit_username
```

If you used a placeholder like `your_reddit_username`, Reddit may reject it. Use your real handle.

### 2. Wrong client credentials

Open https://www.reddit.com/prefs/apps — under your script app:

- `client_id` is the **string under the app name** (next to "personal use script"). Looks like `Abc123XyZ_def`.
- `client_secret` is the **labeled "secret"** field. Longer string.

People often swap them, or copy the wrong one. Confirm in `.env.local`.

### 3. App type wrong

When you created the Reddit app, did you select **"script"**? If it's "web app" or "installed app", the `client_credentials` grant doesn't work. You'd need to delete the app and recreate with the script type.

## After fixing `.env.local`

Always restart the dev server:

```
# Ctrl+C the running process
npm run dev
```

Next.js caches env vars at startup. Edits don't take effect without a restart.

## GDELT showing 0 articles

This patch added an automatic fallback: if `sourcecountry:IN` returns < 5 articles, it retries without the country filter. The result then carries `is_global_coverage: true` so the UI knows to flag it.

If you still see 0 GDELT articles, check the debug endpoint for `sources.gdelt.diagnostic.raw_error`. Common causes:

- GDELT temporarily down (returns HTML error page → "JSON parse failed")
- Topic phrase too rare to match anything (try removing quotes around the topic)

## Other common issues

| Symptom | Cause | Fix |
|---|---|---|
| `HF_TOKEN must be set` | env var missing | add to `.env.local`, restart |
| HF returns 503 forever | model cold-start cycling | wait ~60s, retry |
| `ANTHROPIC_API_KEY` invalid | key revoked / typo | regenerate at console.anthropic.com |
| Vercel timeout at 60s | Hobby tier limit | upgrade to Pro for 300s, or reduce `postsPerSub` |
| Polymarket always empty | topic doesn't match any active market | normal — feature is opt-in by relevance |
| Wikipedia "no match" | no article exists for the topic phrase | try a more canonical phrase |
| Comments fetched but Pulse seems wrong | check `classifier_confidence_avg` in the result | low avg = sarcasm or unfamiliar domain confusing the model |

## Reading the debug endpoint output

Sample successful response (formatted):

```jsonc
{
  "query": { "country": "IN", "topic": "cryptocurrency", "subreddits_to_search": ["india", ...] },
  "env_check": {
    "REDDIT_CLIENT_ID": "set (14 chars)",
    "REDDIT_CLIENT_SECRET": "set (27 chars)",
    "REDDIT_USER_AGENT": "pulse-sentiment/1.0 by /u/yourname",
    "HF_TOKEN": "set (37 chars)",
    "ANTHROPIC_API_KEY": "set (108 chars)"
  },
  "sources": {
    "reddit": {
      "ok": true,
      "summary": {
        "auth_succeeded": true,
        "total_posts_post_dedup": 18,
        "total_comments_after_filter": 247
      },
      "per_subreddit": [
        { "subreddit": "india", "posts_after_filter": 5, "time_window_used": "month" },
        { "subreddit": "IndiaSpeaks", "posts_after_filter": 4, "time_window_used": "month" }
      ],
      "sample_post_titles": [
        "r/india: RBI's stance on crypto regulation (87 comments)",
        ...
      ]
    },
    "gdelt": {
      "ok": true,
      "found": true,
      "article_count": 134,
      "is_global_coverage": false,
      "diagnostic": { "country_filter_attempted": "IN", "country_filter_articles": 134 }
    }
  }
}
```

Failed response (auth issue):

```jsonc
{
  "sources": {
    "reddit": {
      "ok": false,
      "error_class": "RedditAuthError",
      "error_message": "Reddit auth: 401 Unauthorized — check that REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET match your script app...",
      "diagnosis": "❌ AUTH FAILURE — your Reddit credentials are wrong, or User-Agent is malformed."
    }
  }
}
```

The `diagnosis` field is the action item. Fix that, restart, retry.
