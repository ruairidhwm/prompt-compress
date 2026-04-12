import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callClaude, CLAUDE_MODEL } from "./anthropic.js";
import { embed, cosine, countTokens } from "./openai.js";

/**
 * Cross-model validation: score a compressed prompt using Claude instead of GPT-4o-mini.
 *
 * Generates a Claude baseline from the original prompt (via git), then scores
 * the compressed version against it. This tests whether compressions that
 * pass on GPT-4o-mini also hold on a different model family.
 *
 * Usage:
 *   npx tsx src/score-claude.ts <candidate-file> <prompt-directory> [original-commit]
 */

const SIM_THRESHOLD_AVG = 0.92;
const SIM_THRESHOLD_MIN = 0.85;

function fail(msg: string): never {
  console.error(`score-claude.ts: ${msg}`);
  process.exit(1);
}

async function main() {
  const candidatePath = process.argv[2];
  const dir = process.argv[3];
  const originalCommit = process.argv[4] || "f4767a7";

  if (!candidatePath || !dir) {
    fail("Usage: npx tsx src/score-claude.ts <candidate> <dir> [original-commit]");
  }

  const inputsPath = join(dir, "inputs.jsonl");
  const claudeBaselinePath = join(dir, "baseline-claude.jsonl");

  if (!existsSync(inputsPath)) fail(`Missing ${inputsPath}`);
  if (!existsSync(candidatePath)) fail(`Missing ${candidatePath}`);

  const candidate = readFileSync(candidatePath, "utf-8");
  const inputs: string[] = readFileSync(inputsPath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { input: string }).input);

  type BaselineRecord = { input: string; output: string };
  let baseline: BaselineRecord[];

  if (existsSync(claudeBaselinePath)) {
    console.error(`Loading cached Claude baselines from ${claudeBaselinePath}`);
    baseline = readFileSync(claudeBaselinePath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as BaselineRecord);
  } else {
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

    console.error(`Generating Claude (${CLAUDE_MODEL}) baselines for ${inputs.length} inputs...`);
    baseline = [];
    for (let i = 0; i < inputs.length; i++) {
      process.stderr.write(`  [${i + 1}/${inputs.length}] `);
      const { text } = await callClaude(originalPrompt, inputs[i]);
      baseline.push({ input: inputs[i], output: text });
      process.stderr.write(`done\n`);
    }

    const content = baseline.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(claudeBaselinePath, content);
    console.error(`Cached baselines to ${claudeBaselinePath}`);
  }

  // Score compressed prompt on Claude
  console.error(`Scoring compressed prompt on Claude (${CLAUDE_MODEL})...`);
  const candidateOutputs: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    process.stderr.write(`  [${i + 1}/${inputs.length}] `);
    const { text } = await callClaude(candidate, inputs[i]);
    candidateOutputs.push(text);
    process.stderr.write(`done\n`);
  }

  // Embed and compare (still using OpenAI embeddings for apples-to-apples)
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
    model: CLAUDE_MODEL,
    tokens,
    avg_similarity: Number(avgSimilarity.toFixed(4)),
    min_similarity: Number(minSimilarity.toFixed(4)),
    per_input_similarity: similarities.map((s) => Number(s.toFixed(4))),
    passed,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(`score-claude.ts: fatal: ${(e as Error).message}`);
  process.exit(1);
});
