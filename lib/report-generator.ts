import { SeRankingClient } from './seranking';
import { getReport, setReport } from './report-store';
import type {
  ReportData,
  ReportProgress,
  BacklinksSummary,
  BacklinksAuthority,
  BacklinksNewLostCount,
  BacklinksIndexedPage,
  BacklinksDistribution,
  DomainOverview,
  DomainHistory,
  DomainKeyword,
  DomainCompetitor,
  AISearchOverview,
  AILeaderboardEntry,
  AIPrompt,
  KeywordQuestion,
  KeywordGap,
  TrafficByCountry,
  TopPage,
  CompetitorComparison,
  BacklinkGap,
  KeywordSuggestion,
  KeywordResearchData,
  BacklinkHistoryPoint,
  DetailedBacklink,
  IPConcentration,
  BacklinkIntelligence,
  ApiResponseLog,
  Subdomain,
  MultiCompetitorAnalysis,
  PageComparison,
  PaidAdsByKeyword,
  DomainPaidAd,
  DomainPaidKeyword,
  EnhancedAnchor,
  IndividualBacklink,
  RefDomainChange,
  PageAuthorityPoint,
  SubscriptionInfo,
} from './types';

// Re-export store functions
export { getReport, setReport };

interface GeneratorOptions {
  onProgress?: (step: string, progress: number) => void;
}

export async function generateReport(
  client: SeRankingClient,
  domain: string,
  options: GeneratorOptions = {}
): Promise<ReportData> {
  const { onProgress } = options;
  const updateProgress = (step: string, progress: number) => {
    onProgress?.(step, progress);
  };

  try {
    // ============================================================
    // PHASE 1: Get worldwide overview to determine top market
    // ============================================================
    updateProgress('Analyzing traffic distribution...', 5);

    const worldwideData = await client.getDomainOverviewWorldwide(domain).catch(() => ({
      topCountry: 'us',
      countries: [],
      positionChanges: { up: 0, down: 0, new: 0, lost: 0 },
    }));
    const topMarket = worldwideData.topCountry;
    const positionChanges = worldwideData.positionChanges;

    // Identify top 5 markets to fetch detailed metrics
    const topMarkets = worldwideData.countries.slice(0, 5).map(c => c.source);

    // ============================================================
    // PHASE 2: Parallel calls (using top market)
    // ============================================================
    updateProgress('Fetching backlink and domain data...', 10);

    // Create promises for top market overviews (to get detailed metrics like keywords_top3, traffic_cost)
    const topMarketOverviewPromises = topMarkets.map(market =>
      client.getDomainOverview(domain, market).catch(() => null)
    );

    const [
      backlinksSummary,
      backlinksAuthority,
      backlinksNewLost,
      backlinksIndexedPagesResult,
      backlinksDistribution,
      domainHistory,
      allKeywordsResult,
      nearPageOneResult,
      competitorsResult,
      subdomainsResult,
      // Enhanced backlink data (new)
      enhancedAnchorsResult,
      topBacklinksResult,
      subnetCountResult,
      ...topMarketOverviews
    ] = await Promise.all([
      client.getBacklinksSummary(domain).catch(() => null),
      client.getBacklinksAuthority(domain).catch(() => null),
      client.getBacklinksNewLostCount(domain).catch(() => null),
      client.getBacklinksIndexedPages(domain, 10).catch(() => ({ data: [] })),
      client.getBacklinksDistribution(domain).catch(() => null),
      client.getDomainHistory(domain, topMarket).catch(() => []),
      client.getDomainKeywords(domain, topMarket, { limit: 20 }).catch(() => ({ data: [], total: 0 })),
      client.getDomainKeywords(domain, topMarket, {
        limit: 10,
        filterPositionFrom: 11,
        filterPositionTo: 20,
        filterVolumeFrom: 500,
        orderField: 'volume',
        orderType: 'desc',
      }).catch(() => ({ data: [], total: 0 })),
      client.getDomainCompetitors(domain, topMarket).catch(() => ({ data: [] })),
      client.getDomainSubdomains(domain, topMarket, { limit: 10, orderField: 'traffic_sum', orderType: 'desc' }).catch(() => ({ data: [] })),
      // Enhanced backlink data (new)
      client.getBacklinksAnchors(domain, 20).catch(() => []),
      client.getBacklinksRaw(domain, { limit: 50, perDomain: 2, orderBy: 'domain_inlink_rank' }).catch(() => ({ backlinks: [] })),
      client.getReferringSubnetsCount(domain).catch(() => 0),
      ...topMarketOverviewPromises,
    ]);

    // Map top market overviews by source for easy lookup
    const topMarketMetrics = new Map<string, DomainOverview>();
    topMarkets.forEach((market, index) => {
      const overview = topMarketOverviews[index] as DomainOverview | null;
      if (overview) {
        topMarketMetrics.set(market, overview);
      }
    });

    // Use the top market's overview as the main domainOverview
    const domainOverview = topMarketMetrics.get(topMarket) || null;

    updateProgress('Backlinks & Keywords complete', 35);

    // ============================================================
    // PHASE 2.5: Domain Analysis & Competitor Comparison
    // ============================================================
    updateProgress('Fetching domain analysis data...', 38);

    const topCompetitorForAnalysis = competitorsResult.data?.[0];

    // Determine second market (if available)
    const secondMarket = topMarkets.length > 1 ? topMarkets[1] : null;

    const [
      topPagesByTrafficResult,
      topPagesByTrafficCountry2Result,
      keywordOverlapResult,
      backlinkGapsResult,
    ] = await Promise.all([
      client.getTopPagesByTraffic(domain, topMarket, 10).catch(() => ({ data: [] })),
      secondMarket
        ? client.getTopPagesByTraffic(domain, secondMarket, 10).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      topCompetitorForAnalysis
        ? client.getKeywordOverlap(domain, topCompetitorForAnalysis.domain, topMarket, 20).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      topCompetitorForAnalysis
        ? client.getBacklinkGap(domain, topCompetitorForAnalysis.domain, 20).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
    ]);

    // Prepare traffic by country data with detailed metrics for top markets
    const totalTraffic = worldwideData.countries.reduce((sum, cc) => sum + cc.traffic, 0);
    const trafficByCountry: TrafficByCountry[] = worldwideData.countries.map(c => {
      const marketMetrics = topMarketMetrics.get(c.source);
      return {
        source: c.source,
        country: COUNTRY_NAMES[c.source] || c.source.toUpperCase(),
        traffic: c.traffic,
        keywords: c.keywords,
        percentage: totalTraffic > 0 ? (c.traffic / totalTraffic) * 100 : 0,
        // Add detailed metrics if available (for top 5 markets)
        traffic_cost: marketMetrics?.traffic_cost,
        keywords_top3: marketMetrics?.keywords_top3,
        keywords_top10: marketMetrics?.keywords_top10,
        keywords_top100: marketMetrics?.keywords_top100,
      };
    });

    // Prepare subdomains data
    const subdomains: Subdomain[] = subdomainsResult.data || [];

    // Get competitor metrics for comparison
    const competitorDomains = competitorsResult.data?.slice(0, 5).map(c => c.domain) || [];
    const competitorMetricsResult = competitorDomains.length > 0
      ? await client.getCompetitorMetrics([domain, ...competitorDomains], topMarket).catch(() => ({ data: [] }))
      : { data: [] };

    // Merge competitor metrics with competitor data
    const competitorComparison: CompetitorComparison[] = competitorsResult.data?.slice(0, 5).map(c => {
      const metrics = competitorMetricsResult.data.find(m => m.domain === c.domain);
      return {
        domain: c.domain,
        traffic: metrics?.traffic || c.traffic,
        keywords: metrics?.keywords || c.keywords,
        authority: metrics?.authority || 0,
        backlinks: metrics?.backlinks || 0,
        common_keywords: c.common_keywords,
        overlap: c.overlap,
      };
    }) || [];

    updateProgress('Domain analysis complete', 42);

    // ============================================================
    // PHASE 2.6: Multi-Competitor Gap Analysis
    // ============================================================
    updateProgress('Analyzing multi-competitor gaps...', 43);

    // Analyze gaps across top 5 competitors (need at least 2 for meaningful analysis)
    const top5Competitors = competitorsResult.data?.slice(0, 5).map(c => c.domain) || [];
    const multiCompetitorAnalysis: MultiCompetitorAnalysis | null = top5Competitors.length >= 2
      ? await client.getMultiCompetitorAnalysis(domain, top5Competitors, topMarket)
          .catch(() => null)
      : null;

    updateProgress('Multi-competitor analysis complete', 48);

    // ============================================================
    // PHASE 2.7: Top Pages Worldwide Stats (for Domain Analysis)
    // ============================================================
    updateProgress('Fetching worldwide page stats...', 49);

    // Get worldwide stats for our top pages (for domain analysis section)
    let topPagesWorldwide: import('./types').URLOverviewWorldwide[] = [];
    if (topPagesByTrafficResult.data.length > 0) {
      try {
        const topPagesForWorldwide = topPagesByTrafficResult.data.slice(0, 5);
        const worldwidePromises = topPagesForWorldwide.map(page =>
          client.getURLOverviewWorldwide(page.url).catch(() => null)
        );
        const worldwideResults = await Promise.all(worldwidePromises);
        topPagesWorldwide = worldwideResults.filter((r): r is import('./types').URLOverviewWorldwide => r !== null);
      } catch (error) {
        console.warn('Failed to fetch top pages worldwide stats:', error);
      }
    }

    // ============================================================
    // PHASE 2.8: Page-to-Page Keyword Comparison (for Competitive)
    // ============================================================
    updateProgress('Comparing page keywords...', 50);

    // Compare our top page vs competitor's top page using URL keyword comparison
    let pageComparisons: PageComparison[] = [];
    if (topCompetitorForAnalysis && topPagesByTrafficResult.data.length > 0) {
      try {
        // Get competitor's top pages
        const competitorTopPagesResult = await client.getTopPagesByTraffic(
          topCompetitorForAnalysis.domain,
          topMarket,
          3
        ).catch(() => ({ data: [] }));

        // Select up to 2 pages from each to compare (to manage API costs - 200 credits per comparison)
        const ourTopPages = topPagesByTrafficResult.data.slice(0, 2);
        const competitorTopPages = competitorTopPagesResult.data.slice(0, 2);

        // Fetch URL-based keyword comparison for each page pair
        const comparisonPromises: Promise<PageComparison | null>[] = [];

        for (let i = 0; i < Math.min(ourTopPages.length, competitorTopPages.length); i++) {
          const ourPage = ourTopPages[i];
          const competitorPage = competitorTopPages[i];

          comparisonPromises.push(
            client.getPageComparison(ourPage.url, competitorPage.url, topMarket, 10)
              .catch(() => null)
          );
        }

        const comparisonResults = await Promise.all(comparisonPromises);
        pageComparisons = comparisonResults.filter((c): c is PageComparison => c !== null);
      } catch (error) {
        console.warn('Failed to fetch page comparisons:', error);
      }
    }

    // ============================================================
    // PHASE 3: AI Search + Content Opportunities (using top market)
    // ============================================================
    updateProgress('Analyzing AI search visibility...', 51);

    const topCompetitor = competitorsResult.data?.[0];
    const topKeyword = allKeywordsResult.data?.[0]?.keyword || domain.split('.')[0];

    // First discover the brand name
    const brandResult = await client.discoverBrand(domain, topMarket).catch(() => ({ brand: domain.split('.')[0] }));
    const brandName = brandResult.brand;

    // All available AI engines
    const allEngines = ['ai-overview', 'ai-mode', 'chatgpt', 'perplexity', 'gemini'];

    // AI Leaderboard - fetch FIRST to identify which engines have presence
    let aiLeaderboard: AILeaderboardEntry[] = [];
    let aiEngineData: AISearchOverview['engines'] = [];

    // Build competitors list (top 5 competitors)
    // If no competitors found, use common SEO tools as fallback for comparison
    const defaultCompetitors = [
      { target: 'semrush.com', brand: 'Semrush' },
      { target: 'ahrefs.com', brand: 'Ahrefs' },
      { target: 'moz.com', brand: 'Moz' },
    ];

    const competitorsList = competitorsResult.data?.slice(0, 5).map(c => ({
      target: c.domain,
      brand: c.domain.split('.')[0],
    })) || [];

    // Always ensure we have at least 1 competitor for the API call
    const finalCompetitorsList = competitorsList.length > 0
      ? competitorsList
      : defaultCompetitors.filter(c => c.target !== domain).slice(0, 3);

    updateProgress('Fetching AI leaderboard...', 55);

    try {
      const leaderboardResult = await client.getAISearchLeaderboard(
        { target: domain, brand: brandName },
        finalCompetitorsList,
        topMarket,
        allEngines
      );

      aiLeaderboard = leaderboardResult.data || [];
      // Use per-engine data from leaderboard results
      if (leaderboardResult.engineData && leaderboardResult.engineData.length > 0) {
        aiEngineData = leaderboardResult.engineData;
      }
    } catch {
      // AI Leaderboard not available, continue with fallback
    }

    updateProgress('Fetching AI search data...', 65);

    // Determine which engines to fetch prompts from based on leaderboard presence
    // Only fetch from engines where target has presence (brand or link citations)
    const enginesWithPresence = aiEngineData.length > 0
      ? aiEngineData
          .filter(e => e.brand_presence > 0 || e.link_presence > 0)
          .map(e => e.engine)
      : [];

    // Only fetch prompts if we have engines with presence (no fallback)
    // Fetch brand prompts FIRST so brand/brand_link types take precedence over link-only in deduplication
    const promptsPromises = enginesWithPresence.flatMap(engine => [
      client.getAISearchPromptsByBrand(brandName, topMarket, engine, 3).catch(() => ({ data: [] })),
      client.getAISearchPromptsByTarget(domain, topMarket, engine, 3).catch(() => ({ data: [] })),
    ]);

    const [
      aiOverview,
      keywordGapsResult,
      questionKeywordsResult,
      ...promptsResults
    ] = await Promise.all([
      client.getAISearchOverview(domain, topMarket).catch(() => null),
      topCompetitor
        ? client.getDomainKeywordsComparison(topCompetitor.domain, domain, topMarket, {
            diff: 1,
            limit: 10,
            orderField: 'volume',
            orderType: 'desc',
          }).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      client.getKeywordQuestions(topKeyword, topMarket).catch(() => ({ data: [] })),
      ...promptsPromises,
    ]);

    // Merge and deduplicate prompts from all engines, grouped by engine
    // When same prompt appears in both brand and target results, merge types appropriately
    const promptsByEngine = new Map<string, AIPrompt[]>();
    for (const result of promptsResults) {
      const promptResult = result as { data: AIPrompt[] };
      for (const p of promptResult.data) {
        const engineList = promptsByEngine.get(p.engine) || [];
        const existingIndex = engineList.findIndex(existing => existing.prompt.toLowerCase() === p.prompt.toLowerCase());

        if (existingIndex === -1) {
          // New prompt, add it
          engineList.push(p);
        } else {
          // Duplicate found - merge types if needed
          // If existing is brand/brand_link and new is link, upgrade to brand_link
          // If existing is link and new is brand/brand_link, upgrade to brand_link
          const existing = engineList[existingIndex];
          const existingIsBrand = existing.type === 'brand' || existing.type === 'brand_link';
          const newIsLink = p.type === 'link' || p.type === 'brand_link';
          const existingIsLink = existing.type === 'link' || existing.type === 'brand_link';
          const newIsBrand = p.type === 'brand' || p.type === 'brand_link';

          if ((existingIsBrand && newIsLink) || (existingIsLink && newIsBrand)) {
            engineList[existingIndex] = { ...existing, type: 'brand_link' };
          }
        }
        promptsByEngine.set(p.engine, engineList);
      }
    }

    // Sort each engine's prompts by volume
    for (const list of promptsByEngine.values()) {
      list.sort((a, b) => (b.volume || 0) - (a.volume || 0));
    }

    // Take top N from each engine to ensure balanced representation
    const promptsPerEngine = 8;
    const balancedPrompts: AIPrompt[] = [];
    for (const [, list] of promptsByEngine) {
      balancedPrompts.push(...list.slice(0, promptsPerEngine));
    }

    const aiPromptsResult = {
      data: balancedPrompts
    };

    // If leaderboard didn't provide engine data, try to use overview data
    if (aiEngineData.length === 0 && aiOverview?.engines && aiOverview.engines.length > 0) {
      aiEngineData = aiOverview.engines;
    }

    // Add traffic data from overview if available
    if (aiOverview && aiEngineData.length > 0) {
      const totalTraffic = aiOverview.engines?.[0]?.traffic || 0;
      // Distribute traffic proportionally across engines based on total presence
      const totalPresence = aiEngineData.reduce((sum, e) => sum + e.brand_presence + e.link_presence, 0);
      if (totalPresence > 0 && totalTraffic > 0) {
        aiEngineData = aiEngineData.map(e => ({
          ...e,
          traffic: Math.round((e.brand_presence + e.link_presence) / totalPresence * totalTraffic)
        }));
      }
    }

    updateProgress('AI & Content Analysis complete', 80);

    // ============================================================
    // PHASE 3.5: Advanced Keyword Research & Backlink Intelligence
    // ============================================================
    updateProgress('Fetching keyword research data...', 82);

    // Get keyword research data (using top keyword as seed)
    const seedKeyword = allKeywordsResult.data?.[0]?.keyword || domain.split('.')[0];

    const [
      similarKeywordsResult,
      relatedKeywordsResult,
      longTailKeywordsResult,
      backlinkHistoryResult,
      newLostBacklinksResult,
      referringIpsResult,
    ] = await Promise.all([
      client.getSimilarKeywords(seedKeyword, topMarket, 20).catch(() => []),
      client.getRelatedKeywords(seedKeyword, topMarket, 20).catch(() => []),
      client.getLongTailKeywords(seedKeyword, topMarket, 20).catch(() => []),
      client.getCumulativeBacklinksHistory(domain, 12).catch(() => []),
      client.getNewLostBacklinksDetailed(domain, 30).catch(() => ({ new: [], lost: [] })),
      client.getReferringIpsAnalysis(domain, 20).catch(() => []),
    ]);

    updateProgress('Keyword research & backlink intelligence complete', 87);

    // ============================================================
    // PHASE 3.6: Paid Ads Intelligence
    // ============================================================
    updateProgress('Analyzing paid ads...', 88);

    // First, fetch keywords the domain is actually bidding on (paid keywords)
    const domainPaidKeywordsResult = await client.getDomainPaidKeywords(domain, topMarket, {
      limit: 10,
      orderField: 'traffic',
      orderType: 'desc',
    }).catch(() => ({ data: [] }));

    const domainPaidKeywords: DomainPaidKeyword[] = domainPaidKeywordsResult.data;

    // For each paid keyword, fetch competitor ads data
    // This shows who else is advertising on the keywords the domain is bidding on
    let paidAdsInsights: PaidAdsByKeyword[] = [];
    if (domainPaidKeywords.length > 0) {
      // Take top 5 paid keywords by traffic to analyze
      const keywordsToAnalyze = domainPaidKeywords.slice(0, 5).map(k => k.keyword);
      paidAdsInsights = await client.getPaidAdsForKeywords(
        keywordsToAnalyze,
        topMarket,
        5
      ).catch(() => []);
    }

    // Fetch domain paid ads using the older endpoint (for backward compatibility)
    const domainPaidAdsResult = await client.getDomainPaidAds(domain, topMarket, { limit: 20 })
      .catch(() => ({ data: [] }));

    updateProgress('Paid ads analysis complete', 90);

    // ============================================================
    // PHASE 3.7: Enhanced Backlink Intelligence
    // ============================================================
    updateProgress('Analyzing backlink quality...', 91);

    const [refDomainHistoryResult, authorityTrendResult] = await Promise.all([
      client.getRefDomainsHistory(domain, 30).catch(() => []),
      client.getPageAuthorityHistory(`https://${domain}`, 12).catch(() => []),
    ]);

    // Process ref domain changes
    const newRefDomains = refDomainHistoryResult.filter(d => d.new_lost_type === 'new');
    const lostRefDomains = refDomainHistoryResult.filter(d => d.new_lost_type === 'lost');

    // Calculate average DA of gained/lost domains
    const calculateAvgDA = (domains: RefDomainChange[]): number => {
      if (domains.length === 0) return 0;
      const totalDA = domains.reduce((sum, d) => sum + d.domain_inlink_rank, 0);
      return Math.round(totalDA / domains.length);
    };

    const refDomainChanges = {
      new: newRefDomains,
      lost: lostRefDomains,
      qualityGained: calculateAvgDA(newRefDomains),
      qualityLost: calculateAvgDA(lostRefDomains),
    };

    updateProgress('Backlink quality analysis complete', 93);

    // Build keyword research data
    const allSuggestions = [...similarKeywordsResult, ...relatedKeywordsResult, ...longTailKeywordsResult];
    const sweetSpotKeywords = allSuggestions.filter(k => k.volume >= 1000 && k.difficulty < 40);

    const keywordResearch: KeywordResearchData = {
      seedKeyword,
      similarKeywords: similarKeywordsResult,
      relatedKeywords: relatedKeywordsResult,
      longTailKeywords: longTailKeywordsResult,
      sweetSpotKeywords: sweetSpotKeywords.slice(0, 20),
    };

    // Build backlink intelligence data
    const backlinkIntelligence: BacklinkIntelligence = {
      history: backlinkHistoryResult,
      newBacklinks: newLostBacklinksResult.new,
      lostBacklinks: newLostBacklinksResult.lost,
      ipConcentration: referringIpsResult,
      netChange: {
        backlinks: newLostBacklinksResult.new.length - newLostBacklinksResult.lost.length,
        refdomains: (backlinksNewLost?.new_refdomains || 0) - (backlinksNewLost?.lost_refdomains || 0),
        period: '30 days',
      },
      // Enhanced backlink intelligence fields
      enhancedAnchors: enhancedAnchorsResult,
      topBacklinks: topBacklinksResult.backlinks || [],
      refDomainChanges,
      authorityTrend: authorityTrendResult,
      subnetCount: subnetCountResult,
    };

    // ============================================================
    // PHASE 4: Compile Report
    // ============================================================
    updateProgress('Compiling report...', 95);

    // Collect API response logs and total credits from the client
    const apiLogs = client.getApiLogs();
    const totalCredits = client.getTotalCredits();

    // Fetch subscription info (0 credits) for credits display tooltip
    const subscriptionInfo = await client.getSubscription().catch(() => null);

    const report = compileReport({
      backlinksSummary,
      backlinksAuthority,
      backlinksNewLost,
      backlinksIndexedPages: backlinksIndexedPagesResult.data,
      backlinksDistribution,
      domainOverview,
      domainHistory,
      allKeywords: allKeywordsResult.data,
      // Use total from domainOverview since keywords API doesn't return count
      totalKeywords: domainOverview?.keywords || allKeywordsResult.data.length,
      nearPageOneKeywords: nearPageOneResult.data,
      competitors: competitorsResult.data,
      aiOverview,
      aiEngineData,
      aiLeaderboard,
      aiPrompts: aiPromptsResult.data,
      keywordGaps: keywordGapsResult.data,
      questionKeywords: questionKeywordsResult.data,
      topMarket,
      secondMarket,
      // Domain Analysis fields
      trafficByCountry,
      subdomains,
      topPagesByTraffic: topPagesByTrafficResult.data,
      topPagesByTrafficCountry2: topPagesByTrafficCountry2Result.data,
      topPagesWorldwide,
      // Keywords fields
      positionChanges,
      // Enhanced Competitors fields
      competitorComparison,
      keywordOverlap: keywordOverlapResult.data,
      backlinkGaps: backlinkGapsResult.data,
      // Multi-Competitor Analysis
      multiCompetitorAnalysis,
      // Page Performance Comparison
      pageComparisons,
      // Advanced Keyword Research
      keywordResearch,
      // Domain Paid Keywords (keywords the domain is bidding on)
      domainPaidKeywords,
      // Paid Ads Competitors (competitors bidding on the same keywords)
      paidAdsInsights,
      // Domain Paid Ads (legacy endpoint)
      domainPaidAds: domainPaidAdsResult.data,
      // Enhanced Backlink Intelligence
      backlinkIntelligence,
      // API Response Logs (for developer inspection)
      apiLogs,
      // Total credits consumed
      totalCredits,
      // Subscription info for credits tooltip
      subscriptionInfo,
    });

    updateProgress('Report ready!', 100);

    return report;
  } catch (error) {
    // Error handling is done by the API route via SSE
    throw error;
  }
}

interface CompileReportInput {
  backlinksSummary: BacklinksSummary | null;
  backlinksAuthority: BacklinksAuthority | null;
  backlinksNewLost: BacklinksNewLostCount | null;
  backlinksIndexedPages: BacklinksIndexedPage[];
  backlinksDistribution: BacklinksDistribution | null;
  domainOverview: DomainOverview | null;
  domainHistory: DomainHistory[];
  allKeywords: DomainKeyword[];
  totalKeywords: number;
  nearPageOneKeywords: DomainKeyword[];
  competitors: DomainCompetitor[];
  aiOverview: AISearchOverview | null;
  aiEngineData: AISearchOverview['engines'];
  aiLeaderboard: AILeaderboardEntry[];
  aiPrompts: AIPrompt[];
  keywordGaps: KeywordGap[];
  questionKeywords: KeywordQuestion[];
  topMarket: string;
  secondMarket: string | null;
  // Domain Analysis fields
  trafficByCountry: TrafficByCountry[];
  subdomains: Subdomain[];
  topPagesByTraffic: TopPage[];
  topPagesByTrafficCountry2: TopPage[];
  topPagesWorldwide: import('./types').URLOverviewWorldwide[];
  // Keywords fields
  positionChanges: { up: number; down: number; new: number; lost: number };
  // Enhanced Competitors fields
  competitorComparison: CompetitorComparison[];
  keywordOverlap: { keyword: string; volume: number; ourPosition: number; competitorPosition: number }[];
  backlinkGaps: BacklinkGap[];
  // Multi-Competitor Analysis
  multiCompetitorAnalysis: MultiCompetitorAnalysis | null;
  // Page Performance Comparison
  pageComparisons: PageComparison[];
  // Advanced Keyword Research
  keywordResearch: KeywordResearchData;
  // Domain Paid Keywords (keywords the domain is bidding on)
  domainPaidKeywords: DomainPaidKeyword[];
  // Paid Ads Competitors (competitors bidding on the same keywords)
  paidAdsInsights: PaidAdsByKeyword[];
  // Domain Paid Ads (legacy endpoint)
  domainPaidAds: DomainPaidAd[];
  // Enhanced Backlink Intelligence
  backlinkIntelligence: BacklinkIntelligence;
  // API Response Logs
  apiLogs: ApiResponseLog[];
  // Total credits consumed
  totalCredits: number;
  // Subscription info for credits tooltip
  subscriptionInfo: SubscriptionInfo | null;
}

// Country code to name mapping (ISO 3166-1 alpha-2)
const COUNTRY_NAMES: Record<string, string> = {
  // A
  ad: 'Andorra',
  ae: 'United Arab Emirates',
  af: 'Afghanistan',
  ag: 'Antigua and Barbuda',
  ai: 'Anguilla',
  al: 'Albania',
  am: 'Armenia',
  ao: 'Angola',
  ar: 'Argentina',
  as: 'American Samoa',
  at: 'Austria',
  au: 'Australia',
  az: 'Azerbaijan',
  // B
  ba: 'Bosnia and Herzegovina',
  bb: 'Barbados',
  bd: 'Bangladesh',
  be: 'Belgium',
  bf: 'Burkina Faso',
  bg: 'Bulgaria',
  bh: 'Bahrain',
  bi: 'Burundi',
  bj: 'Benin',
  bn: 'Brunei',
  bo: 'Bolivia',
  br: 'Brazil',
  bs: 'Bahamas',
  bt: 'Bhutan',
  bw: 'Botswana',
  by: 'Belarus',
  bz: 'Belize',
  // C
  ca: 'Canada',
  cd: 'DR Congo',
  cf: 'Central African Republic',
  ch: 'Switzerland',
  ci: 'Ivory Coast',
  ck: 'Cook Islands',
  cl: 'Chile',
  cm: 'Cameroon',
  cn: 'China',
  co: 'Colombia',
  cr: 'Costa Rica',
  cv: 'Cape Verde',
  cy: 'Cyprus',
  cz: 'Czech Republic',
  // D
  de: 'Germany',
  dj: 'Djibouti',
  dk: 'Denmark',
  dm: 'Dominica',
  do: 'Dominican Republic',
  dz: 'Algeria',
  // E
  ec: 'Ecuador',
  ee: 'Estonia',
  eg: 'Egypt',
  es: 'Spain',
  et: 'Ethiopia',
  // F
  fi: 'Finland',
  fj: 'Fiji',
  fm: 'Micronesia',
  fr: 'France',
  // G
  ga: 'Gabon',
  ge: 'Georgia',
  gh: 'Ghana',
  gi: 'Gibraltar',
  gl: 'Greenland',
  gm: 'Gambia',
  gp: 'Guadeloupe',
  gr: 'Greece',
  gt: 'Guatemala',
  gy: 'Guyana',
  // H
  hk: 'Hong Kong',
  hn: 'Honduras',
  hr: 'Croatia',
  ht: 'Haiti',
  hu: 'Hungary',
  // I
  id: 'Indonesia',
  ie: 'Ireland',
  il: 'Israel',
  in: 'India',
  iq: 'Iraq',
  is: 'Iceland',
  it: 'Italy',
  // J
  je: 'Jersey',
  jm: 'Jamaica',
  jo: 'Jordan',
  jp: 'Japan',
  // K
  ke: 'Kenya',
  kg: 'Kyrgyzstan',
  kh: 'Cambodia',
  ki: 'Kiribati',
  kr: 'South Korea',
  kw: 'Kuwait',
  kz: 'Kazakhstan',
  // L
  la: 'Laos',
  lb: 'Lebanon',
  li: 'Liechtenstein',
  lk: 'Sri Lanka',
  ls: 'Lesotho',
  lt: 'Lithuania',
  lu: 'Luxembourg',
  lv: 'Latvia',
  ly: 'Libya',
  // M
  ma: 'Morocco',
  mc: 'Monaco',
  md: 'Moldova',
  me: 'Montenegro',
  mg: 'Madagascar',
  mk: 'North Macedonia',
  ml: 'Mali',
  mm: 'Myanmar',
  mn: 'Mongolia',
  ms: 'Montserrat',
  mt: 'Malta',
  mu: 'Mauritius',
  mv: 'Maldives',
  mw: 'Malawi',
  mx: 'Mexico',
  my: 'Malaysia',
  mz: 'Mozambique',
  // N
  na: 'Namibia',
  ne: 'Niger',
  nf: 'Norfolk Island',
  ng: 'Nigeria',
  ni: 'Nicaragua',
  nl: 'Netherlands',
  no: 'Norway',
  np: 'Nepal',
  nr: 'Nauru',
  nz: 'New Zealand',
  // O
  om: 'Oman',
  // P
  pa: 'Panama',
  pe: 'Peru',
  pg: 'Papua New Guinea',
  ph: 'Philippines',
  pk: 'Pakistan',
  pl: 'Poland',
  pr: 'Puerto Rico',
  ps: 'Palestine',
  pt: 'Portugal',
  py: 'Paraguay',
  // Q
  qa: 'Qatar',
  // R
  re: 'Réunion',
  ro: 'Romania',
  rs: 'Serbia',
  ru: 'Russia',
  rw: 'Rwanda',
  // S
  sa: 'Saudi Arabia',
  sb: 'Solomon Islands',
  sc: 'Seychelles',
  se: 'Sweden',
  sg: 'Singapore',
  sh: 'Saint Helena',
  si: 'Slovenia',
  sk: 'Slovakia',
  sl: 'Sierra Leone',
  sm: 'San Marino',
  sn: 'Senegal',
  so: 'Somalia',
  sr: 'Suriname',
  st: 'São Tomé and Príncipe',
  sv: 'El Salvador',
  // T
  tc: 'Turks and Caicos',
  td: 'Chad',
  tg: 'Togo',
  th: 'Thailand',
  tj: 'Tajikistan',
  tm: 'Turkmenistan',
  tn: 'Tunisia',
  to: 'Tonga',
  tr: 'Turkey',
  tt: 'Trinidad and Tobago',
  tw: 'Taiwan',
  tz: 'Tanzania',
  // U
  ua: 'Ukraine',
  ug: 'Uganda',
  uk: 'United Kingdom',
  us: 'United States',
  uy: 'Uruguay',
  uz: 'Uzbekistan',
  // V
  vc: 'Saint Vincent and the Grenadines',
  ve: 'Venezuela',
  vg: 'British Virgin Islands',
  vi: 'US Virgin Islands',
  vn: 'Vietnam',
  vu: 'Vanuatu',
  // W
  ws: 'Samoa',
  // Z
  za: 'South Africa',
  zm: 'Zambia',
  zw: 'Zimbabwe',
};

function compileReport(input: CompileReportInput): ReportData {
  const {
    backlinksSummary,
    backlinksAuthority,
    backlinksNewLost,
    backlinksIndexedPages,
    backlinksDistribution,
    domainOverview,
    domainHistory,
    allKeywords,
    totalKeywords,
    nearPageOneKeywords,
    competitors,
    aiOverview,
    aiEngineData,
    aiLeaderboard,
    aiPrompts,
    keywordGaps,
    questionKeywords,
    topMarket,
    secondMarket,
    // Domain Analysis fields
    trafficByCountry,
    subdomains,
    topPagesByTraffic,
    topPagesByTrafficCountry2,
    topPagesWorldwide,
    // Keywords fields
    positionChanges,
    // Enhanced Competitors fields
    competitorComparison,
    keywordOverlap,
    backlinkGaps,
    // Multi-Competitor Analysis
    multiCompetitorAnalysis,
    // Page Performance Comparison
    pageComparisons,
    // Advanced Keyword Research
    keywordResearch,
    // Domain Paid Keywords
    domainPaidKeywords,
    // Paid Ads Competitors
    paidAdsInsights,
    // Domain Paid Ads (legacy)
    domainPaidAds,
    // Enhanced Backlink Intelligence
    backlinkIntelligence,
    // API Response Logs
    apiLogs,
    // Total credits consumed
    totalCredits,
  } = input;

  // Use position distribution from domain overview (actual totals)
  // Fall back to counting from fetched keywords if overview not available
  const positionDistribution = domainOverview ? {
    top3: domainOverview.keywords_top3 || 0,
    top10: domainOverview.keywords_top10 || 0,
    top20: domainOverview.keywords_top20 || 0,
    top50: domainOverview.keywords_top50 || 0,
    top100: domainOverview.keywords_top100 || 0,
  } : {
    top3: allKeywords.filter(k => k.position <= 3).length,
    top10: allKeywords.filter(k => k.position <= 10).length,
    top20: allKeywords.filter(k => k.position <= 20).length,
    top50: allKeywords.filter(k => k.position <= 50).length,
    top100: allKeywords.filter(k => k.position <= 100).length,
  };

  // Calculate quick wins
  const lowHangingFruit = calculateQuickWins({
    nearPageOneKeywords,
    backlinksIndexedPages,
    keywordGaps,
  });

  // Get AI Share of Voice from leaderboard (current domain)
  const aiShareOfVoice = aiLeaderboard.find(e => e.is_primary_target)?.share_of_voice ?? 0;

  return {
    executive: {
      traffic: domainOverview?.traffic || 0,
      backlinks: backlinksSummary?.backlinks || 0,
      authority: backlinksAuthority?.domain_inlink_rank || 0,
      keywords: totalKeywords || domainOverview?.keywords || 0,
      aiShareOfVoice,
    },
    backlinks: {
      summary: backlinksSummary || createEmptyBacklinksSummary(),
      authority: backlinksAuthority || { domain_inlink_rank: 0, page_inlink_rank: 0 },
      momentum: backlinksNewLost || {
        new_backlinks: 0,
        lost_backlinks: 0,
        new_refdomains: 0,
        lost_refdomains: 0,
      },
      indexedPages: backlinksIndexedPages,
      distribution: backlinksDistribution || createEmptyDistribution(),
      intelligence: backlinkIntelligence,
    },
    keywords: {
      total: totalKeywords,
      topKeywords: allKeywords,
      nearPageOne: nearPageOneKeywords,
      positionDistribution,
      history: domainHistory,
      positionChanges,
      research: keywordResearch,
      domainPaidKeywords: domainPaidKeywords.length > 0 ? domainPaidKeywords : undefined,
    },
    domainAnalysis: {
      authority: backlinksAuthority?.domain_inlink_rank || 0,
      trafficByCountry: trafficByCountry || [],
      subdomains: subdomains || [],
      trafficTrend: domainHistory,
      topPagesByTraffic: topPagesByTraffic || [],
      topPagesByTrafficCountry2: topPagesByTrafficCountry2.length > 0 ? topPagesByTrafficCountry2 : undefined,
      topPagesByBacklinks: backlinksIndexedPages.slice(0, 10),
      anchorTextDistribution: backlinksSummary?.top_anchors_by_backlinks || [],
      refDomainsDistribution: backlinksDistribution || createEmptyDistribution(),
      paidAds: domainPaidAds.length > 0 ? domainPaidAds : undefined,
      topPagesWorldwide: topPagesWorldwide.length > 0 ? topPagesWorldwide : undefined,
    },
    competitive: {
      competitors,
      competitorComparison: competitorComparison || [],
      keywordGaps,
      keywordOverlap: keywordOverlap || [],
      backlinkGaps: backlinkGaps || [],
      multiCompetitorAnalysis: multiCompetitorAnalysis || undefined,
      pageComparisons: pageComparisons.length > 0 ? pageComparisons : undefined,
      paidSearchCompetitors: paidAdsInsights.length > 0 ? paidAdsInsights : undefined,
    },
    aiSearch: {
      overview: {
        target: aiOverview?.target || '',
        engines: aiEngineData.length > 0 ? aiEngineData : (aiOverview?.engines || []),
      },
      leaderboard: aiLeaderboard,
      prompts: aiPrompts,
      market: topMarket,
      marketName: COUNTRY_NAMES[topMarket] || topMarket.toUpperCase(),
    },
    contentOpportunities: {
      questionKeywords,
      gaps: keywordGaps,
    },
    quickWins: {
      nearPageOneKeywords,
      lowHangingFruit,
    },
    apiResponses: apiLogs,
    totalCredits,
    subscriptionInfo: input.subscriptionInfo || undefined,
  };
}

function createEmptyBacklinksSummary(): BacklinksSummary {
  return {
    backlinks: 0,
    backlinks_num: 0,
    refdomains: 0,
    refdomains_num: 0,
    subnets: 0,
    ips: 0,
    dofollow_backlinks: 0,
    nofollow_backlinks: 0,
    text_backlinks: 0,
    image_backlinks: 0,
    redirect_backlinks: 0,
    canonical_backlinks: 0,
    gov_backlinks: 0,
    edu_backlinks: 0,
    tlds: {},
    countries: {},
    top_anchors_by_backlinks: [],
    top_anchors_by_refdomains: [],
  };
}

function createEmptyDistribution(): BacklinksDistribution {
  return {
    '0-10': 0,
    '11-20': 0,
    '21-30': 0,
    '31-40': 0,
    '41-50': 0,
    '51-60': 0,
    '61-70': 0,
    '71-80': 0,
    '81-90': 0,
    '91-100': 0,
  };
}

interface QuickWinsInput {
  nearPageOneKeywords: DomainKeyword[];
  backlinksIndexedPages: BacklinksIndexedPage[];
  keywordGaps: KeywordGap[];
}

function calculateQuickWins(input: QuickWinsInput): ReportData['quickWins']['lowHangingFruit'] {
  const { nearPageOneKeywords, keywordGaps } = input;
  const wins: ReportData['quickWins']['lowHangingFruit'] = [];

  // Near page one keywords
  if (nearPageOneKeywords.length > 0) {
    const totalPotentialTraffic = nearPageOneKeywords.reduce((acc, k) => acc + k.volume * 0.15, 0);
    wins.push({
      type: 'keywords',
      description: `Optimize ${nearPageOneKeywords.length} keywords in positions 11-20 (potential +${Math.round(totalPotentialTraffic)} visits/mo)`,
      impact: 'high',
      effort: 'medium',
    });
  }

  // Keyword gaps
  if (keywordGaps.length > 0) {
    const totalGapVolume = keywordGaps.reduce((acc, k) => acc + k.volume, 0);
    wins.push({
      type: 'content',
      description: `Create content for ${keywordGaps.length} keyword gaps (${totalGapVolume.toLocaleString()} monthly searches)`,
      impact: 'high',
      effort: 'medium',
    });
  }

  return wins;
}
