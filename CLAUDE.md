# Prompt Compression Autoresearch

You are running an autoresearch loop to compress production LLM system prompts while preserving their behaviour.

## Goal

For each prompt directory in `prompts/`, find the shortest possible version of `prompt.txt` that still passes the scoring constraint:

- Average semantic similarity ≥ 0.92 against baseline outputs
- Minimum per-input similarity ≥ 0.85

Token count is what you are minimising. Lower is better. The scoring script does all the measurement — your job is to propose changes, run the script, and keep or revert based on the result.

## The corpus

These are leaked production system prompts from real AI tools (cursor, v0, devin, perplexity, lovable). They are LONG (2,000–9,000 tokens) and were written by serious teams. Do not assume they are full of fat. Some sections are load-bearing in non-obvious ways. Compress carefully and check the result of every change.

## The loop

Process the prompts in this order: v0, devin, lovable, cursor, perplexity.

For each prompt directory, repeat until a stopping condition is hit:

1. Read the current `prompts/{name}/prompt.txt`. Note its token count.
2. Read `results/{name}.jsonl` if it exists, to see what has already been tried. Do not repeat strategies that already failed.
3. Propose a shorter version. Save it to `prompts/{name}/candidate.txt`.
4. Run: `npx tsx src/score.ts prompts/{name}/candidate.txt prompts/{name}`
5. Read the JSON output from stdout.
6. If `passed` is `true` AND `tokens` is less than the current `prompt.txt` token count:
   - Copy `candidate.txt` over `prompt.txt`
   - Append a result line to `results/{name}.jsonl` with `kept: true`
   - Run `git add prompts/{name}/prompt.txt results/{name}.jsonl`
   - Run `git commit -m "compress {name}: <old> -> <new> tokens"`
7. If `passed` is `false` OR `tokens` is not lower:
   - Append a result line to `results/{name}.jsonl` with `kept: false`
   - Do NOT modify `prompt.txt`
   - Do NOT commit
8. Delete `candidate.txt`.
9. Move to the next iteration.

## Stopping conditions

Stop working on a prompt when ANY of these are true:

- 25 iterations completed on this prompt
- 5 consecutive iterations have failed to improve the score
- The prompt is below 25% of its original token count (further compression risks breaking behaviours that the 8 test inputs do not exercise)

When stopping a prompt, append a final summary line to `results/{name}.jsonl`:

```json
{
  "summary": true,
  "final_tokens": 2140,
  "original_tokens": 4280,
  "reduction_pct": 50.0,
  "iterations": 23
}
```

Then move to the next prompt directory. After all 5 prompts are processed, stop.

## Hard constraints

- Only modify files in `prompts/{name}/prompt.txt` and `results/{name}.jsonl`.
- NEVER touch `inputs.jsonl` or `baseline.jsonl`. They are ground truth.
- NEVER touch anything in `src/`.
- NEVER modify CLAUDE.md.
- One change per iteration. A "change" is a single edit to a single section of the prompt. If you want to make edits to two different sections, do them in two separate iterations. Always commit successful changes before starting the next iteration.
- If `score.ts` errors out, log the error in results and skip the iteration.
- Do not retry the same change twice. Each iteration costs real money.

## Result log format

One JSON object per line in `results/{name}.jsonl`. Required fields:

```json
{
  "iteration": 1,
  "tokens": 4280,
  "avg_similarity": 0.94,
  "min_similarity": 0.88,
  "passed": true,
  "kept": true,
  "strategy": "removed the 12-line preamble about being a helpful assistant"
}
```

The `strategy` field is a one-sentence description of what you tried. Be specific. "Made shorter" is useless. "Removed the entire 'communication style' section because it contained 8 sub-rules about formatting that the inputs do not exercise" is useful. The strategy field is what makes the results readable as a research log later — write it for someone who will read 25 of these in a row and want to understand what happened.

## Strategies for long production prompts

These prompts are longer and more structured than tutorial prompts. Strategies that work on short prompts may not apply. Roughly in order of safety:

1. Remove redundant filler: "please", "make sure to", "remember", "it's important that"
2. Compress repetitive examples — if there are 5 examples making the same point, remove 2 or 3 and check whether the remaining ones are enough
3. Combine related rules into single sentences
4. Remove sections that restate something already obvious from earlier context
5. Compress role-setting preamble (often 100–300 tokens of "you are a…")
6. Look for sections that contradict or duplicate each other — leaked prompts sometimes accumulate cruft across versions
7. Try removing entire numbered rules one at a time. If a rule's removal does not drop similarity, it was not load-bearing for these specific inputs
8. For tool-use sections, check whether tool descriptions can be terser
9. Remove specific examples that are not exercised by any of the 8 test inputs
10. Compress lists into comma-separated form where readability allows

When you find a strategy that works, push that direction further. When you find one that breaks `min_similarity`, the lesson is "this part of the prompt is load-bearing for at least one input" — record what failed and try something different. Do not keep trying minor variants of a failed approach.

## What not to do

- Do not remove safety instructions, refusal language, or content policies even if removing them would pass the scoring threshold. The scoring
  threshold cannot detect every kind of behavioural change. Safety sections stay.
- Do not delete anything that mentions tool names, tool schemas, or tool syntax — these are load-bearing for any input that exercises tool use, even if your sample of 8 inputs does not happen to.
- Do not rewrite the prompt from scratch. Each iteration should be a
  recognisable edit of the previous version. If you find yourself wanting to start over, that is the signal to move to the next prompt instead.
- Do not edit `inputs.jsonl` or `baseline.jsonl` under any circumstances, even if you think you have a good reason.
