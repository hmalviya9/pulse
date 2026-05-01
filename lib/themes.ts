// Theme extraction: a Claude API call OVER the actual classified corpus.
// Unlike v1 (which had Claude search and summarize whatever it felt like),
// here Claude only sees comments we measured — themes are grounded in the same data
// the Pulse Index was computed on.

import type { ClassifiedComment } from './aggregate';

export interface Theme {
  theme: string;          // 3-5 word label
  sentiment: 'positive' | 'neutral' | 'negative';
  description: string;    // 1 sentence in Claude's own words
  example_count: number;  // how many comments fit this theme (Claude's estimate)
}

export interface ThemeAnalysisResult {
  themes: Theme[];
  surprise_finding: string;
  headline_verdict: string;
  summary: string;
}

function dominantLabel(s: { positive: number; neutral: number; negative: number }) {
  if (s.positive >= s.neutral && s.positive >= s.negative) return 'positive';
  if (s.negative >= s.neutral) return 'negative';
  return 'neutral';
}

export async function extractThemes(
  classified: ClassifiedComment[],
  topic: string,
  countryName: string
): Promise<ThemeAnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY must be set in .env.local');

  // Sample up to 80 comments — top by upvotes within each bucket for balance
  const buckets: Record<string, ClassifiedComment[]> = { positive: [], neutral: [], negative: [] };
  for (const c of classified) buckets[dominantLabel(c.sentiment)].push(c);
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => b.comment.score - a.comment.score);
  }
  const sampled = [
    ...buckets.positive.slice(0, 30),
    ...buckets.negative.slice(0, 30),
    ...buckets.neutral.slice(0, 20),
  ];

  // Build the corpus payload — truncate each body to keep total context bounded
  const corpusLines = sampled.map((c, i) => {
    const lbl = dominantLabel(c.sentiment);
    const body = c.comment.body.length > 400 ? c.comment.body.slice(0, 400) + '...' : c.comment.body;
    return `[${i + 1}] [${lbl}, ↑${c.comment.score}, r/${c.comment.subreddit}] ${body}`;
  }).join('\n\n');

  const prompt = `You are analyzing a measured corpus of Reddit comments about "${topic}" from ${countryName}-relevant subreddits. Each comment has been pre-classified by a sentiment model and tagged with its sentiment label and upvote count.

Your job: identify the dominant THEMES in this conversation. You are NOT re-doing sentiment analysis — that's already done. You are doing thematic synthesis.

CRITICAL RULES:
- PARAPHRASE. Never quote any comment verbatim. Every description must be in your own words.
- Themes must be GROUNDED in the comments below — not your prior knowledge of the topic.
- Be specific. "People are concerned" is useless. "Concern about job displacement in IT roles within 5 years" is useful.
- If the corpus is thin or contradictory, say so.

CORPUS (${sampled.length} comments):
${corpusLines}

Respond with ONLY valid JSON, no preamble, no markdown fences:

{
  "themes": [
    {
      "theme": "<3-5 word label>",
      "sentiment": "positive|neutral|negative",
      "description": "<1 sentence in your own words, paraphrased from the comments>",
      "example_count": <integer estimate of how many comments above fit this theme>
    }
  ],
  "surprise_finding": "<1-2 sentences on the most counterintuitive pattern in this specific corpus>",
  "headline_verdict": "<one short punchy line, max 10 words, capturing the dominant mood>",
  "summary": "<3 sentences on the overall picture grounded in these comments>"
}

Constraints: themes 3-5 items. Order themes by example_count desc.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API failed (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b: any) => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude');

  let raw = textBlock.text.trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    raw = raw.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(raw) as ThemeAnalysisResult;
  } catch (e) {
    throw new Error('Could not parse theme analysis response');
  }
}
