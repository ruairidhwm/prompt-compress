import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const BASE = "https://api.openai.com/v1";

export async function callModel(
  systemPrompt: string,
  userInput: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    text: data.choices[0].message.content ?? "",
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  };
}

export async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey()}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
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

export function countTokens(text: string): number {
  /**
   * This is a fairly rough approximation. It's only for relative measurement which is all we need. We're optimising for 'fewer' rather than 'exactly N tokens'. Perhaps can swap in @anthropic-ai/tokenizer for more accurate counts?
   */
  return Math.ceil(text.length / 4);
}
