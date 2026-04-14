/**
 * contextGuard.ts
 *
 * Pre-flight middleware that detects context window overflow before the API call.
 * Gemini may silently truncate on overflow; Anthropic/OpenAI return 400s. Guard against all three.
 *
 * Soft limit = hard limit - reservedOutputTokens. The window is shared between input and output,
 * so always reserve space for the response (1k chat, 4-8k analysis, 8-16k agent steps).
 *
 * Strategies: truncate_oldest (drop oldest non-system msgs), reject (throw), warn (dev only).
 */

import type { Message, OverflowStrategy, PreflightResult, ModelKey } from "./types";
import { MODEL_CONFIGS } from "./models";
import { countTokens } from "./tokenizer";

// Every message has ~4 tokens of overhead for the role label + formatting
const MESSAGE_OVERHEAD_TOKENS = 4;

function tokenizeMessages(messages: Message[]): (Message & { tokens: number })[] {
  return messages.map((m) => ({
    ...m,
    tokens: countTokens(m.content) + MESSAGE_OVERHEAD_TOKENS,
  }));
}

/** Run before every LLM API call. Applies overflow strategy if total tokens exceed soft limit. */
export function preflightCheck(
  messages: Message[],
  modelKey: ModelKey,
  reservedOutputTokens: number = 1000,
  strategy: OverflowStrategy = "truncate_oldest"
): PreflightResult {
  const config = MODEL_CONFIGS[modelKey];
  const hardLimit = config.contextWindow;
  const softLimit = hardLimit - reservedOutputTokens;

  let withTokens = tokenizeMessages(messages);
  const totalTokens = withTokens.reduce((sum, m) => sum + m.tokens, 0);

  if (totalTokens <= softLimit) {
    return {
      safe: true,
      totalTokens,
      hardLimit,
      softLimit,
      availableTokens: softLimit - totalTokens,
      utilizationPct: parseFloat(((totalTokens / hardLimit) * 100).toFixed(2)),
      truncated: false,
      droppedMessages: 0,
      strategy,
      messages,
    };
  }

  if (strategy === "warn") {
    return {
      safe: false,
      totalTokens,
      hardLimit,
      softLimit,
      availableTokens: 0,
      utilizationPct: parseFloat(((totalTokens / hardLimit) * 100).toFixed(2)),
      truncated: false,
      droppedMessages: 0,
      strategy,
      messages,
      warning: `[contextGuard] WARN: ${totalTokens} tokens exceeds soft limit of ${softLimit}. Proceeding anyway — the provider may reject this call.`,
    };
  }

  if (strategy === "reject") {
    const excess = totalTokens - softLimit;
    throw new Error(
      `[contextGuard] OVERFLOW: ${totalTokens} tokens exceeds soft limit of ${softLimit} ` +
      `(hard limit: ${hardLimit}, reserved output: ${reservedOutputTokens}). ` +
      `Reduce input by ${excess} tokens before calling the API.`
    );
  }

  // System prompt is never truncated
  let droppedMessages = 0;
  while (withTokens.reduce((s, m) => s + m.tokens, 0) > softLimit) {
    const firstNonSystem = withTokens.findIndex((m) => m.role !== "system");
    if (firstNonSystem === -1) {
      throw new Error(
        `[contextGuard] FATAL: System prompt alone (${withTokens[0].tokens} tokens) ` +
        `exceeds soft limit of ${softLimit}. Shorten your system prompt.`
      );
    }
    withTokens.splice(firstNonSystem, 1);
    droppedMessages++;
  }

  const finalTokens = withTokens.reduce((s, m) => s + m.tokens, 0);
  const cleanMessages: Message[] = withTokens.map(({ role, content }) => ({ role, content }));

  return {
    safe: true,
    totalTokens: finalTokens,
    hardLimit,
    softLimit,
    availableTokens: softLimit - finalTokens,
    utilizationPct: parseFloat(((finalTokens / hardLimit) * 100).toFixed(2)),
    truncated: true,
    droppedMessages,
    strategy,
    messages: cleanMessages,
    warning: `Dropped ${droppedMessages} message(s) to fit within context limit.`,
  };
}

/**
 * Returns a token-budgeted window from full chat history.
 * Always includes the system prompt; walks backwards from most recent to fill the budget.
 */
export function slidingWindowContext(
  fullHistory: Message[],
  modelKey: ModelKey,
  inputBudgetFraction: number = 0.7
): { window: Message[]; droppedCount: number; usedTokens: number } {
  const config = MODEL_CONFIGS[modelKey];
  const budget = Math.floor(config.contextWindow * inputBudgetFraction);

  const systemMessages = fullHistory.filter((m) => m.role === "system");
  const conversation   = fullHistory.filter((m) => m.role !== "system");

  const systemTokens = systemMessages.reduce(
    (s, m) => s + countTokens(m.content) + MESSAGE_OVERHEAD_TOKENS,
    0
  );

  let remaining = budget - systemTokens;
  const kept: Message[] = [];

  for (let i = conversation.length - 1; i >= 0; i--) {
    const tokens = countTokens(conversation[i].content) + MESSAGE_OVERHEAD_TOKENS;
    if (remaining - tokens < 0) break;
    kept.unshift(conversation[i]);
    remaining -= tokens;
  }

  const window = [...systemMessages, ...kept];
  const usedTokens = budget - remaining;
  const droppedCount = conversation.length - kept.length;

  return { window, droppedCount, usedTokens };
}
