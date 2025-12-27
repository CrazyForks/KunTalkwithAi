export interface SearchHit {
    title: string;
    href: string;
    snippet: string;
}

export const WebSearchService = {
    async search(query: string): Promise<SearchHit[]> {
        const apiKey = import.meta.env.VITE_GOOGLE_SEARCH_API_KEY;
        const cseId = import.meta.env.VITE_GOOGLE_CSE_ID;

        if (!apiKey || !cseId) {
            console.warn('Web Search skipped: Missing API Key or CSE ID in .env');
            return [];
        }

        const endpoint = import.meta.env.VITE_GOOGLE_SEARCH_API_URL || 'https://www.googleapis.com/customsearch/v1';
        const url = new URL(endpoint);
        url.searchParams.append('key', apiKey);
        url.searchParams.append('cx', cseId);
        url.searchParams.append('q', query);
        url.searchParams.append('num', '5'); // Align with Android count

        try {
            const res = await fetch(url.toString());
            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                console.error('Google Search failed:', res.status, res.statusText, txt);
                return [];
            }

            const data = await res.json();
            const items = data.items || [];

            return items.map((item: any) => ({
                title: item.title || '',
                href: item.link || '',
                snippet: item.snippet || ''
            }));
        } catch (e) {
            console.error('Google Search error:', e);
            return [];
        }
    },

    formatResultsForPrompt(results: SearchHit[], query: string): string {
        if (results.length === 0) return '';
        
        let formatted = `Search results for "${query}":\n\n`;
        results.forEach((hit, idx) => {
            formatted += `${idx + 1}. ${hit.title}\n`;
            if (hit.snippet) formatted += `${hit.snippet}\n`;
            if (hit.href) formatted += `${hit.href}\n\n`;
        });
        formatted += `Please answer based on the search results above.\n`;
        return formatted;
    }
};