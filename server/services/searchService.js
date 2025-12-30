import axios from 'axios';

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

const executeLangSearchRequest = async (requestFn) => {
    let attempts = 0;
    while (attempts < LANGSEARCH_KEYS.length) {
        try {
            const apiKey = getLangSearchKey();
            return await requestFn(apiKey);
        } catch (error) {
            if (error.response && (error.response.status === 429 || error.response.status === 402)) {
                rotateKey();
                attempts++;
                continue;
            }
            throw error;
        }
    }
    throw new Error("All LangSearch API keys are exhausted or rate-limited.");
};

export const searchWeb = async (query, count = 10) => {
    try {
        const response = await executeLangSearchRequest((apiKey) =>
            axios.post('https://api.langsearch.com/v1/web-search', {
                query: query,
                summary: true,
                count: count,
                freshness: 'day'
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })
        );
        return response.data.data?.webPages?.value || [];
    } catch (error) {
        console.error('LangSearch Error:', error.message);
        return [];
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
        return documents.slice(0, topN);
    }
};
