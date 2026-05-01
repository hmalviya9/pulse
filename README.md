# Pulse v3 — Multi-Source Public Sentiment Index

Four sources triangulating. Disagreement is itself a signal.

## What's new vs v2

v2 was honest about its measurements — but it was still one source. If Reddit was telling you a weird story, you had no way to know. v3 fixes that.

| | v2 | v3 |
|---|---|---|
| Sources | 1 (Reddit) | 4 (Reddit + GDELT + Wikipedia + Polymarket) |
| Sentiment blend | n/a | Weighted by sample size, with bootstrap CI |
| Cross-source disagreement | hidden | **surfaced as "divergence" — a story signal** |
| Attention/momentum | n/a | Wikipedia 30-day pageview chart |
| Conviction signal | n/a | Polymarket "money on the line" prob |
| News tone, country-filtered | n/a | GDELT 2.0 DOC API, ~50–500 articles per query |
| Architecture | Sequential pipeline | Promise.allSettled in parallel — 4 sources fetched at once |

## What each source actually contributes

- **Reddit** → grassroots conversation. What ordinary online people say to each other, classified by a multilingual sentiment model.
- **GDELT** → institutional voice. What the press in your country is saying, weighted by tone score.
- **Wikipedia** → attention curve. Are people *looking up* this topic? Surging or fading? (This isn't sentiment — it's whether anyone cares.)
- **Polymarket** → conviction. When real money is betting on an event related to the topic, what probability does it imply?

Reddit and GDELT are blended into the headline Pulse Index. Wikipedia and Polymarket are surfaced separately because mixing "event probability" with "comment sentiment" is the same vibes-math we built v2 to escape.

## The signature feature: divergence

When Reddit and GDELT disagree by 15+ points, the result page surfaces a **divergence panel** with a written story. Examples of what this catches:

- *"News media is markedly more positive (72) than Reddit conversation (54). Often signals an institutional/grassroots gap."*
- *"Reddit is markedly more positive (78) than news coverage (51). Often signals an enthusiast bubble or a story media hasn't caught up to."*

This is the part you can't get from any single source.

## What you need

Three credentials. All free. (Wikipedia, GDELT, Polymarket need none — they're fully public.)

### 1. Reddit OAuth (5 min) — same as v2
1. https://www.reddit.com/prefs/apps → "create another app" → "script"
2. Copy `client_id` and `client_secret`

### 2. Hugging Face token (2 min) — same as v2
1. https://huggingface.co/settings/tokens → "New token" → role: "Read"

### 3. Anthropic API key (2 min) — same as v2
1. https://console.anthropic.com/

## Setup

```bash
npm install
cp .env.local.example .env.local
# fill in REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT,
#         HF_TOKEN, ANTHROPIC_API_KEY
npm run dev
```

Open `http://localhost:3000`. First query: 30–60s (HF cold-start). Subsequent: 25–45s.

## Architecture

```
       User submits country + topic
              │
              ▼
    /api/analyze  (orchestrator)
              │
              ▼
   ┌──────────┴──────────┐  Promise.allSettled
   │                     │
   ▼   ▼   ▼   ▼
Reddit  GDELT  Wiki  Polymarket
   │      │     │      │
   ▼      ▼     ▼      ▼
  HF      —     —      —          (only Reddit needs classifier)
  classifier
   │      │     │      │
   ▼      ▼     ▼      ▼
  pulse_score (0-100) for each
   │      │     │      │
   └──┬───┘     │      │
      ▼         │      │
   blend()      │      │           weighted: w ∝ log(1 + N)
   + divergence │      │
      │         │      │
      └─────────┴──────┴────────────► UI
```

## Files

```
pulse-v3/
├── app/
│   ├── api/analyze/route.ts    Orchestrator — parallel source fetch + blend
│   ├── layout.tsx
│   ├── page.tsx                Multi-source UI (~900 lines)
│   └── globals.css
├── lib/
│   ├── countries.ts            Country → subreddits mapping
│   ├── sentiment.ts            HF XLM-RoBERTa client
│   ├── aggregate.ts            Reddit-only formula (still here, used by redditSource)
│   ├── themes.ts               Claude over measured corpus
│   ├── blend.ts                Multi-source blender + divergence calc
│   └── sources/
│       ├── reddit.ts           Low-level Reddit OAuth + fetch
│       ├── redditSource.ts     Wraps reddit + classify + aggregate → SourceResult
│       ├── gdelt.ts            GDELT 2.0 DOC API (tonechart + artlist)
│       ├── wikipedia.ts        Pageviews REST API + momentum calc
│       └── polymarket.ts       Gamma /public-search + match scoring
├── README.md
└── ...config files
```

## Limitations (still real)

What I addressed in v3:
- ✅ Single-source dependency → solved by adding 3 more sources
- ✅ Hidden source bias → surfaced as divergence
- ✅ "Vibes" attention measurement → real Wikipedia data
- ✅ No ground-truth conviction signal → Polymarket added when relevant

What's still here:
- ⚠️ Each source has its own population bias (Reddit = young/urban, GDELT news = English-language press, Polymarket = crypto-native traders, Wikipedia = literate/curious users). All four together is a much better signal than one — but it's still not a national poll.
- ⚠️ Polymarket only matches well-defined events, not topics. A "housing crisis" query won't find a market because there isn't one. We surface the match score so you can judge.
- ⚠️ GDELT's country attribution is by publication country, not the country the article is *about*. A Reuters article in the US about India counts as US.
- ⚠️ Wikipedia language project ≠ country (e.g. en.wikipedia is read in IN/US/GB/PH/SG/NG). For non-Anglophone countries we use the local language Wikipedia, which has its own readership profile.
- ⚠️ Sarcasm, irony, in-group jokes → still defeat the classifier
- ⚠️ ~25-45 second latency. Each source has its own slowest path; we're bound by the slowest of the four.

## What's next (v4 ideas)

- **Topic coherence pre-filter** so off-topic comments don't get classified
- **Recency weighting** — exponential decay on `created_utc` so 3-day-old comments outweigh 25-day-old ones
- **Sensitivity panel** — show how the index would change if you swapped subreddits / dropped Reddit / dropped GDELT. The "what if" makes the editorial choices visible.
- **YouTube comments** — adds video-discussion sentiment, separate signal from Reddit
- **Bluesky** — once it has more reach in non-US contexts, an actually-public Twitter alternative
- **Time-series mode** — same query weekly, build a chart of how sentiment shifted

## License

MIT.
