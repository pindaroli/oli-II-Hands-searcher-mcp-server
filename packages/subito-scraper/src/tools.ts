import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getDatasetItems,
  checkApifyStatus,
  formatApifyError,
  SUBITO_ACTOR_ID
} from './apify.js';
import { scrapeSubito } from './engine.js';
import { buildSubitoSearchUrl } from './url-builder.js';
import { inspectListingsWithAi, getAiConfig, resolveRuleModuleId } from 'shared-mcp-utils';

/**
 * Formats scraped items into clean markdown for display to LLM / user
 */
function formatItemsMarkdown(items: Record<string, unknown>[]): string {
  if (items.length === 0) {
    return 'Nessun annuncio trovato per i criteri specificati.';
  }

  return items
    .map((item, index) => {
      const title =
        (item.subject as string) ||
        (item.title as string) ||
        (item.name as string) ||
        `Annuncio #${index + 1}`;

      const rawPrice =
        (item.features_price_values as string) ||
        (item.price as string) ||
        (item.price_value as string);
      const price = rawPrice ? `💶 **Prezzo:** ${rawPrice}` : '💶 **Prezzo:** N/D';

      const town = (item.geo_town_value as string) || (item.geo_city_value as string) || '';
      const province = (item.geo_city_shortName as string) || '';
      const region = (item.geo_region_value as string) || '';
      const locationParts = [town, province ? `(${province})` : '', region].filter(Boolean);
      const location = locationParts.join(' ') || (item.location as string) || (item.geo as string) || '';

      const url =
        (item.urls_default as string) ||
        (item.urls_mobile as string) ||
        (item.url as string) ||
        (item.link as string) ||
        '';

      const date = (item.date as string) || (item.publishedAt as string) || '';
      const condition = (item.features_item_condition_values as string) || '';
      const shipping = (item.features_item_shipping_type_values as string) || '';
      const advertiser =
        (item.advertiser_name as string) ||
        (item.seller as string) ||
        (item.advertiser_userId ? `ID: ${item.advertiser_userId}` : '');
      const phone = (item.phone as string) || (item.telephone as string) || '';
      const email = (item.email as string) || '';
      const description = (item.body as string) || (item.description as string) || '';

      const details: string[] = [];
      if (price) details.push(price);
      if (location) details.push(`📍 **Luogo:** ${location}`);
      if (condition) details.push(`✨ **Condizione:** ${condition}`);
      if (shipping) details.push(`📦 **Spedizione:** ${shipping}`);
      if (date) details.push(`🕒 **Data:** ${date}`);
      if (advertiser) details.push(`👤 **Venditore:** ${advertiser}`);
      if (phone) details.push(`📞 **Telefono:** ${phone}`);
      if (email) details.push(`✉️ **Email:** ${email}`);
      if (url) details.push(`🔗 [Visualizza su Subito.it](${url})`);

      let formatted = `### ${index + 1}. ${title}\n` + details.join(' | ') + '\n';
      if (description) {
        const shortDesc = description.length > 250 ? description.substring(0, 250) + '...' : description;
        formatted += `\n> ${shortDesc.replace(/\n+/g, ' ')}\n`;
      }
      return formatted;
    })
    .join('\n---\n\n');
}

/**
 * Registers all Subito.it scraping tools on the MCP server instance
 */
export function registerTools(server: McpServer): void {
  // 1. Tool: Scrape by direct search URL
  server.tool(
    'subito_scrape_by_url',
    'Scrapes classified ads directly from a Subito.it search URL using Apify Actor (azzouzana/subito-scraper-pro-by-search-url) and optionally applies AI rules filtering.',
    {
      searchUrl: z
        .string()
        .describe('Full Subito.it search URL to scrape (e.g. "https://www.subito.it/annunci-italia/vendita/usato/?q=iphone+15")'),
      maxItems: z
        .number()
        .int()
        .positive()
        .optional()
        .default(30)
        .describe('Maximum number of ads/listings to retrieve (default: 30)'),
      timeoutSecs: z
        .number()
        .int()
        .positive()
        .optional()
        .default(300)
        .describe('Timeout in seconds for Apify Actor execution'),
      token: z
        .string()
        .optional()
        .describe('Optional Apify API Token (overrides APIFY_TOKEN environment variable)')
    },
    async ({ searchUrl, maxItems, timeoutSecs, token }) => {
      try {
        const result = await scrapeSubito({
          searchUrl,
          maxItems,
          timeoutSecs,
          token
        });

        const aiConfig = getAiConfig();
        const shouldRunAi = aiConfig.isEnabled && (aiConfig.apiKey || process.env.AI_API_KEY);

        let finalReport = '';
        let aiResult: any = null;

        if (shouldRunAi && result.items.length > 0) {
          try {
            let effectiveModuleId = 'nvme';
            let extractedQuery = searchUrl;
            try {
              const urlObj = new URL(searchUrl);
              const qParam = urlObj.searchParams.get('q');
              if (qParam) {
                extractedQuery = qParam;
                effectiveModuleId = await resolveRuleModuleId(qParam, undefined);
              }
            } catch (urlErr) {
              console.error('[Subito Scraper] Failed to parse query from searchUrl:', urlErr);
            }

            aiResult = await inspectListingsWithAi(result.items, {
              targetQuery: extractedQuery,
              ruleModuleId: effectiveModuleId,
              maxItemsToInspect: Math.min(maxItems, aiConfig.maxInspections || 20)
            });
            finalReport = aiResult.markdownReport;
          } catch (aiErr: any) {
            console.error('[Subito Scraper] AI Inspection error:', aiErr);
            finalReport = `⚠️ **Nota:** Analisi AI non riuscita (${aiErr.message}), mostro risultati standard.\n\n` + formatItemsMarkdown(result.items);
          }
        } else {
          finalReport = formatItemsMarkdown(result.items);
        }

        return {
          content: [
            {
              type: 'text',
              text: `### Risultati Scraping Subito.it per URL\n- **URL:** ${searchUrl}\n- **Annunci estratti:** ${result.items.length} (Totale nel dataset: ${result.itemsCount})\n- **Dataset Apify:** [Console Apify Dataset](${result.datasetUrl})\n\n---\n\n${finalReport}`
            },
            {
              type: 'text',
              text: `JSON Risultati:\n\`\`\`json\n${JSON.stringify(aiResult ? aiResult : result.items, null, 2)}\n\`\`\``
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: formatApifyError(error)
            }
          ]
        };
      }
    }
  );

  // 2. Tool: Search Subito by query and filters
  server.tool(
    'subito_search',
    'Searches Subito.it for classified ads and automatically applies AI-powered rules filtering, price/GB calculations, and accepted/rejected breakdowns.',
    {
      query: z
        .string()
        .describe('Search query keyword (e.g. "RAM DDR5", "MacBook Pro M3", "BMW 320d")'),
      category: z
        .string()
        .optional()
        .default('usato')
        .describe(
          'Category on Subito.it: "usato", "auto", "moto", "accessori-auto", "accessori-moto", "case", "appartamenti", "immobili-affitto", "informatica", "telefonia", "audio-video", "fotografia", "videogiochi", "elettrodomestici", "arredamento", "abbigliamento", "orologi", "sport", "biciclette", "musica", "libri", "collezionismo", "lavoro"'
        ),
      region: z
        .string()
        .optional()
        .default('italia')
        .describe(
          'Italian region: "italia" (all Italy), "lombardia", "lazio", "campania", "veneto", "piemonte", "emilia-romagna", "toscana", "sicilia", "puglia", etc.'
        ),
      minPrice: z
        .number()
        .positive()
        .optional()
        .describe('Minimum price in EUR (optional)'),
      maxPrice: z
        .number()
        .positive()
        .optional()
        .describe('Maximum price in EUR (optional)'),
      maxPricePerGB: z
        .number()
        .positive()
        .optional()
        .default(10)
        .describe('Maximum price in EUR per GB for RAM hardware evaluation (default: 10 EUR/GB)'),
      shippingOnly: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, filters only listings with TuttoSubito shipping available'),
      sortBy: z
        .enum(['datedesc', 'priceasc', 'pricedesc', 'relevance'])
        .optional()
        .default('datedesc')
        .describe('Sorting order: "datedesc" (most recent), "priceasc" (cheapest), "pricedesc" (most expensive), "relevance"'),
      maxItems: z
        .number()
        .int()
        .positive()
        .optional()
        .default(30)
        .describe('Maximum number of listings to retrieve (default: 30)'),
      timeoutSecs: z
        .number()
        .int()
        .positive()
        .optional()
        .default(300)
        .describe('Timeout in seconds for Apify Actor execution'),
      ruleModuleId: z
        .string()
        .optional()
        .describe('Optional rule module ID to apply (e.g. "ram_ddr5", "ram", "matx_motherboard", "psu_sfx")'),
      token: z
        .string()
        .optional()
        .describe('Optional Apify API Token (overrides APIFY_TOKEN environment variable)')
    },
    async ({
      query,
      category,
      region,
      minPrice,
      maxPrice,
      maxPricePerGB,
      shippingOnly,
      sortBy,
      maxItems,
      timeoutSecs,
      ruleModuleId,
      token
    }) => {
      try {
        const searchUrl = buildSubitoSearchUrl({
          query,
          category,
          region,
          minPrice,
          maxPrice,
          shippingOnly,
          sortBy
        });

        const result = await scrapeSubito({
          searchUrl,
          maxItems,
          timeoutSecs,
          token
        });

        const aiConfig = getAiConfig();
        const shouldRunAi = aiConfig.isEnabled && (aiConfig.apiKey || process.env.AI_API_KEY);

        let finalReport = '';
        let aiResult: any = null;

        if (shouldRunAi && result.items.length > 0) {
          try {
            const effectiveModuleId = await resolveRuleModuleId(query, ruleModuleId);
            aiResult = await inspectListingsWithAi(result.items, {
              targetQuery: query,
              maxPricePerGB,
              ruleModuleId: effectiveModuleId,
              maxItemsToInspect: Math.min(maxItems, aiConfig.maxInspections || 20),
              apifyStats: result.stats,
              datasetUrl: result.datasetUrl
            });
            finalReport = aiResult.markdownReport;
          } catch (aiErr: any) {
            console.error('[Subito Scraper] AI Inspection error:', aiErr);
            finalReport = `⚠️ **Nota:** Analisi AI non riuscita (${aiErr.message}), mostro risultati standard.\n\n` + formatItemsMarkdown(result.items);
          }
        } else {
          finalReport = formatItemsMarkdown(result.items);
        }

        return {
          content: [
            {
              type: 'text',
              text: `### Risultati Ricerca Subito.it per "${query}"\n- **URL Generato:** ${searchUrl}\n- **Categoria:** ${category} | **Regione:** ${region}\n- **Annunci trovati:** ${result.items.length} (Totale nel dataset: ${result.itemsCount})\n- **Dataset Apify:** [Console Apify Dataset](${result.datasetUrl})\n\n---\n\n${finalReport}`
            },
            {
              type: 'text',
              text: `JSON Risultati:\n\`\`\`json\n${JSON.stringify(aiResult ? aiResult : result.items, null, 2)}\n\`\`\``
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: formatApifyError(error)
            }
          ]
        };
      }
    }
  );

  // 3. Tool: Fetch items from existing dataset ID
  server.tool(
    'subito_get_dataset_items',
    'Fetches scraped items from a previously generated Apify dataset ID',
    {
      datasetId: z
        .string()
        .describe('Apify Dataset ID containing scraped Subito.it listings'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .default(50)
        .describe('Number of items to retrieve (default: 50)'),
      token: z
        .string()
        .optional()
        .describe('Optional Apify API Token (overrides APIFY_TOKEN environment variable)')
    },
    async ({ datasetId, limit, token }) => {
      try {
        const { items, total } = await getDatasetItems(datasetId, limit, 0, token);
        const markdownSummary = formatItemsMarkdown(items);

        return {
          content: [
            {
              type: 'text',
              text: `### Dataset Apify: \`${datasetId}\`\n- **Articoli recuperati:** ${items.length} di ${total}\n- **Link Dataset:** [Console Apify](https://console.apify.com/storage/datasets/${datasetId})\n\n---\n\n${markdownSummary}`
            },
            {
              type: 'text',
              text: `JSON Risultati:\n\`\`\`json\n${JSON.stringify(items, null, 2)}\n\`\`\``
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: formatApifyError(error)
            }
          ]
        };
      }
    }
  );

  // 4. Tool: Check Apify API connection and token status
  server.tool(
    'apify_check_status',
    'Checks the status of the Apify account and validates the API token',
    {
      token: z
        .string()
        .optional()
        .describe('Optional Apify API Token to test (overrides APIFY_TOKEN environment variable)')
    },
    async ({ token }) => {
      try {
        const status = await checkApifyStatus(token);

        if (status.isValid) {
          return {
            content: [
              {
                type: 'text',
                text: `✅ **Connessione ad Apify riuscita!**\n\n- **Utente:** ${status.username} (${status.email})\n- **Piano:** ${status.plan}\n- **Actor ID configurato:** \`${SUBITO_ACTOR_ID}\``
              }
            ]
          };
        } else {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `🔴 **Verifica connessione ad Apify fallita:** ${status.error}`
              }
            ]
          };
        }
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: formatApifyError(error)
            }
          ]
        };
      }
    }
  );
}
