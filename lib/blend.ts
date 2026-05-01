// Multi-source blender: takes per-source Pulse scores and confidence weights,
// returns a blended Pulse Index plus divergence diagnostics.
//
// Design choice: not all sources blend in the same way.
//   - Reddit: opinion-loaded conversation → blends into Sentiment Pulse
//   - GDELT:  news media tone            → blends into Sentiment Pulse
//   - Polymarket: event probability      → DOES NOT blend (separate "conviction" panel)
//   - Wikipedia: attention momentum      → DOES NOT blend (separate "attention" panel)
//
// Why? Blending Polymarket's "yes probability on a specific event" with
// "Reddit comment sentiment" is the same kind of vibes-math we built v2 to escape.
// Apples and oranges. We surface them side-by-side instead.

export interface SourceContribution {
  source: 'reddit' | 'gdelt';
  pulse_score: number;
  weight: number;       // confidence weight, see calculation below
  sample_n: number;     // sample size descriptor (comments / articles)
}

export interface BlendResult {
  // The headline number — only built from sentiment-bearing sources (Reddit + GDELT)
  pulse_index: number;
  pulse_index_low: number;
  pulse_index_high: number;

  // Per-source contributions to the blend
  contributions: SourceContribution[];

  // Divergence: how much do the sources disagree?
  // Useful as a "story" signal: high divergence = "elites and grassroots disagree"
  divergence: number;             // 0-50, std-dev of per-source pulse scores
  divergence_label: 'aligned' | 'mixed' | 'split';
  divergence_note: string;        // human-readable summary

  // Coverage: how many of the expected sources had enough data?
  sources_used: number;
  sources_attempted: number;
  insufficient_sources: string[];
}

/**
 * Confidence weight per source.
 * Reddit: scaled by sample size, capped at ~1.0 for N≥200
 * GDELT:  scaled by article count, capped at ~1.0 for N≥100
 * Both have a floor at 0.2 if any data exists, so we don't drop sources entirely
 * just because the sample is small.
 */
function redditWeight(sampleSize: number): number {
  if (sampleSize < 10) return 0;
  return Math.max(0.2, Math.min(1.0, sampleSize / 200));
}

function gdeltWeight(articleCount: number): number {
  if (articleCount < 5) return 0;
  return Math.max(0.2, Math.min(1.0, articleCount / 100));
}

export interface BlenderInput {
  reddit: { found: boolean; pulse_score: number; sample_size: number; ci_width: number } | null;
  gdelt:  { found: boolean; pulse_score: number; article_count: number } | null;
}

export function blend(input: BlenderInput): BlendResult {
  const contributions: SourceContribution[] = [];
  const insufficient: string[] = [];
  const attempted = 2; // reddit + gdelt

  if (input.reddit && input.reddit.found) {
    contributions.push({
      source: 'reddit',
      pulse_score: input.reddit.pulse_score,
      weight: redditWeight(input.reddit.sample_size),
      sample_n: input.reddit.sample_size,
    });
  } else {
    insufficient.push('reddit');
  }

  if (input.gdelt && input.gdelt.found) {
    contributions.push({
      source: 'gdelt',
      pulse_score: input.gdelt.pulse_score,
      weight: gdeltWeight(input.gdelt.article_count),
      sample_n: input.gdelt.article_count,
    });
  } else {
    insufficient.push('gdelt');
  }

  // Blend
  let pulse = 50, lo = 50, hi = 50;
  let divergence = 0;
  let divLabel: BlendResult['divergence_label'] = 'aligned';
  let divNote = 'Only one source available — no comparison possible.';

  if (contributions.length === 0) {
    // No sentiment data at all
    return {
      pulse_index: 50, pulse_index_low: 50, pulse_index_high: 50,
      contributions: [],
      divergence: 0, divergence_label: 'aligned', divergence_note: 'No sentiment data available.',
      sources_used: 0, sources_attempted: attempted, insufficient_sources: insufficient,
    };
  }

  const totalWeight = contributions.reduce((s, c) => s + c.weight, 0);
  pulse = Math.round(contributions.reduce((s, c) => s + c.pulse_score * c.weight, 0) / totalWeight);

  // CI: if Reddit is available, use its bootstrap CI as the lower-bound uncertainty.
  // Add divergence as additional uncertainty.
  const redditCi = input.reddit?.ci_width || 0;

  if (contributions.length >= 2) {
    // Std dev across sources
    const mean = contributions.reduce((s, c) => s + c.pulse_score, 0) / contributions.length;
    const variance = contributions.reduce((s, c) => s + Math.pow(c.pulse_score - mean, 2), 0) / contributions.length;
    divergence = Math.round(Math.sqrt(variance));

    if (divergence < 5) {
      divLabel = 'aligned';
      divNote = 'Reddit and news media tell the same story.';
    } else if (divergence < 15) {
      divLabel = 'mixed';
      divNote = 'Sources broadly agree but disagree on intensity.';
    } else {
      divLabel = 'split';
      const reddit = contributions.find(c => c.source === 'reddit');
      const gdelt = contributions.find(c => c.source === 'gdelt');
      if (reddit && gdelt) {
        if (gdelt.pulse_score > reddit.pulse_score + 10) {
          divNote = `News media is markedly more positive (${gdelt.pulse_score}) than Reddit conversation (${reddit.pulse_score}). Often signals an institutional/grassroots gap.`;
        } else if (reddit.pulse_score > gdelt.pulse_score + 10) {
          divNote = `Reddit is markedly more positive (${reddit.pulse_score}) than news coverage (${gdelt.pulse_score}). Often signals an enthusiast bubble or a story media hasn't caught up to.`;
        } else {
          divNote = 'Sources sharply disagree on direction.';
        }
      } else {
        divNote = 'Sources sharply disagree.';
      }
    }
  }

  // CI = max(reddit_ci, divergence) — divergence widens uncertainty
  const halfWidth = Math.max(redditCi / 2, divergence);
  lo = Math.max(0, pulse - Math.round(halfWidth));
  hi = Math.min(100, pulse + Math.round(halfWidth));

  return {
    pulse_index: pulse,
    pulse_index_low: lo,
    pulse_index_high: hi,
    contributions,
    divergence,
    divergence_label: divLabel,
    divergence_note: divNote,
    sources_used: contributions.length,
    sources_attempted: attempted,
    insufficient_sources: insufficient,
  };
}
