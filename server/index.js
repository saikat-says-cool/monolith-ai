import express from 'express';
import cors from 'cors';
import { query } from './db.js';
import { searchWeb, rerankResults, parallelSearch } from './services/searchService.js';
import { getAIResponse, generateSearchQueries } from './services/aiService.js';
import crypto from 'crypto';

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Init DB
const initDb = async () => {
    try {
        await query(`
      CREATE TABLE IF NOT EXISTS spaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        system_prompt TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        await query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        // Check if space_id column exists, if not add it (for migration)
        try {
            await query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS space_id UUID REFERENCES spaces(id) ON DELETE CASCADE;`);
        } catch (e) {
            // Silently fail if column already exists or table doesn't exist yet
        }

        await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        search_results JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        await query(`CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);`);

        await query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key TEXT UNIQUE NOT NULL,
        name TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP WITH TIME ZONE
      );
    `);

        console.log('Database tables initialized');
    } catch (err) {
        console.error('Error initializing DB:', err);
    }
};

initDb();

// --- Spaces API ---
app.get('/api/spaces', async (req, res) => {
    try {
        const result = await query('SELECT * FROM spaces ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('SERVER ERROR [GET /spaces]:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/spaces', async (req, res) => {
    const { name, system_prompt } = req.body;
    try {
        const result = await query(
            'INSERT INTO spaces (name, system_prompt) VALUES ($1, $2) RETURNING *',
            [name, system_prompt]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('SERVER ERROR [POST /spaces]:', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/spaces/:id', async (req, res) => {
    const { id } = req.params;
    const { name, system_prompt } = req.body;
    try {
        const result = await query(
            'UPDATE spaces SET name = COALESCE($1, name), system_prompt = COALESCE($2, system_prompt) WHERE id = $3 RETURNING *',
            [name, system_prompt, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`SERVER ERROR [PATCH /spaces/${id}]:`, err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/spaces/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await query('DELETE FROM spaces WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error(`SERVER ERROR [DELETE /spaces/${id}]:`, err);
        res.status(500).json({ error: err.message });
    }
});

// Get all conversations (with optional space_id filter)
app.get('/api/conversations', async (req, res) => {
    const { space_id } = req.query;
    try {
        let q = 'SELECT * FROM conversations';
        let params = [];
        if (space_id) {
            if (space_id === 'default') {
                q += ' WHERE space_id IS NULL';
            } else {
                q += ' WHERE space_id = $1';
                params.push(space_id);
            }
        }
        q += ' ORDER BY updated_at DESC';
        const result = await query(q, params);
        res.json(result.rows);
    } catch (err) {
        console.error('SERVER ERROR [GET /conversations]:', err);
        res.status(500).json({ error: err.message, details: err });
    }
});

// Create new conversation
app.post('/api/conversations', async (req, res) => {
    const { title, space_id } = req.body;
    try {
        const result = await query(
            'INSERT INTO conversations (title, space_id) VALUES ($1, $2) RETURNING *',
            [title || 'New Chat', space_id === 'default' ? null : space_id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('SERVER ERROR [POST /conversations]:', err);
        res.status(500).json({ error: err.message, details: err });
    }
});

// Get messages for a conversation
app.get('/api/conversations/:id/messages', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query(
            'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(`SERVER ERROR [GET /messages/${id}]:`, err);
        res.status(500).json({ error: err.message, details: err });
    }
});

// Add a message to a conversation
app.post('/api/conversations/:id/messages', async (req, res) => {
    const { id } = req.params;
    const { role, content, search_results } = req.body;

    try {
        const result = await query(
            'INSERT INTO messages (conversation_id, role, content, search_results) VALUES ($1, $2, $3, $4) RETURNING *',
            [id, role, content, JSON.stringify(search_results)]
        );

        // Update timestamp
        await query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [id]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error(`SERVER ERROR [POST /messages/${id}]:`, err);
        res.status(500).json({ error: err.message, details: err });
    }
});

// Update conversation title
app.patch('/api/conversations/:id', async (req, res) => {
    const { id } = req.params;
    const { title } = req.body;
    try {
        const result = await query(
            'UPDATE conversations SET title = $1 WHERE id = $2 RETURNING *',
            [title, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`SERVER ERROR [PATCH /conversations/${id}]:`, err);
        res.status(500).json({ error: err.message, details: err });
    }
});

// Delete conversation
// --- API Key Management (Internal/Dashboard use) ---
app.post('/api/keys', async (req, res) => {
    const { name } = req.body;
    const key = `pk-${crypto.randomBytes(24).toString('hex')}`;
    try {
        const result = await query(
            'INSERT INTO api_keys (key, name) VALUES ($1, $2) RETURNING *',
            [key, name || 'Default Key']
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('SERVER ERROR [POST /keys]:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/keys', async (req, res) => {
    try {
        const result = await query('SELECT id, name, key, created_at, last_used_at FROM api_keys ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('SERVER ERROR [GET /keys]:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/keys/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await query('DELETE FROM api_keys WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error(`SERVER ERROR [DELETE /keys/${id}]:`, err);
        res.status(500).json({ error: err.message });
    }
});

// --- API v1 Middleware ---
const validateApiKey = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid API key' });
    }
    const key = authHeader.split(' ')[1];
    try {
        const result = await query('SELECT * FROM api_keys WHERE key = $1', [key]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid API key' });
        }
        // Update last used
        await query('UPDATE api_keys SET last_used_at = NOW() WHERE key = $1', [key]);
        req.apiKey = result.rows[0];
        next();
    } catch (err) {
        console.error('API KEY VALIDATION ERROR:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// --- API v1 Endpoints (For external consumption) ---

// Search Endpoint
app.post('/api/v1/search', validateApiKey, async (req, res) => {
    const { query: searchQuery, count = 10, rerank = true } = req.body;
    if (!searchQuery) return res.status(400).json({ error: 'Query is required' });

    try {
        let results = await searchWeb(searchQuery, count);
        if (rerank && results.length > 0) {
            results = await rerankResults(searchQuery, results, 5);
        }
        res.json({ results });
    } catch (err) {
        console.error('v1 Search Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Completions Endpoint (Standard)
app.post('/api/v1/chat/completions', validateApiKey, async (req, res) => {
    const { model, messages, stream = false, deep = false } = req.body;

    try {
        const lastMessage = messages[messages.length - 1].content;
        const history = messages.slice(0, -1);

        // === MULTI-QUERY FLOW ===
        // Step 1: Generate optimized search queries from user input
        console.log('[Chat] Starting multi-query flow...');
        const searchQueries = await generateSearchQueries(lastMessage, deep ? 5 : 3);

        // Step 2: Run parallel searches across all generated queries
        const allResults = await parallelSearch(searchQueries, deep ? 15 : 10);

        // Step 3: Rerank all results to get the most relevant ones
        let reranked = allResults;
        if (allResults.length > 0) {
            reranked = await rerankResults(lastMessage, allResults, deep ? 20 : 10);
        }
        console.log(`[Chat] Final context: ${reranked.length} sources after reranking`);

        if (stream) {
            // Streaming Mode
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Send the generated search queries as a special event
            res.write(`data: ${JSON.stringify({ type: 'search_queries', data: searchQueries })}\n\n`);

            // Send search results as a special event
            res.write(`data: ${JSON.stringify({ type: 'search_results', data: reranked })}\n\n`);

            // Stream Generation
            const { streamAIResponse } = await import('./services/aiService.js');
            const generator = streamAIResponse(lastMessage, reranked, history);

            for await (const chunk of generator) {
                res.write(`data: ${JSON.stringify({
                    choices: [{ delta: { content: chunk } }]
                })}\n\n`);
            }

            res.write('data: [DONE]\n\n');
            res.end();
        } else {
            // Standard POST response
            const aiResponse = await getAIResponse(
                lastMessage,
                reranked.slice(0, deep ? 20 : 10),
                history,
                deep
            );

            res.json({
                id: `chat-${crypto.randomBytes(8).toString('hex')}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: model || 'monolith-v1',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: aiResponse,
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: -1,
                    completion_tokens: -1,
                    total_tokens: -1
                },
                search_queries: searchQueries, // Show the generated queries
                search_results: reranked // The final reranked sources
            });
        }
    } catch (err) {
        console.error('v1 Chat Error:', err);
        if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

app.delete('/api/conversations/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await query('DELETE FROM conversations WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error(`SERVER ERROR [DELETE /conversations/${id}]:`, err);
        res.status(500).json({ error: err.message, details: err });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});
