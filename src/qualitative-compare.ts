import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { callModel, countTokens } from "./openai.js";

/**
 * Qualitative comparison: generate side-by-side outputs from original and
 * compressed prompts on 3 new inputs. Produces a human-readable markdown
 * document for manual inspection.
 *
 * Usage:
 *   npx tsx src/qualitative-compare.ts <prompt-directory> [original-ref]
 */

async function main() {
  const dir = process.argv[2];
  const originalRef = process.argv[3] || "original-prompts";

  if (!dir) {
    console.error("Usage: npx tsx src/qualitative-compare.ts <prompt-directory> [original-ref]");
    process.exit(1);
  }

  const promptName = dir.split("/").pop()!;
  const compressedPrompt = readFileSync(join(dir, "prompt.txt"), "utf-8");

  const { execSync } = await import("child_process");
  const originalPrompt = execSync(
    `git show ${originalRef}:prompts/${promptName}/prompt.txt`,
    { encoding: "utf-8" }
  );

  // Use the first 3 extended inputs for qualitative comparison
  const extInputsPath = join(dir, "inputs-extended.jsonl");
  const inputs: string[] = readFileSync(extInputsPath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((l) => (JSON.parse(l) as { input: string }).input);

  const origTokens = countTokens(originalPrompt);
  const compTokens = countTokens(compressedPrompt);

  let md = `# Qualitative Comparison: ${promptName}\n\n`;
  md += `Original: ${origTokens} tokens | Compressed: ${compTokens} tokens | Reduction: ${((1 - compTokens / origTokens) * 100).toFixed(1)}%\n\n`;
  md += `Model: gpt-4o-mini, temperature 0\n\n---\n\n`;

  for (let i = 0; i < inputs.length; i++) {
    console.error(`[${i + 1}/${inputs.length}] Generating...`);

    const { text: origOutput } = await callModel(originalPrompt, inputs[i]);
    const { text: compOutput } = await callModel(compressedPrompt, inputs[i]);

    md += `## Input ${i + 1}\n\n`;
    md += `> ${inputs[i].slice(0, 200)}${inputs[i].length > 200 ? '...' : ''}\n\n`;
    md += `### Original prompt output\n\n`;
    md += origOutput + '\n\n';
    md += `### Compressed prompt output\n\n`;
    md += compOutput + '\n\n';
    md += `---\n\n`;
  }

  const outPath = `results/analysis/qualitative-${promptName}.md`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, md);
  console.error(`Wrote ${outPath}`);
  console.log(outPath);
}

main().catch((e) => {
  console.error(`qualitative-compare.ts: fatal: ${(e as Error).message}`);
  process.exit(1);
});
