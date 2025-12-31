// Supabase Edge Function: monolith-chat
// Optimized for conservative rate-limiting, payload management, and conversational intelligence.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Global guidelines that cannot be overridden by user prompts
const GLOBAL_MONOLITH_GUIDELINES = `
CORE PROTOCOLS:
1. TRUTH & ACCURACY: Never hallucinate. If search results are ambiguous or contradictory, state so.
2. CURRENT CONTEXT: You have a high-latency connection to the web. Always check the current date/time provided.
3. CITATION HYGIENE: Do not use inline [1][2] markers. Instead, refer to sources naturally (e.g., "According to the New York Times..." or "Recent data from the World Bank suggests...").
4. PERSONA: You are Monolith, a researcher of unparalleled caliber. You are sophisticated, articulate, and deeply helpful.
5. NO PLACEHOLDERS: Never say "I will look that up" or "Searching...". You are provide the FINAL synthesis.
6. ERROR HANDLING: If search results are entirely missing, briefly mention that your web-access layer hit a snag but provide the best possible answer from internal knowledge.
`;

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // 0. AUTHENTICATION (Internal vs External)
        const authHeader = req.headers.get('Authorization')
        const providedKey = authHeader?.replace('Bearer ', '').trim()
        const isExternal = providedKey?.startsWith('pk-')

        if (isExternal) {
            // Initialize Supabase Client for Key Validation
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2")
            const supabaseAdmin = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
            )

            const { data: keyRecord, error: keyError } = await supabaseAdmin
                .from('api_keys')
                .select('*')
                .eq('key', providedKey)
                .single()

            if (keyError || !keyRecord) {
                return new Response(JSON.stringify({ error: "Invalid or expired API Key." }), {
                    status: 403,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                })
            }
            console.log(`[Monolith API] External request authorized via key: ${keyRecord.name}`)
        } else {
            console.log(`[Monolith] Internal web request authorized.`)
        }

        const body = await req.json();
        const { query: searchQuery, queries = [], history = [], deep = false, space_id = 'default', custom_prompt = null } = body;

        // Get current Date/Time for context
        const now = new Date();
        const dateTimeContext = `Current Date/Time: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}`;

        // 1. Setup API Keys
        const LANGSEARCH_KEYS = Deno.env.get('LANGSEARCH_KEYS')?.split(',').map(k => k.trim()).filter(Boolean) || []
        const LONGCAT_KEYS = Deno.env.get('LONGCAT_KEYS')?.split(',').map(k => k.trim()).filter(Boolean) || []

        if (LANGSEARCH_KEYS.length === 0 || LONGCAT_KEYS.length === 0) {
            throw new Error("API Keys not configured in Supabase Secrets")
        }

        // --- HELPER FUNCTIONS ---
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        const executeRotatedRequest = async (keys: string[], requestFn: (key: string) => Promise<any>, offset: number = 0) => {
            let attempts = 0;
            while (attempts < keys.length) {
                const keyIndex = (offset + attempts) % keys.length;
                try {
                    return await requestFn(keys[keyIndex]);
                } catch (error) {
                    const status = error.status || 0;
                    // Rotate on: Key Issues (401, 403), Provider Issues (5xx, 429, 402), or Network/Crash (0)
                    const shouldRotate = status >= 500 || status === 0 || [401, 402, 403, 429].includes(status);

                    if (shouldRotate) {
                        console.warn(`[Safety Net] Key index ${keyIndex} failed (Status: ${status}). Rotating to next key...`);
                        attempts++;
                        if (attempts < keys.length) {
                            await sleep(status === 429 ? 2000 : 500); // Increased paced delay for reliability
                            continue;
                        }
                    }
                    throw error; // If it's a 400 (Client error) or all keys failed, throw
                }
            }
            throw new Error(`Monolith Safety Net: Exhausted ${keys.length} keys or provider is globally down.`);
        }

        // 2. Search Planning
        let generatedQueries = queries;
        let searchStrategy = {
            depth_label: deep ? "Exhaustive" : "Adaptive",
            count_per_call: deep ? 35 : 15,
            use_hour_layer: false,
            freshness: "all" as any,
            conversational_tone: !deep // Personality only for normal mode
        };

        console.log(`[Monolith] Planning search strategy for: ${searchQuery}`)
        const plannerResponse = await executeRotatedRequest(LONGCAT_KEYS, async (apiKey) => {
            const resp = await fetch('https://api.longcat.chat/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'LongCat-Flash-Chat',
                    messages: [
                        {
                            role: 'system',
                            content: `You are the Monolith Search Planner. Your goal is to determine how to best find information for a query.
                            Output a JSON object:
                            {
                              "queries": ["query1", ...],
                              "depth_label": "Surface" | "Standard" | "Deep",
                              "use_hour_layer": boolean,
                              "freshness": "hour" | "day" | "week" | "month" | "year" | "all",
                              "reasoning": "short explanation"
                            }
                            - freshness: 
                                - "hour"/"day": For breaking news, stocks, sports results, or "in the last 24h" queries.
                                - "week"/"month": For ongoing events, recent trends (last few days/weeks).
                                - "year": For recent history, annual reports, 2024/2025 specific info.
                                - "all": For general knowledge, history, or whenever background context is better than just news.
                            - use_hour_layer: true ONLY if the query is extremely time-sensitive (news happening NOW).
                            - queries: Generate search-engine optimized strings. If the user provided specific queries already, you can return them or suggest better ones.`
                        },
                        { role: 'user', content: `Query: ${searchQuery}${queries.length > 0 ? `\nExisting Query Paths: ${JSON.stringify(queries)}` : ''}` }
                    ],
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                })
            });
            if (!resp.ok) {
                const errBody = await resp.text();
                console.error(`[Monolith] API Error (Status: ${resp.status}):`, errBody);
                throw { status: resp.status, message: errBody };
            }
            const data = await resp.json();
            let content = data.choices[0].message.content.trim();
            // Safety clean
            if (content.includes('```')) content = content.replace(/```json|```/g, '').trim();
            return JSON.parse(content);
        });

        if (!generatedQueries || generatedQueries.length === 0) {
            generatedQueries = plannerResponse.queries;
        }
        searchStrategy.depth_label = plannerResponse.depth_label;
        searchStrategy.use_hour_layer = plannerResponse.use_hour_layer;
        searchStrategy.freshness = plannerResponse.freshness;

        // Adjust results count based on planner depth
        if (plannerResponse.depth_label === "Surface") searchStrategy.count_per_call = 15;
        else if (plannerResponse.depth_label === "Standard") searchStrategy.count_per_call = 20;
        else if (plannerResponse.depth_label === "Deep") searchStrategy.count_per_call = 35; // Increased for Deep

        console.log(`[Monolith] Planner selected ${searchStrategy.depth_label} depth, freshness: ${searchStrategy.freshness}, hour_layer: ${searchStrategy.use_hour_layer}.`)
        if (!generatedQueries.includes(searchQuery)) generatedQueries.unshift(searchQuery);

        // 3. Orchestrated Search (Strict pacing to respect 1 req/sec limit)
        console.log(`[Monolith] Searching ${generatedQueries.length} paths with strict pacing...`)

        const allSearchLayers: any[] = [];
        generatedQueries.forEach((q: string, qIndex: number) => {
            // Priority 1: Requested Freshness (if not 'all')
            if (searchStrategy.freshness !== 'all') {
                allSearchLayers.push({ query: q, freshness: searchStrategy.freshness, index: qIndex });
            }

            // Priority 2: Hour layer for extreme recency
            if (searchStrategy.use_hour_layer && searchStrategy.freshness !== 'hour') {
                allSearchLayers.push({ query: q, freshness: 'hour', index: qIndex });
            }

            // Priority 3: General Knowledge (Context)
            // We always include 'all' for the first query or in deep mode to ensure depth.
            if (qIndex === 0 || deep || searchStrategy.freshness === 'all') {
                allSearchLayers.push({ query: q, freshness: 'all', index: qIndex });
            }
        });

        const resultsArray: any[] = [];
        const staggerMs = 1100; // Safe 1.1s gap to strictly respect 1 req/sec

        // Sequential execution with pacing for search calls
        for (let i = 0; i < allSearchLayers.length; i++) {
            const layer = allSearchLayers[i];
            try {
                console.log(`[Monolith] Fetching Layer ${i + 1}/${allSearchLayers.length}: [${layer.freshness}] ${layer.query}`);
                const layerResults = await executeRotatedRequest(LANGSEARCH_KEYS, async (apiKey) => {
                    const resp = await fetch('https://api.langsearch.com/v1/web-search', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: layer.query,
                            summary: true,
                            count: searchStrategy.count_per_call,
                            freshness: layer.freshness
                        })
                    });
                    if (!resp.ok) {
                        const errBody = await resp.text();
                        // Special handling for 429 even inside rotated request to be extra safe
                        if (resp.status === 429) {
                            console.warn("[Monolith] Hard rate limit hit, doubling wait time...");
                            await sleep(2000);
                        }
                        throw { status: resp.status, message: `Search(${layer.freshness}) Error: ${errBody}` };
                    }
                    const data = await resp.json();
                    return data.data?.webPages?.value || [];
                }, i);
                resultsArray.push(layerResults);
            } catch (err) {
                console.warn(`[Monolith Orchestrator] Search layer failed but proceeding:`, err);
            }

            // Pacing: Wait only if not the last request
            if (i < allSearchLayers.length - 1) {
                await sleep(staggerMs);
            }
        }

        const allResults = [];
        const seenUrls = new Set();
        for (const list of resultsArray) {
            for (const item of list) {
                if (!seenUrls.has(item.url)) {
                    seenUrls.add(item.url);
                    allResults.push(item);
                }
            }
        }

        // 4. Rerank
        console.log(`[Monolith] Reranking ${allResults.length} unique sources...`)
        let reranked = [];
        if (allResults.length > 0) {
            const docsToRerank = allResults.slice(0, 100);
            const chunkSize = 50;
            const chunks = [];
            for (let i = 0; i < docsToRerank.length; i += chunkSize) {
                chunks.push(docsToRerank.slice(i, i + chunkSize));
            }

            // Rerank also needs pacing if multiple chunks
            for (let idx = 0; idx < chunks.length; idx++) {
                const chunk = chunks[idx];
                try {
                    const chunkReranked = await executeRotatedRequest(LANGSEARCH_KEYS, async (apiKey) => {
                        const resp = await fetch('https://api.langsearch.com/v1/rerank', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                model: 'langsearch-reranker-v1',
                                query: searchQuery,
                                documents: chunk.map(d => (d.summary || d.snippet || d.name || "").slice(0, 800)),
                                top_n: chunk.length,
                                return_documents: false
                            })
                        });
                        if (!resp.ok) {
                            const errBody = await resp.text();
                            throw { status: resp.status, message: `Rerank Error: ${errBody}` };
                        }
                        const data = await resp.json();
                        return data.results.map(r => ({ ...chunk[r.index], relevance_score: r.relevance_score }));
                    }, idx + resultsArray.length); // Use unique offset
                    reranked.push(...chunkReranked);
                } catch (err) {
                    console.warn(`[Monolith Orchestrator] Rerank chunk ${idx} failed:`, err);
                }

                if (idx < chunks.length - 1) await sleep(staggerMs);
            }
            reranked.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
        }

        // 5. Synthesis
        const contextLimit = deep ? 40 : 20;
        console.log(`[Monolith] Synthesizing answer from top ${Math.min(reranked.length, contextLimit)} sources...`)

        const contextText = (reranked.length > 0 ? reranked : allResults).slice(0, contextLimit).map((c, i) => {
            const content = (c.summary || c.snippet || "").slice(0, 1200);
            const dateStr = c.datePublished ? ` (Published: ${c.datePublished})` : (c.dateLastCrawled ? ` (Cached: ${c.dateLastCrawled})` : "");
            return `[SOURCE ${i + 1}] Title: ${c.name}${dateStr}\nURL: ${c.url}\nContent: ${content}`;
        }).join('\n\n');

        const basePrompt = `You are Monolith AI.
CONTEXT:
${dateTimeContext}
Search Strategy: Freshness=${searchStrategy.freshness}, Time-Sensitive=${searchStrategy.use_hour_layer}

QUERY: "${searchQuery}"

STRATEGY: ${searchStrategy.conversational_tone ?
                'BE CONVERSATIONAL: Talk like a brilliant friend who has just done the research for you. Weave the information into a natural, engaging narrative. Use a touch of personality but keep it professional and authoritative.' :
                'BE EXHAUSTIVE: Provide a thorough, structured, and citation-heavy research report. Cover all nuances, data points, and perspectives found in the sources. Use detailed sections.'
            }

SOURCES:
${contextText || "No direct web results found. Use your internal knowledge but acknowledge the lack of recent sources."}`;

        // Combine prompts: Global -> User Custom -> Base
        const finalSystemPrompt = `
${GLOBAL_MONOLITH_GUIDELINES}
${custom_prompt ? `USER-SPECIFIC INSTRUCTIONS:\n${custom_prompt}\n` : ''}
${basePrompt}`;

        const aiResponse = await executeRotatedRequest(LONGCAT_KEYS, async (apiKey) => {
            const resp = await fetch('https://api.longcat.chat/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'LongCat-Flash-Chat',
                    messages: [
                        { role: 'system', content: finalSystemPrompt },
                        ...history,
                        { role: 'user', content: searchQuery }
                    ],
                    max_tokens: deep ? 4096 : 2048,
                    temperature: 0.7
                })
            });
            if (!resp.ok) {
                const errText = await resp.text();
                throw { status: resp.status, message: `Synthesis Error: ${errText}` };
            }
            const data = await resp.json();
            return data.choices[0].message.content;
        });

        return new Response(JSON.stringify({
            answer: aiResponse,
            sources: (reranked.length > 0 ? reranked : allResults).slice(0, contextLimit),
            all_sources: allResults,
            search_queries: generatedQueries
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error("Monolith Edge Error:", err);
        const errorMessage = typeof err === 'string' ? err : (err.message || "Internal Server Error");
        return new Response(JSON.stringify({
            error: errorMessage,
            details: err.status ? `API Status ${err.status}` : err.toString()
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
})

