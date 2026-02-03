'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Download,
  Share2,
  Link as LinkIcon,
  Search,
  Users,
  Bot,
  Zap,
  AlertCircle,
  Calendar,
  ExternalLink,
  FileJson,
  ChevronDown,
  Coins,
} from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ExecutiveSummary from '@/components/Report/ExecutiveSummary';
import BacklinkProfile from '@/components/Report/BacklinkProfile';
import KeywordRankings from '@/components/Report/KeywordRankings';
import DomainAnalysis from '@/components/Report/DomainAnalysis';
import CompetitiveLandscape from '@/components/Report/CompetitiveLandscape';
import AISearchVisibility from '@/components/Report/AISearchVisibility';
import QuickWins from '@/components/Report/QuickWins';
import CTASection from '@/components/Report/CTASection';
import { SkeletonReportPage } from '@/components/Skeleton';
import type { Report } from '@/lib/types';
import { BarChart3 } from 'lucide-react';
import { exportToJSON } from '@/lib/utils';

type Section = 'backlinks' | 'keywords' | 'domain-analysis' | 'competitive' | 'ai' | 'quickwins';

export default function ReportPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<Section>('backlinks');
  const [showExportMenu, setShowExportMenu] = useState(false);

  useEffect(() => {
    if (!id) return;

    const fetchReport = async () => {
      try {
        const response = await fetch(`/api/reports/${id}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch report');
        }

        setReport(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    };

    fetchReport();
  }, [id]);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `SEO Report for ${report?.domain}`,
          url,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      await navigator.clipboard.writeText(url);
      alert('Link copied to clipboard!');
    }
  };

  // Error state
  if (error) {
    return (
      <>
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Report Not Found</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <button
              onClick={() => router.push('/')}
              className="btn-primary"
            >
              Generate New Report
            </button>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  // Loading state
  if (!report) {
    return (
      <>
        <Header />
        <main className="flex-1">
          <SkeletonReportPage />
        </main>
        <Footer />
      </>
    );
  }

  // Failed state
  if (report.status === 'failed') {
    return (
      <>
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Report Failed</h2>
            <p className="text-gray-600 mb-6">
              {report.progress?.error || 'An error occurred while generating the report.'}
            </p>
            <button
              onClick={() => router.push('/')}
              className="btn-primary"
            >
              Try Again
            </button>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  // Report ready
  const data = report.data;
  if (!data) return null;

  const sections: { id: Section; name: string; icon: React.ElementType }[] = [
    { id: 'backlinks', name: 'Backlinks', icon: LinkIcon },
    { id: 'keywords', name: 'Keywords', icon: Search },
    { id: 'domain-analysis', name: 'Domain Analysis', icon: BarChart3 },
    { id: 'competitive', name: 'Competitors', icon: Users },
    { id: 'ai', name: 'AI Search', icon: Bot },
    { id: 'quickwins', name: 'Quick Wins', icon: Zap },
  ];

  return (
    <>
      <Header />
      <main className="flex-1 bg-gray-50">
        {/* Report Header */}
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{report.domain}</h1>
                <div className="flex items-center gap-2 text-sm text-gray-500 mt-1 flex-wrap">
                  <Calendar className="w-4 h-4" />
                  <span>
                    Generated: {new Date(report.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                  <span className="text-gray-300">|</span>
                  <div className="relative group">
                    <span className="flex items-center gap-1 cursor-help">
                      <Coins className="w-4 h-4" />
                      {(data.totalCredits || 0).toLocaleString()} credits used
                    </span>
                    {data.subscriptionInfo && (
                      <div className="absolute left-0 top-full mt-2 w-72 bg-gray-900 text-white text-xs rounded-lg p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 shadow-lg">
                        <div className="text-gray-400 text-center mb-2 pb-2 border-b border-gray-700">
                          Period: {new Date(data.subscriptionInfo.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - {new Date(data.subscriptionInfo.expirationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-gray-400">Total:</span>
                            <span className="font-medium">{data.subscriptionInfo.unitsLimit.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Used:</span>
                            <span className="font-medium">{Math.round(data.subscriptionInfo.unitsLimit - data.subscriptionInfo.unitsLeft).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between border-t border-gray-700 pt-2">
                            <span className="text-gray-400">This report:</span>
                            <span className="font-medium">{(data.totalCredits || 0).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-900 transform rotate-45"></div>
                      </div>
                    )}
                  </div>
                  <span className="text-gray-300">|</span>
                  <a
                    href="https://seranking.com/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-600 hover:underline inline-flex items-center gap-1"
                  >
                    Powered by SE Ranking API
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleShare}
                  className="btn-secondary text-sm py-2"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share
                </button>

                {/* Export Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowExportMenu(!showExportMenu)}
                    className="btn-secondary text-sm py-2"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export
                    <ChevronDown className="w-4 h-4 ml-1" />
                  </button>

                  {showExportMenu && (
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                      <button
                        onClick={() => {
                          exportToJSON(data, `${report.domain}-report`);
                          setShowExportMenu(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <FileJson className="w-4 h-4 text-blue-600" />
                        Full Report (JSON)
                      </button>
                      <button
                        onClick={() => {
                          window.print();
                          setShowExportMenu(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <Download className="w-4 h-4 text-gray-600" />
                        Print / PDF
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Executive Summary */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <ExecutiveSummary data={data.executive} />
        </div>

        {/* Section Navigation */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex overflow-x-auto gap-2 pb-2 no-print">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                  activeSection === section.id
                    ? 'bg-primary-100 text-primary-700 font-medium'
                    : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                <section.icon className="w-4 h-4" />
                {section.name}
              </button>
            ))}
          </div>
        </div>

        {/* Report Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {activeSection === 'backlinks' && (
            <div className="space-y-6">
              <h2 className="section-title">
                <LinkIcon className="w-6 h-6 text-primary-600" />
                Backlink Profile Analysis
              </h2>
              <BacklinkProfile
                data={data.backlinks}
                apiLogs={data.apiResponses}
                reportId={report.id}
                totalBacklinks={data.backlinks.summary.backlinks}
              />
            </div>
          )}

          {activeSection === 'keywords' && (
            <div className="space-y-6">
              <h2 className="section-title">
                <Search className="w-6 h-6 text-green-600" />
                Keyword Rankings
              </h2>
              <KeywordRankings data={data.keywords} apiLogs={data.apiResponses} />
            </div>
          )}

          {activeSection === 'domain-analysis' && (
            <div className="space-y-6">
              <h2 className="section-title">
                <BarChart3 className="w-6 h-6 text-indigo-600" />
                Domain Analysis
              </h2>
              <DomainAnalysis data={data.domainAnalysis} apiLogs={data.apiResponses} />
            </div>
          )}

          {activeSection === 'competitive' && (
            <div className="space-y-6">
              <h2 className="section-title">
                <Users className="w-6 h-6 text-blue-600" />
                Competitive Landscape
              </h2>
              <CompetitiveLandscape
                data={data.competitive}
                ourDomain={report.domain}
                ourTraffic={data.executive.traffic}
                ourAuthority={data.executive.authority}
                apiLogs={data.apiResponses}
              />
            </div>
          )}

          {activeSection === 'ai' && (
            <div className="space-y-6">
              <h2 className="section-title">
                <Bot className="w-6 h-6 text-purple-600" />
                AI Search Visibility
              </h2>
              <AISearchVisibility data={data.aiSearch} apiLogs={data.apiResponses} />
            </div>
          )}

          {activeSection === 'quickwins' && (
            <div className="space-y-6">
              <h2 className="section-title">
                <Zap className="w-6 h-6 text-amber-500" />
                Quick Wins & Recommendations
              </h2>
              <QuickWins data={data.quickWins} contentOpportunities={data.contentOpportunities} apiLogs={data.apiResponses} />
            </div>
          )}
        </div>

        {/* CTA Section */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <CTASection />
        </div>
      </main>
      <Footer />
    </>
  );
}
