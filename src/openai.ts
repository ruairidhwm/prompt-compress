import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encoding_for_model } from "tiktoken";

const here = dirname(fileURLToPath(import.meta.url));

loadEnv({ path: join(here, "..", ".env"), override: true });

function openaiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key)
    throw new Error(
      "OPENAI_API_KEY is missing. Set it in a .env file at the project root (next to package.json) or in your environment.",
    );
  return key;
}

export const MODEL = "gpt-4o-mini";
export const EMBED_MODEL = "text-embedding-3-small";
export const PRICE_PER_1K_INPUT = 0.00015;
export const PRICE_PER_1K_OUTPUT = 0.0006;

// Fixed seed for (best-effort) reproducibility. OpenAI does not guarantee
// bit-exact determinism even with temperature 0 + seed, but it meaningfully
// reduces run-to-run drift and declares the run as "seeded" in the response.
export const SEED = 42;

const BASE = "https://api.openai.com/v1";

// Retry on transient 429/5xx failures with exponential backoff.
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 4,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (res.status >= 500 || res.status === 429) {
        const body = await res.text();
        lastError = new Error(`OpenAI ${res.status}: ${body}`);
        if (attempt < maxAttempts) {
          const delayMs = 500 * 2 ** (attempt - 1);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
      }
      // Non-retryable error (4xx other than 429)
      throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts) {
        const delayMs = 500 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`OpenAI request failed after ${maxAttempts} attempts`);
}

export async function callModel(
  systemPrompt: string,
  userInput: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const res = await fetchWithRetry(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      seed: SEED,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ],
    }),
  });
  const data = await res.json();
  return {
    text: data.choices[0].message.content ?? "",
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  };
}

export async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetchWithRetry(`${BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey()}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  const data = await res.json();
  return data.data.map((d: any) => d.embedding as number[]);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Singleton encoder — allocated once, reused across calls.
const enc = encoding_for_model("gpt-4o-mini");

export function countTokens(text: string): number {
  return enc.encode(text).length;
}
