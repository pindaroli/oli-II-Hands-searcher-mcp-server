import axios from 'axios';
import * as cheerio from 'cheerio';
import Bottleneck from 'bottleneck';
import { ApifyRunResult, ScrapeSubitoOptions } from './apify.js';

// Setup Bottleneck rate limiter for local scraping
// Limits to 1 request every LOCAL_SCRAPE_DELAY_MS (default 3000ms = 3 seconds)
const delayMs = process.env.LOCAL_SCRAPE_DELAY_MS ? parseInt(process.env.LOCAL_SCRAPE_DELAY_MS, 10) : 3000;
const limiter = new Bottleneck({
  minTime: delayMs,
  maxConcurrent: 1 // Only one request at a time
});

export async function runLocalScraper(options: ScrapeSubitoOptions): Promise<ApifyRunResult> {
  const { searchUrl, maxItems = 30 } = options;

  let currentPage = 1;
  const extractedItems: Record<string, unknown>[] = [];
  let hasMorePages = true;

  // Parse the original URL to detect page parameter
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(searchUrl);
  } catch (err) {
    throw new Error(`Invalid searchUrl provided: ${searchUrl}`);
  }

  const hasExplicitPage = parsedUrl.searchParams.has('o');

  while (extractedItems.length < maxItems && hasMorePages) {
    // If not first page and not explicit page requested, set pagination parameter
    if (!hasExplicitPage && currentPage > 1) {
      parsedUrl.searchParams.set('o', currentPage.toString());
    }

    const currentUrl = parsedUrl.toString();
    console.error(`[Local Scraper] Scraping page ${currentPage}: ${currentUrl}`);

    // Schedule the HTTP request through the rate limiter
    let pageContent: string;
    try {
      pageContent = await limiter.schedule(async () => {
        const headers = {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate",
          "Accept-Language": "en-US,en;q=0.5",
          "Connection": "keep-alive",
          "Sec-Ch-Ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Brave";v="128"',
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": '"Windows"',
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Sec-Gpc": "1",
          "Upgrade-Insecure-Requests": "1",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        };

        const response = await axios.get(currentUrl, {
          headers,
          timeout: options.timeoutSecs ? options.timeoutSecs * 1000 : 30000
        });
        return response.data;
      });
    } catch (reqErr: any) {
      console.error(`[Local Scraper] Request failed for page ${currentPage}:`, reqErr.message);
      break;
    }

    const $ = cheerio.load(pageContent);
    const scriptTag = $('#__NEXT_DATA__');

    if (!scriptTag.length) {
      console.error(`[Local Scraper] Could not find JSON data on page ${currentPage}. Stopping.`);
      break;
    }

    let jsonData;
    try {
      jsonData = JSON.parse(scriptTag.html() || '{}');
    } catch (err) {
      console.error(`[Local Scraper] Failed to parse JSON on page ${currentPage}. Stopping.`);
      break;
    }

    const itemsObj = jsonData?.props?.pageProps?.initialState?.items || {};
    const itemsList = itemsObj.originalList || itemsObj.list || [];

    if (itemsList.length === 0) {
      console.error(`[Local Scraper] No listings returned on page ${currentPage}. Stopping.`);
      break;
    }

    let addedOnThisPage = 0;
    for (const rawItem of itemsList) {
      if (extractedItems.length >= maxItems) break;

      const product = rawItem.item || rawItem;
      if (!product || !product.subject) continue;

      const mappedProduct: Record<string, unknown> = { ...product };

      // Map Price
      if (!mappedProduct.price && product.features?.['/price']?.values?.[0]?.key) {
        mappedProduct.price = product.features['/price'].values[0].key;
      }
      
      // Map Location (geo)
      if (!mappedProduct.geo_town_value && product.geo?.town?.value) {
        mappedProduct.geo_town_value = product.geo.town.value;
      }
      if (!mappedProduct.geo_city_shortName && product.geo?.city?.shortName) {
        mappedProduct.geo_city_shortName = product.geo.city.shortName;
      }
      if (!mappedProduct.geo_region_value && product.geo?.region?.value) {
        mappedProduct.geo_region_value = product.geo.region.value;
      }

      // Map URLs
      if (!mappedProduct.urls_default && product.urls?.default) {
        mappedProduct.urls_default = product.urls.default;
      }

      // Map Condition & Shipping
      if (!mappedProduct.features_item_condition_values && product.features?.['/item_condition']?.values?.[0]?.value) {
        mappedProduct.features_item_condition_values = product.features['/item_condition'].values[0].value;
      }
      if (!mappedProduct.features_item_shipping_type_values && product.features?.['/item_shippable']?.values?.[0]?.value) {
        mappedProduct.features_item_shipping_type_values = "Disponibile";
      }

      // Map Advertiser
      if (!mappedProduct.advertiser_name && product.advertiser?.name) {
        mappedProduct.advertiser_name = product.advertiser.name;
      }

      extractedItems.push(mappedProduct);
      addedOnThisPage++;
    }

    console.error(`[Local Scraper] Scraped page ${currentPage} successfully: added ${addedOnThisPage} items. (Total: ${extractedItems.length}/${maxItems})`);

    // Decide if we should continue to next page
    if (hasExplicitPage) {
      // If the user queried an explicit URL with page parameter, we don't paginate
      hasMorePages = false;
    } else {
      // If we found fewer items than a full page (usually 24-30), we reached the end
      if (itemsList.length < 24) {
        hasMorePages = false;
      } else {
        currentPage++;
      }
    }
  }

  const runId = `local-${Date.now()}`;

  return {
    runId,
    status: 'SUCCEEDED',
    defaultDatasetId: 'local-dataset',
    itemsCount: extractedItems.length,
    items: extractedItems,
    datasetUrl: 'local-dataset-url',
    actorUrl: 'local-engine',
    stats: {
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMillis: 0,
      computeUnits: 0,
      costUsd: 0
    }
  };
}
