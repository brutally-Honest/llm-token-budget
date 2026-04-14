/**
 * tokenizer.ts
 *
 * Token counting via tiktoken (cl100k_base) with per-model correction factors.
 * For billing-critical paths use the provider's native count endpoint instead.
 */

import { get_encoding, type Tiktoken } from "tiktoken";
import type { ModelKey, TokenProfile } from "./types";
import { MODEL_CONFIGS } from "./models";

let enc: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!enc) {
    enc = get_encoding("cl100k_base");
  }
  return enc;
}

export function countTokens(text: string): number {
  return getEncoder().encode(text).length;
}

/**
 * Token count adjusted for a specific model's tokenizer via empirical correction factor.
 * 1.05 = Claude tokenizes ~5% more tokens than tiktoken reports.
 */
export function countTokensForModel(text: string, modelKey: ModelKey): number {
  const base = countTokens(text);
  const factor = MODEL_CONFIGS[modelKey].tokenCorrectionFactor;
  return Math.ceil(base * factor);
}

/**
 * Classify token density: <3 chars/token = high (code), >4.5 = low (prose), else normal.
 */
export function tokenProfile(text: string): TokenProfile {
  const totalTokens = countTokens(text);
  const avgCharsPerToken = text.length / totalTokens;

  let density: TokenProfile["density"];
  if (avgCharsPerToken < 3) {
    density = "high (code/symbols)";
  } else if (avgCharsPerToken > 4.5) {
    density = "low (simple prose)";
  } else {
    density = "normal";
  }

  return {
    totalTokens,
    avgCharsPerToken: avgCharsPerToken.toFixed(2),
    density,
  };
}
