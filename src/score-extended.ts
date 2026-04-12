import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callModel, embed, cosine, countTokens } from "./openai.js";

/**
 * Score a candidate prompt against an extended input set.
 *
 * Unlike score.ts, this:
 * 1. Uses inputs-extended.jsonl instead of inputs.jsonl
 * 2. Generates baselines on-the-fly from the ORIGINAL prompt (fetched via git)
 * 3. Caches baselines to baseline-extended.jsonl
 * 4. Reports per-input breakdown for analysis
 *
 * Usage:
 *   npx tsx src/score-extended.ts <candidate-file> <prompt-directory> [original-commit]
 */

const SIM_THRESHOLD_AVG = 0.92;
const SIM_THRESHOLD_MIN = 0.85;

function fail(msg: string): never {
  console.error(`score-extended.ts: ${msg}`);
  process.exit(1);
}

async function main() {
  const candidatePath = process.argv[2];
  const dir = process.argv[3];
  const originalCommit = process.argv[4] || "f4767a7"; // commit with original prompts

  if (!candidatePath || !dir) {
    fail("Usage: npx tsx src/score-extended.ts <candidate> <dir> [original-commit]");
  }

  const extInputsPath = join(dir, "inputs-extended.jsonl");
  const extBaselinePath = join(dir, "baseline-extended.jsonl");

  if (!existsSync(extInputsPath)) fail(`Missing ${extInputsPath}`);
  if (!existsSync(candidatePath)) fail(`Missing ${candidatePath}`);

  const candidate = readFileSync(candidatePath, "utf-8");
  const inputs: string[] = readFileSync(extInputsPath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { input: string }).input);

  // Generate or load baselines
  type BaselineRecord = { input: string; output: string };
  let baseline: BaselineRecord[];

  if (existsSync(extBaselinePath)) {
    console.error(`Loading cached baselines from ${extBaselinePath}`);
    baseline = readFileSync(extBaselinePath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as BaselineRecord);
  } else {
    // Get original prompt from git
    const { execSync } = await import("child_process");
    const promptName = dir.split("/").pop();
    let originalPrompt: string;
    try {
      originalPrompt = execSync(
        `git show ${originalCommit}:prompts/${promptName}/prompt.txt`,
        { encoding: "utf-8" }
      );
    } catch {
      fail(`Cannot get original prompt from git at ${originalCommit}`);
    }

    console.error(`Generating baselines for ${inputs.length} extended inputs...`);
    baseline = [];
    for (let i = 0; i < inputs.length; i++) {
      process.stderr.write(`  [${i + 1}/${inputs.length}] `);
      const { text } = await callModel(originalPrompt, inputs[i]);
      baseline.push({ input: inputs[i], output: text });
      process.stderr.write(`done\n`);
    }

    const content = baseline.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(extBaselinePath, content);
    console.error(`Cached baselines to ${extBaselinePath}`);
  }

  if (inputs.length !== baseline.length) {
    fail(`Mismatch: ${inputs.length} inputs vs ${baseline.length} baselines`);
  }

  // Score candidate
  console.error(`Scoring candidate (${countTokens(candidate)} tokens)...`);
  const candidateOutputs: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    process.stderr.write(`  [${i + 1}/${inputs.length}] `);
    const { text } = await callModel(candidate, inputs[i]);
    candidateOutputs.push(text);
    process.stderr.write(`done\n`);
  }

  const allOutputs = [...baseline.map((b) => b.output), ...candidateOutputs];
  const embeddings = await embed(allOutputs);
  const baselineEmb = embeddings.slice(0, baseline.length);
  const candidateEmb = embeddings.slice(baseline.length);

  const similarities = baselineEmb.map((e, i) => cosine(e, candidateEmb[i]));
  const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const minSimilarity = Math.min(...similarities);
  const tokens = countTokens(candidate);
  const passed = avgSimilarity >= SIM_THRESHOLD_AVG && minSimilarity >= SIM_THRESHOLD_MIN;

  const result = {
    tokens,
    avg_similarity: Number(avgSimilarity.toFixed(4)),
    min_similarity: Number(minSimilarity.toFixed(4)),
    per_input_similarity: similarities.map((s, i) => ({
      input_num: i + 1,
      similarity: Number(s.toFixed(4)),
      input_preview: inputs[i].slice(0, 80),
    })),
    passed,
    n_inputs: inputs.length,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(`score-extended.ts: fatal: ${(e as Error).message}`);
  process.exit(1);
});
