import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { callModel, countTokens } from "./openai.js";

type InputRecord = { input: string };
type BaselineRecord = {
  input: string;
  output: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: npx tsx src/baseline.ts <prompt-directory>");
    console.error("");
    console.error("Example: npx tsx src/baseline.ts prompts/cursor");
    process.exit(1);
  }

  const promptPath = join(dir, "prompt.txt");
  const inputsPath = join(dir, "inputs.jsonl");
  const baselinePath = join(dir, "baseline.jsonl");

  if (!existsSync(promptPath)) {
    console.error(`Missing ${promptPath}`);
    process.exit(1);
  }
  if (!existsSync(inputsPath)) {
    console.error(`Missing ${inputsPath}`);
    process.exit(1);
  }

  /**
   * Make sure we don't overwrite the baseline as that's what we're scoring against.
   */
  if (existsSync(baselinePath)) {
    console.error(`Refusing to overwrite existing baseline at ${baselinePath}`);
    console.error(`If you really want to regenerate it, delete it first:`);
    console.error(`  rm ${baselinePath}`);
    process.exit(1);
  }

  const prompt = readFileSync(promptPath, "utf-8");
  const inputs: string[] = readFileSync(inputsPath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        const parsed = JSON.parse(l) as InputRecord;
        if (typeof parsed.input !== "string") {
          throw new TypeError("missing 'input' string field");
        }
        return parsed.input;
      } catch (e) {
        console.error(
          `Failed to parse ${inputsPath} line ${i + 1}: ${(e as Error).message}`,
        );
        process.exit(1);
      }
    });

  if (inputs.length === 0) {
    console.error(`${inputsPath} is empty.`);
    process.exit(1);
  }

  const promptTokens = countTokens(prompt);
  console.error(`Prompt: ${promptPath}`);
  console.error(`  ~${promptTokens} tokens (${prompt.length} chars)`);
  console.error(`Inputs: ${inputs.length}`);
  console.error(
    `Generating baseline outputs with gpt-4o-mini at temperature 0...`,
  );
  console.error("");

  const records: BaselineRecord[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < inputs.length; i++) {
    const num = `[${i + 1}/${inputs.length}]`;
    process.stderr.write(`  ${num} `);
    const start = Date.now();
    try {
      const { text, inputTokens, outputTokens } = await callModel(
        prompt,
        inputs[i],
      );
      const latencyMs = Date.now() - start;
      records.push({
        input: inputs[i],
        output: text,
        latencyMs,
        inputTokens,
        outputTokens,
      });
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      process.stderr.write(`${latencyMs}ms, ${outputTokens} out tokens\n`);
    } catch (e) {
      process.stderr.write(`FAILED\n`);
      console.error(`  Error: ${(e as Error).message}`);
      console.error(
        `  Aborting. No baseline written. Fix the error and re-run.`,
      );
      process.exit(1);
    }
  }

  // Build the full content first, then write once.
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(baselinePath, content);

  // This is a horribly crude cost estimate but it's only for human-readable output so  ¯\_(ツ)_/¯
  const inputCost = (totalInputTokens / 1000) * 0.00015;
  const outputCost = (totalOutputTokens / 1000) * 0.0006;

  console.error("");
  console.error(`Wrote ${records.length} baseline records to ${baselinePath}`);
  console.error(`  Total input tokens:  ${totalInputTokens.toLocaleString()}`);
  console.error(`  Total output tokens: ${totalOutputTokens.toLocaleString()}`);
  console.error(
    `  Estimated cost:      $${(inputCost + outputCost).toFixed(4)}`,
  );
  console.error("");
  console.error(`Baseline is now FROZEN. Do not modify or regenerate it.`);
  console.error(
    `Commit it: git add ${baselinePath} && git commit -m "baseline: ${dir}"`,
  );
}

main().catch((e) => {
  console.error("Fatal:", (e as Error).message);
  process.exit(1);
});
