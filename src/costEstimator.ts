/**
 * costEstimator.ts
 *
 * Cost math on top of token counts: single-call breakdown, daily projections,
 * and cache viability analysis.
 */

import type { ModelKey, CostBreakdown, DailyProjection, ContextUsage, ContextStatus, CacheAnalysis } from "./types";
import { MODEL_CONFIGS } from "./models";
import { countTokensForModel } from "./tokenizer";

/**
 * Full cost breakdown for a single API call.
 * cachedTokens is the portion of inputTokens expected to be cache hits.
 */
export function estimateCost(
  modelKey: ModelKey,
  inputTokens: number,
  outputTokens: number = 500,
  cachedTokens: number = 0
): CostBreakdown {
  const config = MODEL_CONFIGS[modelKey];
  const freshInputTokens = Math.max(0, inputTokens - cachedTokens);

  const cacheViable = config.supportsCaching && cachedTokens >= config.minCacheTokens;

  const freshInputCost = (freshInputTokens / 1_000_000) * config.inputPricePer1M;

  const cacheWriteCost = cacheViable
    ? (cachedTokens / 1_000_000) * config.inputPricePer1M * config.cacheWriteMultiplier
    : (cachedTokens / 1_000_000) * config.inputPricePer1M;

  const cacheReadCost = cacheViable
    ? (cachedTokens / 1_000_000) * config.inputPricePer1M * config.cacheReadMultiplier
    : (cachedTokens / 1_000_000) * config.inputPricePer1M;

  const outputCost = (outputTokens / 1_000_000) * config.outputPricePer1M;

  const totalCostNoCache = freshInputCost + ((cachedTokens / 1_000_000) * config.inputPricePer1M) + outputCost;
  const totalCostCacheWrite = freshInputCost + cacheWriteCost + outputCost;
  const totalCostCacheRead = freshInputCost + cacheReadCost + outputCost;

  return {
    model: config.label,
    modelKey,
    inputTokens,
    outputTokens,
    cachedTokens,
    freshInputCost,
    cacheWriteCost,
    cacheReadCost,
    outputCost,
    totalCostNoCache,
    totalCostCacheWrite,
    totalCostCacheRead,
    supportsCaching: config.supportsCaching,
    cacheViable,
  };
}

/** Daily/monthly cost projections. Caching scenario: call 1 = write, calls 2..N = reads. */
export function projectDailyCost(
  breakdown: CostBreakdown,
  callVolumes: number[] = [50, 200, 1000]
): DailyProjection[] {
  return callVolumes.map((volume) => {
    const dailyCostNoCache = breakdown.totalCostNoCache * volume;

    const dailyCostWithCache = breakdown.cacheViable
      ? breakdown.totalCostCacheWrite + (volume - 1) * breakdown.totalCostCacheRead
      : dailyCostNoCache;

    return {
      volume,
      dailyCostNoCache,
      dailyCostWithCache,
      monthlyCostWithCache: dailyCostWithCache * 30,
      dailySaving: dailyCostNoCache - dailyCostWithCache,
    };
  });
}

/** OK <40%, MODERATE 40-70%, WARNING 70-90%, CRITICAL >90%. */
export function contextUsage(tokenCount: number, modelKey: ModelKey): ContextUsage {
  const config = MODEL_CONFIGS[modelKey];
  const percentage = (tokenCount / config.contextWindow) * 100;

  let status: ContextStatus;
  if (percentage > 90) status = "CRITICAL";
  else if (percentage > 70) status = "WARNING";
  else if (percentage > 40) status = "MODERATE";
  else status = "OK";

  return {
    used: tokenCount,
    limit: config.contextWindow,
    percentage: percentage.toFixed(2),
    status,
  };
}

/**
 * Given system prompt size and daily call volume: whether cache activates,
 * daily/monthly savings, and break-even call count.
 */
export function analyzeCacheViability(
  modelKey: ModelKey,
  systemPromptText: string,
  dailyCallVolume: number,
  estimatedOutputTokens: number = 500
): CacheAnalysis {
  const config = MODEL_CONFIGS[modelKey];
  const systemPromptTokens = countTokensForModel(systemPromptText, modelKey);
  const cacheable = systemPromptTokens >= config.minCacheTokens;

  if (!cacheable) {
    return {
      modelKey,
      systemPromptTokens,
      dailyCallVolume,
      cacheable: false,
      cacheViableReason: `System prompt is ${systemPromptTokens} tokens. Minimum required: ${config.minCacheTokens}. Pad your system prompt or add tool definitions to hit the threshold.`,
      costWithoutCache: 0,
      costWithCache: 0,
      dailySaving: 0,
      breakEvenCallCount: 0,
      monthlyProjectedSaving: 0,
    };
  }

  const outputCostPerCall = (estimatedOutputTokens / 1_000_000) * config.outputPricePer1M;
  const systemCostNoCache = (systemPromptTokens / 1_000_000) * config.inputPricePer1M;
  const systemCostWrite   = (systemPromptTokens / 1_000_000) * config.inputPricePer1M * config.cacheWriteMultiplier;
  const systemCostRead    = (systemPromptTokens / 1_000_000) * config.inputPricePer1M * config.cacheReadMultiplier;

  const costWithoutCache = (systemCostNoCache + outputCostPerCall) * dailyCallVolume;
  const costWithCache    = systemCostWrite + (dailyCallVolume - 1) * (systemCostRead + outputCostPerCall) + outputCostPerCall;

  const writePremium = systemCostWrite - systemCostRead;
  const savingPerRead = systemCostNoCache - systemCostRead;
  const breakEvenCallCount = savingPerRead > 0 ? Math.ceil(writePremium / savingPerRead) + 1 : 1;

  return {
    modelKey,
    systemPromptTokens,
    dailyCallVolume,
    cacheable: true,
    cacheViableReason: `Cache activates. ${systemPromptTokens} tokens ≥ minimum ${config.minCacheTokens}. Break-even at call ${breakEvenCallCount}.`,
    costWithoutCache,
    costWithCache,
    dailySaving: costWithoutCache - costWithCache,
    breakEvenCallCount,
    monthlyProjectedSaving: (costWithoutCache - costWithCache) * 30,
  };
}
