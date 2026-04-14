# Learnings — Building an LLM Pre-flight Layer

This was mainly to understand what AI integration actually looks like in production from a backend and system design lens.

---

## What I Built

- Local token counter that works before making any API call
- Cost estimation layer across models/providers
- Pre-flight middleware to catch context overflow before provider failure
- Sliding window flow:
  - full conversation in DB
  - only recent token-budgeted context sent to model
- Reusable CLI for token, cost, and context sanity checks

---

## Core Learnings

### 1) Tokens are the real unit, not characters

LLMs don't charge per request or character. They charge per token.

Same text can cost differently across providers because tokenizers differ. Code is usually more expensive than plain text because symbols, brackets, and identifiers split into smaller token chunks.

- prose = fewer larger chunks
- code = fragmented chunks


### 2) Context window is a budget

The context window is shared between:
- input tokens
- output tokens

So if a model supports 200k context and your input itself is 200k, response generation has no room.

This means output space must always be reserved in application logic:

```
softLimit = totalContext - reservedOutput
```

### 3) Tokenizer 

Token counting has to happen before the request leaves your service.

This layer helps with:
- context checks
- cost estimation
- trimming strategy
- request rejection
- billing estimates

This is exactly how we treat request validation before hitting DB or external services.

### 4) Caching is more of cost optimisation than speed

Prompt caching is less of a latency feature and more of a cost control layer.

Best candidates:
- system prompts
- tool definitions
- static instructions
- few-shot examples

For use cases with frequent calls, this is one of the first optimizations worth doing.

---

## Backend / System Design Parallel

This is what clicked for me:

> LLM call should never be a direct SDK call from business logic. It should go through middleware.

```
Request
   → Token Validator
   → Context Guard
   → Cost Estimator
   → LLM Client
   → Provider
```

Exactly like:

```
Request
   → Auth
   → Rate limiter
   → Validation
   → Service layer
   → DB
```

This framing made AI integration feel much closer to normal backend architecture.

---

## Long Conversation Design Pattern

Correct production pattern is:

```
DB  = full history
LLM = sliding window
```

Example:

```
DB:   [t1...t100]
LLM:  [system][t90...t100]
```

Full persistence stays in DB. Only recent relevant context goes to the model.

This is basically windowed memory management — very similar to how we think about caching hot data vs cold storage.

---

## Failure Cases Worth Handling

### Context overflow

Most common issue. Especially in:
- chat systems
- agent flows
- RAG pipelines

Without pre-flight, provider fails after the network round trip. Should fail before request leaves service.

### Cache misses causing cost spikes

Small dynamic values can break caching:
- timestamps
- request IDs
- random ordering in JSON
- modified tool definitions

This can silently increase costs. Basically cache invalidation.

### Token estimation drift

For non-native tokenizers, estimates drift. Especially with:
- minified code
- heavy symbols
- unusual Unicode

For billing-sensitive paths, actual provider token usage should be logged and used.

---

## Production Engineering Practices

### Log token usage on every call

Track:
- input tokens
- output tokens
- cache hits/misses
- estimated vs actual cost
- latency

Without this, debugging is hard.

### Think of LLM calls like expensive DB queries

This was the strongest system design parallel for me. Same discipline applies:
- validate before execute
- explicit timeout
- retries
- cost visibility
- metrics
- failure handling

LLM APIs are just another external dependency with different failure modes.

---

## Biggest Takeaway

AI integration stopped feeling "AI-ish" once I looked at it as backend systems design.

At the core it is still:
- request shaping
- resource budgeting
- caching
- middleware
- failure handling
- cost optimization

