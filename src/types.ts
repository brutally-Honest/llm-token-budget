/** Central type definitions. All other modules import from here. */

export type ModelKey =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | "gemini-2-5-flash"
  | "gemini-2-0-flash"
  | "deepseek-v3";

export interface ModelConfig {
  label: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextWindow: number;
  supportsCaching: boolean;
  cacheWriteMultiplier: number;
  cacheReadMultiplier: number;
  minCacheTokens: number;
  tokenCorrectionFactor: number; // empirical multiplier vs tiktoken cl100k_base
}

export interface TokenProfile {
  totalTokens: number;
  avgCharsPerToken: string;
  density: "high (code/symbols)" | "normal" | "low (simple prose)";
}

export interface CostBreakdown {
  model: string;
  modelKey: ModelKey;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  freshInputCost: number;
  cacheWriteCost: number;
  cacheReadCost: number;
  outputCost: number;
  totalCostNoCache: number;
  totalCostCacheWrite: number;
  totalCostCacheRead: number;
  supportsCaching: boolean;
  cacheViable: boolean;
}

export interface DailyProjection {
  volume: number;
  dailyCostNoCache: number;
  dailyCostWithCache: number;
  monthlyCostWithCache: number;
  dailySaving: number;
}

export type MessageRole = "system" | "user" | "assistant";

export interface Message {
  role: MessageRole;
  content: string;
}

export type OverflowStrategy = "truncate_oldest" | "summarize" | "reject" | "warn";

export interface PreflightResult {
  safe: boolean;
  totalTokens: number;
  hardLimit: number;
  softLimit: number;
  availableTokens: number;
  utilizationPct: number;
  truncated: boolean;
  droppedMessages: number;
  strategy: OverflowStrategy;
  messages: Message[];
  warning?: string;
}

export type ContextStatus = "OK" | "MODERATE" | "WARNING" | "CRITICAL";

export interface ContextUsage {
  used: number;
  limit: number;
  percentage: string;
  status: ContextStatus;
}

export interface CacheAnalysis {
  modelKey: ModelKey;
  systemPromptTokens: number;
  dailyCallVolume: number;
  cacheable: boolean;
  cacheViableReason: string;
  costWithoutCache: number;
  costWithCache: number;
  dailySaving: number;
  breakEvenCallCount: number;
  monthlyProjectedSaving: number;
}
