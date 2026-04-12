import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { callModel, embed, cosine, countTokens } from "./openai.js";

/**
 * Noise floor measurement.
 *
 * Runs the ORIGINAL prompt against the inputs TWICE (two independent samples),
 * then measures cosine similarity between the two runs per input.
 *
 * This gives the ceiling of what any compression could achieve under the
 * scoring function — no compressed version can score higher than the original
 * prompt scores against itself.
 *
 * Does NOT use baseline.jsonl. Both samples are fresh calls, independent of
 * the frozen baseline.
 *
 * Usage:
 *   npx tsx src/noise-floor.ts prompts/v0
 */

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: npx tsx src/noise-floor.ts <prompt-directory>");
    process.exit(1);
  }

  const promptPath = join(dir, "prompt.txt");
  const inputsPath = join(dir, "inputs.jsonl");

  if (!existsSync(promptPath)) {
    console.error(`Missing ${promptPath}`);
    process.exit(1);
  }
  if (!existsSync(inputsPath)) {
    console.error(`Missing ${inputsPath}`);
    process.exit(1);
  }

  // IMPORTANT: this reads the CURRENT prompt.txt, which after the run has
  // been overwritten with the compressed version. For a true noise-floor
  // measurement, you want the ORIGINAL prompt. Restore it from git first:
  //   git show <pre-experiment-commit>:prompts/<name>/prompt.txt > /tmp/<name>-original.txt
  // Or run this script BEFORE starting the compression run.
  const prompt = readFileSync(promptPath, "utf-8");
  const inputs: string[] = readFileSync(inputsPath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { input: string }).input);

  console.error(`Noise floor: ${dir}`);
  console.error(`  Prompt: ~${countTokens(prompt)} tokens`);
  console.error(`  Inputs: ${inputs.length}`);
  console.error(`  Running each input twice, independently...`);
  console.error("");

  const runA: string[] = [];
  const runB: string[] = [];

  for (let i = 0; i < inputs.length; i++) {
    process.stderr.write(`  [${i + 1}/${inputs.length}] A... `);
    const { text: textA } = await callModel(prompt, inputs[i]);
    runA.push(textA);
    process.stderr.write(`B... `);
    const { text: textB } = await callModel(prompt, inputs[i]);
    runB.push(textB);
    process.stderr.write(`done\n`);
  }

  console.error("");
  console.error("Computing embeddings...");
  const allOutputs = [...runA, ...runB];
  const embeddings = await embed(allOutputs);
  const embA = embeddings.slice(0, runA.length);
  const embB = embeddings.slice(runA.length);

  const similarities = embA.map((e, i) => cosine(e, embB[i]));
  const avgSimilarity =
    similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const minSimilarity = Math.min(...similarities);
  const maxSimilarity = Math.max(...similarities);

  const result = {
    directory: dir,
    prompt_tokens: countTokens(prompt),
    n_inputs: inputs.length,
    avg_self_similarity: Number(avgSimilarity.toFixed(4)),
    min_self_similarity: Number(minSimilarity.toFixed(4)),
    max_self_similarity: Number(maxSimilarity.toFixed(4)),
    per_input_self_similarity: similarities.map((s) => Number(s.toFixed(4))),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(`noise-floor.ts: fatal: ${(e as Error).message}`);
  process.exit(1);
});
