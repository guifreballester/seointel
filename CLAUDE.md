# CLAUDE.md - Project Context for AI Assistants

## Project Overview

SEO Intelligence Report Tool - generates comprehensive SEO reports using the SE Ranking API. Users provide their API key and a domain to analyze.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Storage:** Redis (Upstash) with gzip compression
- **API:** SE Ranking Data API
- **Testing:** Vitest

## Architecture

### Report Generation Flow

```
User submits form (domain + API key)
        ↓
POST /api/reports (SSE stream)
        ↓
Server streams progress events in real-time
        ↓
Report generated in memory (no Redis during generation)
        ↓
Final report compressed (gzip) and stored in Redis (1 SETEX)
        ↓
Client redirects to /report/[id]
        ↓
Single GET from Redis to display report
```

### Key Design Decisions

1. **SSE Streaming:** Progress is streamed directly to the client via Server-Sent Events. No polling, no Redis writes during generation.

2. **Redis Optimization:** Only 2 Redis commands per report (1 SETEX + 1 GET). This is critical - we have a 500k commands/month limit.

3. **Compression:** Reports are gzip compressed before storage (70-85% size reduction). The `isCompressed()` function provides backwards compatibility with legacy uncompressed data.

4. **TTL:** Reports expire after 2 days (172800 seconds).

## Key Files

| File | Purpose |
|------|---------|
| `lib/report-store.ts` | Redis get/set with compression |
| `lib/compression.ts` | gzip compress/decompress utilities |
| `lib/report-generator.ts` | Orchestrates all SE Ranking API calls |
| `lib/seranking.ts` | SE Ranking API client |
| `app/api/reports/route.ts` | SSE endpoint for report generation |
| `components/ReportForm.tsx` | Form with SSE progress display |

## SE Ranking API

- API docs: https://seranking.com/api
- Credits are consumed per API call
- The `SeRankingClient` tracks credits and logs all API calls
- API responses are stored in the report for debugging (Developer Info accordion)

## Environment Variables

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## Commands

```bash
npm run dev          # Start dev server on port 3003
npm run build        # Production build
npm run test         # Run tests in watch mode
npm run test:run     # Run tests once
```

## Testing

- Tests use Vitest
- Compression tests in `__tests__/compression.test.ts`
- SE Ranking client tests mock the API responses

## Important Constraints

1. **Redis Commands:** Minimize Redis operations. Current usage is ~2 commands per report. Do NOT add polling or frequent updates.

2. **No Progress Storage:** Progress is streamed via SSE, never stored in Redis. The `updateReportProgress` function was removed.

3. **Compression Backwards Compatibility:** `getReport()` auto-detects plain JSON vs compressed data by checking if string starts with `{` or `[`.

4. **Serverless Timeout:** `maxDuration = 300` (5 minutes) is set for the reports endpoint to handle long-running report generation.

## Git Remotes

- `origin` → seranking/seointel
- `personal` → guifreballester/seointel

Always push to both remotes.
