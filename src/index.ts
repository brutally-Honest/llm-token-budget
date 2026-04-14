/**
 * CLI entry point.
 * Usage: ts-node src/index.ts <file> [--cached N] [--output N] [--volume N]
 *        echo "text" | ts-node src/index.ts --stdin
 */

import fs from "fs";
import chalk from "chalk";
import { tokenProfile, countTokensForModel } from "./tokenizer";
import { estimateCost, projectDailyCost, contextUsage, analyzeCacheViability } from "./costEstimator";
import { preflightCheck, slidingWindowContext } from "./contextGuard";
import { MODEL_CONFIGS, ALL_MODELS } from "./models";
import type { ModelKey, ContextStatus } from "./types";

const args = process.argv.slice(2);
const stdinMode = args.includes("--stdin");

function getArg(flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] ?? null : null;
}

const cachedTokens   = parseInt(getArg("--cached")  ?? "0", 10);
const estimatedOutput = parseInt(getArg("--output")  ?? "500", 10);
const dailyVolume    = parseInt(getArg("--volume")   ?? "200", 10);

let inputText = "";

if (stdinMode) {
  inputText = fs.readFileSync("/dev/stdin", "utf8");
} else {
  const filePath = args.find((a) => !a.startsWith("--") && isNaN(Number(a)));
  if (!filePath) {
    console.error(chalk.red("Usage: ts-node src/index.ts <file> [--cached N] [--output N] [--volume N]"));
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`File not found: ${filePath}`));
    process.exit(1);
  }
  inputText = fs.readFileSync(filePath, "utf8");
}

const hr = (char = "─", w = 64) => chalk.dim(char.repeat(w));

function statusBadge(status: ContextStatus): string {
  const labels: Record<ContextStatus, () => string> = {
    CRITICAL: () => chalk.bgRed.white.bold(" CRITICAL "),
    WARNING:  () => chalk.bgYellow.black(" WARNING "),
    MODERATE: () => chalk.yellow("MODERATE"),
    OK:       () => chalk.green("OK"),
  };
  return labels[status]();
}

function progressBar(pct: number, width = 22): string {
  const filled = Math.round((pct / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  if (pct > 90) return chalk.red(bar);
  if (pct > 70) return chalk.yellow(bar);
  return chalk.green(bar);
}

function usd(n: number): string {
  if (n === 0) return chalk.dim("$0.00");
  if (n < 0.001) return chalk.green(`$${(n * 1000).toFixed(3)}m`);
  return chalk.cyan(`$${n.toFixed(5)}`);
}

function usdPerDay(n: number): string {
  const s = `$${n.toFixed(2)}/day`;
  if (n > 20)  return chalk.red(s);
  if (n > 5)   return chalk.yellow(s);
  return chalk.green(s);
}

console.log("\n" + chalk.bold("LLM Token Budget Report (2026 Pricing)"));
console.log(chalk.dim(`Input: ${inputText.length} chars | Output est: ${estimatedOutput} tokens | Cached prefix: ${cachedTokens} tokens | Volume: ${dailyVolume} calls/day\n`));

console.log(chalk.bold("Token Profile"));
console.log(hr());
const profile = tokenProfile(inputText);
console.log(`  Base token count (cl100k):   ${chalk.cyan(profile.totalTokens)}`);
console.log(`  Avg chars per token:         ${chalk.cyan(profile.avgCharsPerToken)}`);
console.log(`  Token density:               ${chalk.yellow(profile.density)}`);
if (profile.density === "high (code/symbols)") {
  console.log(chalk.dim("  ↳ Dense input. Each token covers very few characters — expected for code/symbols."));
  console.log(chalk.dim("    Chunk this before passing to avoid cost explosion."));
}

console.log("\n" + chalk.bold("Token Count by Model (tokenizer correction applied)"));
console.log(hr());
console.log(chalk.dim("  The tokenizer is the library (tiktoken). These corrections account for each model's"));
console.log(chalk.dim("  own tokenizer — same text, different token counts, different cost.\n"));
for (const m of ALL_MODELS) {
  const count = countTokensForModel(inputText, m);
  const factor = MODEL_CONFIGS[m].tokenCorrectionFactor;
  const correction = factor !== 1.0 ? chalk.dim(` (×${factor} correction)`) : chalk.dim(" (exact — native tokenizer)");
  console.log(`  ${MODEL_CONFIGS[m].label.padEnd(36)} ${chalk.cyan(count.toString().padStart(7))} tokens${correction}`);
}

console.log("\n" + chalk.bold("Context Window Usage"));
console.log(hr());
for (const m of ALL_MODELS) {
  const count = countTokensForModel(inputText, m);
  const usage = contextUsage(count, m);
  const bar   = progressBar(parseFloat(usage.percentage));
  const limitStr = (usage.limit / 1000).toFixed(0) + "k";
  console.log(
    `  ${MODEL_CONFIGS[m].label.padEnd(36)} ${bar} ${usage.percentage.padStart(6)}%  ${statusBadge(usage.status as ContextStatus)}`
  );
  console.log(chalk.dim(`     ${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} tokens (${limitStr} context)`));
}

console.log("\n" + chalk.bold("Cost Breakdown — Single Call"));
console.log(hr());
const costsMap: Record<ModelKey, ReturnType<typeof estimateCost>> = {} as any;

for (const m of ALL_MODELS) {
  const count = countTokensForModel(inputText, m);
  const breakdown = estimateCost(m, count, estimatedOutput, cachedTokens);
  costsMap[m] = breakdown;
  const config = MODEL_CONFIGS[m];

  console.log(`\n  ${chalk.bold(breakdown.model)}`);
  console.log(`    Fresh input:          ${usd(breakdown.freshInputCost)}`);

  if (cachedTokens > 0) {
    if (!breakdown.cacheViable) {
      console.log(`    Cache:                ${chalk.dim(`not activated — ${cachedTokens} tokens < min ${config.minCacheTokens}`)}`);
    } else {
      const cacheType = config.cacheWriteMultiplier === 1.0 ? "implicit" : "explicit";
      console.log(`    Cache write (call 1): ${usd(breakdown.cacheWriteCost)} ${chalk.dim(`(${cacheType}, ×${config.cacheWriteMultiplier} write rate)`)}`);
      console.log(`    Cache read  (call N): ${usd(breakdown.cacheReadCost)} ${chalk.dim(`(×${config.cacheReadMultiplier} read rate — ${((1 - config.cacheReadMultiplier) * 100).toFixed(0)}% cheaper)`)}`);
    }
  }
  console.log(`    Output:               ${usd(breakdown.outputCost)}`);
  console.log(`    ────────────────────────────────────`);
  console.log(`    No cache total:       ${chalk.bold(usd(breakdown.totalCostNoCache))}`);
  if (breakdown.cacheViable) {
    console.log(`    Cache write total:    ${usd(breakdown.totalCostCacheWrite)} ${chalk.dim("(first call)")}`);
    console.log(`    Cache read total:     ${chalk.bold.cyan(usd(breakdown.totalCostCacheRead))} ${chalk.dim("(cache hit calls)")}`);
  }
}

console.log("\n" + chalk.bold("Daily Cost Projection"));
console.log(hr());
const volumes = [50, 200, 1000];
console.log(chalk.dim("  (Caching scenario: call 1 = cache write, calls 2..N = cache reads)\n"));
const colW = 22;
console.log(chalk.dim("  " + "Model".padEnd(36) + volumes.map(v => `${v} calls/day`.padEnd(colW)).join("")));
for (const m of ALL_MODELS) {
  const projections = projectDailyCost(costsMap[m], volumes);
  const row = projections.map(p => usdPerDay(p.dailyCostWithCache).padEnd(colW + 10)).join("");
  console.log(`  ${MODEL_CONFIGS[m].label.padEnd(36)}${row}`);
}

console.log("\n" + chalk.bold("Cache Viability Analysis"));
console.log(hr());
console.log(chalk.dim(`  Based on ${dailyVolume} calls/day with your current input as the system prompt.\n`));

for (const m of ["claude-sonnet-4-6", "gpt-4o", "gemini-2-5-flash", "deepseek-v3"] as ModelKey[]) {
  const analysis = analyzeCacheViability(m, inputText, dailyVolume, estimatedOutput);
  const config = MODEL_CONFIGS[m];

  console.log(`  ${chalk.bold(config.label)}`);
  if (!analysis.cacheable) {
    console.log(`    ${chalk.yellow("! " + analysis.cacheViableReason)}`);
  } else {
    console.log(`    ${chalk.green("+")} ${analysis.cacheViableReason}`);
    console.log(`    Without cache: ${chalk.red(usdPerDay(analysis.costWithoutCache))}  With cache: ${chalk.green(usdPerDay(analysis.costWithCache))}`);
    console.log(`    Daily saving:  ${chalk.bold.green(usdPerDay(analysis.dailySaving))}  Monthly: ${chalk.green("$" + analysis.monthlyProjectedSaving.toFixed(2))}`);
  }
  console.log();
}

console.log(chalk.bold("Pre-flight Context Guard"));
console.log(hr());
console.log(chalk.dim("  This runs before every LLM call. It counts tokens, applies the soft limit,"));
console.log(chalk.dim("  and truncates or rejects before the API call — not after.\n"));
console.log(chalk.dim("  Stack position:  Request → [Token Middleware] → [Context Guard] → LLM Client → API\n"));

const demoMessages = [
  { role: "system" as const, content: "You are a helpful backend engineer assistant. You help with Go, Node.js, distributed systems, and AI integration." },
  { role: "user" as const,   content: "Can you summarize this document for me?" },
  { role: "assistant" as const, content: "Sure, let me read through it carefully." },
  { role: "user" as const,   content: inputText },
];

for (const m of ["claude-sonnet-4-6", "gpt-4o"] as ModelKey[]) {
  try {
    const result = preflightCheck(demoMessages, m, 1000, "truncate_oldest");
    const label = MODEL_CONFIGS[m].label.padEnd(36);
    if (result.truncated) {
      console.log(`  ${label} ${chalk.yellow("TRUNCATED")} — dropped ${result.droppedMessages} msg(s), ${result.totalTokens} tokens used, ${result.availableTokens} remaining`);
    } else {
      console.log(`  ${label} ${chalk.green("SAFE")} — ${result.totalTokens} tokens (${result.utilizationPct}% of window), ${result.availableTokens} remaining`);
    }
  } catch (err) {
    const e = err as Error;
    console.log(`  ${MODEL_CONFIGS[m].label.padEnd(36)} ${chalk.red("REJECTED")} — ${e.message}`);
  }
}

console.log("\n" + chalk.dim("  Sliding window example (70% budget for input):"));
const longHistory = [
  { role: "system" as const, content: "You are a helpful assistant." },
  ...Array.from({ length: 10 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `Turn ${i + 1}: ${inputText.slice(0, 200)}`,
  })),
];

const swResult = slidingWindowContext(longHistory, "claude-sonnet-4-6", 0.7);
console.log(
  chalk.dim(`  Full history: ${longHistory.length} messages → Window: ${swResult.window.length} messages (dropped ${swResult.droppedCount}, ${swResult.usedTokens} tokens used)`)
);

console.log("\n" + hr("━", 64) + "\n");
