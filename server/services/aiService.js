import axios from 'axios';

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

// Generate multiple optimized search queries from a single user input
export const generateSearchQueries = async (userQuery, count = 3) => {
    const systemPrompt = `You are a search query optimization expert. Your task is to take a user's question and generate ${count} different, highly specific search queries that will help find comprehensive information to answer their question.

RULES:
1. Each query should target a different aspect or angle of the user's question.
2. Make queries specific and search-engine friendly (no conversational fluff).
3. Include relevant keywords, dates (like "2024" or "latest"), and specific terms.
4. If the question is about comparisons, generate separate queries for each item being compared.
5. Return ONLY a JSON array of strings, nothing else. Example: ["query 1", "query 2", "query 3"]

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
                temperature: 0.3 // Lower temperature for more focused output
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })
        );

        const content = response.data.choices[0].message.content.trim();
        // Parse the JSON array from the response
        const queries = JSON.parse(content);

        // Always include the original query as well
        if (!queries.includes(userQuery)) {
            queries.unshift(userQuery);
        }

        console.log('[Multi-Query] Generated queries:', queries);
        return queries.slice(0, count + 1); // Return original + generated
    } catch (error) {
        console.error('Query Generation Error:', error.message);
        // Fallback: just return the original query
        return [userQuery];
    }
};

export const getAIResponse = async (query, contexts, history = [], deep = false, customSystemPrompt = null) => {
    const contextText = contexts.map((c, i) => `[ID: ${i + 1}] Source: ${c.url}\nTitle: ${c.name}\nContent: ${c.summary || c.snippet}`).join('\n\n');

    const historyText = history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

    const basePrompt = `You are a friendly, intelligent, and ${deep ? 'highly detailed, expert-level' : 'highly conversational'} AI assistant. ${deep ? 'You are currently in DEEP RESEARCH mode, so provide extremely comprehensive, nuanced, and detailed analysis.' : 'Your goal is to help the user with their needs while maintaining a natural, warm, and engaging dialogue.'}`;

    const systemPrompt = `${customSystemPrompt ? `CUSTOM INSTRUCTIONS: ${customSystemPrompt}\n\n` : ''}${basePrompt}

KNOWLEDGE (REAL-TIME SEARCH RESULTS - PAST 24H):
${contextText}

CONVERSATION HISTORY:
${historyText}

INSTRUCTIONS:
1. Use the provided search results to inform your answer. ${deep ? 'Analyze the sources deeply, looking for connections and detailed insights.' : 'Present them in a natural, conversational way.'}
2. **REAL-TIME PRIORITY**: You have access to real-time search results. Prioritize the most recent information from the past 24 hours. Always lead with the absolute latest developments if available.
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
                max_tokens: deep ? 8192 : 4096,
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
