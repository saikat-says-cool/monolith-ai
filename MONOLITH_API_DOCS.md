# 🗿 Monolith API Documentation

Welcome to the Monolith Engine API. This documentation provides everything you need to integrate Monolith's high-intelligence search and research capabilities into your own applications, automation workflows (n8n, Make.com), or custom bots.

---

## 🔐 Authentication

All API requests must include your unique API Key in the `Authorization` header as a Bearer token.

**Header:**
`Authorization: Bearer pk-xxxxxxxxxxxx`

> [!TIP]
> You can create and manage your API keys directly from the **API Settings** in the Monolith Web Dashboard.

---

## 🚀 The Chat Endpoint

The primary endpoint for generating research-backed answers.

- **URL:** `https://fvparsgobgmggcioyxhi.supabase.co/functions/v1/monolith-chat`
- **Method:** `POST`
- **Content-Type:** `application/json`

### 📥 Request Body Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | **Yes** | The user's search query or question. |
| `deep` | `boolean` | No | Set to `true` for **Deep Research Mode** (exhaustive search, more sources, longer answer). Defaults to `false` (Adaptive Mode). |
| `history` | `array` | No | List of previous message objects `[{role: "user", content: "..."}, {role: "assistant", content: "..."}]` for contextual follow-ups. |
| `custom_prompt` | `string` | No | Additional system-level instructions to steer the AI's behavior or persona. |
| `queries` | `array` | No | Pre-generated search strings to skip the "Planning" phase and force specific search paths. |
| `stream` | `boolean` | No | Set to `true` to receive a streaming response (text/event-stream). Defaults to `false`. |

### 📤 Response Format

#### Standard (stream: false)
```json
{
  "answer": "The refined, researched answer synthesized from multiple sources...",
  "sources": [...],
  "all_sources": [...],
  "search_queries": ["query path 1", ... ]
}
```

#### Streaming (stream: true)
The endpoint returns a `text/event-stream`.
1.  **First Chunk**: A JSON object containing metadata (`type: "metadata"`, `sources`, `all_sources`, `search_queries`) followed by a delimiter `---\n\n`.
2.  **Subsequent Chunks**: Raw text tokens of the answer.

---

## 🛠️ Code Examples

### cURL (Streaming)
```bash
curl -X POST https://fvparsgobgmggcioyxhi.supabase.co/functions/v1/monolith-chat \
  -H "Authorization: Bearer YOUR_PK_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Who is the current CEO of Tesla?",
    "stream": true
  }'
```

### JavaScript (Streaming Example)
```javascript
const response = await fetch('https://fvparsgobgmggcioyxhi.supabase.co/functions/v1/monolith-chat', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_PK_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    query: "Latest news on SpaceX Starship",
    stream: true
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}
```

---

## 🤖 Integration Tips (n8n / Make.com)

1.  **Stateless by Default**: API calls to this endpoint **do not** save messages to your web conversation history. They are isolated, stateless requests.
2.  **Webhooks**: Use the `HTTP Request` node in n8n or the `HTTP` module in Make.
3.  **Large Responses**: Deep Research can take up to 40-60 seconds. Ensure your timeout settings are set high enough (at least 90s) to allow for complete synthesis.
4.  **Error Handling**: If you receive a `429`, the global LangSearch limit has been reached. Monolith handles rotation internally, but if all keys are exhausted, wait 60 seconds before retrying.

---

*© 2025 Monolith AI. Built for the future of research.*
