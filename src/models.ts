/**
 * models.ts
 *
 * 2026 pricing, context windows, and caching parameters for major LLM providers.
 * Source: official provider pricing pages, verified April 2026.
 *
 * Key changes from 2024/2025:
 *   - GPT-4o pricing unchanged at $2.50/$10.00 (OpenAI held the line)
 *   - Claude Sonnet 4.6 at $3.00/$15.00, now with 1M context window
 *   - Gemini 2.5 Flash dramatically cheaper at $0.30/$2.50 with implicit caching
 *   - DeepSeek V3 added as the sub-$0.30 option for high-volume, lower-stakes tasks
 *   - Haiku 4.5 added as Claude's budget tier
 *
 * Caching notes (important for the middleware):
 *   - Anthropic: EXPLICIT — you must add cache_control to your API call
 *   - OpenAI: IMPLICIT — automatic, no code change needed, 10x discount on cache hits
 *   - Gemini 2.5: IMPLICIT — automatic, cache reads at 0.25x
 *   - DeepSeek: IMPLICIT — automatic, no configuration needed
 */

import type { ModelKey, ModelConfig } from "./types";

export const MODEL_CONFIGS: Record<ModelKey, ModelConfig> = {
  "gpt-4o": {
    label: "GPT-4o (OpenAI)",
    inputPricePer1M: 2.5,
    outputPricePer1M: 10.0,
    contextWindow: 128_000,
    supportsCaching: true,
    cacheWriteMultiplier: 1.0,
    cacheReadMultiplier: 0.5,
    minCacheTokens: 1024,
    tokenCorrectionFactor: 1.0,
  },

  "gpt-4o-mini": {
    label: "GPT-4o Mini (OpenAI)",
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
    contextWindow: 128_000,
    supportsCaching: true,
    cacheWriteMultiplier: 1.0,
    cacheReadMultiplier: 0.5,
    minCacheTokens: 1024,
    tokenCorrectionFactor: 1.0,
  },

  "claude-sonnet-4-6": {
    label: "Claude Sonnet 4.6 (Anthropic)",
    inputPricePer1M: 3.0,
    outputPricePer1M: 15.0,
    contextWindow: 1_000_000,
    supportsCaching: true,
    cacheWriteMultiplier: 1.25, // explicit: 1.25x write premium, 5-min TTL
    cacheReadMultiplier: 0.1,   // explicit: 90% read discount
    minCacheTokens: 1024,
    tokenCorrectionFactor: 1.05,
  },

  "claude-haiku-4-5": {
    label: "Claude Haiku 4.5 (Anthropic)",
    inputPricePer1M: 0.25,
    outputPricePer1M: 1.25,
    contextWindow: 200_000,
    supportsCaching: true,
    cacheWriteMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
    minCacheTokens: 4096, // higher threshold than Sonnet
    tokenCorrectionFactor: 1.05,
  },

  "gemini-2-5-flash": {
    label: "Gemini 2.5 Flash (Google)",
    inputPricePer1M: 0.3,
    outputPricePer1M: 2.5,
    contextWindow: 1_000_000,
    supportsCaching: true,
    cacheWriteMultiplier: 1.0,
    cacheReadMultiplier: 0.25,
    minCacheTokens: 1028,
    tokenCorrectionFactor: 1.1, // SentencePiece splits more on code/symbols
  },

  "gemini-2-0-flash": {
    label: "Gemini 2.0 Flash (Google)",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.4,
    contextWindow: 1_000_000,
    supportsCaching: true,
    cacheWriteMultiplier: 1.0,
    cacheReadMultiplier: 0.25,
    minCacheTokens: 4096,
    tokenCorrectionFactor: 1.1,
  },

  "deepseek-v3": {
    label: "DeepSeek V3 (DeepSeek)",
    inputPricePer1M: 0.27,
    outputPricePer1M: 1.1,
    contextWindow: 128_000,
    supportsCaching: true,
    cacheWriteMultiplier: 1.0,
    cacheReadMultiplier: 0.1,
    minCacheTokens: 0,
    tokenCorrectionFactor: 1.08,
  },
};

export const ALL_MODELS = Object.keys(MODEL_CONFIGS) as ModelKey[];
