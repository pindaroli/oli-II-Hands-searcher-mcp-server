import { buildSubitoSearchUrl, SubitoSearchParams } from './url-builder.js';
import { scrapeSubito } from './engine.js';
import { inspectListingsWithAi, getAiConfig, resolveRuleModuleId } from 'shared-mcp-utils';

export interface SubitoBatchOptions extends SubitoSearchParams {
  maxItems?: number;
  maxPricePerGB?: number;
  ruleModuleId?: string;
  targetQuery?: string;
  timeoutSecs?: number;
  token?: string;
  cappingEnabled?: boolean;
  onProgress?: (progress: { 
    stage: 'initializing' | 'scraping' | 'analyzing' | 'done'; 
    message: string; 
    current?: number; 
    total?: number; 
  }) => void;
}

export interface SubitoBatchResult {
  query: string;
  searchUrl: string;
  totalFound: number;
  analyzedCount: number;
  accepted: any[];
  rejected: any[];
  markdownReport: string;
}

/**
 * Runs a Subito.it batch query: crawls multiple pages, filters results,
 * and executes LLM OCR/Vision validation. Designed for CLI/programmatic usage.
 */
export async function runSubitoBatch(options: SubitoBatchOptions): Promise<SubitoBatchResult> {
  const query = options.query || '';
  const category = options.category || 'informatica';
  const region = options.region || 'italia';
  const maxItems = options.maxItems || 30;
  const timeoutSecs = options.timeoutSecs || 180;
  const token = options.token;
  const cappingEnabled = options.cappingEnabled ?? false;
  const onProgress = options.onProgress || (() => {});

  onProgress({ stage: 'initializing', message: `Avvio ricerca batch per "${query}"...` });

  // 1. Build Subito Search URL
  const searchUrl = buildSubitoSearchUrl({
    query,
    category,
    region,
    minPrice: options.minPrice,
    maxPrice: options.maxPrice,
    shippingOnly: options.shippingOnly,
    sortBy: options.sortBy || 'datedesc'
  });

  onProgress({ stage: 'scraping', message: `Scarico gli annunci da Subito.it: ${searchUrl}` });

  // 2. Scrape Subito listings (crawling multiple pages via local scraper or Apify)
  const result = await scrapeSubito({
    searchUrl,
    maxItems,
    timeoutSecs,
    token
  });

  onProgress({ 
    stage: 'scraping', 
    message: `Scaricamento completato. Trovati ${result.items.length} annunci da filtrare.`,
    current: result.items.length,
    total: result.items.length
  });

  const aiConfig = getAiConfig();
  const shouldRunAi = aiConfig.isEnabled && (aiConfig.apiKey || process.env.AI_API_KEY);

  let finalReport = '';
  let aiResult: any = null;

  if (shouldRunAi && result.items.length > 0) {
    onProgress({ stage: 'analyzing', message: 'Avvio ispezione AI sui candidati...' });

    try {
      const effectiveModuleId = await resolveRuleModuleId(query, options.ruleModuleId);
      
      // Determine max inspect count: if capping is enabled, respect config limit, otherwise run on all
      const maxInspect = cappingEnabled 
        ? Math.min(maxItems, aiConfig.maxInspections || 20)
        : maxItems;

      aiResult = await inspectListingsWithAi(result.items, {
        targetQuery: options.targetQuery || query,
        maxPricePerGB: options.maxPricePerGB,
        ruleModuleId: effectiveModuleId,
        maxItemsToInspect: maxInspect,
        apifyStats: result.stats,
        datasetUrl: result.datasetUrl
      });
      
      finalReport = aiResult.markdownReport;
    } catch (aiErr: any) {
      console.error('[Subito Scraper Batch] AI Inspection error:', aiErr);
      finalReport = `⚠️ **Nota:** Analisi AI non riuscita (${aiErr.message}), mostro risultati standard.\n\n` + formatItemsMarkdown(result.items);
    }
  } else {
    onProgress({ stage: 'analyzing', message: 'AI non abilitata o nessun annuncio trovato, restituisco report standard.' });
    finalReport = `🤖 **Report di Ricerca Hardware (Standard)**\n\n` + formatItemsMarkdown(result.items);
  }

  onProgress({ stage: 'done', message: 'Ricerca batch completata con successo!' });

  return {
    query,
    searchUrl,
    totalFound: result.items.length,
    analyzedCount: aiResult ? aiResult.totalAnalyzed : result.items.length,
    accepted: aiResult ? aiResult.accepted : result.items,
    rejected: aiResult ? aiResult.rejected : [],
    markdownReport: finalReport
  };
}

/**
 * Format raw listings into markdown fallback list
 */
function formatItemsMarkdown(items: any[]): string {
  if (items.length === 0) return '_Nessun annuncio trovato._';
  
  let md = '| # | Titolo | Prezzo | Località | Link |\n| :-: | :--- | :--- | :--- | :--- |\n';
  items.forEach((item, index) => {
    const priceStr = item.price ? `${item.price} ${item.currency || 'EUR'}` : 'N/D';
    const town = item.geo_town_value || item.geo_city_shortName || 'N/D';
    const url = item.urls_default || item.url || '#';
    md += `| **${index + 1}** | ${item.title || item.subject} | ${priceStr} | ${town} | [Link](${url}) |\n`;
  });
  return md;
}
