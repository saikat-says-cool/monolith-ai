# 🗿 Monolith Engine: Orchestration & AI Anatomy

This document provides a technical deep-dive into the **Orchestration Layer** of Monolith—the logic that transforms a simple user query into a multi-layered, research-backed synthesis.

---

## 🕊️ 1. The Orchestration Philosophy
Unlike traditional search engines that perform a single "Shotgun" request, Monolith uses a **Strategic Sequential Orchestration** model. This ensures depth, recency, and resilience while operating within the strict constraints of external API providers.

---

## 🚀 2. The Orchestration Lifecycle

### Stage 1: Strategic Planning (The Decision Engine)
Everything begins with a **Search Strategy Planner**. The system does not assume it knows how to search; it asks a specialized LLM agent to analyze the query:
- **Query Analysis**: Is this query asking for "Current News," "Academic Facts," or "Historical Context"?
- **Freshness Determination**: The planner selects a primary freshness bucket (`hour`, `day`, `week`, `month`, `year`, `all`).
- **Path Generation**: It creates up to 8 unique search-optimized strings ("Query Paths").
- **Depth Selection**: It chooses a `count_per_call` (15-35) based on the query complexity.

### Stage 2: The Staggered Execution Engine (Paced Search)
The most critical part of Monolith's orchestration is the **Sequential Pacer**. To prevent rate-limiting and ensure high reliability, search calls are orchestrated as follows:
- **Layer Construction**: Queries are paired with freshness levels. For a "news" query, a single query might become two "Layers": `[Query A + Freshness: Hour]` and `[Query A + Freshness: Day]`.
- **Sequential Looping**: Instead of firing 10 requests at once, Monolith iterates through a flat list of all layers.
- **The Stagger (1100ms Gap)**: After every request, the engine enters a mandatory `sleep(1100)` period. This creates a predictable 1-req-per-second heartbeat that is invisible to the user but essential for provider stability.
- **Dynamic Key Rotation**: Inside the orchestrator loop, every request is wrapped in a "Safety Net" that detects 429 (Rate Limit) or 402 (Quota) errors and instantly rotates the underlying API key for the *next* request in the same loop.

### Stage 3: Aggregation & Deduplication
Once the staggered search is complete, the results are merged into a single pool.
- **URL Deduplication**: Since multiple queries or layers might find the same article, Monolith uses a `Set(URL)` to ensure every source in the final context is unique.
- **Cross-Query Merging**: Results from "Query Path 1" and "Query Path 2" are interleaved, creating a comprehensive "all_sources" list.

### Stage 4: The Rerank Orchestrator (Intent Alignment)
Relevance is not left to chance. Monolith runs the top 100 unique results through a Cross-Encoder Reranker:
- **Chunked Reranking**: If there are more than 50 documents, the orchestrator splits them into chunks and processes them with continued pacing.
- **Score Injection**: The reranker assigns a `relevance_score` to each document.
- **Re-Sorting**: The list is re-sorted based on these new scores, moving the most "thematically accurate" information to the top, regardless of which search path originally found it.

### Stage 5: Synthesis Orchestration (Tool-Based Reading Architecture)
The final AI response uses a **Tool-Based External Reading** model instead of prompt stuffing:

**Message Flow:**
```
[System: Static Guidelines] → [History] → [User: Query] → [Assistant: Tool Call] → [Tool: Research Documents]
```

**Why This Architecture?**
1.  **Cacheable System Prompt**: The system prompt is now static (guidelines + date/time + mode). This enables context caching on subsequent turns = **faster time-to-first-token**.
2.  **External Document Perception**: By injecting search results as a `tool` response, the AI treats them as "documents it's reading" rather than "instructions to follow." This improves accuracy and reduces hallucination.
3.  **Inline Citations**: The AI now uses `[1]`, `[2]`, `[n]` markers that map directly to the numbered documents in the tool response.

**The Four Streams:**
1.  **Global Protocols**: Elite persona, citation rules, formatting guidelines (static, cacheable).
2.  **Mode Declaration**: `WEB RESEARCH` or `OFFLINE` depending on user toggle.
3.  **Conversation History**: Previous turns for context.
4.  **Research Database (Tool Response)**: The top-N reranked snippets formatted as `[DOCUMENT 1]`, `[DOCUMENT 2]`, etc.

---

## 🛡️ 3. Safety & Resilience Logic

The orchestration includes three specific "Circuit Breakers":
1.  **Rotation Circuit**: If all keys for a specific provider (e.g., LangSearch) are exhausted, the orchestrator throws a specific error that the UI catches, rather than returning a partial/broken result.
2.  **Timeout Pacing**: If a 429 is hit even with rotation, the stagger delay is doubled (2200ms) for the remainder of the session to "cool down" the provider connection.
3.  **Dumb-Down Fallback**: If search results are entirely empty or blocked, the orchestrator shifts the synthesis prompt to "Knowledge Mode," instructing the AI to use internal model training but to explicitly state that the web-access layer was unsuccessful.

---

## 📊 4. Orchestration Flow Visualization

`User Query` ➡️ `Planner (Strategy)` ➡️ `Layer Construction (Paths + Freshness)` ➡️ `Paced Search (Staggered 1.1s Loop)` ➡️ `Aggregator (Dedupe)` ➡️ `Reranker (Scoring)` ➡️ `Final Synthesis (Narrative)`

---

*This architecture ensures that Monolith remains authoritative and real-time capable, even when searching through dozens of paths and layers.*
