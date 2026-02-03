// Credit costs: { perRequest: number, perRecord: number }
export const CREDIT_COSTS: Record<string, { perRequest: number; perRecord: number }> = {
  // Backlinks
  '/backlinks/summary': { perRequest: 0, perRecord: 100 },
  '/backlinks/all': { perRequest: 0, perRecord: 1 },
  '/backlinks/anchors': { perRequest: 0, perRecord: 1 },
  '/backlinks/count': { perRequest: 0, perRecord: 10 },
  '/backlinks/authority': { perRequest: 0, perRecord: 100 },
  '/backlinks/authority/page': { perRequest: 0, perRecord: 10 },
  '/backlinks/authority/domain': { perRequest: 0, perRecord: 10 },
  '/backlinks/authority/domain/distribution': { perRequest: 0, perRecord: 1 },
  '/backlinks/referring-ips': { perRequest: 0, perRecord: 1 },
  '/backlinks/referring-ips/count': { perRequest: 0, perRecord: 10 },
  '/backlinks/metrics': { perRequest: 0, perRecord: 100 },
  '/backlinks/history': { perRequest: 0, perRecord: 1 },
  '/backlinks/history/count': { perRequest: 0, perRecord: 100 },
  '/backlinks/history/cumulative': { perRequest: 0, perRecord: 100 },
  '/backlinks/refdomains/history': { perRequest: 0, perRecord: 1 },
  '/backlinks/refdomains/history/count': { perRequest: 0, perRecord: 100 },
  '/backlinks/indexed-pages': { perRequest: 0, perRecord: 1 },
  '/backlinks/raw': { perRequest: 0, perRecord: 1 },
  '/backlinks/refdomains': { perRequest: 0, perRecord: 1 },
  '/backlinks/refdomains/count': { perRequest: 0, perRecord: 10 },
  '/backlinks/referring-subnets/count': { perRequest: 0, perRecord: 10 },
  '/backlinks/ips': { perRequest: 0, perRecord: 1 },

  // Domain
  '/domain/overview/db': { perRequest: 100, perRecord: 0 },
  '/domain/overview/worldwide': { perRequest: 100, perRecord: 0 },
  '/domain/overview/worldwide/url': { perRequest: 100, perRecord: 0 },
  '/domain/overview/history': { perRequest: 100, perRecord: 0 },
  '/domain/keywords': { perRequest: 100, perRecord: 0 },
  '/domain/pages': { perRequest: 100, perRecord: 0 },
  '/domain/subdomains': { perRequest: 100, perRecord: 0 },
  '/domain/ads': { perRequest: 100, perRecord: 0 },
  '/domain/competitors': { perRequest: 100, perRecord: 0 },
  '/domain/keywords/comparison': { perRequest: 100, perRecord: 0 },

  // AI Search
  '/ai-search/overview': { perRequest: 1800, perRecord: 0 },
  '/ai-search/overview/leaderboard': { perRequest: 7500, perRecord: 0 },
  '/ai-search/discover-brand': { perRequest: 100, perRecord: 0 },
  '/ai-search/prompts-by-target': { perRequest: 0, perRecord: 200 },
  '/ai-search/prompts-by-brand': { perRequest: 0, perRecord: 200 },

  // Keywords
  '/keywords/export': { perRequest: 0, perRecord: 10 },
  '/keywords/related': { perRequest: 0, perRecord: 10 },
  '/keywords/similar': { perRequest: 0, perRecord: 10 },
  '/keywords/questions': { perRequest: 0, perRecord: 10 },
  '/keywords/long-tail': { perRequest: 0, perRecord: 1 },

  // Account
  '/account/subscription': { perRequest: 0, perRecord: 0 },
};

export function calculateCredits(endpoint: string, recordCount: number): number {
  // Find matching endpoint (longest match wins for specificity)
  const matches = Object.keys(CREDIT_COSTS)
    .filter(pattern => endpoint.includes(pattern))
    .sort((a, b) => b.length - a.length);

  const match = matches[0];
  if (!match) return 0;

  const costs = CREDIT_COSTS[match];
  return costs.perRequest + (costs.perRecord * recordCount);
}

export function countRecords(response: unknown): number {
  if (Array.isArray(response)) return response.length;
  if (typeof response === 'object' && response !== null) {
    // Check common wrapper properties
    const obj = response as Record<string, unknown>;
    for (const key of ['data', 'pages', 'keywords', 'backlinks', 'refdomains', 'prompts', 'summary', 'leaderboard', 'history', 'ips', 'histogram']) {
      if (Array.isArray(obj[key])) return (obj[key] as unknown[]).length;
    }
    return 1; // Single object response
  }
  return 1;
}
