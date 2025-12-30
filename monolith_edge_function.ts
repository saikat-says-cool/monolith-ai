// Supabase Edge Function: monolith-chat
// This replaces your Node.js backend logic for search and AI synthesis.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"
import axios from "https://esm.sh/axios@1.6.7"

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
        const { query: searchQuery, history = [], deep = false, space_id = 'default', stream = false } = await req.json()

        if (!searchQuery) {
            return new Response(JSON.stringify({ error: "Query is required" }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // 1. Setup API Keys (From Supabase Secrets)
        const LANGSEARCH_KEYS = Deno.env.get('LANGSEARCH_KEYS')?.split(',') || []
        const LONGCAT_KEYS = Deno.env.get('LONGCAT_KEYS')?.split(',') || []

        if (LANGSEARCH_KEYS.length === 0 || LONGCAT_KEYS.length === 0) {
            throw new Error("API Keys not configured in Supabase Secrets")
        }

        // --- HELPER FUNCTIONS ---
        const executeRotatedRequest = async (keys, requestFn) => {
            let attempts = 0;
            while (attempts < keys.length) {
                try {
                    return await requestFn(keys[attempts]);
                } catch (error) {
                    if (error.response?.status === 429 || error.response?.status === 402) {
                        attempts++;
                        continue;
                    }
                    throw error;
                }
            }
            throw new Error("All API keys for a service are exhausted.");
        }

        // 2. Generate Search Queries
        console.log(`[Monolith] Generating queries for: ${searchQuery}`)
        const queryCount = deep ? 5 : 3
        const generatedQueries = await executeRotatedRequest(LONGCAT_KEYS, async (apiKey) => {
            const res = await axios.post('https://api.longcat.chat/openai/v1/chat/completions', {
                model: 'LongCat-Flash-Chat',
                messages: [
                    { role: 'system', content: `Generate ${queryCount} optimized search queries. Return ONLY a JSON array of strings.` },
                    { role: 'user', content: searchQuery }
                ],
                temperature: 0.3
            }, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            return JSON.parse(res.data.choices[0].message.content.trim());
        });
        if (!generatedQueries.includes(searchQuery)) generatedQueries.unshift(searchQuery);

        // 3. Parallel Search
        console.log(`[Monolith] Searching ${generatedQueries.length} paths...`)
        const searchPromises = generatedQueries.map(q => executeRotatedRequest(LANGSEARCH_KEYS, async (apiKey) => {
            const res = await axios.post('https://api.langsearch.com/v1/web-search', {
                query: q, summary: true, count: deep ? 20 : 10, freshness: 'day'
            }, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            return res.data.data?.webPages?.value || [];
        }));
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
        console.log(`[Monolith] Reranking ${allResults.length} sources...`)
        let reranked = allResults;
        if (allResults.length > 0) {
            reranked = await executeRotatedRequest(LANGSEARCH_KEYS, async (apiKey) => {
                const res = await axios.post('https://api.langsearch.com/v1/rerank', {
                    model: 'langsearch-reranker-v1',
                    query: searchQuery,
                    documents: allResults.map(d => d.summary || d.snippet),
                    top_n: deep ? 20 : 10,
                    return_documents: true
                }, { headers: { 'Authorization': `Bearer ${apiKey}` } });
                return res.data.results.map(r => ({ ...allResults[r.index], relevance_score: r.relevance_score }));
            });
        }

        // 5. AI Response
        console.log(`[Monolith] Synthesizing answer...`)
        const contextText = reranked.map((c, i) => `[ID: ${i + 1}] Title: ${c.name}\nContent: ${c.summary || c.snippet}`).join('\n\n');
        const systemPrompt = `You are the Monolith AI. Use the provided search results to answer.${deep ? ' Provide deep analysis.' : ''}\n\nKNOWLEDGE:\n${contextText}`;

        const aiResponse = await executeRotatedRequest(LONGCAT_KEYS, async (apiKey) => {
            const res = await axios.post('https://api.longcat.chat/openai/v1/chat/completions', {
                model: 'LongCat-Flash-Chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...history,
                    { role: 'user', content: searchQuery }
                ],
                max_tokens: deep ? 4096 : 2048,
                temperature: 0.7
            }, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            return res.data.choices[0].message.content;
        });

        // Return the final payload
        return new Response(JSON.stringify({
            answer: aiResponse,
            sources: reranked,
            all_sources: allResults,
            search_queries: generatedQueries
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error("Monolith Edge Error:", err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
})
