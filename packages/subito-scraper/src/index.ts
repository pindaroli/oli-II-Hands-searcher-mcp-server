import 'dotenv/config';

// Export programmatic batch functions
export { 
  runSubitoBatch 
} from './batch.js';

// Export programmatic batch types
export type {
  SubitoBatchOptions, 
  SubitoBatchResult 
} from './batch.js';

// Export core scraper functions
export { 
  scrapeSubito 
} from './engine.js';

export { 
  runLocalScraper 
} from './local.js';

export { 
  buildSubitoSearchUrl 
} from './url-builder.js';

// Export core scraper types
export type {
  SubitoSearchParams 
} from './url-builder.js';

export type { 
  ScrapeSubitoOptions, 
  ApifyRunResult, 
  ApifyRunStats 
} from './apify.js';
