# llm-token-budget

Pre-flight token counter, cost estimator, and context guard for LLM API calls. Runs locally before any API call — no network required.

## What it does

Given a text file (or stdin), it produces a full report across 7 major models:

- **Token profile** — raw count, chars/token, density classification
- **Per-model token counts** — corrected for each provider's tokenizer
- **Context window utilization** — visual progress bar with OK/WARNING/CRITICAL status
- **Cost breakdown** — single call, with and without caching
- **Daily cost projection** — at 50, 200, and 1000 calls/day
- **Cache viability analysis** — math on when caching pays off, daily/monthly savings
- **Pre-flight context guard** — middleware simulation: truncate, reject, or warn before overflow


## Usage

```bash
# Analyze a file
npx ts-node src/index.ts samples/random-text.txt

# With caching and output estimates
npx ts-node src/index.ts samples/code.txt --cached 1500 --output 800 --volume 500

# Pipe from stdin
echo "your prompt text here" | npx ts-node src/index.ts --stdin
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--cached <n>` | `0` | Tokens expected to be cache hits |
| `--output <n>` | `500` | Estimated output tokens per call |
| `--volume <n>` | `200` | Calls per day (used in projections) |
| `--stdin` | — | Read input from stdin instead of a file |

## Supported models (April 2026 pricing)

| Model | Input ($/1M) | Output ($/1M) | Context | Caching |
|-------|-------------|---------------|---------|---------|
| GPT-4o | $2.50 | $10.00 | 128k | Implicit (50% discount) |
| GPT-4o Mini | $0.15 | $0.60 | 128k | Implicit (50% discount) |
| Claude Sonnet 4.6 | $3.00 | $15.00 | 1M | Explicit (90% discount) |
| Claude Haiku 4.5 | $0.25 | $1.25 | 200k | Explicit (90% discount) |
| Gemini 2.5 Flash | $0.30 | $2.50 | 1M | Implicit (75% discount) |
| Gemini 2.0 Flash | $0.10 | $0.40 | 1M | Implicit (75% discount) |
| DeepSeek V3 | $0.27 | $1.10 | 128k | Implicit (90% discount) |

## Architecture

```
src/
  types.ts          — all shared interfaces and types
  models.ts         — pricing configs, context windows, caching params per model
  tokenizer.ts      — tiktoken wrapper + per-model correction factors
  costEstimator.ts  — cost math, daily projections, cache viability analysis
  contextGuard.ts   — pre-flight middleware: truncate_oldest / reject / warn
  index.ts          — CLI entry point, report rendering

samples/
  code.txt          — dense input sample (high token density)
  random-text.txt   — prose input sample (normal token density)
```

### Tokenizer correction factors

All models use tiktoken's `cl100k_base` as the base counter, then apply empirical multipliers:

| Provider | Factor | Reason |
|----------|--------|--------|
| OpenAI | 1.00 | Native cl100k_base |
| Anthropic | 1.05 | Slightly more splits on code/symbols |
| Google | 1.10 | SentencePiece — more splits on non-Latin and symbols |
| DeepSeek | 1.08 | Custom BPE, closer to cl100k but diverges on CJK |

### Context guard strategies

`preflightCheck()` takes a `strategy` parameter:

- **`truncate_oldest`** — drops oldest non-system messages until it fits. System prompt is never touched.
- **`reject`** — throws immediately. Caller handles trimming. Use in agentic pipelines.
- **`warn`** — lets it through with a warning. Development only.

`slidingWindowContext()` implements the production pattern: persist full history in your DB, send only a token-budgeted window to the model.

### Caching mechanics

**Anthropic (explicit):** Add `cache_control: { type: "ephemeral" }` to content blocks. First call pays 1.25x write premium, subsequent calls pay 0.1x. TTL: 5 minutes, resets on each hit.

**OpenAI (implicit):** Automatic prefix detection. No code change. Cache reads at 0.5x. TTL: ~5–60 minutes.

**Gemini (implicit):** Automatic. Cache reads at 0.25x. Minimum 1028 tokens (2.5 Flash).

**DeepSeek (implicit):** Automatic. Cache reads at 0.1x. No documented minimum.

Common cache invalidation causes: any character change before the cache breakpoint, timestamps or request IDs in the system prompt, tool definition changes, TTL expiry.

## References

**Pricing & model specs**
- [OpenAI pricing](https://openai.com/api/pricing/) — GPT-4o, GPT-4o Mini
- [Anthropic pricing](https://www.anthropic.com/pricing#anthropic-api) — Claude Sonnet 4.6, Haiku 4.5
- [Google AI pricing](https://ai.google.dev/pricing) — Gemini 2.5 Flash, 2.0 Flash
- [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing) — DeepSeek V3

**Caching documentation**
- [Anthropic prompt caching guide](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [OpenAI prompt caching](https://platform.openai.com/docs/guides/prompt-caching)
- [Gemini context caching](https://ai.google.dev/gemini-api/docs/caching)

**Tokenization**
- [tiktoken](https://github.com/openai/tiktoken) — OpenAI's BPE tokenizer library
- [OpenAI tokenizer playground](https://platform.openai.com/tokenizer)
- [Anthropic token counting API](https://docs.anthropic.com/en/docs/build-with-claude/token-counting)

**Context window management**
- [OpenAI context window docs](https://platform.openai.com/docs/guides/context-windows)
- [Anthropic context window](https://docs.anthropic.com/en/docs/about-claude/models)
