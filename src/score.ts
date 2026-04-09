import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { callModel, embed, cosine, countTokens } from "./openai";

// Average per-input similarity must be at least this to pass.
const SIM_THRESHOLD_AVG = 0.92;

// Worst per-input similarity must be at least this to pass.
const SIM_THRESHOLD_MIN = 0.85;

type BaselineRecord = {
  input: string;
  output: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
};

type ScoreOutput = {
  tokens: number;
  avg_similarity: number;
  min_similarity: number;
  per_input_similarity: number[];
  passed: boolean;
  score: number;
};

function fail(msg: string): never {
  /**
   * Errors straight to stderr so the JSON line on stdout is never polluted.
   */
  console.error(`score.ts: ${msg}`);
  process.exit(1);
}

async function main() {
  const candidatePath = process.argv[2];
  const dir = process.argv[3];

  if (!candidatePath || !dir) {
    fail(
      "Usage: npx tsx src/score.ts <candidate-file> <prompt-directory>\n" +
        "Example: npx tsx src/score.ts prompts/cursor/candidate.txt prompts/cursor",
    );
  }

  if (!existsSync(candidatePath))
    fail(`Candidate file not found: ${candidatePath}`);

  const inputsPath = join(dir, "inputs.jsonl");
  const baselinePath = join(dir, "baseline.jsonl");

  if (!existsSync(inputsPath)) fail(`Missing ${inputsPath}`);
  if (!existsSync(baselinePath)) {
    fail(
      `Missing ${baselinePath}. Run baseline.ts first:\n` +
        `  npx tsx src/baseline.ts ${dir}`,
    );
  }

  // Load the candidate.
  const candidate = readFileSync(candidatePath, "utf-8");
  if (candidate.trim().length === 0) {
    fail(`Candidate file is empty: ${candidatePath}`);
  }

  // Load inputs.
  const inputs: string[] = readFileSync(inputsPath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        const parsed = JSON.parse(l) as { input: string };
        if (typeof parsed.input !== "string")
          throw new Error("missing 'input'");
        return parsed.input;
      } catch (e) {
        fail(`Bad ${inputsPath} line ${i + 1}: ${(e as Error).message}`);
      }
    });

  // Load the baseline but never modify the records as that's what we're scoring against.
  const baseline: BaselineRecord[] = readFileSync(baselinePath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        const parsed = JSON.parse(l) as BaselineRecord;
        if (
          typeof parsed.input !== "string" ||
          typeof parsed.output !== "string"
        ) {
          throw new TypeError("missing 'input' or 'output'");
        }
        return parsed;
      } catch (e) {
        fail(`Bad ${baselinePath} line ${i + 1}: ${(e as Error).message}`);
      }
    });

  if (inputs.length !== baseline.length) {
    fail(
      `Mismatch: ${inputs.length} inputs vs ${baseline.length} baseline records. ` +
        `If you changed inputs.jsonl after generating the baseline, regenerate the baseline.`,
    );
  }

  // Sanity check here that there's no drift in the inputs.
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i] !== baseline[i].input) {
      fail(
        `Input ${i + 1} differs between ${inputsPath} and ${baselinePath}. ` +
          `Inputs must match the baseline exactly. Regenerate the baseline if you ` +
          `intentionally changed the inputs.`,
      );
    }
  }

  const candidateOutputs: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    try {
      const { text } = await callModel(candidate, inputs[i]);
      candidateOutputs.push(text);
    } catch (e) {
      fail(`OpenAI call failed on input ${i + 1}: ${(e as Error).message}`);
    }
  }

  const allOutputs = [...baseline.map((b) => b.output), ...candidateOutputs];
  let embeddings: number[][];
  try {
    embeddings = await embed(allOutputs);
  } catch (e) {
    fail(`Embedding call failed: ${(e as Error).message}`);
  }

  const baselineEmb = embeddings.slice(0, baseline.length);
  const candidateEmb = embeddings.slice(baseline.length);

  const similarities = baselineEmb.map((e, i) => cosine(e, candidateEmb[i]));
  const avgSimilarity =
    similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const minSimilarity = Math.min(...similarities);

  const tokens = countTokens(candidate);
  const passed =
    avgSimilarity >= SIM_THRESHOLD_AVG && minSimilarity >= SIM_THRESHOLD_MIN;

  /**
   * The failures get MAX_SAFE_INTEGER so they always lose any "is this better than current best" comparison the agent does.
   */
  const score = passed ? tokens : Number.MAX_SAFE_INTEGER;

  const result: ScoreOutput = {
    tokens,
    avg_similarity: Number(avgSimilarity.toFixed(4)),
    min_similarity: Number(minSimilarity.toFixed(4)),
    per_input_similarity: similarities.map((s) => Number(s.toFixed(4))),
    passed,
    score,
  };

  console.log(JSON.stringify(result));
}

main().catch((e) => {
  console.error(`score.ts: fatal: ${(e as Error).message}`);
  process.exit(1);
});
