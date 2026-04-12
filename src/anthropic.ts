import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

// Hardcoded for v0.1. Swap this constant if you want a different model.
export const CLAUDE_MODEL = "claude-haiku-4-5";

const client = new Anthropic({
  // Picks up ANTHROPIC_API_KEY from the environment automatically,
  // but being explicit makes the error case easier to debug.
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function callClaude(
  systemPrompt: string,
  userInput: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userInput }],
  });

  // content is an array of blocks; for non-tool-use responses it's text blocks.
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    text,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}
