// Supabase Edge Function: monolith-chat
// ELITE EDITION: Professional Research Orchestration, Domain Reputation, Diversity Guard, and Conflict Synthesis.
// RESPONSE: Non-Streaming JSON

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- ELITE CONFIG ---
const DOMAIN_REPUTATION: Record<string, number> = {
    "reuters.com": 0.25,
    "apnews.com": 0.25,
    "nytimes.com": 0.20,
    "wsj.com": 0.20,
    "theguardian.com": 0.18,
    "bbc.com": 0.18,
    "bloomberg.com": 0.20,
    "nature.com": 0.30,
    "science.org": 0.30,
    "arxiv.org": 0.25,
    "github.com": 0.15,
    "stackoverflow.com": 0.12,
    "wikipedia.org": 0.10,
    "gov": 0.25, // Check for .gov in hostname
    "edu": 0.20  // Check for .edu in hostname
};

const GLOBAL_MONOLITH_GUIDELINES = `
CORE PROTOCOLS:
1. TRUTH & TRIANGULATION: Never hallucinate. If the research documents provide conflicting data, highlight the discrepancy with sophisticated discernment.
2. CITATION PROTOCOL: Use inline citations [1], [2], [n] to cite your sources. Every major claim MUST be cited. The numbers map to the documents in your research database tool response.
3. ELITE PERSONA: You are Monolith, the world's most capable research engine. Authoritative, academic, and extremely thorough.
4. RICH TEXT: Structure responses with Headers (##), **bold** for key facts, and tables for comparisons.
5. SOURCE DIVERSITY: Synthesize from multiple domains. Never rely on a single source.
6. NO TECHNICAL META: Never mention API limits, search issues, or "searching." Just deliver the synthesis.
7. EXTERNAL READING: You are "reading" documents from an External Research Database (provided via tool). Treat them as grounded truth.
8. COMPLETENESS: End with a clear summary. Never use placeholders like "I'll look that up."
`;

// --- UTILITIES ---
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const sanitizeContent = (text: string) => {
    if (!text) return "";
    return text
        .replace(/(\r\n|\n|\r)/gm, " ") // Remove newlines
        .replace(/\s+/g, " ") // Collapse whitespaces
        .replace(/Cookie Policy|Accept all cookies|Sign up for our newsletter|Follow us on social media|Subscribe now/gi, "") // Remove common boilerplate
        .trim()
        .slice(0, 600); // Slightly larger context for better reading comprehension
}

const getDomainBoost = (url: string) => {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        let boost = 0;
        for (const [domain, score] of Object.entries(DOMAIN_REPUTATION)) {
            if (hostname.endsWith(domain)) boost = Math.max(boost, score);
        }
        return boost;
    } catch { return 0; }
}

const executeRotatedRequest = async (keys: string[], requestFn: (key: string) => Promise<any>, offset: number = 0) => {
    let attempts = 0;
    while (attempts < keys.length) {
        const keyIndex = (offset + attempts) % keys.length;
        try {
            return await requestFn(keys[keyIndex]);
        } catch (error: any) {
            const status = error.status || 0;
            const shouldRotate = status >= 500 || status === 0 || [401, 402, 403, 429].includes(status);
            if (shouldRotate) {
                console.warn(`[Safety Net] Rotating key due to status ${status}`);
                attempts++;
                if (attempts < keys.length) {
                    await sleep(status === 429 ? 2000 : 500);
                    continue;
                }
            }
            throw error;
        }
    }
    throw new Error(`Monolith Safety Net: Service disruption. All ${keys.length} keys exhausted.`);
}

async function getDailyPulse(keys: string[]) {
    try {
        const now = new Date();
        const dateStr = now.toLocaleDateString();
        const query = `Latest world news, tech breakthroughs, and major events for ${dateStr}`;

        return await executeRotatedRequest(keys, async (apiKey) => {
            const resp = await fetch('https://api.langsearch.com/v1/web-search', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query, summary: true, count: 5, freshness: 'day' })
            });
            if (!resp.ok) return [];
            const data = await resp.json();
            return (data.data?.webPages?.value || []).slice(0, 5);
        }, 0);
    } catch { return []; }
}

// --- CORE MODULES ---

async function planStrategy(query: string, history: any[], deep: boolean, search: boolean, thinking: boolean, keys: string[]) {
    return await executeRotatedRequest(keys, async (apiKey) => {
        const resp = await fetch('https://api.longcat.chat/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'LongCat-Flash-Chat',
                messages: [
                    {
                        role: 'system',
                        content: `You are the Monolith Search Planner. 
                        DETERMINE if the query requires real-time web access (current events, recent facts, prices, news).
                        If the query is a greeting, a purely conversational follow-up, a request for personal identity ("who are you"), or a general knowledge question that does NOT need recency (e.g., "how to bake a cake", "what is photosynthesis"), set "skip_search": true.
                        Otherwise, output queries for search.
                        
                        Output JSON:
                          "queries": ["query1", ...],
                          "depth_label": "Surface" | "Standard" | "Deep" | "Elite",
                          "use_hour_layer": boolean,
                          "skip_search": boolean,
                          "freshness": "hour" | "day" | "week" | "month" | "year" | "all",
                          "suggest_thinking": boolean
                        }`
                    },
                    {
                        role: 'user',
                        content: `Query: "${query}"\nUser Context: [Search: ${search}, Deep: ${deep}, Thinking: ${thinking}, History Length: ${history.length}]\nDetermine the optimal strategy. If the query involves complex reasoning, math, or coding, set suggest_thinking: true.`
                    }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            })
        });
        if (!resp.ok) throw { status: resp.status, message: await resp.text() };
        const data = await resp.json();
        return JSON.parse(data.choices[0].message.content.trim().replace(/```json|```/g, ''));
    });
}

async function orchestrateSearch(planner: any, searchQuery: string, deep: boolean, keys: string[]) {
    if (planner.skip_search) return [];

    const queries = planner.queries || [searchQuery];
    if (!queries.includes(searchQuery)) queries.unshift(searchQuery);

    const countPerCall = deep ? 35 : 20;
    const results: any[] = [];
    const seenUrls = new Set();
    const domainCounts: Record<string, number> = {};
    const DOMAIN_CAP = 3;

    // OPTIMIZATION 1: Parallel Query Execution
    // We run all unique query paths in parallel, but keep freshness layers within a query paced.
    const queryPromises = queries.map(async (q: string, qIdx: number) => {
        const localResults: any[] = [];
        const freshnessLayers = [];
        if (planner.freshness !== 'all') freshnessLayers.push(planner.freshness);
        if (planner.use_hour_layer && planner.freshness !== 'hour') freshnessLayers.push('hour');
        freshnessLayers.push('all');

        for (let lIdx = 0; lIdx < freshnessLayers.length; lIdx++) {
            const f = freshnessLayers[lIdx];
            try {
                const layerResults = await executeRotatedRequest(keys, async (apiKey) => {
                    const resp = await fetch('https://api.langsearch.com/v1/web-search', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: q, summary: true, count: countPerCall, freshness: f })
                    });
                    if (!resp.ok) throw { status: resp.status, message: await resp.text() };
                    const data = await resp.json();
                    return (data.data?.webPages?.value || []).map((r: any) => ({ ...r, origin_freshness: f }));
                }, qIdx + lIdx);
                localResults.push(...layerResults);
            } catch (err) { console.warn(`[Search] Query ${qIdx} Layer ${lIdx} error.`, err); }

            // Minimal pause between layers of the SAME query to avoid burst limits
            if (lIdx < freshnessLayers.length - 1) await sleep(200);
        }
        return localResults;
    });

    const allRawResults = await Promise.all(queryPromises);

    for (const batch of allRawResults) {
        for (const r of batch) {
            if (seenUrls.has(r.url)) continue;
            try {
                const host = new URL(r.url).hostname;
                if ((domainCounts[host] || 0) < DOMAIN_CAP) {
                    domainCounts[host] = (domainCounts[host] || 0) + 1;
                    seenUrls.add(r.url);
                    results.push(r);
                }
            } catch { /* skip */ }
        }
    }

    return results;
}

async function eliteRerank(query: string, results: any[], keys: string[]) {
    if (results.length === 0) return [];

    // OPTIMIZATION 2: Parallel Reranking Chunks
    const chunks = [];
    for (let i = 0; i < results.length; i += 50) chunks.push(results.slice(i, i + 50));

    const rerankPromises = chunks.map(async (chunk, cIdx) => {
        try {
            return await executeRotatedRequest(keys, async (apiKey) => {
                const r = await fetch('https://api.langsearch.com/v1/rerank', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'langsearch-reranker-v1',
                        query: query,
                        documents: chunk.map(d => sanitizeContent(d.summary || d.snippet || d.name)),
                        top_n: chunk.length
                    })
                });
                if (!r.ok) throw { status: r.status, message: await r.text() };
                const data = await r.json();
                return data.results.map((res: any) => ({ ...chunk[res.index], relevance_score: res.relevance_score }));
            }, cIdx);
        } catch { return chunk.map(d => ({ ...d, relevance_score: 0 })); }
    });

    const allReranked = (await Promise.all(rerankPromises)).flat();

    // ELITE SCORING: Temporal + Reputation + Diversification
    return allReranked.map(doc => {
        let boost = getDomainBoost(doc.url); // Domain Reputation Boost
        if (doc.origin_freshness === 'hour') boost += 0.22;
        else if (doc.origin_freshness === 'day') boost += 0.14;

        if (doc.datePublished) {
            const ageDays = (new Date().getTime() - new Date(doc.datePublished).getTime()) / (1000 * 3600 * 24);
            if (ageDays < 15) boost += 0.10;
        }
        return { ...doc, relevance_score: (doc.relevance_score || 0) + boost };
    }).sort((a, b) => b.relevance_score - a.relevance_score);
}

// --- MAIN SERVE ---
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const authHeader = req.headers.get('Authorization');
        const providedKey = authHeader?.replace('Bearer ', '').trim();
        if (providedKey?.startsWith('pk-')) {
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
            const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
            const { data: keyRecord } = await supabaseAdmin.from('api_keys').select('*').eq('key', providedKey).single();
            if (!keyRecord) return new Response(JSON.stringify({ error: "Invalid API Key" }), { status: 403, headers: corsHeaders });
        }

        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: "Method Not Allowed. Use POST." }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        let body;
        try {
            body = await req.json();
        } catch (e) {
            return new Response(JSON.stringify({ error: "Invalid JSON body or empty request." }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const { query, history = [], deep = false, custom_prompt = null, search = true, thinking = false, queries: providedQueries = null } = body;

        if (!query) {
            return new Response(JSON.stringify({ error: "Missing 'query' in request body." }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const LANGSEARCH_KEYS = Deno.env.get('LANGSEARCH_KEYS')?.split(',').map(k => k.trim()).filter(Boolean) || [];
        const LONGCAT_KEYS = Deno.env.get('LONGCAT_KEYS')?.split(',').map(k => k.trim()).filter(Boolean) || [];

        // --- NON-STREAMING RESPONSE ---
        // 1. Planning (with Auto-Toggle detection)
        let planner;
        let pulseSources = [];
        const isGreeting = /^(hi|hello|hey|greetings|how are you|how's it going|who are you|what is your name|thanks|thank you|bye|goodbye|good morning|good afternoon|good evening)$/i.test(query.trim().toLowerCase());

        if (providedQueries) {
            planner = { queries: providedQueries, freshness: 'all', use_hour_layer: deep, skip_search: false, suggest_thinking: thinking };
        } else if (isGreeting) {
            planner = { queries: [], skip_search: true, suggest_thinking: false };
        } else {
            planner = await planStrategy(query, history, deep, search, thinking, LONGCAT_KEYS);
        }

        const activeSearch = search || (!search && !planner.skip_search);
        const activeDeep = deep || (!deep && (planner.depth_label === 'Deep' || planner.depth_label === 'Elite'));
        const activeThinking = thinking || (!thinking && planner.suggest_thinking);

        // 2. Orchestrated Search (Parallel)
        let topSources = pulseSources;
        let rawResults = [];
        if (activeSearch && !planner.skip_search) {
            rawResults = await orchestrateSearch(planner, query, activeDeep, LANGSEARCH_KEYS);

            // 3. Elite Reranking (Parallel)
            const reranked = await eliteRerank(query, rawResults, LANGSEARCH_KEYS);
            topSources = reranked.slice(0, 55);
        }

        // 4. Elite Synthesis - TOOL-BASED GROUNDING
        const now = new Date();
        const dateTimeContext = `Current Date/Time: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
        const contextText = topSources.map((c, i) => `[DOCUMENT ${i + 1}] Title: ${c.name}\nURL: ${c.url}\nContent: ${sanitizeContent(c.summary || c.snippet)}`).join('\n\n');

        // Static system prompt (cacheable)
        const systemPrompt = `${GLOBAL_MONOLITH_GUIDELINES}
${custom_prompt ? `USER INSTRUCTIONS: ${custom_prompt}` : ''}
${dateTimeContext}
MODE: ${activeSearch ? 'WEB RESEARCH (REAL-TIME)' : 'OFFLINE (KNOWLEDGE OVERRIDE)'}
${activeThinking ? 'REASONING PROTOCOL: You are a thinking model. Prioritize deep multi-step reasoning before delivering your final answer.' : ''}`;

        // Tool-based injection
        const researchToolCall = {
            role: 'assistant' as const,
            tool_calls: [{ id: 'research_1', type: 'function' as const, function: { name: 'access_research_database', arguments: JSON.stringify({ query }) } }]
        };
        const researchToolResponse = {
            role: 'tool' as const,
            tool_call_id: 'research_1',
            content: contextText || 'No documents found in the research database. Use internal knowledge with discernment.'
        };

        const messagesPayload = topSources.length > 0
            ? [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: query }, researchToolCall, researchToolResponse]
            : [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: query }];

        const modelName = activeThinking ? 'LongCat-Flash-Thinking' : 'LongCat-Flash-Chat';
        const aiResponse = await executeRotatedRequest(LONGCAT_KEYS, async (apiKey) => {
            const resp = await fetch('https://api.longcat.chat/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: modelName,
                    messages: messagesPayload,
                    tools: topSources.length > 0 ? [{ type: 'function', function: { name: 'access_research_database', description: 'Retrieve external web research documentation.', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }] : undefined,
                    max_tokens: activeThinking ? 32768 : 16384,
                    temperature: activeThinking ? 1.0 : 0.5
                })
            });
            if (!resp.ok) throw { status: resp.status, message: await resp.text() };
            const data = await resp.json();
            return data.choices[0].message.content;
        });

        return new Response(JSON.stringify({
            answer: aiResponse,
            sources: topSources.slice(0, 50),
            all_sources: rawResults,
            search_queries: planner.queries || [query],
            auto_applied: {
                search: activeSearch && !search,
                deep: activeDeep && !deep,
                thinking: activeThinking && !thinking
            }
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (err: any) {
        console.error("Monolith elite engine error:", err);
        return new Response(JSON.stringify({ error: err.message || "Elite Engine Error" }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
