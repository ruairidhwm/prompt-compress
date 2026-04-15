# prompt-compress

An autoresearch loop for compressing production LLM system prompts while preserving behaviour, and an honest evaluation of why the popular "compress your prompts by 75%" claim doesn't hold up under broader testing.

## What's here

- `prompts/{v0,devin,lovable,cursor,perplexity}/` — leaked production prompts, fixed input sets (`inputs.jsonl`), and frozen baseline outputs (`baseline.jsonl`). Extended adversarial inputs sit alongside as `inputs-extended.jsonl` / `baseline-extended.jsonl`.
- `src/` — scoring, baseline generation, noise-floor measurement, cross-model scoring (Claude), and qualitative side-by-side comparison.
- `results/` — result logs per prompt. `50_cap/` is the first pass (targeting ~50% reduction); top-level `*.jsonl` files are the deeper run (down to ~25% floor). `validation/` contains per-prompt noise-floor measurements. `analysis/` contains the extended-corpus results and qualitative diffs.
- `CLAUDE.md` — loop specification used to drive the compression: stopping conditions, strategies, and hard constraints.

## How the loop works

For each prompt, hill-climb on token count with a semantic-similarity quality gate:

1. Propose one edit to `prompt.txt`, save as `candidate.txt`.
2. `npx tsx src/score.ts prompts/{name}/candidate.txt prompts/{name}` runs the candidate against 8 fixed inputs on `gpt-4o-mini` (temperature 0) and compares each output to the frozen baseline via cosine similarity on `text-embedding-3-small` embeddings.
3. Pass condition: avg similarity ≥ 0.92, min ≥ 0.85. Keep and commit on pass; revert on fail. Log either way.

Stop after 25 iterations, 5 consecutive failures, or once the prompt drops below 25% of its original token count.

## The headline result

63% average compression across 5 prompts passes the 8-input gate. On an 8-input extended corpus targeting under-covered behaviours, every single compressed prompt fails — sometimes badly (min similarity 0.494 on one input). The compression is real; the evaluation wasn't strong enough to catch behavioural regressions. Details in the blog post.

## Reproducing

```bash
npm install
cp .env.example .env   # fill in OPENAI_API_KEY (and optionally ANTHROPIC_API_KEY for cross-model scoring)

# Score a candidate against the original-corpus gate:
npx tsx src/score.ts prompts/v0/candidate.txt prompts/v0

# Score against the extended adversarial corpus:
npx tsx src/score-extended.ts prompts/v0/prompt.txt prompts/v0

# Measure noise floor for a prompt:
npx tsx src/noise-floor.ts prompts/v0
```

## Corpus

The leaked production prompts come from [x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools). Cite that collection if you reuse them.

## License

MIT.
