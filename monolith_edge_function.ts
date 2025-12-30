// Supabase Edge Function: monolith-chat
// Optimized for conservative rate-limiting, payload management, and conversational intelligence.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { query: searchQuery, queries = [], history = [], deep = false, space_id = 'default', custom_prompt = null } = await req.json()

        if (!searchQuery) {
            return new Response(JSON.stringify({ error: "Query is required" }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

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
                    if (error.status === 429 || error.status === 402) {
                        console.warn(`Key index ${keyIndex} rate limited (Status: ${error.status}), rotating...`);
                        attempts++;
                        if (attempts < keys.length) await sleep(1000);
                        continue;
                    }
                    throw error;
                }
            }
            throw new Error(`All ${keys.length} API keys for this service are exhausted.`);
        }

        // 2. Search Planning
        let generatedQueries = queries;
        let searchStrategy = {
            depth_label: deep ? "Exhaustive" : "Adaptive",
            count_per_call: deep ? 35 : 15,
            use_hour_layer: true,
            conversational_tone: !deep // Personality only for normal mode
        };

        if (!generatedQueries || generatedQueries.length === 0) {
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
                                content: `You are the Monolith Search Planner. Your goal is to determine how deep to search.
                                Output a JSON object:
                                {
                                  "queries": ["query1", ...],
                                  "depth_label": "Surface" | "Standard" | "Deep",
                                  "use_hour_layer": boolean,
                                  "freshness": "hour" | "day" | "week" | "month" | "year" | "all",
                                  "reasoning": "short explanation"
                                }
                                - Surface: 1-2 queries (Quick facts). Use 15 results.
                                - Standard: 3 queries (Normal search). Use 20 results.
                                - Deep: 4-5 queries (Complex/Deep). Use 30 results.
                                - use_hour_layer: true if search is time-sensitive (news, stocks, current events).`
                            },
                            { role: 'user', content: searchQuery }
                        ],
                        temperature: 0.2,
                        response_format: { type: "json_object" }
                    })
                });
                if (!resp.ok) throw { status: resp.status };
                const data = await resp.json();
                return JSON.parse(data.choices[0].message.content.trim());
            });

            generatedQueries = plannerResponse.queries;
            searchStrategy.depth_label = plannerResponse.depth_label;
            searchStrategy.use_hour_layer = plannerResponse.use_hour_layer;

            // Adjust results count based on planner depth
            if (plannerResponse.depth_label === "Surface") searchStrategy.count_per_call = 15;
            else if (plannerResponse.depth_label === "Standard") searchStrategy.count_per_call = 20;
            else if (plannerResponse.depth_label === "Deep") searchStrategy.count_per_call = 30;

            console.log(`[Monolith] Planner selected ${searchStrategy.depth_label} depth with ${generatedQueries.length} queries.`)
            if (!generatedQueries.includes(searchQuery)) generatedQueries.unshift(searchQuery);
        }

        // 3. Parallel Search
        console.log(`[Monolith] Searching ${generatedQueries.length} paths with pacing...`)
        const staggerDelay = deep ? 1500 : 800;

        const searchPromises = generatedQueries.flatMap((q, qIndex) => {
            const layers = [];

            // Layer 1: Last Hour
            if (searchStrategy.use_hour_layer || deep) {
                layers.push((async () => {
                    await sleep(qIndex * staggerDelay);
                    return executeRotatedRequest(LANGSEARCH_KEYS, async (apiKey) => {
                        const resp = await fetch('https://api.langsearch.com/v1/web-search', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ query: q, summary: true, count: searchStrategy.count_per_call, freshness: 'hour' })
                        });
                        if (!resp.ok) throw { status: resp.status };
                        const data = await resp.json();
                        return data.data?.webPages?.value || [];
                    }, qIndex);
                })());
            }

            // Layer 2: Last Day
            layers.push((async () => {
                await sleep((qIndex * staggerDelay) + (staggerDelay / 2));
                return executeRotatedRequest(LANGSEARCH_KEYS, async (apiKey) => {
                    const resp = await fetch('https://api.langsearch.com/v1/web-search', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: q, summary: true, count: searchStrategy.count_per_call, freshness: 'day' })
                    });
                    if (!resp.ok) throw { status: resp.status };
                    const data = await resp.json();
                    return data.data?.webPages?.value || [];
                }, qIndex + generatedQueries.length);
            })());

            return layers;
        });

        const resultsArray = await Promise.all(searchPromises);
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

            const rerankPromises = chunks.map((chunk, idx) => executeRotatedRequest(LANGSEARCH_KEYS, async (apiKey) => {
                await sleep(idx * staggerDelay);
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
                if (!resp.ok) throw { status: resp.status };
                const data = await resp.json();
                return data.results.map(r => ({ ...chunk[r.index], relevance_score: r.relevance_score }));
            }, idx));

            const rerankedChunks = await Promise.all(rerankPromises);
            reranked = rerankedChunks.flat().sort((a, b) => b.relevance_score - a.relevance_score);
        }

        // 5. Synthesis
        const contextLimit = deep ? 40 : 20;
        console.log(`[Monolith] Synthesizing answer from top ${Math.min(reranked.length, contextLimit)} sources...`)

        const contextText = reranked.slice(0, contextLimit).map((c, i) => {
            const content = (c.summary || c.snippet || "").slice(0, 1200);
            return `[SOURCE ${i + 1}] Title: ${c.name}\nContent: ${content}`;
        }).join('\n\n');

        const basePrompt = `You are Monolith AI, a highly intelligent and conversational research assistant. 
Use the provided sources to answer the query: "${searchQuery}"

${searchStrategy.conversational_tone ?
                'BE CONVERSATIONAL: Talk like a brilliant friend who has just done the research for you. Avoid robotic "Based on the sources..." phrases. Instead, weave the information into a natural, engaging narrative. Use a touch of personality but keep it professional and authoritative.' :
                'BE EXHAUSTIVE: Provide a thorough, structured, and citation-heavy research report. Cover all nuances, data points, and perspectives found in the sources.'
            }

SOURCES:
${contextText}`;

        const finalSystemPrompt = custom_prompt ? `USER RULES: ${custom_prompt}\n\n${basePrompt}` : basePrompt;

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
                    max_tokens: deep ? 3000 : 1500,
                    temperature: 0.7
                })
            });
            if (!resp.ok) {
                const errText = await resp.text();
                throw { status: resp.status, message: errText };
            }
            const data = await resp.json();
            return data.choices[0].message.content;
        });

        return new Response(JSON.stringify({
            answer: aiResponse,
            sources: reranked.slice(0, contextLimit),
            all_sources: allResults,
            search_queries: generatedQueries
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error("Monolith Edge Error:", err);
        return new Response(JSON.stringify({
            error: err.message || "Internal Server Error",
            details: err.status === 413 ? "Payload too large for synthesis." : err.toString()
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
})
