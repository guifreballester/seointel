// ============================================================
// SE Ranking API Types
// ============================================================

export interface BacklinksSummary {
  backlinks: number;
  backlinks_num: number;
  refdomains: number;
  refdomains_num: number;
  subnets: number;
  ips: number;
  dofollow_backlinks: number;
  nofollow_backlinks: number;
  text_backlinks: number;
  image_backlinks: number;
  redirect_backlinks: number;
  canonical_backlinks: number;
  gov_backlinks: number;
  edu_backlinks: number;
  tlds: { [key: string]: number };
  countries: { [key: string]: number };
  top_anchors_by_backlinks: { anchor: string; count: number }[];
  top_anchors_by_refdomains: { anchor: string; count: number }[];
}

export interface BacklinksAuthority {
  domain_inlink_rank: number;
  page_inlink_rank: number;
}

export interface BacklinksNewLostCount {
  new_backlinks: number;
  lost_backlinks: number;
  new_refdomains: number;
  lost_refdomains: number;
}

export interface BacklinksIndexedPage {
  page: string;
  backlinks: number;
  refdomains: number;
  dofollow: number;
  nofollow: number;
}

export interface BacklinksDistribution {
  '0-10': number;
  '11-20': number;
  '21-30': number;
  '31-40': number;
  '41-50': number;
  '51-60': number;
  '61-70': number;
  '71-80': number;
  '81-90': number;
  '91-100': number;
}

export interface DomainOverview {
  domain: string;
  traffic: number;
  traffic_cost: number;
  keywords: number;
  keywords_top3: number;
  keywords_top10: number;
  keywords_top20: number;
  keywords_top50: number;
  keywords_top100: number;
  ads_keywords: number;
}

export interface DomainHistory {
  date: string;
  year: number;
  month: number;
  traffic: number;
  keywords: number;
  traffic_cost: number;
  top1_5: number;
  top6_10: number;
  top11_20: number;
  top21_50: number;
  top51_100: number;
}

export interface DomainKeyword {
  keyword: string;
  position: number;
  prev_position: number | null;
  volume: number;
  cpc: number;
  competition: number;
  difficulty: number;
  traffic: number;
  traffic_percent: number;
  url: string;
  serp_features: string[];
}

export interface DomainCompetitor {
  domain: string;
  common_keywords: number;
  keywords: number;
  traffic: number;
  traffic_cost: number;
  overlap: number;
}

export interface AISearchOverview {
  target: string;
  engines: {
    engine: string;
    brand_presence: number;
    link_presence: number;
    traffic: number;
  }[];
}

export interface AILeaderboardEntry {
  rank: number;
  domain: string;
  brand: string;
  share_of_voice: number;
  brand_mentions: number;
  link_citations: number;
  is_primary_target?: boolean;
}

export interface AIPrompt {
  prompt: string;
  engine: string;
  type: 'brand' | 'link' | 'brand_link';
  position: number;
  volume?: number;
  answer_snippet?: string;
  answer_full?: string;
  sources?: string[];
}

export interface KeywordQuestion {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
}

export interface KeywordGap {
  keyword: string;
  volume: number;
  difficulty: number;
  competitor_position: number;
  our_position: number | null;
}

// ============================================================
// Multi-Competitor Gap Aggregation Types
// ============================================================

export interface AggregatedKeywordGap {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorCount: number;  // How many competitors rank for this
  competitors: Array<{ domain: string; position: number }>;
  avgPosition: number;
  bestPosition: number;
}

export interface AggregatedKeywordOverlap {
  keyword: string;
  volume: number;
  ourPosition: number;
  competitorCount: number;  // How many competitors outrank us
  competitors: Array<{ domain: string; position: number }>;
  avgCompetitorPosition: number;
  positionGap: number;
}

export interface AggregatedBacklinkGap {
  domain: string;
  domainInlinkRank: number;
  competitorCount: number;  // How many competitors have links from this domain
  totalBacklinksToCompetitors: number;
  competitors: Array<{ domain: string; backlinks: number }>;
}

export interface MultiCompetitorAnalysis {
  competitorsAnalyzed: string[];
  keywordGaps: AggregatedKeywordGap[];
  keywordOverlaps: AggregatedKeywordOverlap[];
  backlinkGaps: AggregatedBacklinkGap[];
  summary: {
    totalKeywordGaps: number;
    keywordGapsMultipleCompetitors: number;
    totalBacklinkGaps: number;
    backlinkGapsMultipleCompetitors: number;
    potentialTrafficOpportunity: number;
  };
}

// ============================================================
// Domain Analysis Types
// ============================================================

export interface TrafficByCountry {
  source: string;
  country: string;
  traffic: number;
  keywords: number;
  percentage: number;
  // Detailed metrics from getDomainOverview (optional, only for top markets)
  traffic_cost?: number;
  keywords_top3?: number;
  keywords_top10?: number;
  keywords_top100?: number;
}

export interface Subdomain {
  subdomain: string;
  traffic: number;
  keywords: number;
}

export interface TopPage {
  url: string;
  traffic: number;
  keywords: number;
  backlinks?: number;
  refdomains?: number;
}

export interface RefDomain {
  domain: string;
  backlinks: number;
  domain_inlink_rank: number;
  first_seen: string;
}

export interface PaidAd {
  keyword: string;
  position: number;
  title: string;
  description: string;
  url: string;
  date: string;
}

// Domain paid keyword - keyword the domain is bidding on (from /domain/keywords?type=adv)
export interface DomainPaidKeyword {
  keyword: string;
  position: number;
  prev_position: number | null;
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
}

// Domain paid ads - keywords the domain is bidding on
export interface DomainPaidAd {
  keyword: string;
  ads_count: number;
  competition: number;
  cpc: number;
  volume: number;
  snippets: DomainAdSnippet[];
}

export interface DomainAdSnippet {
  date: string;
  position: number;
  snippet_title: string;
  snippet_description: string;
  snippet_display_url: string;
  snippet_count: number;
  snippet_num: number;
  url: string;
}

// Paid ads by keyword - shows which domains are advertising on a specific keyword
export interface PaidAdsByKeyword {
  keyword: string;
  advertisers: PaidAdAdvertiser[];
}

export interface PaidAdAdvertiser {
  domain: string;
  ads_count: number;
  keywords_count: number;
  traffic_sum: number;
  price_sum: number;
  snippets: PaidAdSnippet[];
}

export interface PaidAdSnippet {
  date: string;
  position: number;
  snippet_title: string;
  snippet_description: string;
  snippet_display_url: string;
  snippet_count: number;
  url: string;
}

export interface BacklinkGap {
  domain: string;
  domain_inlink_rank: number;
  backlinks_to_competitor: number;
}

export interface CompetitorComparison {
  domain: string;
  traffic: number;
  keywords: number;
  authority: number;
  backlinks: number;
  common_keywords: number;
  overlap: number;
}

// ============================================================
// Report Types
// ============================================================

export type ReportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ReportProgress {
  status: ReportStatus;
  progress: number;
  currentStep: string;
  steps: {
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
  }[];
  error?: string;
}

export interface Report {
  id: string;
  domain: string;
  createdAt: string;
  status: ReportStatus;
  progress?: ReportProgress;
  data?: ReportData;
}

export interface ReportData {
  executive: {
    traffic: number;
    trafficChange?: number;
    backlinks: number;
    backlinksChange?: number;
    authority: number;
    authorityChange?: number;
    keywords: number;
    aiShareOfVoice?: number;
  };
  backlinks: {
    summary: BacklinksSummary;
    authority: BacklinksAuthority;
    momentum: BacklinksNewLostCount;
    indexedPages: BacklinksIndexedPage[];
    distribution: BacklinksDistribution;
    intelligence?: BacklinkIntelligence;
  };
  keywords: {
    total: number;
    topKeywords: DomainKeyword[];
    nearPageOne: DomainKeyword[];
    positionDistribution: {
      top3: number;
      top10: number;
      top20: number;
      top50: number;
      top100: number;
    };
    history: DomainHistory[];
    positionChanges?: {
      up: number;
      down: number;
      new: number;
      lost: number;
    };
    serpFeatures?: {
      feature: string;
      count: number;
    }[];
    research?: KeywordResearchData;
    domainPaidKeywords?: DomainPaidKeyword[];  // Keywords the domain is bidding on
  };
  domainAnalysis: {
    authority: number;
    trafficByCountry: TrafficByCountry[];
    subdomains: Subdomain[];
    trafficTrend: DomainHistory[];
    topPagesByTraffic: TopPage[];
    topPagesByTrafficCountry2?: TopPage[];  // Top pages by traffic for second market
    topPagesByBacklinks: BacklinksIndexedPage[];
    anchorTextDistribution: { anchor: string; count: number }[];
    refDomainsDistribution: BacklinksDistribution;
    paidAds?: DomainPaidAd[];
    topPagesWorldwide?: URLOverviewWorldwide[];  // Worldwide stats for top pages
  };
  competitive: {
    competitors: DomainCompetitor[];
    competitorComparison: CompetitorComparison[];
    keywordGaps: KeywordGap[];
    keywordOverlap: {
      keyword: string;
      volume: number;
      ourPosition: number;
      competitorPosition: number;
    }[];
    backlinkGaps: BacklinkGap[];
    multiCompetitorAnalysis?: MultiCompetitorAnalysis;
    pageComparisons?: PageComparison[];
    paidSearchCompetitors?: PaidAdsByKeyword[];  // Competitors bidding on same keywords
  };
  aiSearch: {
    overview: AISearchOverview;
    leaderboard: AILeaderboardEntry[];
    prompts: AIPrompt[];
    market: string; // Country code (e.g., 'us', 'uk')
    marketName: string; // Country name (e.g., 'United States', 'United Kingdom')
  };
  contentOpportunities: {
    questionKeywords: KeywordQuestion[];
    gaps: KeywordGap[];
  };
  quickWins: {
    nearPageOneKeywords: DomainKeyword[];
    lowHangingFruit: {
      type: string;
      description: string;
      impact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
    }[];
  };
  apiResponses?: ApiResponseLog[];
  totalCredits?: number;
  subscriptionInfo?: SubscriptionInfo;
}

// API Response logging for developer inspection
export interface ApiResponseLog {
  endpoint: string;
  method: 'GET' | 'POST';
  params: Record<string, unknown>;
  response: unknown;
  timestamp: string;
  duration?: number;
  credits?: number;
}

// Subscription info for credits display
export interface SubscriptionInfo {
  status: string;
  startDate: string;
  expirationDate: string;
  unitsLimit: number;
  unitsLeft: number;
}

// ============================================================
// API Request/Response Types
// ============================================================

export interface CreateReportRequest {
  domain: string;
  apiKey: string;
}

export interface CreateReportResponse {
  id: string;
  status: ReportStatus;
}

export interface ApiConfig {
  key: string;
  mode: 'user' | 'shared';
  trackCredits: boolean;
  rateLimit: boolean;
}

// ============================================================
// Advanced Keyword Research Types
// ============================================================

export interface KeywordSuggestion {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  competition: number;
  trend?: number[];  // 12-month search trend
  currentlyRanking?: boolean;
  position?: number;
}

export interface KeywordResearchData {
  seedKeyword: string;
  similarKeywords: KeywordSuggestion[];
  relatedKeywords: KeywordSuggestion[];
  longTailKeywords: KeywordSuggestion[];
  sweetSpotKeywords: KeywordSuggestion[];  // Vol >1K, Diff <40
}

// ============================================================
// Enhanced Backlink Intelligence Types
// ============================================================

export interface BacklinkHistoryPoint {
  date: string;
  backlinks: number;
  refdomains: number;
}

export interface DetailedBacklink {
  url_from: string;
  url_to: string;
  anchor: string;
  domain_inlink_rank: number;
  date_found?: string;
  date_lost?: string;
  dofollow: boolean;
  type: 'new' | 'lost';
}

export interface IPConcentration {
  ip: string;
  backlinks: number;
  percentage: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface BacklinkIntelligence {
  history: BacklinkHistoryPoint[];
  newBacklinks: DetailedBacklink[];
  lostBacklinks: DetailedBacklink[];
  ipConcentration: IPConcentration[];
  netChange: {
    backlinks: number;
    refdomains: number;
    period: string;
  };
  // Enhanced backlink intelligence fields
  enhancedAnchors?: EnhancedAnchor[];
  topBacklinks?: IndividualBacklink[];
  refDomainChanges?: {
    new: RefDomainChange[];
    lost: RefDomainChange[];
    qualityGained: number;  // avg DA of new domains
    qualityLost: number;    // avg DA of lost domains
  };
  authorityTrend?: PageAuthorityPoint[];
  subnetCount?: number;
}

// ============================================================
// Enhanced Backlinks Report Types
// ============================================================

// Enhanced anchor with freshness data
export interface EnhancedAnchor {
  anchor: string;
  backlinks: number;
  refdomains: number;
  dofollow_backlinks: number;
  nofollow_backlinks: number;
  first_seen: string;
  last_visited: string;
}

// Individual backlink details
export interface IndividualBacklink {
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
}

// Detailed ref domain change
export interface RefDomainChange {
  refdomain: string;
  domain_inlink_rank: number;
  backlinks: number;
  dofollow_backlinks: number;
  first_seen: string;
  new_lost_date: string;
  new_lost_type: 'new' | 'lost';
}

// Page authority history point
export interface PageAuthorityPoint {
  date: string;
  inlink_rank: number;
}

// ============================================================
// URL Performance Comparison Types
// ============================================================

export interface URLOverviewWorldwide {
  url: string;
  organic: {
    keywords_count: number;
    traffic_sum: number;
    price_sum: number;
  };
  adv: {
    keywords_count: number;
    traffic_sum: number;
    price_sum: number;
  };
}

// URL-to-URL keyword comparison result
export interface URLKeywordComparison {
  keyword: string;
  volume: number;
  cpc: number;
  competition: number;
  difficulty: number;
  // Our URL metrics
  position: number | null;
  url: string | null;
  traffic: number | null;
  price: number | null;
  // Competitor URL metrics
  compare_position: number | null;
  compare_url: string | null;
  compare_traffic: number | null;
  compare_price: number | null;
}

// Page-to-page comparison using URL keyword comparison API
export interface PageComparison {
  ourUrl: string;
  competitorUrl: string;
  commonKeywords: URLKeywordComparison[];  // Keywords both pages rank for (diff=0)
  ourUniqueKeywords: URLKeywordComparison[]; // Keywords only our page ranks for (diff=1)
}
