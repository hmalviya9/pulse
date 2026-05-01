# Pulse v2 — Public Sentiment Index

Real Reddit data, real classifier, real numbers. The honest version of v1.

## What this actually does

1. Authenticates with **Reddit's official OAuth API** (60 req/min, no scraping)
2. Searches country-relevant subreddits for the topic, fetches **actual posts and top comments** with timestamps and upvote counts
3. Runs each comment through **`cardiffnlp/twitter-xlm-roberta-base-sentiment`** — a multilingual sentiment classifier (HuggingFace Inference API)
4. Aggregates with a **defined upvote-weighted formula** and computes a **bootstrap confidence interval** (500 resamples)
5. Has Claude synthesize themes — but **only over the same comments that were measured**, not from its training data
6. Returns real sample size, real source links, real timestamps

No fabricated stats. Every number traces back to a real comment. Every comment has a permalink you can click.

## What you need

Three credentials. All free to get.

### 1. Reddit OAuth credentials (5 min)

1. Go to https://www.reddit.com/prefs/apps
2. Scroll to bottom → **"create another app..."**
3. Choose **"script"** type
4. Fill in:
   - name: `pulse-sentiment` (anything)
   - description: leave blank
   - about url: leave blank
   - redirect uri: `http://localhost:8080` (placeholder, unused for client_credentials)
5. Click **"create app"**
6. Copy:
   - `client_id` — the random string under your app name (under "personal use script")
   - `client_secret` — labeled "secret"

### 2. Hugging Face token (2 min)

1. Sign up / log in at https://huggingface.co
2. Go to https://huggingface.co/settings/tokens
3. **"New token"** → role: **Read** → name: anything → create
4. Copy the token (starts with `hf_`)

Free tier rate limits are generous for testing. For production traffic, look at HF Inference Providers' paid tier.

### 3. Anthropic API key (2 min)

1. Sign up at https://console.anthropic.com/
2. Generate an API key
3. Note: this is used for theme synthesis over the measured corpus — about 1 short call per query

## Setup

```bash
# 1. Install
npm install

# 2. Copy env template
cp .env.local.example .env.local

# 3. Fill in your credentials in .env.local
# REDDIT_CLIENT_ID=...
# REDDIT_CLIENT_SECRET=...
# REDDIT_USERNAME=your_reddit_username
# REDDIT_USER_AGENT=pulse-sentiment/1.0 by /u/your_reddit_username
# HF_TOKEN=hf_...
# ANTHROPIC_API_KEY=sk-ant-...

# 4. Run
npm run dev
```

Open `http://localhost:3000`.

First query takes 30–60 seconds (HF model cold-start). Subsequent queries are 20–40 seconds.

## Deploying to Vercel

```bash
npm install -g vercel
vercel
```

Then add the env vars in the Vercel dashboard: **Project → Settings → Environment Variables**. Set the same five vars from `.env.local`.

**Important — timeout:**
- **Vercel Hobby** caps serverless functions at 60s. Most queries fit. Some won't.
- **Vercel Pro** ($20/mo) raises it to 300s. Recommended.

The `/app/api/analyze/route.ts` already declares `export const maxDuration = 60` — bump to `300` if on Pro.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (app/page.tsx)                                │
│  - Country picker + topic input                         │
│  - Loading ritual (rotating status)                     │
│  - Reveal w/ counter + CI + breakdown + voices + themes │
│  - SVG share card → PNG download                        │
└────────────────────────┬────────────────────────────────┘
                         │ POST /api/analyze
                         ▼
┌─────────────────────────────────────────────────────────┐
│  app/api/analyze/route.ts (orchestrator)                │
│                                                         │
│  1. lib/reddit.ts                                       │
│     ├─ getToken()         OAuth client_credentials      │
│     ├─ searchSubreddit()  /r/{sub}/search.json          │
│     └─ fetchPostComments() /r/{sub}/comments/{id}.json  │
│     → ~200-300 comments across ~10-16 threads           │
│                                                         │
│  2. lib/sentiment.ts                                    │
│     └─ classifyAll()     HF: cardiffnlp xlm-roberta     │
│     → 3-class probabilities per comment                 │
│                                                         │
│  3. lib/aggregate.ts                                    │
│     ├─ weight = log(2 + max(0, upvotes))                │
│     ├─ signed = P(pos) - P(neg)                         │
│     ├─ pulse  = round(50 * (1 + Σw·s / Σw))             │
│     └─ bootstrap() 500 resamples → p25/p75 CI           │
│                                                         │
│  4. lib/themes.ts                                       │
│     └─ Claude synthesizes themes OVER the measured      │
│        corpus (not its training data)                   │
└─────────────────────────────────────────────────────────┘
```

## What this still doesn't do

Honest list of remaining limitations:

- **Reddit ≠ public.** Reddit users skew younger, male, urban, English-fluent. Country subreddits often skew diaspora/expat. We surface this in the methodology drawer but it's worth repeating.
- **Search ranking is not random sampling.** Reddit's relevance algorithm boosts engaged content. Loud takes are over-weighted vs. lurkers. The upvote-weighting in our formula doubles down on this — by design (more visible opinions matter more) but worth knowing.
- **Time window is approximate.** `t=month` filters posts created in the last month, but top comments inside those posts can be slightly older. We surface the actual oldest/newest comment timestamps in the UI.
- **Classifier is twitter-tuned.** XLM-RoBERTa sentiment was fine-tuned on tweets. Reddit comments are usually longer and more nuanced — the model can miss sarcasm, in-group jokes, and very long arguments.
- **No topic coherence check.** If you query "AI" in `r/india`, you'll catch threads about AI but also stray comments mentioning "AI" in unrelated discussions. We don't filter for on-topic-ness beyond Reddit's own search relevance.
- **Single source.** It's still only Reddit. A real political-grade sentiment system would triangulate Reddit + news headlines + Twitter/X + survey data + prediction markets.

## Files

```
pulse-v2/
├── app/
│   ├── api/analyze/route.ts    Main pipeline orchestrator
│   ├── layout.tsx              Root layout + fonts
│   ├── page.tsx                The full UI (client component)
│   └── globals.css             Editorial-minimal styles
├── lib/
│   ├── countries.ts            Country → subreddit mapping
│   ├── reddit.ts               OAuth + search + comments
│   ├── sentiment.ts            HF classifier client
│   ├── aggregate.ts            Formula + bootstrap CI
│   └── themes.ts               Claude over measured corpus
├── package.json
├── tsconfig.json
├── next.config.mjs
├── .env.local.example
└── README.md                   This file
```

## License

MIT. Do whatever. Just don't claim it's a representative national poll — because it isn't.
