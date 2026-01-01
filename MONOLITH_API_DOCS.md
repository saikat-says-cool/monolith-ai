# 🗿 Monolith Engine API Documentation

Welcome to the Monolith Engine API. This documentation provides everything you need to integrate Monolith's high-intelligence search, deep research, and reasoning capabilities into your own applications, automation workflows (n8n, Make.com), or custom bots.

---

## 🔐 Authentication

All API requests must include your unique API Key in the `Authorization` header as a Bearer token.

**Header:**
`Authorization: Bearer pk-xxxxxxxxxxxx`

> [!TIP]
> You can create and manage your API keys directly from the **API Settings** in the Monolith Web Dashboard.

---

## 🚀 The Chat Endpoint

The primary endpoint for generating research-backed answers or offline reasoning.

- **URL:** `https://fvparsgobgmggcioyxhi.supabase.co/functions/v1/monolith-chat`
- **Method:** `POST`
- **Content-Type:** `application/json`

### 📥 Request Body Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `query` | `string` | **Yes** | - | The user's search query or question. |
| `search` | `boolean` | No | `true` | Set to `false` for **Offline Mode**. Note: Auto-Toggle may override this if query requires real-time data. |
| `deep` | `boolean` | No | `false` | Sets **Deep Research Mode** (exhaustive parallel search, 50+ sources). Auto-Toggle may enable this for complex queries. |
| `thinking` | `boolean` | No | `false` | Uses the **LongCat-Flash-Thinking** model for high-reasoning tasks. Auto-Toggle enables for math/code/logic. |
| `history` | `array` | No | `[]` | List of previous messages `[{role: "user", content: "..."}]` for context. |
| `custom_prompt` | `string` | No | - | Additional system instructions to steer the AI's persona. |
| `queries` | `array` | No | - | Pre-generated search strings to skip the "Planning" phase. |

---

## 🧠 Auto-Toggle Intelligence

Monolith includes **intent-aware mode detection**. Even if you send `search: false`, the engine's planner may automatically activate web search if your query requires real-time data.

**How it works:**
1. The **Planner** always runs first, analyzing your query.
2. If the query needs current data (news, prices, events) → **Search is activated**.
3. If the query is complex or multi-faceted → **Deep Research is activated**.
4. If the query requires reasoning, math, or code → **Thinking Mode is activated**.

The response includes an `auto_applied` object indicating which modes were auto-enabled:
```json
{
  "auto_applied": { "search": true, "deep": false, "thinking": true }
}
```

---

## 🔧 Tool-Based Grounding Architecture

Monolith uses a **Tool-Based External Reading** model for AI synthesis:

1. **Search results are NOT stuffed into the system prompt.** Instead, they are injected as a `tool` response message.
2. The AI perceives these as **external documents it's "reading"** rather than instructions.
3. This enables **context caching** (faster responses on follow-up queries) and **improved accuracy**.

**Citation Protocol:** All responses use inline citations `[1]`, `[2]`, `[n]` that map to the source documents. Use these numbers to cross-reference the `sources` array in the response.

---

## 🛰️ Situational Pulse (Offline Grounding)

If you start a **new thread** (`history: []`) in **Offline Mode** (`search: false`) AND the planner doesn't override it, the engine performs a lightning-fast "Daily Pulse" search. This provides the AI with:
1. Current Date/Time.
2. Major world events and headlines for today.

This ensures your "offline" AI stays contextually grounded in the current world state.

---

## 📤 Response Format

```json
{
  "answer": "The refined, researched answer with [1] citations...",
  "sources": [
    {
      "name": "Source Title",
      "url": "https://example.com/article",
      "snippet": "...",
      "relevance_score": 0.95
    }
  ],
  "all_sources": [...],
  "search_queries": ["query 1", "query 2"],
  "auto_applied": { "search": false, "deep": false, "thinking": false }
}
```

---

## 🛠️ Code Examples

### cURL
```bash
curl -X POST https://fvparsgobgmggcioyxhi.supabase.co/functions/v1/monolith-chat \
  -H "Authorization: Bearer YOUR_PK_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is the latest status of SpaceX Starship?",
    "search": true,
    "deep": true,
    "thinking": true
  }'
```

### Python
```python
import requests

response = requests.post(
    "https://fvparsgobgmggcioyxhi.supabase.co/functions/v1/monolith-chat",
    headers={
        "Authorization": "Bearer YOUR_PK_KEY",
        "Content-Type": "application/json"
    },
    json={
        "query": "What are the latest AI breakthroughs?",
        "deep": True
    }
)
data = response.json()
print(data["answer"])
```

---

## 🤖 Integration Tips (n8n / Make.com)

1.  **Timeouts**: Deep Research is now faster (parallelized), but can still take 20-40s. Set node timeouts to **60s** minimum.
2.  **Key Rotation**: Monolith handles API key rotation for search and AI internally. If you receive a `401` or `500`, it usually indicates your Bearer token is invalid or the provider is down.

---

*© 2026 Monolith AI. Built for the future of research.*

