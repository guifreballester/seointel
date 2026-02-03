import type {
  BacklinksSummary,
  BacklinksAuthority,
  BacklinksNewLostCount,
  BacklinksIndexedPage,
  BacklinksDistribution,
  DomainOverview,
  DomainKeyword,
  DomainCompetitor,
  AISearchOverview,
  AILeaderboardEntry,
  AIPrompt,
  KeywordQuestion,
  KeywordGap,
  ApiConfig,
  KeywordSuggestion,
  BacklinkHistoryPoint,
  DetailedBacklink,
  IPConcentration,
  ApiResponseLog,
  AggregatedKeywordGap,
  AggregatedKeywordOverlap,
  AggregatedBacklinkGap,
  MultiCompetitorAnalysis,
  URLOverviewWorldwide,
  URLKeywordComparison,
  PageComparison,
  EnhancedAnchor,
  IndividualBacklink,
  RefDomainChange,
  PageAuthorityPoint,
  SubscriptionInfo,
} from './types';
import { calculateCredits, countRecords } from './credits';

const API_BASE_URL = 'https://api.seranking.com/v1';

// Default rate limit: 5 requests per second
// Contact api@seranking.com for higher limits
const DEFAULT_RATE_LIMIT = 5;

/**
 * Simple token bucket rate limiter
 * Default: 5 requests per second (configurable)
 */
class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private lastRefill: number;

  constructor(requestsPerSecond: number = DEFAULT_RATE_LIMIT) {
    this.maxTokens = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.refillRate = requestsPerSecond / 1000; // convert to per-ms
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Calculate wait time for next token
    const waitTime = Math.ceil((1 - this.tokens) / this.refillRate);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    this.tokens = 0;
    this.lastRefill = Date.now();
  }
}

/**
 * Custom error classes for specific API errors
 */
export class RateLimitError extends Error {
  constructor() {
    super(
      'Rate limit exceeded. The API allows 5 requests per second by default.\n\n' +
      'To resolve:\n' +
      '1. Reduce your request rate\n' +
      '2. The rate limit can be adjusted in lib/seranking.ts\n' +
      '3. For higher limits, contact api@seranking.com'
    );
    this.name = 'RateLimitError';
  }
}

export class InsufficientFundsError extends Error {
  constructor() {
    super(
      'API Error: Insufficient funds - your API key is temporarily disabled.\n\n' +
      'To resolve:\n' +
      '1. Purchase additional credits at: https://online.seranking.com/admin.api.dashboard.html\n' +
      '2. Or contact api@seranking.com for assistance'
    );
    this.name = 'InsufficientFundsError';
  }
}

// Helper to truncate text for answer snippets
function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  // Clean up the text - remove extra whitespace and newlines
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength).trim() + '...';
}

export class SeRankingClient {
  private apiKey: string;
  private config: ApiConfig;
  private rateLimiter: RateLimiter;
  private apiLogs: ApiResponseLog[] = [];
  private enableLogging: boolean;

  constructor(apiKey: string, config?: Omit<Partial<ApiConfig>, 'rateLimit'> & { enableLogging?: boolean; rateLimit?: number }) {
    this.apiKey = apiKey;
    this.config = {
      key: apiKey,
      mode: config?.mode || 'user',
      trackCredits: config?.trackCredits || false,
      rateLimit: config?.rateLimit !== undefined ? true : false,
    };
    this.rateLimiter = new RateLimiter(config?.rateLimit || DEFAULT_RATE_LIMIT);
    this.enableLogging = config?.enableLogging ?? true;
  }

  /**
   * Get all API response logs (for developer inspection)
   */
  getApiLogs(): ApiResponseLog[] {
    return this.apiLogs;
  }

  /**
   * Clear API response logs
   */
  clearApiLogs(): void {
    this.apiLogs = [];
  }

  /**
   * Get total credits consumed across all API calls
   */
  getTotalCredits(): number {
    return this.apiLogs.reduce((sum, log) => sum + (log.credits || 0), 0);
  }

  /**
   * Get subscription info (costs 0 credits)
   */
  async getSubscription(): Promise<SubscriptionInfo> {
    const response = await this.request<{
      subscription_info: {
        status: string;
        start_date: string;
        expiraton_date: string; // API has typo: "expiraton" not "expiration"
        units_limit: number;
        units_left: string | number;
      };
    }>('/account/subscription');

    const info = response.subscription_info;
    return {
      status: info.status,
      startDate: info.start_date,
      expirationDate: info.expiraton_date, // API typo
      unitsLimit: info.units_limit,
      unitsLeft: parseFloat(String(info.units_left)),
    };
  }

  private async request<T>(
    endpoint: string,
    params: Record<string, unknown> = {},
    method: 'GET' | 'POST' = 'GET'
  ): Promise<T> {
    // Apply rate limiting
    await this.rateLimiter.acquire();

    const url = new URL(`${API_BASE_URL}${endpoint}`);
    const startTime = Date.now();

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    };

    if (method === 'GET') {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    } else {
      options.body = JSON.stringify(params);
    }

    const response = await fetch(url.toString(), options);

    if (!response.ok) {
      const errorText = await response.text();

      // Handle specific error codes
      if (response.status === 429) {
        throw new RateLimitError();
      }
      if (response.status === 402) {
        throw new InsufficientFundsError();
      }

      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const duration = Date.now() - startTime;

    // Log the API response for developer inspection
    if (this.enableLogging) {
      const recordCount = countRecords(data);
      const credits = calculateCredits(endpoint, recordCount);

      this.apiLogs.push({
        endpoint,
        method,
        params,
        response: data,
        timestamp: new Date().toISOString(),
        duration,
        credits,
      });
    }

    return data;
  }

  // ============================================================
  // Backlinks Endpoints
  // ============================================================

  async getBacklinksSummary(target: string, mode: 'domain' | 'host' | 'url' = 'domain'): Promise<BacklinksSummary> {
    const response = await this.request<{ summary: Array<{
      target: string;
      backlinks: number;
      refdomains: number;
      subnets: number;
      ips: number;
      nofollow_backlinks: number;
      dofollow_backlinks: number;
      edu_backlinks: number;
      gov_backlinks: number;
      domain_inlink_rank: number;
      text_backlinks: number;
      top_anchors_by_backlinks: { anchor: string; backlinks: number }[];
      top_anchors_by_refdomains: { anchor: string; refdomains: number }[];
      top_tlds: { tld: string; count: number }[];
      top_countries: { country: string; count: number }[];
    }> }>('/backlinks/summary', { target, mode });

    const data = response.summary?.[0];
    if (!data) {
      throw new Error('No backlinks data returned');
    }

    // Map API response to our types
    return {
      backlinks: data.backlinks || 0,
      backlinks_num: data.backlinks || 0,
      refdomains: data.refdomains || 0,
      refdomains_num: data.refdomains || 0,
      subnets: data.subnets || 0,
      ips: data.ips || 0,
      dofollow_backlinks: data.dofollow_backlinks || 0,
      nofollow_backlinks: data.nofollow_backlinks || 0,
      text_backlinks: data.text_backlinks || 0,
      image_backlinks: 0,
      redirect_backlinks: 0,
      canonical_backlinks: 0,
      gov_backlinks: data.gov_backlinks || 0,
      edu_backlinks: data.edu_backlinks || 0,
      tlds: Object.fromEntries((data.top_tlds || []).map(t => [t.tld, t.count])),
      countries: Object.fromEntries((data.top_countries || []).map(c => [c.country, c.count])),
      top_anchors_by_backlinks: (data.top_anchors_by_backlinks || []).map(a => ({
        anchor: a.anchor,
        count: a.backlinks
      })),
      top_anchors_by_refdomains: (data.top_anchors_by_refdomains || []).map(a => ({
        anchor: a.anchor,
        count: a.refdomains
      })),
    };
  }

  async getBacklinksAuthority(target: string): Promise<BacklinksAuthority> {
    const response = await this.request<{
      pages: Array<{
        url: string;
        domain_inlink_rank: number;
        inlink_rank: number;
      }>;
    }>('/backlinks/authority', { target });

    const page = response.pages?.[0];
    return {
      domain_inlink_rank: page?.domain_inlink_rank || 0,
      page_inlink_rank: page?.inlink_rank || 0,
    };
  }

  async getBacklinksNewLostCount(
    target: string,
    dateFrom?: string,
    dateTo?: string
  ): Promise<BacklinksNewLostCount> {
    try {
      // Calculate date range (last 30 days by default)
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const toDate = dateTo || now.toISOString().split('T')[0];
      const fromDate = dateFrom || thirtyDaysAgo.toISOString().split('T')[0];

      // SE Ranking API only returns the type you request (new OR lost, not both)
      // So we need to make separate calls for 'new' and 'lost'

      // Fetch NEW backlinks count
      const newBacklinksPromise = this.request<{
        new_lost_backlinks_count: Array<{
          date: string;
          new: number;
          lost: number;
        }>;
      }>('/backlinks/history/count', {
        target,
        mode: 'domain',
        new_lost_type: 'new',
        date_from: fromDate,
        date_to: toDate,
        link_type: 'href',
        anchor_type: 'text',
        dofollow: 'dofollow',
      }).catch(() => ({ new_lost_backlinks_count: [] }));

      // Fetch LOST backlinks count
      const lostBacklinksPromise = this.request<{
        new_lost_backlinks_count: Array<{
          date: string;
          new: number;
          lost: number;
        }>;
      }>('/backlinks/history/count', {
        target,
        mode: 'domain',
        new_lost_type: 'lost',
        date_from: fromDate,
        date_to: toDate,
        link_type: 'href',
        anchor_type: 'text',
        dofollow: 'dofollow',
      }).catch(() => ({ new_lost_backlinks_count: [] }));

      // Fetch NEW refdomains count
      const newRefdomainsPromise = this.request<{
        new_lost_refdomains_count: Array<{
          date: string;
          new: number;
          lost: number;
        }>;
      }>('/backlinks/history/refdomains/count', {
        target,
        mode: 'domain',
        new_lost_type: 'new',
        date_from: fromDate,
        date_to: toDate,
      }).catch(() => ({ new_lost_refdomains_count: [] }));

      // Fetch LOST refdomains count
      const lostRefdomainsPromise = this.request<{
        new_lost_refdomains_count: Array<{
          date: string;
          new: number;
          lost: number;
        }>;
      }>('/backlinks/history/refdomains/count', {
        target,
        mode: 'domain',
        new_lost_type: 'lost',
        date_from: fromDate,
        date_to: toDate,
      }).catch(() => ({ new_lost_refdomains_count: [] }));

      const [newBacklinksResponse, lostBacklinksResponse, newRefdomainsResponse, lostRefdomainsResponse] = await Promise.all([
        newBacklinksPromise,
        lostBacklinksPromise,
        newRefdomainsPromise,
        lostRefdomainsPromise,
      ]);

      // Sum up the NEW backlinks values
      let newBacklinks = 0;
      for (const item of newBacklinksResponse.new_lost_backlinks_count || []) {
        newBacklinks += item.new || 0;
      }

      // Sum up the LOST backlinks values
      let lostBacklinks = 0;
      for (const item of lostBacklinksResponse.new_lost_backlinks_count || []) {
        lostBacklinks += item.lost || 0;
      }

      // Sum up the NEW refdomains values
      let newRefdomains = 0;
      for (const item of newRefdomainsResponse.new_lost_refdomains_count || []) {
        newRefdomains += item.new || 0;
      }

      // Sum up the LOST refdomains values
      let lostRefdomains = 0;
      for (const item of lostRefdomainsResponse.new_lost_refdomains_count || []) {
        lostRefdomains += item.lost || 0;
      }

      return {
        new_backlinks: newBacklinks,
        lost_backlinks: lostBacklinks,
        new_refdomains: newRefdomains,
        lost_refdomains: lostRefdomains,
      };
    } catch {
      return {
        new_backlinks: 0,
        lost_backlinks: 0,
        new_refdomains: 0,
        lost_refdomains: 0,
      };
    }
  }

  async getBacklinksIndexedPages(
    target: string,
    limit: number = 10
  ): Promise<{ data: BacklinksIndexedPage[] }> {
    const response = await this.request<{
      pages: Array<{
        url: string;
        backlinks: number;
        refdomains: number;
        dofollow_backlinks: number;
        nofollow_backlinks: number;
      }>;
    }>('/backlinks/indexed-pages', { target, limit });

    return {
      data: (response.pages || []).map(p => ({
        page: p.url,
        backlinks: p.backlinks || 0,
        refdomains: p.refdomains || 0,
        dofollow: p.dofollow_backlinks || 0,
        nofollow: p.nofollow_backlinks || 0,
      })),
    };
  }

  async getBacklinksDistribution(target: string): Promise<BacklinksDistribution> {
    try {
      const response = await this.request<{
        histogram: Array<{
          domain_inlink_rank: number;
          refdomains: number;
        }>;
      }>('/backlinks/authority/domain/distribution', { target, mode: 'domain', histogramMode: 'domain' });

      const dist: BacklinksDistribution = {
        '0-10': 0, '11-20': 0, '21-30': 0, '31-40': 0, '41-50': 0,
        '51-60': 0, '61-70': 0, '71-80': 0, '81-90': 0, '91-100': 0,
      };

      // Aggregate individual values into ranges
      for (const item of response.histogram || []) {
        const rank = item.domain_inlink_rank;
        const count = item.refdomains || 0;

        if (rank <= 10) dist['0-10'] += count;
        else if (rank <= 20) dist['11-20'] += count;
        else if (rank <= 30) dist['21-30'] += count;
        else if (rank <= 40) dist['31-40'] += count;
        else if (rank <= 50) dist['41-50'] += count;
        else if (rank <= 60) dist['51-60'] += count;
        else if (rank <= 70) dist['61-70'] += count;
        else if (rank <= 80) dist['71-80'] += count;
        else if (rank <= 90) dist['81-90'] += count;
        else dist['91-100'] += count;
      }

      return dist;
    } catch (error) {
      console.error('[SE Ranking API] Distribution error:', error);
      return {
        '0-10': 0, '11-20': 0, '21-30': 0, '31-40': 0, '41-50': 0,
        '51-60': 0, '61-70': 0, '71-80': 0, '81-90': 0, '91-100': 0,
      };
    }
  }

  // ============================================================
  // Domain Endpoints
  // ============================================================

  async getDomainOverview(domain: string, source: string = 'us'): Promise<DomainOverview> {
    const response = await this.request<{
      organic: {
        base_domain: string;
        traffic_sum: number;
        price_sum: number;
        keywords_count: number;
        top1_5: number;
        top6_10: number;
        top11_20: number;
        top21_50: number;
        top51_100: number;
      };
      adv?: {
        keywords_count: number;
      };
    }>('/domain/overview/db', { domain, source });

    const organic = response.organic || {};
    const top1_5 = organic.top1_5 || 0;
    const top6_10 = organic.top6_10 || 0;
    const top11_20 = organic.top11_20 || 0;
    const top21_50 = organic.top21_50 || 0;
    const top51_100 = organic.top51_100 || 0;

    const top3 = Math.round(top1_5 * 0.6); // Estimate top 3 as 60% of top1-5
    const top10 = top1_5 + top6_10;
    const top100 = top10 + top11_20 + top21_50 + top51_100;

    const top20 = top10 + top11_20;
    const top50 = top20 + top21_50;

    return {
      domain: organic.base_domain || domain,
      traffic: organic.traffic_sum || 0,
      traffic_cost: organic.price_sum || 0,
      keywords: organic.keywords_count || 0,
      keywords_top3: top3,
      keywords_top10: top10,
      keywords_top20: top20,
      keywords_top50: top50,
      keywords_top100: top100,
      ads_keywords: response.adv?.keywords_count || 0,
    };
  }

  async getDomainOverviewWorldwide(
    domain: string
  ): Promise<{
    topCountry: string;
    countries: Array<{ source: string; traffic: number; keywords: number }>;
    positionChanges: { up: number; down: number; new: number; lost: number };
  }> {
    try {
      // Single call with show_zones_list: 1 returns both worldwide aggregate AND per-country breakdown
      // Include positions_diff in fields to get position change data
      const response = await this.request<{
        organic: Array<{
          source: string;
          keywords_count: number;
          traffic_sum: number;
          positions_new_count?: number;
          positions_up_count?: number;
          positions_down_count?: number;
          positions_lost_count?: number;
        }>;
        adv: Array<{
          source: string;
          keywords_count: number;
          traffic_sum: number;
          positions_new_count?: number;
          positions_up_count?: number;
          positions_down_count?: number;
          positions_lost_count?: number;
        }>;
      }>('/domain/overview/worldwide', {
        domain,
        show_zones_list: 1,
        fields: 'price,traffic,keywords,positions_diff',
      });

      // Extract worldwide aggregate (source: "worldwide") for position changes from both organic and ads
      const organicWorldwide = (response.organic || []).find(c => c.source === 'worldwide');
      const advWorldwide = (response.adv || []).find(c => c.source === 'worldwide');

      // Sum position changes from both organic and ads
      const positionChanges = {
        up: (organicWorldwide?.positions_up_count || 0) + (advWorldwide?.positions_up_count || 0),
        down: (organicWorldwide?.positions_down_count || 0) + (advWorldwide?.positions_down_count || 0),
        new: (organicWorldwide?.positions_new_count || 0) + (advWorldwide?.positions_new_count || 0),
        lost: (organicWorldwide?.positions_lost_count || 0) + (advWorldwide?.positions_lost_count || 0),
      };

      // Extract per-country data (exclude worldwide aggregate)
      const countries = (response.organic || [])
        .filter(c => c.source !== 'worldwide')
        .map(c => ({
          source: c.source,
          traffic: c.traffic_sum || 0,
          keywords: c.keywords_count || 0,
        }))
        .sort((a, b) => b.traffic - a.traffic);

      // Get top country by traffic (default to 'us' if no data)
      const topCountry = countries[0]?.source || 'us';

      return { topCountry, countries, positionChanges };
    } catch (error) {
      console.warn('Failed to fetch worldwide overview:', error);
      return { topCountry: 'us', countries: [], positionChanges: { up: 0, down: 0, new: 0, lost: 0 } };
    }
  }

  async getURLOverviewWorldwide(
    url: string,
    fields: string[] = ['keywords', 'traffic', 'price']
  ): Promise<URLOverviewWorldwide> {
    try {
      const response = await this.request<{
        organic: Array<{
          source: string;
          keywords_count: number;
          traffic_sum: number;
          price_sum: number;
        }>;
        adv: Array<{
          source: string;
          keywords_count: number;
          traffic_sum: number;
          price_sum: number;
        }>;
      }>('/domain/overview/worldwide/url', {
        url,
        fields: fields.join(','),
      });

      const organic = response.organic?.[0] || { keywords_count: 0, traffic_sum: 0, price_sum: 0 };
      const adv = response.adv?.[0] || { keywords_count: 0, traffic_sum: 0, price_sum: 0 };

      return {
        url,
        organic: {
          keywords_count: organic.keywords_count || 0,
          traffic_sum: organic.traffic_sum || 0,
          price_sum: organic.price_sum || 0,
        },
        adv: {
          keywords_count: adv.keywords_count || 0,
          traffic_sum: adv.traffic_sum || 0,
          price_sum: adv.price_sum || 0,
        },
      };
    } catch (error) {
      console.warn('Failed to fetch URL overview worldwide:', error);
      return {
        url,
        organic: { keywords_count: 0, traffic_sum: 0, price_sum: 0 },
        adv: { keywords_count: 0, traffic_sum: 0, price_sum: 0 },
      };
    }
  }

  async getDomainSubdomains(
    domain: string,
    source: string = 'us',
    options: {
      limit?: number;
      orderField?: 'traffic_sum' | 'keywords_count';
      orderType?: 'asc' | 'desc';
    } = {}
  ): Promise<{ data: Array<{ subdomain: string; traffic: number; keywords: number }> }> {
    try {
      const response = await this.request<Array<{
        subdomain: string;
        traffic_sum: number;
        keywords_count: number;
      }>>('/domain/subdomains', {
        domain,
        source,
        limit: options.limit || 10,
        order_field: options.orderField || 'traffic_sum',
        order_type: options.orderType || 'desc',
      });

      const subdomains = Array.isArray(response) ? response : [];

      return {
        data: subdomains.map(s => ({
          subdomain: s.subdomain,
          traffic: s.traffic_sum || 0,
          keywords: s.keywords_count || 0,
        })),
      };
    } catch (error) {
      console.warn('Failed to fetch domain subdomains:', error);
      return { data: [] };
    }
  }

  async getDomainHistory(
    domain: string,
    source: string = 'us'
  ): Promise<import('./types').DomainHistory[]> {
    try {
      const response = await this.request<Array<{
        year: number;
        month: number;
        keywords_count: number;
        traffic_sum: number;
        price_sum: number;
        top1_5: number;
        top6_10: number;
        top11_20: number;
        top21_50: number;
        top51_100: number;
      }>>('/domain/overview/history', { domain, source, type: 'organic' });

      const history = Array.isArray(response) ? response : [];

      return history.map(h => ({
        date: `${h.year}-${String(h.month).padStart(2, '0')}`,
        year: h.year,
        month: h.month,
        traffic: h.traffic_sum || 0,
        keywords: h.keywords_count || 0,
        traffic_cost: h.price_sum || 0,
        top1_5: h.top1_5 || 0,
        top6_10: h.top6_10 || 0,
        top11_20: h.top11_20 || 0,
        top21_50: h.top21_50 || 0,
        top51_100: h.top51_100 || 0,
      }));
    } catch (error) {
      console.error('Failed to fetch domain history:', error);
      return [];
    }
  }

  async getDomainKeywords(
    domain: string,
    source: string = 'us',
    options: {
      type?: 'organic' | 'adv';
      limit?: number;
      offset?: number;
      filterPositionFrom?: number;
      filterPositionTo?: number;
      filterVolumeFrom?: number;
      orderField?: string;
      orderType?: 'asc' | 'desc';
    } = {}
  ): Promise<{ data: DomainKeyword[]; total: number }> {
    // API returns array directly, not wrapped in object
    const response = await this.request<Array<{
      keyword: string;
      position: number;
      prev_pos: number | null;
      volume: number;
      cpc: number;
      competition: number;
      difficulty: number;
      traffic: number;
      traffic_percent: number;
      url: string;
      serp_features: string[];
    }>>('/domain/keywords', {
      domain,
      source,
      type: options.type || 'organic',
      limit: options.limit || 20,
      page: options.offset ? Math.floor(options.offset / (options.limit || 20)) + 1 : 1,
      filter_position_from: options.filterPositionFrom,
      filter_position_to: options.filterPositionTo,
      filter_volume_from: options.filterVolumeFrom,
      order_field: options.orderField || 'traffic',
      order_type: options.orderType || 'desc',
    });

    const keywords = Array.isArray(response) ? response : [];

    return {
      data: keywords.map(k => ({
        keyword: k.keyword,
        position: k.position || 0,
        prev_position: k.prev_pos,
        volume: k.volume || 0,
        cpc: k.cpc || 0,
        competition: k.competition || 0,
        difficulty: k.difficulty || 0,
        traffic: k.traffic || 0,
        traffic_percent: k.traffic_percent || 0,
        url: k.url || '',
        serp_features: k.serp_features || [],
      })),
      // Total is not returned by this endpoint; we get it from getDomainOverview
      total: keywords.length,
    };
  }

  /**
   * Get domain's paid keywords (keywords the domain is bidding on)
   * Uses /domain/keywords with type=adv
   * Returns keywords with ad snippet information
   */
  async getDomainPaidKeywords(
    domain: string,
    source: string = 'us',
    options: {
      limit?: number;
      orderField?: string;
      orderType?: 'asc' | 'desc';
    } = {}
  ): Promise<{ data: import('./types').DomainPaidKeyword[] }> {
    try {
      const response = await this.request<Array<{
        keyword: string;
        position: number;
        prev_pos: number | null;
        volume: number;
        cpc: number;
        competition: number;
        traffic: number;
        traffic_percent: number;
        price: number;
        url: string;
        snippet_title: string;
        snippet_description: string;
        snippet_display_url: string;
        snippets_count: number;
      }>>('/domain/keywords', {
        domain,
        source,
        type: 'adv',
        limit: options.limit || 20,
        order_field: options.orderField || 'traffic',
        order_type: options.orderType || 'desc',
        cols: 'keyword,position,prev_pos,volume,cpc,competition,traffic,traffic_percent,price,url,snippet_title,snippet_description,snippet_display_url,snippets_count',
      });

      const keywords = Array.isArray(response) ? response : [];

      return {
        data: keywords.map(k => ({
          keyword: k.keyword || '',
          position: k.position || 0,
          prev_position: k.prev_pos,
          volume: k.volume || 0,
          cpc: k.cpc || 0,
          competition: k.competition || 0,
          traffic: k.traffic || 0,
          traffic_percent: k.traffic_percent || 0,
          price: k.price || 0,
          url: k.url || '',
          snippet_title: k.snippet_title || '',
          snippet_description: k.snippet_description || '',
          snippet_display_url: k.snippet_display_url || '',
          snippets_count: k.snippets_count || 0,
        })),
      };
    } catch (error) {
      console.warn('Failed to fetch domain paid keywords:', error);
      return { data: [] };
    }
  }

  async getDomainCompetitors(
    domain: string,
    source: string = 'us',
    limit: number = 10
  ): Promise<{ data: DomainCompetitor[] }> {
    // API returns array directly
    const response = await this.request<Array<{
      domain: string;
      common_keywords: number;
      total_keywords: number;
      traffic_sum: number;
      price_sum: number;
      domain_relevance: number;
    }>>('/domain/competitors', { domain, source, stats: 1 });

    const competitors = Array.isArray(response) ? response : [];

    // Sort by common_keywords descending to get most relevant business competitors
    const sorted = competitors.sort((a, b) => b.common_keywords - a.common_keywords);

    return {
      data: sorted.slice(0, limit).map(c => ({
        domain: c.domain,
        common_keywords: c.common_keywords || 0,
        keywords: c.total_keywords || 0,
        traffic: c.traffic_sum || 0,
        traffic_cost: c.price_sum || 0,
        overlap: c.domain_relevance || 0,
      })),
    };
  }

  async getDomainKeywordsComparison(
    domain: string,
    compareDomain: string,
    source: string = 'us',
    options: {
      diff?: number;
      limit?: number;
      orderField?: string;
      orderType?: 'asc' | 'desc';
    } = {}
  ): Promise<{ data: KeywordGap[] }> {
    try {
      // API returns array directly
      // For keyword gap (diff=1): domain=competitor (has keywords), compare=our domain (missing)
      const response = await this.request<Array<{
        keyword: string;
        volume: number;
        difficulty: number;
        position: number;
      }>>('/domain/keywords/comparison', {
        domain,
        compare: compareDomain,
        source,
        diff: options.diff ?? 1,
        limit: options.limit || 10,
        order_field: options.orderField || 'volume',
        order_type: options.orderType || 'desc',
      });

      const keywords = Array.isArray(response) ? response : [];

      return {
        data: keywords.map(k => ({
          keyword: k.keyword,
          volume: k.volume || 0,
          difficulty: k.difficulty || 0,
          competitor_position: k.position || 0,
          our_position: null, // Not ranking for this keyword (that's why it's a gap)
        })),
      };
    } catch {
      return { data: [] };
    }
  }

  /**
   * Compare keywords between two URLs (not domains)
   * Uses the same /domain/keywords/comparison endpoint but with url parameter
   * Returns detailed comparison including traffic, position, and price for both URLs
   */
  async getURLKeywordsComparison(
    ourUrl: string,
    competitorUrl: string,
    source: string = 'us',
    options: {
      diff?: number;  // 0 = common keywords, 1 = keyword gap
      limit?: number;
      orderField?: string;
      orderType?: 'asc' | 'desc';
    } = {}
  ): Promise<{ data: URLKeywordComparison[] }> {
    try {
      const response = await this.request<Array<{
        keyword: string;
        volume: number;
        cpc: number;
        competition: number;
        difficulty: number;
        total_sites: number;
        position: number | null;
        url: string | null;
        price: number | null;
        traffic: number | null;
        compare_position: number | null;
        compare_url: string | null;
        compare_price: number | null;
        compare_traffic: number | null;
      }>>('/domain/keywords/comparison', {
        url: ourUrl,
        compare: competitorUrl,
        source,
        diff: options.diff ?? 0,
        limit: options.limit || 20,
        order_field: options.orderField || 'volume',
        order_type: options.orderType || 'desc',
      });

      const keywords = Array.isArray(response) ? response : [];

      return {
        data: keywords.map(k => ({
          keyword: k.keyword,
          volume: k.volume || 0,
          cpc: k.cpc || 0,
          competition: k.competition || 0,
          difficulty: k.difficulty || 0,
          position: k.position,
          url: k.url,
          traffic: k.traffic,
          price: k.price,
          compare_position: k.compare_position,
          compare_url: k.compare_url,
          compare_traffic: k.compare_traffic,
          compare_price: k.compare_price,
        })),
      };
    } catch (error) {
      console.warn('Failed to fetch URL keywords comparison:', error);
      return { data: [] };
    }
  }

  /**
   * Get full page comparison between two URLs
   * Fetches both common keywords and unique keywords for our page
   */
  async getPageComparison(
    ourUrl: string,
    competitorUrl: string,
    source: string = 'us',
    limit: number = 10
  ): Promise<PageComparison> {
    try {
      const [commonResult, uniqueResult] = await Promise.all([
        // Common keywords (diff=0) - keywords both pages rank for
        this.getURLKeywordsComparison(ourUrl, competitorUrl, source, {
          diff: 0,
          limit,
          orderField: 'volume',
          orderType: 'desc',
        }),
        // Our unique keywords (diff=1) - keywords only our page ranks for
        this.getURLKeywordsComparison(ourUrl, competitorUrl, source, {
          diff: 1,
          limit,
          orderField: 'volume',
          orderType: 'desc',
        }),
      ]);

      return {
        ourUrl,
        competitorUrl,
        commonKeywords: commonResult.data,
        ourUniqueKeywords: uniqueResult.data,
      };
    } catch (error) {
      console.warn('Failed to fetch page comparison:', error);
      return {
        ourUrl,
        competitorUrl,
        commonKeywords: [],
        ourUniqueKeywords: [],
      };
    }
  }

  // ============================================================
  // AI Search Endpoints
  // ============================================================

  async getAISearchOverview(target: string, source: string = 'us'): Promise<AISearchOverview> {
    try {
      // SE Ranking API: GET /ai-search/overview
      // Get aggregated data first
      const response = await this.request<{
        summary: {
          brand_presence: { current: number };
          link_presence: { current: number };
          ai_opportunity_traffic: { current: number };
          average_position: { current: number };
        };
      }>('/ai-search/overview', { target, source });

      const totalBrandPresence = response.summary?.brand_presence?.current || 0;
      const totalLinkPresence = response.summary?.link_presence?.current || 0;
      const aiTraffic = response.summary?.ai_opportunity_traffic?.current || 0;

      // Now fetch per-engine data
      const engineNames = ['ai-overview', 'ai-mode', 'chatgpt', 'perplexity', 'gemini'];
      const engineResults = await Promise.all(
        engineNames.map(async (engine) => {
          try {
            const engineResponse = await this.request<{
              summary: {
                brand_presence: { current: number };
                link_presence: { current: number };
                ai_opportunity_traffic: { current: number };
              };
            }>('/ai-search/overview', { target, source, engine });

            return {
              engine,
              brand_presence: engineResponse.summary?.brand_presence?.current || 0,
              link_presence: engineResponse.summary?.link_presence?.current || 0,
              traffic: engineResponse.summary?.ai_opportunity_traffic?.current || 0,
            };
          } catch {
            return { engine, brand_presence: 0, link_presence: 0, traffic: 0 };
          }
        })
      );

      // Filter out engines with no data
      const enginesWithData = engineResults.filter(e => e.brand_presence > 0 || e.link_presence > 0);

      // If no per-engine data, use aggregated data as fallback
      if (enginesWithData.length === 0 && (totalBrandPresence > 0 || totalLinkPresence > 0)) {
        return {
          target,
          engines: [
            { engine: 'all', brand_presence: totalBrandPresence, link_presence: totalLinkPresence, traffic: aiTraffic },
          ],
        };
      }

      return {
        target,
        engines: enginesWithData,
      };
    } catch (error) {
      console.warn('AI Search Overview failed:', error);
      return { target, engines: [] };
    }
  }

  async getAISearchLeaderboard(
    primary: { target: string; brand?: string },
    competitors: { target: string; brand?: string }[],
    source: string = 'us',
    engines: string[] = ['ai-overview', 'ai-mode', 'chatgpt', 'perplexity', 'gemini']
  ): Promise<{
    data: AILeaderboardEntry[];
    engineData: AISearchOverview['engines'];
  }> {
    try {
      // SE Ranking API: POST /ai-search/overview/leaderboard
      const response = await this.request<{
        leaderboard: Array<{
          rank: number;
          domain: string;
          share_of_voice: number;
          brand_presence: number;
          link_presence: number;
          is_primary_target: boolean;
        }>;
        results: Record<string, Record<string, { brand_presence: number; link_presence: number }>>;
      }>(
        '/ai-search/overview/leaderboard',
        { primary, competitors, source, engines },
        'POST'
      );

      // Transform leaderboard to our format
      const data: AILeaderboardEntry[] = (response.leaderboard || []).map(entry => ({
        rank: entry.rank,
        domain: entry.domain,
        brand: entry.domain.split('.')[0],
        share_of_voice: Math.round(entry.share_of_voice * 100),
        brand_mentions: entry.brand_presence || 0,
        link_citations: entry.link_presence || 0,
        is_primary_target: entry.is_primary_target || false,
      }));

      // Extract per-engine data for the primary target from the results
      const primaryDomain = primary.target;
      const primaryResults = response.results?.[primaryDomain] || {};

      const engineData: AISearchOverview['engines'] = engines.map(engine => ({
        engine,
        brand_presence: primaryResults[engine]?.brand_presence || 0,
        link_presence: primaryResults[engine]?.link_presence || 0,
        traffic: 0,
      }));

      return { data, engineData };
    } catch (error) {
      console.error('[AI Leaderboard] FAILED:', error);
      return { data: [], engineData: [] };
    }
  }

  async getAISearchPromptsByTarget(
    target: string,
    source: string,
    engine: string,
    limit: number = 20,
    scope: string = 'base_domain'
  ): Promise<{ data: AIPrompt[] }> {
    try {
      // SE Ranking API: GET /ai-search/prompts-by-target
      // Note: engine is REQUIRED by the API
      const response = await this.request<{
        total: number;
        prompts: Array<{
          prompt: string;
          volume: number;
          type: string;
          answer?: {
            text: string;
            links: string[];
          };
        }>;
      }>('/ai-search/prompts-by-target', { target, source, engine, limit, scope });

      // Transform to our format
      // API returns type as "Link", "Brand", or "Brand_Link" (capitalized)
      const data: AIPrompt[] = (response.prompts || []).map((p, index) => ({
        prompt: p.prompt,
        engine: engine,
        type: p.type.toLowerCase() === 'link' ? 'link' as const :
              p.type.toLowerCase() === 'brand' ? 'brand' as const : 'brand_link' as const,
        position: index + 1,
        volume: p.volume || 0,
        answer_snippet: p.answer?.text ? truncateText(p.answer.text, 200) : undefined,
        answer_full: p.answer?.text || undefined,
        sources: p.answer?.links && p.answer.links.length > 0 ? p.answer.links : undefined,
      }));

      return { data };
    } catch (error) {
      console.warn('AI Search Prompts failed:', error);
      return { data: [] };
    }
  }

  async getAISearchPromptsByBrand(
    brand: string,
    source: string,
    engine: string,
    limit: number = 20
  ): Promise<{ data: AIPrompt[] }> {
    try {
      // SE Ranking API: GET /ai-search/prompts-by-brand
      // Note: engine is REQUIRED by the API
      const response = await this.request<{
        total: number;
        prompts: Array<{
          prompt: string;
          volume: number;
          type: string;
          answer?: {
            text: string;
            links: string[];
          };
        }>;
      }>('/ai-search/prompts-by-brand', { brand, source, engine, limit });

      // Transform to our format
      const data: AIPrompt[] = (response.prompts || []).map((p, index) => ({
        prompt: p.prompt,
        engine: engine,
        type: p.type.toLowerCase() === 'link' ? 'link' as const :
              p.type.toLowerCase() === 'brand' ? 'brand' as const : 'brand_link' as const,
        position: index + 1,
        volume: p.volume || 0,
        answer_snippet: p.answer?.text ? truncateText(p.answer.text, 200) : undefined,
        answer_full: p.answer?.text || undefined,
        sources: p.answer?.links && p.answer.links.length > 0 ? p.answer.links : undefined,
      }));

      return { data };
    } catch (error) {
      console.warn('AI Search Prompts by Brand failed:', error);
      return { data: [] };
    }
  }

  async discoverBrand(target: string, source: string = 'us', scope: string = 'base_domain'): Promise<{ brand: string }> {
    try {
      // SE Ranking API: GET /ai-search/discover-brand
      // API returns { brands: string[] } - we take the first brand
      const response = await this.request<{ brands: string[] }>('/ai-search/discover-brand', { target, source, scope });
      const brand = response.brands?.[0] || target.split('.')[0];
      return { brand };
    } catch {
      return { brand: target.split('.')[0] };
    }
  }

  // ============================================================
  // Keyword Endpoints
  // ============================================================

  async getKeywordQuestions(
    keyword: string,
    source: string = 'us',
    limit: number = 10
  ): Promise<{ data: KeywordQuestion[] }> {
    try {
      const response = await this.request<{
        keywords: Array<{
          keyword: string;
          volume: number;
          difficulty: number;
          cpc: number;
        }>;
      }>('/keywords/questions', { keyword, source, limit });

      return {
        data: response.keywords || [],
      };
    } catch {
      return { data: [] };
    }
  }

  // ============================================================
  // Additional Methods for Domain Analysis & Competitors
  // ============================================================

  async getBacklinksRefDomains(
    target: string,
    limit: number = 100,
    orderBy: 'date_found' | 'domain_inlink_rank' | 'inlink_rank' = 'domain_inlink_rank'
  ): Promise<{ data: import('./types').RefDomain[] }> {
    try {
      const response = await this.request<{
        refdomains: Array<{
          refdomain: string;
          backlinks: number;
          domain_inlink_rank: number;
          first_seen: string;
        }>;
      }>('/backlinks/refdomains', { target, limit, order_by: orderBy, mode: 'domain' });

      return {
        data: (response.refdomains || []).map(r => ({
          domain: r.refdomain,
          backlinks: r.backlinks || 0,
          domain_inlink_rank: r.domain_inlink_rank || 0,
          first_seen: r.first_seen || '',
        })),
      };
    } catch (error) {
      console.warn('Failed to fetch ref domains:', error);
      return { data: [] };
    }
  }

  async getTopPagesByTraffic(
    domain: string,
    source: string = 'us',
    limit: number = 10
  ): Promise<{ data: import('./types').TopPage[] }> {
    try {
      // Fetch keywords and aggregate by URL
      const response = await this.request<Array<{
        keyword: string;
        position: number;
        volume: number;
        traffic: number;
        url: string;
      }>>('/domain/keywords', {
        domain,
        source,
        limit: 100, // Get more keywords to aggregate
        order_field: 'traffic',
        order_type: 'desc',
      });

      const keywords = Array.isArray(response) ? response : [];

      // Aggregate by URL
      const urlMap = new Map<string, { traffic: number; keywords: number }>();
      for (const k of keywords) {
        if (!k.url) continue;
        const existing = urlMap.get(k.url) || { traffic: 0, keywords: 0 };
        urlMap.set(k.url, {
          traffic: existing.traffic + (k.traffic || 0),
          keywords: existing.keywords + 1,
        });
      }

      // Convert to array and sort by traffic
      const pages: import('./types').TopPage[] = Array.from(urlMap.entries())
        .map(([url, data]) => ({
          url,
          traffic: data.traffic,
          keywords: data.keywords,
        }))
        .sort((a, b) => b.traffic - a.traffic)
        .slice(0, limit);

      return { data: pages };
    } catch (error) {
      console.warn('Failed to fetch top pages by traffic:', error);
      return { data: [] };
    }
  }

  async getDomainAds(
    domain: string,
    source: string = 'us',
    limit: number = 10
  ): Promise<{ data: import('./types').PaidAd[] }> {
    try {
      const response = await this.request<Array<{
        keyword: string;
        position: number;
        title: string;
        description: string;
        url: string;
        date: string;
      }>>('/domain/ads/domain', { domain, source, limit });

      const ads = Array.isArray(response) ? response : [];

      return {
        data: ads.map(a => ({
          keyword: a.keyword || '',
          position: a.position || 0,
          title: a.title || '',
          description: a.description || '',
          url: a.url || '',
          date: a.date || '',
        })),
      };
    } catch (error) {
      console.warn('Failed to fetch domain ads:', error);
      return { data: [] };
    }
  }

  /**
   * Get paid ads for a domain
   * Retrieves keywords the domain is bidding on in paid search
   * Cost: 100 credits per request
   */
  async getDomainPaidAds(
    domain: string,
    source: string = 'us',
    options: {
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ data: import('./types').DomainPaidAd[] }> {
    try {
      const response = await this.request<Array<{
        keyword: string;
        ads_count: number;
        competition: string | number;
        cpc: string | number;
        volume: string | number;
        snippets: Record<string, {
          position: string | number;
          snippet_title: string;
          snippet_description: string;
          snippet_display_url: string;
          snippet_count: string | number;
          snippet_num: number;
          url: string;
        }>;
      }>>('/domain/ads', {
        domain,
        source,
        from: options.from,
        to: options.to,
        page: options.page || 1,
        limit: options.limit || 20,
      });

      const ads = Array.isArray(response) ? response : [];

      return {
        data: ads.map(a => ({
          keyword: a.keyword || '',
          ads_count: a.ads_count || 0,
          competition: typeof a.competition === 'string' ? parseFloat(a.competition) : (a.competition || 0),
          cpc: typeof a.cpc === 'string' ? parseFloat(a.cpc) : (a.cpc || 0),
          volume: typeof a.volume === 'string' ? parseInt(a.volume, 10) : (a.volume || 0),
          snippets: Object.entries(a.snippets || {}).map(([date, snippet]) => ({
            date,
            position: typeof snippet.position === 'string' ? parseInt(snippet.position, 10) : (snippet.position || 0),
            snippet_title: snippet.snippet_title || '',
            snippet_description: snippet.snippet_description || '',
            snippet_display_url: snippet.snippet_display_url || '',
            snippet_count: typeof snippet.snippet_count === 'string' ? parseInt(snippet.snippet_count, 10) : (snippet.snippet_count || 0),
            snippet_num: snippet.snippet_num || 0,
            url: snippet.url || '',
          })),
        })),
      };
    } catch (error) {
      console.warn('Failed to fetch domain paid ads:', error);
      return { data: [] };
    }
  }

  /**
   * Get paid ads by keyword
   * Retrieves domains that are advertising on a specific keyword
   * Cost: 100 credits per request
   */
  async getPaidAdsByKeyword(
    keyword: string,
    source: string = 'us',
    options: {
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ): Promise<import('./types').PaidAdsByKeyword> {
    try {
      const response = await this.request<Array<{
        domain: string;
        ads_count: number;
        keywords_count: number;
        traffic_sum: number;
        price_sum: number;
        snippets: Record<string, {
          position: number | string;
          snippet_title: string;
          snippet_description: string;
          snippet_display_url: string;
          snippet_count: number | string;
          url: string;
        }>;
      }>>('/domain/ads', {
        source,
        keyword,
        from: options.from,
        to: options.to,
        limit: options.limit || 10,
      });

      const advertisers = Array.isArray(response) ? response : [];

      return {
        keyword,
        advertisers: advertisers.map(a => ({
          domain: a.domain || '',
          ads_count: a.ads_count || 0,
          keywords_count: a.keywords_count || 0,
          traffic_sum: a.traffic_sum || 0,
          price_sum: a.price_sum || 0,
          snippets: Object.entries(a.snippets || {}).map(([date, snippet]) => ({
            date,
            position: typeof snippet.position === 'string' ? parseInt(snippet.position, 10) : (snippet.position || 0),
            snippet_title: snippet.snippet_title || '',
            snippet_description: snippet.snippet_description || '',
            snippet_display_url: snippet.snippet_display_url || '',
            snippet_count: typeof snippet.snippet_count === 'string' ? parseInt(snippet.snippet_count, 10) : (snippet.snippet_count || 0),
            url: snippet.url || '',
          })),
        })),
      };
    } catch (error) {
      console.warn('Failed to fetch paid ads for keyword:', keyword, error);
      return { keyword, advertisers: [] };
    }
  }

  /**
   * Get paid ads for multiple keywords
   * Fetches paid ads data for a list of keywords
   */
  async getPaidAdsForKeywords(
    keywords: string[],
    source: string = 'us',
    limit: number = 5
  ): Promise<import('./types').PaidAdsByKeyword[]> {
    // Fetch in parallel with individual error handling
    const results = await Promise.all(
      keywords.map(keyword =>
        this.getPaidAdsByKeyword(keyword, source, { limit })
      )
    );

    // Filter out keywords with no advertisers
    return results.filter(r => r.advertisers.length > 0);
  }

  async getKeywordOverlap(
    domain: string,
    compareDomain: string,
    source: string = 'us',
    limit: number = 20
  ): Promise<{ data: Array<{ keyword: string; volume: number; ourPosition: number; competitorPosition: number }> }> {
    try {
      // diff=0 means common keywords (intersection)
      const response = await this.request<Array<{
        keyword: string;
        volume: number;
        position: number;
        compare_position: number;
      }>>('/domain/keywords/comparison', {
        domain,
        compare: compareDomain,
        source,
        diff: 0, // Common keywords
        limit,
        order_field: 'volume',
        order_type: 'desc',
      });

      const keywords = Array.isArray(response) ? response : [];

      return {
        data: keywords.map(k => ({
          keyword: k.keyword,
          volume: k.volume || 0,
          ourPosition: k.position || 0,
          competitorPosition: k.compare_position || 0,
        })),
      };
    } catch (error) {
      console.warn('Failed to fetch keyword overlap:', error);
      return { data: [] };
    }
  }

  async getCompetitorMetrics(
    domains: string[],
    source: string = 'us'
  ): Promise<{ data: import('./types').CompetitorComparison[] }> {
    try {
      // Fetch metrics for multiple domains in parallel
      const results = await Promise.all(
        domains.map(async (domain) => {
          const [overview, authority] = await Promise.all([
            this.getDomainOverview(domain, source).catch(() => null),
            this.getBacklinksAuthority(domain).catch(() => null),
          ]);

          return {
            domain,
            traffic: overview?.traffic || 0,
            keywords: overview?.keywords || 0,
            authority: authority?.domain_inlink_rank || 0,
            backlinks: 0, // Would need separate call
            common_keywords: 0,
            overlap: 0,
          };
        })
      );

      return { data: results };
    } catch (error) {
      console.warn('Failed to fetch competitor metrics:', error);
      return { data: [] };
    }
  }

  async getBacklinkGap(
    ourDomain: string,
    competitorDomain: string,
    limit: number = 20
  ): Promise<{ data: import('./types').BacklinkGap[] }> {
    try {
      // Get ref domains for competitor
      const competitorRefDomains = await this.getBacklinksRefDomains(competitorDomain, 100);
      // Get ref domains for our domain
      const ourRefDomains = await this.getBacklinksRefDomains(ourDomain, 100);

      // Find domains linking to competitor but not to us
      const ourDomainSet = new Set(ourRefDomains.data.map(r => r.domain));
      const gaps = competitorRefDomains.data
        .filter(r => !ourDomainSet.has(r.domain))
        .slice(0, limit)
        .map(r => ({
          domain: r.domain,
          domain_inlink_rank: r.domain_inlink_rank,
          backlinks_to_competitor: r.backlinks,
        }));

      return { data: gaps };
    } catch (error) {
      console.warn('Failed to calculate backlink gap:', error);
      return { data: [] };
    }
  }

  // ============================================================
  // Advanced Keyword Research Endpoints
  // ============================================================

  async getSimilarKeywords(
    keyword: string,
    source: string = 'us',
    limit: number = 20
  ): Promise<KeywordSuggestion[]> {
    try {
      const response = await this.request<{
        keywords: Array<{
          keyword: string;
          volume: number;
          difficulty: number;
          cpc: number;
          competition: number;
        }>;
      }>('/keywords/similar', { keyword, source, limit });

      return (response.keywords || []).map(k => ({
        keyword: k.keyword,
        volume: k.volume || 0,
        difficulty: k.difficulty || 0,
        cpc: k.cpc || 0,
        competition: k.competition || 0,
      }));
    } catch (error) {
      console.warn('Failed to fetch similar keywords:', error);
      return [];
    }
  }

  async getRelatedKeywords(
    keyword: string,
    source: string = 'us',
    limit: number = 20
  ): Promise<KeywordSuggestion[]> {
    try {
      const response = await this.request<{
        keywords: Array<{
          keyword: string;
          volume: number;
          difficulty: number;
          cpc: number;
          competition: number;
        }>;
      }>('/keywords/related', { keyword, source, limit });

      return (response.keywords || []).map(k => ({
        keyword: k.keyword,
        volume: k.volume || 0,
        difficulty: k.difficulty || 0,
        cpc: k.cpc || 0,
        competition: k.competition || 0,
      }));
    } catch (error) {
      console.warn('Failed to fetch related keywords:', error);
      return [];
    }
  }

  async getLongTailKeywords(
    keyword: string,
    source: string = 'us',
    limit: number = 20
  ): Promise<KeywordSuggestion[]> {
    try {
      const response = await this.request<{
        keywords: Array<{
          keyword: string;
          volume: number;
          difficulty: number;
          cpc: number;
          competition: number;
        }>;
      }>('/keywords/long-tail', { keyword, source, limit });

      return (response.keywords || []).map(k => ({
        keyword: k.keyword,
        volume: k.volume || 0,
        difficulty: k.difficulty || 0,
        cpc: k.cpc || 0,
        competition: k.competition || 0,
      }));
    } catch (error) {
      console.warn('Failed to fetch long-tail keywords:', error);
      return [];
    }
  }

  // ============================================================
  // Enhanced Backlink Intelligence Endpoints
  // ============================================================

  async getCumulativeBacklinksHistory(
    target: string,
    months: number = 12
  ): Promise<BacklinkHistoryPoint[]> {
    try {
      // Calculate date range
      const now = new Date();
      const monthsAgo = new Date(now.getTime() - months * 30 * 24 * 60 * 60 * 1000);
      const toDate = now.toISOString().split('T')[0];
      const fromDate = monthsAgo.toISOString().split('T')[0];

      const response = await this.request<{
        history: Array<{
          date: string;
          backlinks: number;
          refdomains: number;
        }>;
      }>('/backlinks/history/cumulative', {
        target,
        mode: 'domain',
        date_from: fromDate,
        date_to: toDate,
      });

      return (response.history || []).map(h => ({
        date: h.date,
        backlinks: h.backlinks || 0,
        refdomains: h.refdomains || 0,
      }));
    } catch (error) {
      console.warn('Failed to fetch backlink history:', error);
      return [];
    }
  }

  async getNewLostBacklinksDetailed(
    target: string,
    days: number = 30
  ): Promise<{ new: DetailedBacklink[]; lost: DetailedBacklink[] }> {
    try {
      const now = new Date();
      const daysAgo = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const toDate = now.toISOString().split('T')[0];
      const fromDate = daysAgo.toISOString().split('T')[0];

      // Fetch new backlinks
      const newBacklinksPromise = this.request<{
        backlinks: Array<{
          url_from: string;
          url_to: string;
          anchor: string;
          domain_inlink_rank: number;
          first_seen: string;
          nofollow: boolean;
        }>;
      }>('/backlinks/history', {
        target,
        mode: 'domain',
        new_lost_type: 'new',
        date_from: fromDate,
        date_to: toDate,
        limit: 50,
        order_by: 'domain_inlink_rank',
      }).catch(() => ({ backlinks: [] }));

      // Fetch lost backlinks
      const lostBacklinksPromise = this.request<{
        backlinks: Array<{
          url_from: string;
          url_to: string;
          anchor: string;
          domain_inlink_rank: number;
          last_seen: string;
          nofollow: boolean;
        }>;
      }>('/backlinks/history', {
        target,
        mode: 'domain',
        new_lost_type: 'lost',
        date_from: fromDate,
        date_to: toDate,
        limit: 50,
        order_by: 'domain_inlink_rank',
      }).catch(() => ({ backlinks: [] }));

      const [newResponse, lostResponse] = await Promise.all([
        newBacklinksPromise,
        lostBacklinksPromise,
      ]);

      return {
        new: (newResponse.backlinks || []).map(b => ({
          url_from: b.url_from || '',
          url_to: b.url_to || '',
          anchor: b.anchor || '',
          domain_inlink_rank: b.domain_inlink_rank || 0,
          date_found: b.first_seen,
          dofollow: !b.nofollow,
          type: 'new' as const,
        })),
        lost: (lostResponse.backlinks || []).map(b => ({
          url_from: b.url_from || '',
          url_to: b.url_to || '',
          anchor: b.anchor || '',
          domain_inlink_rank: b.domain_inlink_rank || 0,
          date_lost: b.last_seen,
          dofollow: !b.nofollow,
          type: 'lost' as const,
        })),
      };
    } catch (error) {
      console.warn('Failed to fetch new/lost backlinks:', error);
      return { new: [], lost: [] };
    }
  }

  async getReferringIpsAnalysis(
    target: string,
    limit: number = 20
  ): Promise<IPConcentration[]> {
    try {
      const response = await this.request<{
        ips: Array<{
          ip: string;
          backlinks: number;
        }>;
      }>('/backlinks/ips', { target, mode: 'domain', limit });

      const ips = response.ips || [];
      const totalBacklinks = ips.reduce((sum, ip) => sum + (ip.backlinks || 0), 0);

      return ips.map(ip => {
        const percentage = totalBacklinks > 0 ? (ip.backlinks / totalBacklinks) * 100 : 0;
        let riskLevel: 'low' | 'medium' | 'high' = 'low';
        if (percentage > 15) riskLevel = 'high';
        else if (percentage > 8) riskLevel = 'medium';

        return {
          ip: ip.ip,
          backlinks: ip.backlinks || 0,
          percentage,
          riskLevel,
        };
      });
    } catch (error) {
      console.warn('Failed to fetch referring IPs:', error);
      return [];
    }
  }

  // ============================================================
  // Enhanced Backlinks Report Endpoints
  // ============================================================

  /**
   * Get enhanced anchors with freshness data
   * Cost: ~1 credit per anchor
   */
  async getBacklinksAnchors(
    target: string,
    limit: number = 20
  ): Promise<EnhancedAnchor[]> {
    try {
      const response = await this.request<{
        anchors: Array<{
          anchor: string;
          backlinks: number;
          refdomains: number;
          dofollow_backlinks: number;
          nofollow_backlinks: number;
          first_seen: string;
          last_visited: string;
        }>;
      }>('/backlinks/anchors', {
        target,
        mode: 'domain',
        limit,
        order_by: 'refdomains',
      });

      return (response.anchors || []).map(a => ({
        anchor: a.anchor || '',
        backlinks: a.backlinks || 0,
        refdomains: a.refdomains || 0,
        dofollow_backlinks: a.dofollow_backlinks || 0,
        nofollow_backlinks: a.nofollow_backlinks || 0,
        first_seen: a.first_seen || '',
        last_visited: a.last_visited || '',
      }));
    } catch (error) {
      console.warn('Failed to fetch backlinks anchors:', error);
      return [];
    }
  }

  /**
   * Get individual backlinks with full details
   * Cost: ~1 credit per backlink
   */
  async getBacklinksAll(
    target: string,
    options: {
      limit?: number;
      orderBy?: 'date_found' | 'domain_inlink_rank' | 'inlink_rank';
      dofollowOnly?: boolean;
    } = {}
  ): Promise<IndividualBacklink[]> {
    try {
      const response = await this.request<{
        backlinks: Array<{
          url_from: string;
          url_to: string;
          title: string;
          anchor: string;
          nofollow: boolean;
          image: boolean;
          image_source: string;
          inlink_rank: number;
          domain_inlink_rank: number;
          first_seen: string;
          last_visited: string;
        }>;
      }>('/backlinks/all', {
        target,
        mode: 'domain',
        limit: options.limit || 30,
        order_by: options.orderBy || 'domain_inlink_rank',
        dofollow: options.dofollowOnly ? 'dofollow' : undefined,
      });

      return (response.backlinks || []).map(b => ({
        url_from: b.url_from || '',
        url_to: b.url_to || '',
        title: b.title || '',
        anchor: b.anchor || '',
        nofollow: b.nofollow || false,
        image: b.image || false,
        image_source: b.image_source || '',
        inlink_rank: b.inlink_rank || 0,
        domain_inlink_rank: b.domain_inlink_rank || 0,
        first_seen: b.first_seen || '',
        last_visited: b.last_visited || '',
      }));
    } catch (error) {
      console.warn('Failed to fetch all backlinks:', error);
      return [];
    }
  }

  /**
   * Get referring domains history (new/lost)
   * Cost: ~1 credit per domain
   */
  async getRefDomainsHistory(
    target: string,
    days: number = 30
  ): Promise<RefDomainChange[]> {
    try {
      const now = new Date();
      const daysAgo = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const toDate = now.toISOString().split('T')[0];
      const fromDate = daysAgo.toISOString().split('T')[0];

      // Fetch new and lost ref domains in parallel
      const [newResponse, lostResponse] = await Promise.all([
        this.request<{
          refdomains: Array<{
            refdomain: string;
            domain_inlink_rank: number;
            backlinks: number;
            dofollow_backlinks: number;
            first_seen: string;
            new_lost_date: string;
          }>;
        }>('/backlinks/history/refdomains', {
          target,
          mode: 'domain',
          new_lost_type: 'new',
          date_from: fromDate,
          date_to: toDate,
          limit: 25,
          order_by: 'domain_inlink_rank',
        }).catch(() => ({ refdomains: [] })),

        this.request<{
          refdomains: Array<{
            refdomain: string;
            domain_inlink_rank: number;
            backlinks: number;
            dofollow_backlinks: number;
            first_seen: string;
            new_lost_date: string;
          }>;
        }>('/backlinks/history/refdomains', {
          target,
          mode: 'domain',
          new_lost_type: 'lost',
          date_from: fromDate,
          date_to: toDate,
          limit: 25,
          order_by: 'domain_inlink_rank',
        }).catch(() => ({ refdomains: [] })),
      ]);

      const newDomains: RefDomainChange[] = (newResponse.refdomains || []).map(r => ({
        refdomain: r.refdomain || '',
        domain_inlink_rank: r.domain_inlink_rank || 0,
        backlinks: r.backlinks || 0,
        dofollow_backlinks: r.dofollow_backlinks || 0,
        first_seen: r.first_seen || '',
        new_lost_date: r.new_lost_date || '',
        new_lost_type: 'new' as const,
      }));

      const lostDomains: RefDomainChange[] = (lostResponse.refdomains || []).map(r => ({
        refdomain: r.refdomain || '',
        domain_inlink_rank: r.domain_inlink_rank || 0,
        backlinks: r.backlinks || 0,
        dofollow_backlinks: r.dofollow_backlinks || 0,
        first_seen: r.first_seen || '',
        new_lost_date: r.new_lost_date || '',
        new_lost_type: 'lost' as const,
      }));

      return [...newDomains, ...lostDomains];
    } catch (error) {
      console.warn('Failed to fetch ref domains history:', error);
      return [];
    }
  }

  /**
   * Get page authority history over time
   * Cost: ~1 credit per point
   */
  async getPageAuthorityHistory(
    target: string,
    months: number = 12
  ): Promise<PageAuthorityPoint[]> {
    try {
      const response = await this.request<{
        history: Array<{
          date: string;
          inlink_rank: number;
        }>;
      }>('/backlinks/authority/page/history', {
        target,
        limit: months,
      });

      return (response.history || []).map(h => ({
        date: h.date || '',
        inlink_rank: h.inlink_rank || 0,
      }));
    } catch (error) {
      console.warn('Failed to fetch page authority history:', error);
      return [];
    }
  }

  /**
   * Get referring subnets count
   * Cost: ~10 credits
   */
  async getReferringSubnetsCount(target: string): Promise<number> {
    try {
      const response = await this.request<{
        count: number;
      }>('/backlinks/referring-subnets/count', {
        target,
        mode: 'domain',
      });

      return response.count || 0;
    } catch (error) {
      console.warn('Failed to fetch referring subnets count:', error);
      return 0;
    }
  }

  /**
   * Get raw backlinks data for export
   * Cost: 1 credit per backlink returned
   * @param target - Domain or URL to get backlinks for
   * @param options - Export options
   */
  async getBacklinksRaw(
    target: string,
    options: {
      limit?: number;
      offset?: number;
      perDomain?: number;  // Max backlinks per referring domain (1-100)
      orderBy?: 'date_found' | 'domain_inlink_rank' | 'inlink_rank';
      dofollowOnly?: boolean;
    } = {}
  ): Promise<{
    backlinks: Array<{
      url_from: string;
      url_to: string;
      title: string;
      anchor: string;
      nofollow: boolean;
      image: boolean;
      image_source: string;
      inlink_rank: number;
      domain_inlink_rank: number;
      first_seen: string;
      last_visited: string;
      refdomain: string;
    }>;
    total: number;
  }> {
    try {
      const response = await this.request<{
        backlinks: Array<{
          url_from: string;
          url_to: string;
          title: string;
          anchor: string;
          nofollow: boolean;
          image: boolean;
          image_source: string;
          inlink_rank: number;
          domain_inlink_rank: number;
          first_seen: string;
          last_visited: string;
        }>;
        total?: number;
      }>('/backlinks/raw', {
        target,
        mode: 'domain',
        limit: options.limit || 100,
        offset: options.offset || 0,
        per_domain: options.perDomain || 100,
        order_by: options.orderBy || 'domain_inlink_rank',
        dofollow: options.dofollowOnly ? 'dofollow' : undefined,
      });

      // Extract refdomain from url_from
      const backlinks = (response.backlinks || []).map(b => ({
        ...b,
        refdomain: extractDomainFromUrl(b.url_from),
      }));

      return {
        backlinks,
        total: response.total || backlinks.length,
      };
    } catch (error) {
      console.warn('Failed to fetch raw backlinks:', error);
      return { backlinks: [], total: 0 };
    }
  }

  // ============================================================
  // Multi-Competitor Gap Aggregation Methods
  // ============================================================

  /**
   * Get keyword gaps across multiple competitors
   * Aggregates keywords that competitors rank for but we don't
   */
  async getMultiCompetitorKeywordGaps(
    ourDomain: string,
    competitors: string[],
    source: string = 'us',
    limit: number = 50
  ): Promise<AggregatedKeywordGap[]> {
    try {
      // Fetch keyword gaps for each competitor in parallel
      const gapResults = await Promise.all(
        competitors.map(async (competitor) => {
          const result = await this.getDomainKeywordsComparison(
            competitor,
            ourDomain,
            source,
            { diff: 1, limit: 100, orderField: 'volume', orderType: 'desc' }
          ).catch(() => ({ data: [] }));
          return { competitor, gaps: result.data };
        })
      );

      // Aggregate by keyword
      const keywordMap = new Map<string, {
        keyword: string;
        volume: number;
        difficulty: number;
        competitors: Array<{ domain: string; position: number }>;
      }>();

      for (const { competitor, gaps } of gapResults) {
        for (const gap of gaps) {
          const existing = keywordMap.get(gap.keyword);
          if (existing) {
            existing.competitors.push({ domain: competitor, position: gap.competitor_position });
            // Keep highest volume/difficulty seen
            existing.volume = Math.max(existing.volume, gap.volume);
            existing.difficulty = Math.max(existing.difficulty, gap.difficulty);
          } else {
            keywordMap.set(gap.keyword, {
              keyword: gap.keyword,
              volume: gap.volume,
              difficulty: gap.difficulty,
              competitors: [{ domain: competitor, position: gap.competitor_position }],
            });
          }
        }
      }

      // Convert to array and calculate aggregated metrics
      const aggregated: AggregatedKeywordGap[] = Array.from(keywordMap.values())
        .map(item => ({
          keyword: item.keyword,
          volume: item.volume,
          difficulty: item.difficulty,
          competitorCount: item.competitors.length,
          competitors: item.competitors,
          avgPosition: Math.round(
            item.competitors.reduce((sum, c) => sum + c.position, 0) / item.competitors.length
          ),
          bestPosition: Math.min(...item.competitors.map(c => c.position)),
        }))
        // Sort by competitorCount desc, then volume desc
        .sort((a, b) => {
          if (b.competitorCount !== a.competitorCount) {
            return b.competitorCount - a.competitorCount;
          }
          return b.volume - a.volume;
        })
        .slice(0, limit);

      return aggregated;
    } catch (error) {
      console.warn('Failed to fetch multi-competitor keyword gaps:', error);
      return [];
    }
  }

  /**
   * Get keyword overlaps across multiple competitors
   * Aggregates keywords where competitors outrank us
   */
  async getMultiCompetitorKeywordOverlaps(
    ourDomain: string,
    competitors: string[],
    source: string = 'us',
    limit: number = 50
  ): Promise<AggregatedKeywordOverlap[]> {
    try {
      // Fetch keyword overlaps for each competitor in parallel
      const overlapResults = await Promise.all(
        competitors.map(async (competitor) => {
          const result = await this.getKeywordOverlap(
            ourDomain,
            competitor,
            source,
            100
          ).catch(() => ({ data: [] }));
          return { competitor, overlaps: result.data };
        })
      );

      // Aggregate by keyword - only include where competitor outranks us
      const keywordMap = new Map<string, {
        keyword: string;
        volume: number;
        ourPosition: number;
        competitors: Array<{ domain: string; position: number }>;
      }>();

      for (const { competitor, overlaps } of overlapResults) {
        for (const overlap of overlaps) {
          // Only include if competitor has better position
          if (overlap.competitorPosition < overlap.ourPosition) {
            const existing = keywordMap.get(overlap.keyword);
            if (existing) {
              existing.competitors.push({ domain: competitor, position: overlap.competitorPosition });
              // Keep consistent values
              existing.volume = Math.max(existing.volume, overlap.volume);
            } else {
              keywordMap.set(overlap.keyword, {
                keyword: overlap.keyword,
                volume: overlap.volume,
                ourPosition: overlap.ourPosition,
                competitors: [{ domain: competitor, position: overlap.competitorPosition }],
              });
            }
          }
        }
      }

      // Convert to array and calculate aggregated metrics
      const aggregated: AggregatedKeywordOverlap[] = Array.from(keywordMap.values())
        .map(item => {
          const avgCompetitorPosition = Math.round(
            item.competitors.reduce((sum, c) => sum + c.position, 0) / item.competitors.length
          );
          return {
            keyword: item.keyword,
            volume: item.volume,
            ourPosition: item.ourPosition,
            competitorCount: item.competitors.length,
            competitors: item.competitors,
            avgCompetitorPosition,
            positionGap: item.ourPosition - avgCompetitorPosition,
          };
        })
        // Sort by competitorCount desc, then volume desc
        .sort((a, b) => {
          if (b.competitorCount !== a.competitorCount) {
            return b.competitorCount - a.competitorCount;
          }
          return b.volume - a.volume;
        })
        .slice(0, limit);

      return aggregated;
    } catch (error) {
      console.warn('Failed to fetch multi-competitor keyword overlaps:', error);
      return [];
    }
  }

  /**
   * Get backlink gaps across multiple competitors
   * Aggregates referring domains that link to competitors but not to us
   */
  async getMultiCompetitorBacklinkGaps(
    ourDomain: string,
    competitors: string[],
    limit: number = 50
  ): Promise<AggregatedBacklinkGap[]> {
    try {
      // First get our ref domains to exclude
      const ourRefDomains = await this.getBacklinksRefDomains(ourDomain, 200).catch(() => ({ data: [] }));
      const ourDomainSet = new Set(ourRefDomains.data.map(r => r.domain));

      // Fetch ref domains for each competitor in parallel
      const refDomainResults = await Promise.all(
        competitors.map(async (competitor) => {
          const result = await this.getBacklinksRefDomains(competitor, 100).catch(() => ({ data: [] }));
          return { competitor, refDomains: result.data };
        })
      );

      // Aggregate by referring domain
      const domainMap = new Map<string, {
        domain: string;
        domainInlinkRank: number;
        competitors: Array<{ domain: string; backlinks: number }>;
        totalBacklinks: number;
      }>();

      for (const { competitor, refDomains } of refDomainResults) {
        for (const ref of refDomains) {
          // Skip if we already have links from this domain
          if (ourDomainSet.has(ref.domain)) continue;

          const existing = domainMap.get(ref.domain);
          if (existing) {
            existing.competitors.push({ domain: competitor, backlinks: ref.backlinks });
            existing.totalBacklinks += ref.backlinks;
            // Keep highest authority seen
            existing.domainInlinkRank = Math.max(existing.domainInlinkRank, ref.domain_inlink_rank);
          } else {
            domainMap.set(ref.domain, {
              domain: ref.domain,
              domainInlinkRank: ref.domain_inlink_rank,
              competitors: [{ domain: competitor, backlinks: ref.backlinks }],
              totalBacklinks: ref.backlinks,
            });
          }
        }
      }

      // Convert to array and sort
      const aggregated: AggregatedBacklinkGap[] = Array.from(domainMap.values())
        .map(item => ({
          domain: item.domain,
          domainInlinkRank: item.domainInlinkRank,
          competitorCount: item.competitors.length,
          totalBacklinksToCompetitors: item.totalBacklinks,
          competitors: item.competitors,
        }))
        // Sort by competitorCount desc, then authority desc
        .sort((a, b) => {
          if (b.competitorCount !== a.competitorCount) {
            return b.competitorCount - a.competitorCount;
          }
          return b.domainInlinkRank - a.domainInlinkRank;
        })
        .slice(0, limit);

      return aggregated;
    } catch (error) {
      console.warn('Failed to fetch multi-competitor backlink gaps:', error);
      return [];
    }
  }

  /**
   * Orchestrator method for complete multi-competitor analysis
   * Calls keyword gaps, overlaps, and backlink gaps sequentially (for rate limiting)
   */
  async getMultiCompetitorAnalysis(
    ourDomain: string,
    competitors: string[],
    source: string = 'us'
  ): Promise<MultiCompetitorAnalysis> {
    try {
      // Run sequentially to respect rate limits
      const keywordGaps = await this.getMultiCompetitorKeywordGaps(ourDomain, competitors, source, 50);
      const keywordOverlaps = await this.getMultiCompetitorKeywordOverlaps(ourDomain, competitors, source, 50);
      const backlinkGaps = await this.getMultiCompetitorBacklinkGaps(ourDomain, competitors, 50);

      // Calculate summary stats
      const keywordGapsMultipleCompetitors = keywordGaps.filter(g => g.competitorCount >= 2).length;
      const backlinkGapsMultipleCompetitors = backlinkGaps.filter(g => g.competitorCount >= 2).length;

      // Estimate potential traffic from keyword gaps (using avg CTR of ~10% for top 10)
      const potentialTrafficOpportunity = keywordGaps
        .filter(g => g.competitorCount >= 2)
        .reduce((sum, g) => sum + Math.round(g.volume * 0.1), 0);

      return {
        competitorsAnalyzed: competitors,
        keywordGaps,
        keywordOverlaps,
        backlinkGaps,
        summary: {
          totalKeywordGaps: keywordGaps.length,
          keywordGapsMultipleCompetitors,
          totalBacklinkGaps: backlinkGaps.length,
          backlinkGapsMultipleCompetitors,
          potentialTrafficOpportunity,
        },
      };
    } catch (error) {
      console.warn('Failed to complete multi-competitor analysis:', error);
      return {
        competitorsAnalyzed: competitors,
        keywordGaps: [],
        keywordOverlaps: [],
        backlinkGaps: [],
        summary: {
          totalKeywordGaps: 0,
          keywordGapsMultipleCompetitors: 0,
          totalBacklinkGaps: 0,
          backlinkGapsMultipleCompetitors: 0,
          potentialTrafficOpportunity: 0,
        },
      };
    }
  }

  /**
   * Start async backlink export job
   * Cost: 1 credit per backlink (charged when download completes)
   * Returns task_id to poll for status
   */
  async exportBacklinks(
    target: string,
    mode: 'domain' | 'host' | 'url' = 'domain'
  ): Promise<{ taskId: string; status: string }> {
    try {
      const response = await this.request<{
        task_status: string;
        task_id: string;
      }>('/backlinks/export', {
        target,
        mode,
      });

      return {
        taskId: response.task_id || '',
        status: response.task_status || 'unknown',
      };
    } catch (error) {
      console.warn('Failed to start backlinks export:', error);
      throw error;
    }
  }

  /**
   * Check status of async backlink export job
   * Returns download URL when complete
   */
  async getBacklinksExportStatus(
    taskId: string
  ): Promise<{
    status: 'queued_for_processing' | 'processing' | 'complete' | 'rejected' | 'unknown';
    downloadUrl?: string;
  }> {
    try {
      const response = await this.request<{
        task_status: string;
        task_id: string;
        download_file?: string;
      }>('/backlinks/export/status', {
        task_id: taskId,
      });

      return {
        status: response.task_status as 'queued_for_processing' | 'processing' | 'complete' | 'rejected' | 'unknown',
        downloadUrl: response.download_file,
      };
    } catch (error) {
      console.warn('Failed to get export status:', error);
      return { status: 'unknown' };
    }
  }
}

// Helper to extract domain from URL
function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

// Factory function to create client with proper configuration
export function createSeRankingClient(
  apiKey: string | undefined,
  isUserKey: boolean = true
): SeRankingClient | null {
  const key = apiKey || (isUserKey ? undefined : process.env.SE_RANKING_SHARED_API_KEY);

  if (!key) {
    return null;
  }

  return new SeRankingClient(key, {
    mode: isUserKey ? 'user' : 'shared',
    trackCredits: !isUserKey,
    // Use default rate limit (5 RPS) for shared keys
    rateLimit: !isUserKey ? DEFAULT_RATE_LIMIT : undefined,
  });
}
