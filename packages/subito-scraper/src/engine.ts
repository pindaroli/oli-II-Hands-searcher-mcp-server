import { ScrapeSubitoOptions, ApifyRunResult, runSubitoScraper, hasApifyToken } from './apify.js';
import { runLocalScraper } from './local.js';
import { getCachedResult, setCachedResult } from './cache.js';

export async function scrapeSubito(options: ScrapeSubitoOptions): Promise<ApifyRunResult> {
  const { searchUrl, token } = options;

  // 1. Check cache first
  const cachedResult = getCachedResult(searchUrl);
  if (cachedResult) {
    console.error(`[Subito Scraper Engine] Cache HIT for URL: ${searchUrl}`);
    return cachedResult;
  }

  let result: ApifyRunResult;

  // 2. Check if we should use Apify
  if (hasApifyToken(token)) {
    try {
      console.error(`[Subito Scraper Engine] Apify token found. Trying Apify actor...`);
      result = await runSubitoScraper(options);
    } catch (err: any) {
      const errMsg = err.message || '';
      const isUnauthorized = err.statusCode === 401 || errMsg.toLowerCase().includes('unauthorized') || errMsg.toLowerCase().includes('token is missing');
      const isLimitExceeded = err.statusCode === 403 || errMsg.toLowerCase().includes('limit exceeded') || errMsg.toLowerCase().includes('platform-feature-disabled');
      
      if (isUnauthorized || isLimitExceeded) {
        console.error(`[Subito Scraper Engine] Apify returned Unauthorized or Limit Exceeded. Falling back to local scraper...`);
        result = await runLocalScraper(options);
      } else {
        // If it's another kind of error (like 429 Rate Limit, or out of memory), we throw it so the user knows
        throw err;
      }
    }
  } else {
    // 3. Fallback to local scraper directly if no token
    console.error(`[Subito Scraper Engine] No Apify token configured. Using local scraper...`);
    result = await runLocalScraper(options);
  }

  // 4. Cache the result
  setCachedResult(searchUrl, result);

  return result;
}
