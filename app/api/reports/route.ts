import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { validateDomain, cleanDomain } from '@/lib/utils';
import { createSeRankingClient } from '@/lib/seranking';
import { generateReport, setReport, updateReportProgress } from '@/lib/report-generator';
import { generateMockReport } from '@/lib/mock-data';
import type { Report } from '@/lib/types';

export const maxDuration = 300; // 5 minutes max for report generation

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { domain, apiKey } = body;

    // Validate domain
    const cleanedDomain = cleanDomain(domain || '');
    if (!cleanedDomain || !validateDomain(cleanedDomain)) {
      return NextResponse.json(
        { error: 'Invalid domain. Please enter a valid domain (e.g., example.com)' },
        { status: 400 }
      );
    }

    // Validate API key
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Please provide your SE Ranking API key' },
        { status: 400 }
      );
    }
    const isApiKeyMode = true;

    // Create report ID
    const reportId = uuidv4();

    // Initialize report
    const report: Report = {
      id: reportId,
      domain: cleanedDomain,
      createdAt: new Date().toISOString(),
      status: 'pending',
      progress: {
        status: 'pending',
        progress: 0,
        currentStep: 'Initializing...',
        steps: [
          { name: 'Fetching backlink data', status: 'pending' },
          { name: 'Analyzing keywords', status: 'pending' },
          { name: 'Running site audit', status: 'pending' },
          { name: 'Checking AI visibility', status: 'pending' },
          { name: 'Compiling report', status: 'pending' },
        ],
      },
    };

    await setReport(reportId, report);

    // Try to create API client
    const client = createSeRankingClient(apiKey, isApiKeyMode);

    // Generate report in background using after() to keep task alive in serverless
    after(async () => {
      try {
        await updateReportProgress(reportId, {
          status: 'processing',
          currentStep: 'Starting analysis...',
        });

        let reportData;

        if (client) {
          // Use real API
          reportData = await generateReport(client, cleanedDomain, reportId);
        } else {
          // Use mock data when no API key is available
          // Simulate progress
          const steps = [
            { step: 'Fetching backlink data...', progress: 20 },
            { step: 'Analyzing keywords...', progress: 40 },
            { step: 'Running site audit...', progress: 60 },
            { step: 'Checking AI visibility...', progress: 80 },
            { step: 'Compiling report...', progress: 95 },
          ];

          for (const { step, progress } of steps) {
            await updateReportProgress(reportId, {
              currentStep: step,
              progress,
            });
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          reportData = generateMockReport(cleanedDomain);
        }

        // Update report with data
        const completedReport = {
          ...report,
          status: 'completed' as const,
          data: reportData,
          progress: {
            status: 'completed' as const,
            progress: 100,
            currentStep: 'Report ready!',
            steps: report.progress!.steps.map((s) => ({
              ...s,
              status: 'completed' as const,
            })),
          },
        };

        await setReport(reportId, completedReport);
      } catch (error) {
        console.error('Report generation error:', error);
        await updateReportProgress(reportId, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    return NextResponse.json({
      id: reportId,
      status: 'processing',
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
