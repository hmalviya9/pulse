// Sentiment classification via Hugging Face Inference API.
// Model: cardiffnlp/twitter-xlm-roberta-base-sentiment (multilingual, 8 langs fine-tuned + 30 supported)
// Endpoint format: https://router.huggingface.co/hf-inference/models/{model}

const MODEL = 'cardiffnlp/twitter-xlm-roberta-base-sentiment';
const ENDPOINT = `https://router.huggingface.co/hf-inference/models/${MODEL}`;
const BATCH_SIZE = 32; // HF inference has practical batch limits
const COLD_START_RETRIES = 3;

export interface SentimentResult {
  positive: number; // probability [0, 1]
  neutral: number;
  negative: number;
}

export const SENTIMENT_MODEL_NAME = MODEL;

function preprocess(text: string): string {
  // Normalize per the model card: replace user mentions and URLs with placeholders
  return text
    .split(/\s+/)
    .map(t => {
      if (t.startsWith('u/') || t.startsWith('/u/') || t.startsWith('@')) return '@user';
      if (t.startsWith('http://') || t.startsWith('https://')) return 'http';
      return t;
    })
    .join(' ')
    .slice(0, 512); // keep input bounded for the model
}

function normalizeLabel(label: string): 'positive' | 'neutral' | 'negative' | null {
  const l = label.toLowerCase();
  if (l === 'positive' || l === 'pos' || l === 'label_2') return 'positive';
  if (l === 'neutral' || l === 'neu' || l === 'label_1') return 'neutral';
  if (l === 'negative' || l === 'neg' || l === 'label_0') return 'negative';
  return null;
}

async function classifyBatch(texts: string[]): Promise<SentimentResult[]> {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error('HF_TOKEN must be set in .env.local');

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < COLD_START_RETRIES; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: texts.map(preprocess),
          options: { wait_for_model: true },
        }),
      });

      if (res.status === 503) {
        // Model loading — back off and retry
        await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`HF inference failed (${res.status}): ${errBody.slice(0, 200)}`);
      }

      const data = await res.json();
      // Expected: array of arrays of {label, score}
      // For a single input, sometimes returns a flat array — normalize
      const batches: any[][] = Array.isArray(data[0]) ? data : [data];

      return batches.map((scores: any[]) => {
        const result: SentimentResult = { positive: 0, neutral: 0, negative: 0 };
        for (const s of scores) {
          const label = normalizeLabel(s.label);
          if (label) result[label] = s.score;
        }
        // Normalize to sum to 1 (in case of tiny rounding issues)
        const sum = result.positive + result.neutral + result.negative;
        if (sum > 0) {
          result.positive /= sum;
          result.neutral /= sum;
          result.negative /= sum;
        }
        return result;
      });
    } catch (e: any) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr || new Error('Sentiment classification failed after retries');
}

/**
 * Classify a list of texts. Batches under the hood, returns one result per input.
 */
export async function classifyAll(texts: string[]): Promise<SentimentResult[]> {
  const results: SentimentResult[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchResults = await classifyBatch(batch);
    results.push(...batchResults);
  }
  return results;
}
