import LRUCache from 'lru-cache';
import { ApifyRunResult } from './apify.js';

// Define cache configuration
const options = {
  max: 100, // Keep maximum 100 queries in cache
  ttl: 1000 * 60 * 15, // 15 minutes TTL
  updateAgeOnGet: false,
  updateAgeOnHas: false
};

const scraperCache = new LRUCache<string, ApifyRunResult>(options);

export function getCachedResult(url: string): ApifyRunResult | undefined {
  return scraperCache.get(url);
}

export function setCachedResult(url: string, result: ApifyRunResult): void {
  scraperCache.set(url, result);
}
