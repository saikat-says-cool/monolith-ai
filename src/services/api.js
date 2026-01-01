import axios from 'axios';

// LangSearch API Keys Pool
const LANGSEARCH_KEYS = [
    'sk-b523f81de2824c58b166ec0a6bd7a34f',
    'sk-dbfa94b2f94e4f16a2f075cba2b0a0a8',
    'sk-3cc37c168e2f4a2f8004511ad285e4d2',
    'sk-7afaeaa225a54826ab32e6d3d8a50b71',
    'sk-a875d42a2fda434a98e76d10b8eb0ede',
    'sk-977469c8a9854c6b806dea773334053c',
    'sk-5fb69fee782f410dbc3cdb47419bbcaa'
];

let currentKeyIndex = 0;

const getLangSearchKey = () => LANGSEARCH_KEYS[currentKeyIndex];

const rotateKey = () => {
    currentKeyIndex = (currentKeyIndex + 1) % LANGSEARCH_KEYS.length;
    console.log(`[LangSearch] Rate limit hit. Rotating to key index ${currentKeyIndex}`);
};

// Generic wrapper for LangSearch requests with auto-rotation
const executeLangSearchRequest = async (requestFn) => {
    let attempts = 0;
    // Try each key at least once
    while (attempts < LANGSEARCH_KEYS.length) {
        try {
            const apiKey = getLangSearchKey();
            return await requestFn(apiKey);
        } catch (error) {
            // Check for Rate Limit (429) or Payment Required/Quota (402)
            if (error.response && (error.response.status === 429 || error.response.status === 402)) {
                rotateKey();
                attempts++;
                continue; // Retry with new key
            }
            // If it's another error, throw it immediately
            throw error;
        }
    }
    throw new Error("All LangSearch API keys are exhausted or rate-limited.");
};

const AI_API_KEY = import.meta.env.VITE_AI_API_KEY;
const AI_BASE_URL = import.meta.env.VITE_AI_BASE_URL || 'https://api.openai.com/v1';
const AI_MODEL = import.meta.env.VITE_AI_MODEL || 'gpt-4o';

export const searchWeb = async (query, count = 10) => {
    try {
        const response = await executeLangSearchRequest((apiKey) =>
            axios.post('https://api.langsearch.com/v1/web-search', {
                query: query,
                summary: true,
                count: count,
                freshness: 'all' // Default to all-time, can be overridden by specific logic
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })
        );
        // The documentation shows response.data.data.webPages.value
        return response.data.data?.webPages?.value || [];
    } catch (error) {
        console.error('LangSearch Error:', error.message);
        return [];
    }
};

export const rerankResults = async (query, documents, topN = 5) => {
    if (!documents || documents.length === 0) return documents;

    try {
        const response = await executeLangSearchRequest((apiKey) =>
            axios.post('https://api.langsearch.com/v1/rerank', {
                model: 'langsearch-reranker-v1',
                query: query,
                documents: documents.map(d => d.summary || d.snippet),
                top_n: topN,
                return_documents: true
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })
        );

        // Map reranked results back to original document structure
        const reranked = response.data.results.map(result => {
            const originalDoc = documents[result.index];
            return {
                ...originalDoc,
                relevance_score: result.relevance_score
            };
        });

        return reranked;
    } catch (error) {
        console.error('Rerank Error:', error.message);
        return documents.slice(0, topN); // Fallback to top N original
    }
};

// LongCat API Keys Pool
const LONGCAT_KEYS = [
    'ak_1ZT5QN3iq4fp2lh54j9BH1rW1Ai7v',
    'ak_1Xt5vz8fh7go0WM5UG5qH1tZ7717J',
    'ak_1tn5Db5nh7Ro6mU78e38a8DT62q5M',
    'ak_1kP69v1S20W75nD0Rg1qp1Dq1xX0l',
    'ak_1iV6O22pL7PP9Pc6MZ4AL41t8NM02',
    'ak_1mV6g611i9FE94Y2GS2pj7Dg22Z3Q',
    'ak_1Hs6ON2Kg3dg7N69YY4tl8Nv1Vh5E',
    'ak_1t96Cv6b528y8oC6fx37E7Vp9Gh2C',
    'ak_1ZP6tv7jZ1CT6ri5Fw2jB0uX6jW84',
    'ak_1By6G582R2fo7UW30k8Hy85U8H56c',
    'ak_1Ir7Hz8ME8Js4OS03c5mn0PC71H2X',
    'ak_1YS76u2Qg7xn6xa6UN5JW3BL9QK7K',
    'ak_1RN7kW08e3XR0hI8xw8QJ5os82133',
    'ak_1hv7ql7Q85vr45n42U1xD8Gj6Ms1z',
    'ak_1Bm8Fn89i1Xv4W70IV10T5LK19u1C',
    'ak_1Uf8lO5PH4Bo4tS8J47dA1FC6Go60'
];

let currentLongCatKeyIndex = 0;

const getLongCatKey = () => LONGCAT_KEYS[currentLongCatKeyIndex];

const rotateLongCatKey = () => {
    currentLongCatKeyIndex = (currentLongCatKeyIndex + 1) % LONGCAT_KEYS.length;
    console.log(`[LongCat] Rate limit hit. Rotating to key index ${currentLongCatKeyIndex}`);
};

const executeLongCatRequest = async (requestFn) => {
    let attempts = 0;
    while (attempts < LONGCAT_KEYS.length) {
        try {
            const apiKey = getLongCatKey();
            return await requestFn(apiKey);
        } catch (error) {
            // Handle fetch errors (which don't have .response)
            const status = error.response ? error.response.status : (error.status || 500);
            if (status === 429 || status === 402) {
                rotateLongCatKey();
                attempts++;
                continue;
            }
            throw error;
        }
    }
    throw new Error("All LongCat API keys are exhausted or rate-limited.");
};

export const generateSearchQueries = async (userQuery, count = 3) => {
    const systemPrompt = `You are a search query optimization expert. Your task is to take a user's question and generate ${count} different, highly specific search queries that will help find comprehensive information to answer their question.

RULES:
1. Each query should target a different aspect or angle of the user's question.
2. Make queries specific and search-engine friendly (no conversational fluff).
3. Include relevant keywords, dates (like "2024" or "latest"), and specific terms.
4. If the question is about comparisons, generate separate queries for each item being compared.
5. RECENCY: If the question is about current events or a time-sensitive topic, ensure at least one query targets the absolute latest developments (using terms like "today", "now", "breaking").
6. Return ONLY a JSON array of strings, nothing else. Example: ["query 1", "query 2", "query 3"]

USER QUESTION: ${userQuery}`;

    try {
        const response = await executeLongCatRequest((apiKey) =>
            axios.post('https://api.longcat.chat/openai/v1/chat/completions', {
                model: 'LongCat-Flash-Chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Generate the search queries now.' }
                ],
                stream: false,
                max_tokens: 512,
                temperature: 0.3
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })
        );

        const content = response.data.choices[0].message.content.trim();
        const queries = JSON.parse(content);

        // Always include the original query
        if (!queries.includes(userQuery)) {
            queries.unshift(userQuery);
        }

        console.log('[Multi-Query] Generated queries:', queries);
        return queries.slice(0, count + 1);
    } catch (error) {
        console.error('Query Generation Error:', error.message);
        return [userQuery]; // Fallback
    }
};

// Run multiple searches in parallel and merge unique results
export const parallelSearch = async (queries, countPerQuery = 10) => {
    console.log(`[Parallel Search] Running ${queries.length} queries in parallel...`);

    const searchPromises = queries.map(query => searchWeb(query, countPerQuery));
    const allResults = await Promise.all(searchPromises);

    // Flatten and deduplicate by URL
    const seenUrls = new Set();
    const uniqueResults = [];

    for (const results of allResults) {
        for (const result of results) {
            if (!seenUrls.has(result.url)) {
                seenUrls.add(result.url);
                uniqueResults.push(result);
            }
        }
    }

    console.log(`[Parallel Search] Found ${uniqueResults.length} unique results from ${queries.length} queries`);
    return uniqueResults;
};

export const getAIResponse = async (query, contexts, history = [], deep = false, customSystemPrompt = null) => {
    const contextText = contexts.map((c, i) => `[ID: ${i + 1}] Source: ${c.url}\nTitle: ${c.name}\nContent: ${c.summary || c.snippet}`).join('\n\n');

    // Format history for the prompt
    const historyText = history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

    const basePrompt = `You are a friendly, intelligent, and ${deep ? 'highly detailed, expert-level' : 'highly conversational'} AI assistant. ${deep ? 'You are currently in DEEP RESEARCH mode, so provide extremely comprehensive, nuanced, and detailed analysis.' : 'Your goal is to help the user with their needs while maintaining a natural, warm, and engaging dialogue.'}`;

    const systemPrompt = `${customSystemPrompt ? `CUSTOM INSTRUCTIONS: ${customSystemPrompt}\n\n` : ''}${basePrompt}

KNOWLEDGE (REAL-TIME SEARCH RESULTS):
${contextText}

CONVERSATION HISTORY:
${historyText}

INSTRUCTIONS:
1. Use the provided search results to inform your answer. ${deep ? 'Analyze the sources deeply, looking for connections and detailed insights.' : 'Present them in a natural, conversational way.'}
2. **PRIORITIZE RECENCY**: If recent information is available, prioritize it. Always lead with the latest developments if the topic is current.
3. DO NOT use inline citations like [1], [2], or (Source 1). Keep the text clean.
4. Reference the conversation history if the user refers back to previous topics.
5. ${deep ? 'Provide a long, exhaustive response with multiple sections if necessary.' : 'Be thorough but concise.'}
6. If the search results don't help, use your internal knowledge while being honest about your sources.
7. Adopt a professional yet helpful "sidekick" persona.`;

    try {
        const response = await executeLongCatRequest((apiKey) =>
            axios.post('https://api.longcat.chat/openai/v1/chat/completions', {
                model: 'LongCat-Flash-Chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: query }
                ],
                stream: false,
                max_tokens: deep ? 8192 : 4096, // More tokens for deep research
                temperature: 0.7
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })
        );

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('LongCat API Error:', error.message);
        return "I apologize, but I'm having trouble generating an answer right now. Please try again later.";
    }
};
// AssemblyAI Voice Transcription Pool
const ASSEMBLY_AI_KEYS = [
    '423b13e0543d494ba19bf307da601665',
    'aab3043373c64ed1ab847b7b042d5842',
    '7763ab46f71b482ab99b0e89e82af886',
    '030ba214fc8443348935c27fd786c59f',
    '287d8bc4fab746ec9e9b09cb46e10ddf'
];

let currentAssemblyAIKeyIndex = 0;

const getAssemblyAIKey = () => ASSEMBLY_AI_KEYS[currentAssemblyAIKeyIndex];

const rotateAssemblyAIKey = () => {
    currentAssemblyAIKeyIndex = (currentAssemblyAIKeyIndex + 1) % ASSEMBLY_AI_KEYS.length;
    console.log(`[AssemblyAI] Rate limit or error hit. Rotating to key index ${currentAssemblyAIKeyIndex}`);
};

const executeAssemblyAIRequest = async (requestFn) => {
    let attempts = 0;
    while (attempts < ASSEMBLY_AI_KEYS.length) {
        try {
            const apiKey = getAssemblyAIKey();
            return await requestFn(apiKey);
        } catch (error) {
            const status = error.response ? error.response.status : (error.status || 500);
            // 429: Too Many Requests, 401/403: Potentially exhausted/invalid in some cases, usually 429 for rates
            if (status === 429 || status === 402) {
                rotateAssemblyAIKey();
                attempts++;
                continue;
            }
            throw error;
        }
    }
    throw new Error("All AssemblyAI API keys are exhausted or rate-limited.");
};

export const transcribeAudio = async (audioBlob) => {
    try {
        // 1. Upload the audio file with rotation support
        const uploadUrl = await executeAssemblyAIRequest(async (apiKey) => {
            const response = await axios.post('https://api.assemblyai.com/v2/upload', audioBlob, {
                headers: {
                    'Authorization': apiKey,
                    'Content-Type': 'application/octet-stream'
                }
            });
            return response.data.upload_url;
        });

        // 2. Start transcription with rotation support
        const transcriptId = await executeAssemblyAIRequest(async (apiKey) => {
            const response = await axios.post('https://api.assemblyai.com/v2/transcript', {
                audio_url: uploadUrl
            }, {
                headers: {
                    'Authorization': apiKey,
                    'Content-Type': 'application/json'
                }
            });
            return response.data.id;
        });

        // 3. Poll for result with the SAME key that started the transcript (AssemblyAI transcript IDs are key-specific)
        // Note: Polling should ideally use the same key, but AssemblyAI keeps transcript data for a while.
        // If the key rotated between upload and transcript, we might have issues, but let's assume session consistency for polling.
        const activeKey = getAssemblyAIKey();

        while (true) {
            const statusResponse = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
                headers: {
                    'Authorization': activeKey
                }
            });

            const { status, text, error } = statusResponse.data;

            if (status === 'completed') {
                return text;
            } else if (status === 'error') {
                throw new Error(`AssemblyAI Transcription Error: ${error}`);
            }

            // Wait for 1.5 seconds before polling again
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    } catch (error) {
        console.error('Transcription Error:', error);
        throw error;
    }
};


