import sharp from 'sharp';
import { getComponentRule, getGlobalInstructions, DeterministicFilters } from './index.js';

export interface ListingItem {
  id?: string | number;
  title?: string;
  name?: string;
  subject?: string;
  price?: string | number;
  price_numeric?: number;
  total_item_price?: string;
  currency?: string;
  brand?: string;
  brand_title?: string;
  size?: string;
  status?: string;
  condition?: string;
  url?: string;
  link?: string;
  item_url?: string;
  description?: string;
  body?: string;
  photos?: any[];
  images?: any[];
  photo?: any;
  imageUrl?: string;
  image_url?: string;
  picture?: string;
  [key: string]: any;
}

export interface BaseInspectionVerdict {
  listingId: string;
  title: string;
  url: string;
  price: number;
  currency: string;
  brand: string;
  status: 'ACCEPTED' | 'REJECTED';
  formFactor: string;
  detectedModel?: string | null;
  infoSource?: 'PHOTO_LABEL_OCR' | 'PHOTO_SMART' | 'PHOTO_VISION' | 'TEXT_FALLBACK' | 'DETERMINISTIC_RULE';
  rejectionReason: string | null;
  evidence: string;
  photoUrl?: string;
  photoUrls?: string[];
  inspectionMethod?: 'DETERMINISTIC_RULE' | 'VISION_AI' | 'TEXT_AI';
}

export interface RamInspectionVerdict extends BaseInspectionVerdict {
  detectedGeneration: string;
  detectedCapacityGB: number | null;
  detectedPartNumber: string | null;
  pricePerGB: number | null;
}

export interface SsdInspectionVerdict extends BaseInspectionVerdict {
  detectedGeneration: string;
  detectedCapacityGB: number | null;
  detectedPartNumber: string | null;
  detectedSerialNumber: string | null;
  smartHealth: string | null;
}

export interface PsuInspectionVerdict extends BaseInspectionVerdict {
  detectedWattage: number | null;
  detectedCertification: string | null;
  detectedProductionYear: number | null;
  detectedSerialNumber?: string | null;
}

export interface AiInspectionVerdict extends BaseInspectionVerdict {
  detectedGeneration?: string;
  detectedCapacityGB?: number | null;
  detectedPartNumber?: string | null;
  detectedSerialNumber?: string | null;
  smartHealth?: string | null;
  pricePerGB?: number | null;
  
  detectedWattage?: number | null;
  detectedCertification?: string | null;
  detectedProductionYear?: number | null;
}

export interface AiMetrics {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalAiDurationSec: number;
  tokensPerSec: number;
}

export interface ApifyRunStats {
  durationMillis?: number;
  computeUnits?: number;
  costUsd?: number;
  startedAt?: Date | string;
  finishedAt?: Date | string;
}

export interface AiInspectionResult {
  aiModelUsed: string;
  providerUrl: string;
  totalAnalyzed: number;
  accepted: AiInspectionVerdict[];
  rejected: AiInspectionVerdict[];
  markdownReport: string;
  metrics?: AiMetrics;
  apifyStats?: ApifyRunStats;
}

interface NormalizedListing {
  id: string;
  title: string;
  brand: string;
  price: number;
  currency: string;
  url: string;
  description: string;
  photoUrls: string[];
  photoUrl: string;
}

/**
 * Resolves AI provider configuration from environment
 */
export function getAiConfig() {
  const baseUrl = (process.env.AI_BASE_URL || 'http://localhost:11434/v1').trim().replace(/\/+$/, '');
  const apiKey = (process.env.AI_API_KEY || process.env.AI_TOKEN || 'ollama').trim();
  const model = (process.env.AI_MODEL || 'qwen2.5-vl:32b').trim();
  const isEnabled = process.env.AI_VISION_ENABLED !== 'false';
  const maxInspections = parseInt(process.env.MAX_AI_INSPECTIONS || '20', 10);

  return {
    baseUrl,
    apiKey,
    model,
    isEnabled,
    maxInspections
  };
}

/**
 * Normalizes URL, title, photos, and price extraction from listing item
 */
function normalizeListing(item: ListingItem, index: number): NormalizedListing {
  const rawUrl = (
    item.urls_default ||
    item.urls_mobile ||
    item.url ||
    item.link ||
    item.item_url ||
    item.listing_url ||
    item.share_url ||
    ''
  ).toString();
  const match = rawUrl.match(/\/(?:items|item)\/([^\/?#]+)/);
  const id = String(item.id || item.item_id || item.advertiser_userId || (match ? match[1] : index + 1));
  const slug = item.slug ? String(item.slug).replace(/-/g, ' ') : (match && match[1] ? decodeURIComponent(match[1]).replace(/-/g, ' ') : '');

  const rawTitle = (item.subject || item.title || item.name || '').toString().trim();
  const brand = (item.brand || item.brand_title || '').toString().trim();
  const title = (rawTitle.length > 3 ? rawTitle : (slug.length > 5 ? slug : (brand || `Articolo #${index + 1}`)));

  let rawPrice = item.price_numeric;
  if (rawPrice === undefined || rawPrice === null) {
    const rawPriceVal = item.features_price_values || item.price || item.total_item_price || item.price_value || '0';
    const cleaned = String(rawPriceVal).replace(/[^\d.,]/g, '').replace(',', '.');
    rawPrice = parseFloat(cleaned);
  }
  const price = isNaN(rawPrice) ? 0 : rawPrice;
  const currency = item.currency || 'EUR';

  const desc = (item.body || item.description || '').toString().trim();

  // Extract all photos available
  const rawPhotos = item.photos || item.images || [];
  const photoUrls: string[] = [];
  if (Array.isArray(rawPhotos)) {
    for (const p of rawPhotos) {
      const u = typeof p === 'string' ? p : (p?.url || p?.full_size_url || p?.medium_size_url || p?.image_url || '');
      if (u && !photoUrls.includes(u)) {
        photoUrls.push(u);
      }
    }
  }
  if (photoUrls.length === 0) {
    const single = item.imageUrl || item.image_url || item.photo || item.picture;
    if (typeof single === 'string' && single) {
      photoUrls.push(single);
    }
  }

  return {
    id,
    title,
    brand,
    price,
    currency,
    url: rawUrl,
    description: desc,
    photoUrls,
    photoUrl: photoUrls[0] || ''
  };
}

/**
 * Downloads an image from URL and converts it to a standard JPEG Base64 data URI
 * (Ensures full compatibility with Ollama / OpenAI Vision models which do not support WebP)
 */
async function fetchImageAsBase64(url: string, timeoutMs: number = 6000): Promise<string | null> {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    if (!resp.ok) return null;
    const arrayBuffer = await resp.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);
    if (inputBuffer.length < 100) return null;

    try {
      // Normalize any image (WebP, AVIF, PNG, TIFF) to standard JPEG
      const jpegBuffer = await sharp(inputBuffer).jpeg({ quality: 80 }).toBuffer();
      return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
    } catch {
      // Fallback to raw buffer if sharp fails
      const contentType = resp.headers.get('content-type') || 'image/jpeg';
      return `data:${contentType};base64,${inputBuffer.toString('base64')}`;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enhanced Fast Deterministic Filters (Fase 2)
 * Eliminates 70-85% of bad listings instantly in 0.001s
 */
function applyDeterministicFilters(
  item: NormalizedListing,
  filters?: DeterministicFilters,
  context?: { targetQuery?: string; maxPricePerGB?: number; ruleModuleId?: string }
): { rejected: boolean; reason: string | null; formFactor?: AiInspectionVerdict['formFactor'] } {
  const fullText = `${item.title} ${item.description} ${item.brand} ${item.url}`.toLowerCase();
  const ruleModuleId = context?.ruleModuleId || 'ram';

  // 1. Invalid or missing price
  if (item.price <= 0) {
    return {
      rejected: true,
      reason: 'Filtro rapido: prezzo non valido o pari a 0 €',
      formFactor: 'UNKNOWN'
    };
  }

  // 2. NVMe specific deterministic filters
  const isNvmeTarget = ruleModuleId === 'nvme' || (context?.targetQuery && /nvme|ssd/i.test(context.targetQuery));
  if (isNvmeTarget) {
    // Mechanical HDD or empty enclosure detection
    const nonSsdMatch = fullText.match(/\b(hdd|hard disk meccanico|disco meccanico|disco rigido meccanico|enclosure vuoto|box vuoto|solo custodia|solo case|solo scatola)\b/i);
    if (nonSsdMatch) {
      return {
        rejected: true,
        reason: `Filtro rapido: rilevato componente non SSD NVMe ("${nonSsdMatch[0]}")`,
        formFactor: 'ACCESSORY_OTHER'
      };
    }
  }

  // PSU specific deterministic filters
  const isPsuTarget = ruleModuleId.startsWith('psu') || (context?.targetQuery && /alimentatore|psu|power supply/i.test(context.targetQuery));
  if (isPsuTarget) {
    const pcMatch = fullText.match(/\b(pc gaming|pc completo|computer completo|computer fisso|gaming rig|workstation|server da rack|server rack|poweredge|proliant)\b/i);
    if (pcMatch && !/solo alimentatore|solo psu/i.test(fullText)) {
      return {
        rejected: true,
        reason: `Filtro rapido: rilevato sistema completo o assemblato ("${pcMatch[0]}")`,
        formFactor: 'ACCESSORY_OTHER'
      };
    }
  }

  // 3. RAM specific generation & accessory checks (only when evaluating RAM)
  const isRamTarget = ruleModuleId === 'ram' || ruleModuleId === 'ram_ddr5';
  if (isRamTarget) {
    const isDdr5Target = ruleModuleId === 'ram_ddr5' || (context?.targetQuery && /ddr5/i.test(context.targetQuery));
    if (isDdr5Target) {
      const hasDdr5 = /\bddr5\b/i.test(fullText);
      const hasOlderDdr = /\b(ddr4|ddr3|ddr2|pc3200|pc2700|pc-3200)\b/i.test(fullText);
      if (hasOlderDdr && !hasDdr5) {
        return {
          rejected: true,
          reason: 'Filtro rapido: rilevata generazione precedente (DDR4/DDR3/DDR2)',
          formFactor: 'UNKNOWN'
        };
      }
    }

    const accessoryMatch = fullText.match(/\b(adattatore|adapter|cover|dissipatore|heatsink|cavo|connettore|case|alimentatore|scheda madre|motherboard|pc completo|computer fisso completo)\b/i);
    if (accessoryMatch) {
      return {
        rejected: true,
        reason: `Filtro rapido: accessorio o componente non RAM rilevato ("${accessoryMatch[0]}")`,
        formFactor: 'ACCESSORY_OTHER'
      };
    }
  }

  // 4. Rule-defined keyword filters
  if (filters?.exclude_keywords && Array.isArray(filters.exclude_keywords)) {
    for (const kw of filters.exclude_keywords) {
      const lowerKw = kw.toLowerCase().trim();
      if (!lowerKw) continue;
      const regex = new RegExp(`\\b${lowerKw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (regex.test(fullText) || fullText.includes(lowerKw)) {
        let formFactor: AiInspectionVerdict['formFactor'] = 'UNKNOWN';
        if (/sodimm|so-dimm|so dimm|laptop|notebook|portatile/i.test(kw)) formFactor = 'SODIMM_LAPTOP';
        else if (/rdimm|ecc reg/i.test(kw)) formFactor = 'ECC_SERVER';
        else if (/gddr5|scheda madre|motherboard|adattatore/i.test(kw)) formFactor = 'ACCESSORY_OTHER';

        return {
          rejected: true,
          reason: `Filtro deterministico JSON: rilevata parola chiave non ammessa "${kw}"`,
          formFactor
        };
      }
    }
  }

  // 5. Exclude non-standard capacities (e.g. 12GB for RAM)
  if (filters?.exclude_capacities_gb && Array.isArray(filters.exclude_capacities_gb)) {
    for (const cap of filters.exclude_capacities_gb) {
      const capPattern = new RegExp(`\\b${cap}\\s*(?:gb|go|g)\\b`, 'i');
      if (capPattern.test(item.title) || capPattern.test(item.description)) {
        return {
          rejected: true,
          reason: `Filtro deterministico JSON: capacità non standard (${cap}GB) tipica di notebook/laptop`,
          formFactor: 'SODIMM_LAPTOP'
        };
      }
    }
  }

  // 6. Exclude part number prefixes (e.g. M425 for Samsung SODIMM, HMCG66 for Hynix SODIMM)
  if (filters?.exclude_part_number_prefixes && Array.isArray(filters.exclude_part_number_prefixes)) {
    for (const pfx of filters.exclude_part_number_prefixes) {
      const regex = new RegExp(pfx, 'i');
      if (regex.test(fullText)) {
        return {
          rejected: true,
          reason: `Filtro deterministico JSON: rilevato Part Number non conforme (prefisso "${pfx}")`,
          formFactor: 'SODIMM_LAPTOP'
        };
      }
    }
  }

  // 7. Preliminary Price/GB check for RAM only (SSD NVMe have vastly different €/GB ratios)
  if (isRamTarget) {
    const maxPricePerGB = context?.maxPricePerGB || 10;
    let preliminaryCapacityGB: number | null = null;

    const multiMatch = fullText.match(/\b(\d+)\s*(?:x|\*)\s*(\d+)\s*(?:gb|go|g)\b/i);
    const singleMatch = fullText.match(/\b(\d+)\s*(?:gb|go)\b/i);

    if (multiMatch) {
      const c = parseInt(multiMatch[1], 10);
      const s = parseInt(multiMatch[2], 10);
      if ([2, 4, 8].includes(c) && [4, 8, 16, 24, 32, 48, 64].includes(s)) {
        preliminaryCapacityGB = c * s;
      }
    } else if (singleMatch) {
      const s = parseInt(singleMatch[1], 10);
      if ([8, 16, 24, 32, 48, 64, 96, 128].includes(s)) {
        preliminaryCapacityGB = s;
      }
    }

    if (preliminaryCapacityGB && preliminaryCapacityGB > 0 && item.price > 0) {
      const estPricePerGB = item.price / preliminaryCapacityGB;
      if (estPricePerGB > maxPricePerGB * 1.05) {
        return {
          rejected: true,
          reason: `Filtro rapido: prezzo unitario dichiarato (${estPricePerGB.toFixed(2)} €/GB per ${preliminaryCapacityGB}GB) supera la soglia di ${maxPricePerGB} €/GB`,
          formFactor: 'UNKNOWN'
        };
      }
    }
  }

  return { rejected: false, reason: null };
}

/**
 * Fetches the full item description from the listing page if missing from catalog scrape
 */
async function fetchItemDescription(url: string, timeoutMs: number = 3000): Promise<string | null> {
  if (!url || !url.startsWith('http')) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // 1. Try extracting from JSON-LD schema
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    if (jsonLdMatch && jsonLdMatch[1]) {
      try {
        const schema = JSON.parse(jsonLdMatch[1]);
        if (schema.description) return String(schema.description).trim();
      } catch {}
    }

    // 2. Try extracting from <meta property="og:description" content="...">
    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i) ||
                        html.match(/<meta\s+content=["'](.*?)["']\s+property=["']og:description["']/i);
    if (ogDescMatch && ogDescMatch[1]) {
      return ogDescMatch[1].trim();
    }

    // 3. Try extracting from <meta name="description" content="...">
    const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i) ||
                          html.match(/<meta\s+content=["'](.*?)["']\s+name=["']description["']/i);
    if (metaDescMatch && metaDescMatch[1]) {
      return metaDescMatch[1].trim();
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Concurrent map utility to execute tasks with a fixed concurrency limit
 */
async function asyncPool<T, R>(concurrency: number, items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workers = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Executes chat completions request against OpenAI-compatible endpoint
 */
interface AiCallResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationSec: number;
  tokensPerSec: number;
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: any[]
): Promise<AiCallResult> {
  const endpoint = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : (baseUrl.includes('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const callStartTime = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })
  });

  const durationSec = Math.max(0.01, (Date.now() - callStartTime) / 1000);

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`AI API error (HTTP ${response.status} from ${endpoint}): ${errBody}`);
  }

  const data: any = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI API returned empty response content');
  }

  const promptTokens = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? data.eval_count ?? 0;
  const totalTokens = data.usage?.total_tokens ?? (promptTokens + completionTokens);
  const tokensPerSec = completionTokens > 0 ? parseFloat((completionTokens / durationSec).toFixed(1)) : 0;

  return {
    content,
    promptTokens,
    completionTokens,
    totalTokens,
    durationSec,
    tokensPerSec
  };
}

/**
 * Inspects listings using fast deterministic pre-filtering (Phase 2)
 * followed by targeted parallel Vision AI (Phase 3)
 */
export async function inspectListingsWithAi(
  items: ListingItem[],
  options: {
    ruleModuleId?: string;
    targetQuery?: string;
    maxPricePerGB?: number;
    maxItemsToInspect?: number;
    token?: string;
    baseUrl?: string;
    model?: string;
    apifyStats?: ApifyRunStats;
    datasetUrl?: string;
  } = {}
): Promise<AiInspectionResult> {
  const startTime = Date.now();
  const config = getAiConfig();
  const apiKey = options.token || config.apiKey;
  const baseUrl = options.baseUrl || config.baseUrl;
  const model = options.model || config.model;
  const maxPricePerGB = options.maxPricePerGB || 10;
  const maxInspect = options.maxItemsToInspect || config.maxInspections || 20;

  const normalized = items.map((it, idx) => normalizeListing(it, idx));

  // Determine rule module and load declarative rules
  const ruleModuleId = options.ruleModuleId || 'nvme';
  const compRule = getComponentRule(ruleModuleId) || getComponentRule('ram');
  const globalInst = getGlobalInstructions();
  const isNvme = ruleModuleId === 'nvme';
  const isRam = ruleModuleId === 'ram' || ruleModuleId === 'ram_ddr5';
  const isPsu = ruleModuleId.startsWith('psu');

  const specificRulesText = compRule ? `[${compRule.name}]\n${compRule.rules}` : 'Applica massima cautela e verifica rigida.';
  const globalRulesText = Array.isArray(globalInst.global_instructions) 
    ? globalInst.global_instructions.join('\n') 
    : String(globalInst.global_instructions || '');

  const auditLogs: string[] = [];
  const logAudit = (msg: string) => {
    auditLogs.push(msg);
    console.error(msg);
  };

  logAudit(`\n[AI Inspector] ========================================`);
  logAudit(`[AI Inspector] 🚀 Inizio ispezione su ${normalized.length} annunci scaricati`);
  logAudit(`[AI Inspector] 🎯 Target: ${options.targetQuery || (isNvme ? 'SSD NVMe M.2' : (isPsu ? 'Alimentatore PC' : 'RAM DDR5 Desktop UDIMM'))}${isRam ? ` | Limite: ${maxPricePerGB} €/GB` : ''}`);
  logAudit(`[AI Inspector] ⚙️ Engine: ${baseUrl} (${model}) | Modulo: ${ruleModuleId}`);
  if (options.apifyStats?.computeUnits !== undefined) {
    logAudit(`[AI Inspector] ⚡ Scraper Apify: ${(options.apifyStats.durationMillis ? (options.apifyStats.durationMillis / 1000).toFixed(1) + 's' : 'N/D')} | Compute Units: ${options.apifyStats.computeUnits.toFixed(4)} CU`);
  }
  logAudit(`[AI Inspector] ========================================`);

  // Phase 2: Instant Fast Deterministic Pre-Filtering
  const preFilteredVerdicts: Map<string, AiInspectionVerdict> = new Map();
  const initialCandidates: NormalizedListing[] = [];

  for (const item of normalized) {
    const filterResult = applyDeterministicFilters(item, compRule?.deterministic_filters, {
      targetQuery: options.targetQuery,
      maxPricePerGB,
      ruleModuleId
    });

    if (filterResult.rejected) {
      preFilteredVerdicts.set(item.id, {
        listingId: item.id,
        title: item.title,
        url: item.url,
        price: item.price,
        currency: item.currency,
        brand: item.brand,
        status: 'REJECTED',
        formFactor: filterResult.formFactor || 'UNKNOWN',
        detectedGeneration: isNvme ? 'NVMe' : 'DDR5',
        detectedCapacityGB: null,
        detectedPartNumber: null,
        detectedSerialNumber: null,
        detectedModel: null,
        smartHealth: null,
        infoSource: 'DETERMINISTIC_RULE',
        pricePerGB: null,
        rejectionReason: filterResult.reason,
        evidence: 'Scartato istantaneamente tramite pre-filtro deterministico (Fase 2)',
        photoUrl: item.photoUrl,
        photoUrls: item.photoUrls,
        inspectionMethod: 'DETERMINISTIC_RULE'
      });
    } else {
      initialCandidates.push(item);
    }
  }

  logAudit(`[AI Inspector] ⚡ Fase 2 completata: ${preFilteredVerdicts.size} scartati istantaneamente, ${initialCandidates.length} candidati plausibili.`);

  // Cap candidates to maxInspect to avoid timeouts while checking the best deals
  const candidatesForAi = initialCandidates.slice(0, maxInspect);
  if (initialCandidates.length > maxInspect) {
    for (const extra of initialCandidates.slice(maxInspect)) {
      preFilteredVerdicts.set(extra.id, {
        listingId: extra.id,
        title: extra.title,
        url: extra.url,
        price: extra.price,
        currency: extra.currency,
        brand: extra.brand,
        status: 'REJECTED',
        formFactor: 'UNKNOWN',
        detectedGeneration: isNvme ? 'NVMe' : 'DDR5',
        detectedCapacityGB: null,
        detectedPartNumber: null,
        detectedSerialNumber: null,
        detectedModel: null,
        smartHealth: null,
        infoSource: 'DETERMINISTIC_RULE',
        pricePerGB: null,
        rejectionReason: `Superato limite massimo ispezioni approfondite (ispezionati i primi ${maxInspect} candidati)`,
        evidence: 'Fuori dal lotto prioritario',
        photoUrl: extra.photoUrl,
        photoUrls: extra.photoUrls,
        inspectionMethod: 'DETERMINISTIC_RULE'
      });
    }
  }

  // Deep Scrape descriptions for candidates missing text (concurrency pool of 5)
  const missingDescCandidates = candidatesForAi.filter(c => !c.description || c.description.length < 15);
  if (missingDescCandidates.length > 0) {
    logAudit(`[AI Inspector] 📄 Recupero descrizioni mancanti in parallelo per ${missingDescCandidates.length} annunci...`);
    await asyncPool(5, missingDescCandidates, async cand => {
      const fetchedDesc = await fetchItemDescription(cand.url);
      if (fetchedDesc) {
        cand.description = fetchedDesc;
      }
    });
  }

  // Phase 3: Targeted Parallel Multimodal Vision AI
  const isVisionModel = /vl|vision|llava|minicpm|gpt-4o|gemini/i.test(model);
  const aiVerdictsMap: Map<string, any> = new Map();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalAiDurationSec = 0;

  if (candidatesForAi.length > 0) {
    const targetQueryLower = (options.targetQuery || '').toLowerCase();
    const isEnglishQuery = /power\s*supply|psu|gold|platinum|titanium|ram|desktop|laptop|ssd|nvme/i.test(targetQueryLower) && 
                           !/alimentatore|platino|oro|titanio|memoria|disco/i.test(targetQueryLower);

    const outputLanguageInstruction = isEnglishQuery
      ? "MANDATORY: You must write the JSON fields 'rejectionReason' and 'evidence' in English."
      : "MANDATORY: You must write the JSON fields 'rejectionReason' and 'evidence' in Italian (Italiano).";

    let systemPrompt = '';

    if (isNvme) {
      systemPrompt = `You are an expert hardware verifier specialized in M.2 PCIe NVMe SSDs and drive diagnostics (SMART / CrystalDiskInfo).

GLOBAL RULES:
${globalRulesText}

COMPONENT RULES:
${specificRulesText}

USER TARGET:
- Target: ${options.targetQuery || 'M.2 NVMe SSD'}

SOURCE PRECEDENCE HIERARCHY (MANDATORY):
1. PHASE 1 (PHOTO / OCR - MAXIMUM AUTHORITY):
   - Examine all photos looking for the M.2 SSD drive label or SMART screenshot (CrystalDiskInfo, Samsung Magician, smartctl).
   - Extract with maximum precision:
     * detectedModel: exact model (e.g. "Samsung PM9A1", "WD Black SN770", "Crucial P3 Plus", "Micron 2300")
     * detectedPartNumber: P/N or Model Code (e.g. "MZVL2512HCJQ-00000", "WDS500G3X0E")
     * detectedSerialNumber: S/N serial number (e.g. "S676NF0R123456", "23412E801923")
     * detectedCapacityGB: capacity (e.g. 512, 500, 1000, 1024, 2000, 2048)
     * smartHealth: health percentage and usage hours if visible in the SMART screenshot (e.g. "100% (1h use)", "96%", "90%")
     * formFactor: "M2_2280" | "M2_2242" | "M2_2230" | "SATA_M2" | "UNKNOWN"
   - If this data is visible in the photos, use this verified data and set infoSource to 'PHOTO_LABEL_OCR' (if from drive label) or 'PHOTO_SMART' (if from SMART screenshot).

2. PHASE 2 (TEXT/DESCRIPTION FALLBACK):
   - ONLY IF the label in the photos is absent, partial, or unreadable, extract the model and capacity from the listing title and description.
   - In this case, set infoSource to 'TEXT_FALLBACK'.

VALIDATION CRITERIA:
- Verify if the item complies with the user's requested target specifications (e.g. capacity limits). Set status to 'ACCEPTED' only if all requirements are satisfied.
- Set status to 'REJECTED' if it is a mechanical HDD, SATA SSD (2.5" or M.2 B+M key), empty enclosure/adapter only, or any non-compliant product.

RESPOND EXCLUSIVELY IN JSON:
{
  "results": [
    {
      "listingId": "string",
      "formFactor": "M2_2280" | "M2_2242" | "M2_2230" | "SATA_M2" | "UNKNOWN",
      "detectedGeneration": "NVMe" | "SATA" | "OTHER",
      "detectedModel": "string or null",
      "detectedPartNumber": "string or null",
      "detectedSerialNumber": "string or null",
      "detectedCapacityGB": number or null,
      "smartHealth": "string or null",
      "infoSource": "PHOTO_LABEL_OCR" | "PHOTO_SMART" | "PHOTO_VISION" | "TEXT_FALLBACK",
      "evidence": "evidence from photo/OCR/text",
      "rejectionReason": "string or null if ACCEPTED",
      "status": "ACCEPTED" | "REJECTED"
    }
  ]
}`;
    } else if (isPsu) {
      systemPrompt = `You are an expert hardware verifier with advanced visual analysis/OCR capabilities.
Determine for each listing if it is a standalone PC Power Supply Unit (PSU) that complies with the user's target specifications.

GLOBAL RULES:
${globalRulesText}

COMPONENT RULES:
${specificRulesText}

USER TARGET:
- Target: ${options.targetQuery || 'PC Power Supply (PSU)'}

SOURCE PRECEDENCE HIERARCHY (MANDATORY):
1. PHASE 1 (PHOTO / OCR - MAXIMUM AUTHORITY):
   - Examine all photos looking for the PSU technical specifications label (DC/AC output table or main sticker) or the box.
   - Extract with maximum precision:
     * detectedBrand: Brand of the PSU (e.g. "Seasonic", "Corsair", "EVGA", "Cooler Master")
     * detectedModel: Exact model (e.g. "Focus GX-550", "SF750", "Supernova 650 P2")
     * detectedWattage: Nominal PSU power in Watts as a number (e.g. 400, 650, 750, 1000). Look for text like "Total Power: 400W" or "400Watts".
     * detectedCertification: 80 PLUS certification visible on the sticker or logo (Platinum, Gold, Titanium, Bronze, Silver, White, or UNKNOWN).
     * detectedProductionYear: Manufacturing year if indicated on the sticker (e.g. "DOM: 2021", "Year: 2022") or deducible from the Serial Number (S/N) if typical prefixes are known.
     * detectedSerialNumber: Serial number or unique identifier code (e.g. "S/N: 2110...", "R1204...").
     * formFactor: "ATX" | "SFX" | "SFX-L" | "TFX" | "FLEX-ATX" | "SERVER_HOT_PLUG" | "UNKNOWN"
   - If this data is visible in the photos, set infoSource to 'PHOTO_LABEL_OCR'.

2. PHASE 2 (TEXT/DESCRIPTION FALLBACK):
   - ONLY IF the label in the photos is absent, partial, or unreadable, extract the model, wattage, certification, and year of purchase/production from the listing title and description.
   - In this case, set infoSource to 'TEXT_FALLBACK'.

STRICT VALIDATION CRITERIA:
1. EVALUATION OF THE LISTING SUBJECT (FUNDAMENTAL):
   - You must determine with certainty if the listing primarily sells a standalone power supply (single loose or boxed component).
   - If the listing sells an entire computer (gaming PC, desktop computer, workstation, mini PC, server) where the PSU is simply listed as part of the build, you MUST set "status": "REJECTED" and explain why in "rejectionReason" (e.g., "Rilevato computer completo o assemblato" or equivalent translated reason). Do not accept under any circumstances, even if the described PSU matches the target.
   - If the listing describes a bundle or lot of multiple components (e.g., "motherboard + cpu + power supply"), set "status": "REJECTED".

2. TARGET SPECIFICATIONS COMPLIANCE & ZERO ASSUMPTIONS:
   - Carefully evaluate all user target specifications (e.g. maximum wattage limits like "max 400W", required 80 Plus certifications like "gold or platinum", specific form factors).
   - Pay special attention to logical conjunctions like "or" (e.g. "gold or platinum" means either certification is acceptable).
   - MANDATORY CERTIFICATION RULE: If the user target requests specific 80 PLUS certifications (e.g. "gold", "platinum", "titanium"), you MUST set "status": "REJECTED" for any item where the certification is "UNKNOWN", missing, or not clearly verified from the label, box, or description. DO NOT accept unverified or UNKNOWN certification items when a specific certification tier is requested.
   - MANDATORY WATTAGE RULE: If a maximum wattage limit is requested (e.g. "max 400 watt"), any PSU exceeding that wattage MUST be set to "status": "REJECTED".
   - Set "status": "ACCEPTED" ONLY if the item is a standalone PSU and positively satisfies ALL requested user criteria with verified evidence. Otherwise, set "status": "REJECTED" and explain the exact missing or non-compliant specification in "rejectionReason".

RESPOND EXCLUSIVELY IN JSON:
{
  "results": [
    {
      "listingId": "string",
      "formFactor": "ATX" | "SFX" | "SFX-L" | "TFX" | "FLEX-ATX" | "SERVER_HOT_PLUG" | "UNKNOWN",
      "detectedBrand": "string or null",
      "detectedModel": "string or null",
      "detectedWattage": number or null,
      "detectedCertification": "Platinum" | "Gold" | "Titanium" | "Bronze" | "Silver" | "White" | "UNKNOWN",
      "detectedProductionYear": number or null,
      "detectedSerialNumber": "string or null",
      "infoSource": "PHOTO_LABEL_OCR" | "PHOTO_VISION" | "TEXT_FALLBACK",
      "evidence": "evidence from photo/OCR/text",
      "rejectionReason": "explicit reason if rejected or non-compliant, otherwise null",
      "status": "ACCEPTED" | "REJECTED"
    }
  ]
}`;
    } else {
      systemPrompt = `You are an expert hardware verifier with advanced visual analysis/OCR capabilities.
Determine for each listing if it is Desktop RAM (UDIMM / 288-pin DIMM) or laptop RAM (SO-DIMM / 262-pin) and verify the capacity (GB) and unit price.

GLOBAL RULES:
${globalRulesText}

COMPONENT RULES:
${specificRulesText}

USER TARGET:
- Target: ${options.targetQuery || '288-pin Desktop UDIMM DDR5 RAM'}
- Maximum price per GB: ${maxPricePerGB} EUR/GB

STRICT CRITERIA:
1. FORM FACTOR & PINS:
   - If the photos or label show SO-DIMM (short laptop module ~70mm, 262 pins, e.g. Samsung M425..., Hynix HMCG66... codes), set status: 'REJECTED' and formFactor: 'SODIMM_LAPTOP'.
   - Set formFactor: 'UDIMM_DESKTOP' ONLY if it is a standard long module for PC Desktop (288 pins, e.g. Samsung M378..., Hynix HMCG78... codes).
2. CAPACITY:
   - Extract the capacity in GB with certainty from text or label OCR.
3. VALIDATION:
   - Set status: 'ACCEPTED' ONLY IF formFactor is 'UDIMM_DESKTOP' AND (Price / Capacity) <= ${maxPricePerGB} EUR/GB.

RESPOND EXCLUSIVELY IN JSON:
{
  "results": [
    {
      "listingId": "string",
      "formFactor": "UDIMM_DESKTOP" | "SODIMM_LAPTOP" | "ECC_SERVER" | "ACCESSORY_OTHER" | "UNKNOWN",
      "detectedGeneration": "DDR5" | "DDR4" | "DDR3" | "OTHER",
      "detectedCapacityGB": number or null,
      "detectedPartNumber": "string or null",
      "pricePerGB": number or null,
      "evidence": "proof from photo/OCR/text",
      "rejectionReason": "string or null if ACCEPTED",
      "status": "ACCEPTED" | "REJECTED"
    }
  ]
}`;
    }

    systemPrompt += `\n\nOUTPUT LANGUAGE RULE:\n${outputLanguageInstruction}`;

    // Split candidates into small chunks of 3 items
    const chunkSize = isVisionModel ? 3 : 10;
    const chunks: NormalizedListing[][] = [];
    for (let i = 0; i < candidatesForAi.length; i += chunkSize) {
      chunks.push(candidatesForAi.slice(i, i + chunkSize));
    }

    const isLocalOllama = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
    const concurrency = isLocalOllama ? 1 : 2;
    logAudit(`[AI Inspector] 👁️ Avvio Fase 3: ${chunks.length} chunk di Vision AI ${isLocalOllama ? 'in sequenza (concorrenza: 1 per Ollama)' : 'in parallelo (concorrenza: 2)'}...`);

    // Process chunks with dynamic concurrency
    await asyncPool(concurrency, chunks, async (chunk, chunkIdx) => {
      logAudit(`[AI Inspector] 🔍 Chunk ${chunkIdx + 1}/${chunks.length} (${chunk.length} annunci)...`);

      // 1. Fetch images in parallel for all items in chunk
      const userContentBlocks: any[] = [];
      let textSummary = `Analizza i seguenti annunci hardware:\n\n`;

      for (const item of chunk) {
        textSummary += `--- ANNUNCIO ID: ${item.id} ---\n`;
        textSummary += `Titolo: ${item.title}\n`;
        textSummary += `Brand: ${item.brand || 'N/D'}\n`;
        textSummary += `Prezzo: ${item.price} ${item.currency}\n`;
        textSummary += `Descrizione: ${item.description || 'Nessuna descrizione fornita'}\n`;
        textSummary += `URL: ${item.url}\n\n`;
      }

      userContentBlocks.push({ type: 'text', text: textSummary });

      if (isVisionModel) {
        const imageFetchPromises: Promise<{ itemId: string; pIdx: number; base64: string | null }>[] = [];
        for (const item of chunk) {
          const photosToDownload = item.photoUrls.slice(0, 3);
          photosToDownload.forEach((pUrl, pIdx) => {
            imageFetchPromises.push(
              fetchImageAsBase64(pUrl).then(base64 => ({ itemId: item.id, pIdx, base64 }))
            );
          });
        }

        const fetchedImages = await Promise.all(imageFetchPromises);
        for (const img of fetchedImages) {
          if (img.base64) {
            userContentBlocks.push({
              type: 'text',
              text: `[Foto ID ${img.itemId} - Immagine #${img.pIdx + 1}]:`
            });
            userContentBlocks.push({
              type: 'image_url',
              image_url: { url: img.base64 }
            });
          }
        }
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: isVisionModel ? userContentBlocks : textSummary }
      ];

      try {
        const callRes = await callOpenAiCompatible(baseUrl, apiKey, model, messages);
        totalPromptTokens += callRes.promptTokens;
        totalCompletionTokens += callRes.completionTokens;
        totalAiDurationSec += callRes.durationSec;

        logAudit(`[AI Inspector]   ↳ Chunk ${chunkIdx + 1} completato in ${callRes.durationSec.toFixed(1)}s (${callRes.tokensPerSec} tok/s)`);

        const cleaned = callRes.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.verdicts || []);
        for (const res of results) {
          if (res && res.listingId) {
            aiVerdictsMap.set(String(res.listingId), res);
          }
        }
      } catch (err: any) {
        logAudit(`[AI Inspector] ⚠️ Errore chiamata AI chunk ${chunkIdx + 1}: ${err.message}`);
      }
    });
  }

  // Combine verdicts across all scraped items
  const finalVerdicts: AiInspectionVerdict[] = normalized.map(cand => {
    // 1. Check pre-filter verdict
    if (preFilteredVerdicts.has(cand.id)) {
      return preFilteredVerdicts.get(cand.id)!;
    }

    // 2. Check AI verdict
    const aiVerdict = aiVerdictsMap.get(String(cand.id)) || {};
    const capacityGB = typeof aiVerdict.detectedCapacityGB === 'number' ? aiVerdict.detectedCapacityGB : null;
    const pricePerGB = capacityGB && cand.price > 0 ? (cand.price / capacityGB) : (typeof aiVerdict.pricePerGB === 'number' ? aiVerdict.pricePerGB : null);

    let status: 'ACCEPTED' | 'REJECTED' = 'REJECTED';
    let rejectionReason = aiVerdict.rejectionReason;

    if (isNvme) {
      const isNvmeValid = aiVerdict.formFactor !== 'SATA_M2' && aiVerdict.formFactor !== 'ACCESSORY_OTHER' && aiVerdict.detectedGeneration !== 'SATA';
      status = (aiVerdict.status === 'ACCEPTED' && isNvmeValid) ? 'ACCEPTED' : 'REJECTED';
      if (!rejectionReason && status === 'REJECTED') {
        if (aiVerdict.formFactor === 'SATA_M2' || aiVerdict.detectedGeneration === 'SATA') {
          rejectionReason = 'SSD SATA rilevato (non conforme a standard PCIe NVMe M-Key)';
        } else {
          rejectionReason = 'Non conforme ai requisiti SSD NVMe o specifiche non verificate';
        }
      }
    } else if (isPsu) {
      const targetQueryLower = (options.targetQuery || '').toLowerCase();
      const requiresGoldOrPlat = /gold|oro|platinum|platino|titanium|titanio/i.test(targetQueryLower);
      const isCertMatch = !requiresGoldOrPlat || (
        aiVerdict.detectedCertification === 'Gold' ||
        aiVerdict.detectedCertification === 'Platinum' ||
        aiVerdict.detectedCertification === 'Titanium'
      );
      
      const isPsuValid = isCertMatch && !aiVerdict.rejectionReason;
      status = (aiVerdict.status === 'ACCEPTED' && isPsuValid) ? 'ACCEPTED' : 'REJECTED';
      if (!rejectionReason && status === 'REJECTED') {
        if (!isCertMatch) {
          rejectionReason = 'Certificazione 80 PLUS richiesta non verificata o assente (UNKNOWN)';
        } else {
          rejectionReason = 'Does not comply with PSU specifications or validation failed';
        }
      }
    } else {
      const isStrictDesktop = aiVerdict.formFactor === 'UDIMM_DESKTOP' && 
        !/sodimm|so-dimm|so dimm|laptop|notebook|portatile/i.test(aiVerdict.evidence || '') &&
        !/sodimm|so-dimm|so dimm|laptop|notebook|portatile/i.test(aiVerdict.detectedPartNumber || '');

      status = (aiVerdict.status === 'ACCEPTED' && isStrictDesktop && capacityGB !== null && (!pricePerGB || pricePerGB <= maxPricePerGB)) 
        ? 'ACCEPTED' 
        : 'REJECTED';

      if (!rejectionReason && status === 'REJECTED') {
        if (!isStrictDesktop || aiVerdict.formFactor === 'SODIMM_LAPTOP') {
          rejectionReason = 'Modulo compatto SO-DIMM per notebook/laptop identificato da foto/OCR';
        } else if (capacityGB === null) {
          rejectionReason = 'Capacità in GB non verificabile con certezza dal testo o dall\'etichetta';
        } else if (pricePerGB && pricePerGB > maxPricePerGB) {
          rejectionReason = `Prezzo unitario ${pricePerGB.toFixed(2)} €/GB superiore alla soglia di ${maxPricePerGB} €/GB`;
        } else {
          rejectionReason = 'Non conforme ai requisiti o specifiche desktop non verificate';
        }
      }
    }

    return {
      listingId: cand.id,
      title: cand.title,
      url: cand.url,
      price: cand.price,
      currency: cand.currency,
      brand: cand.brand || aiVerdict.detectedBrand || (aiVerdict.detectedModel ? aiVerdict.detectedModel.split(' ')[0] : 'N/D'),
      status,
      formFactor: aiVerdict.formFactor || (isNvme ? 'M2_2280' : 'UNKNOWN'),
      detectedGeneration: aiVerdict.detectedGeneration || (isNvme ? 'NVMe' : (isPsu ? (aiVerdict.detectedCertification || 'UNKNOWN') : 'DDR5')),
      detectedCapacityGB: capacityGB,
      detectedPartNumber: aiVerdict.detectedPartNumber || null,
      detectedSerialNumber: aiVerdict.detectedSerialNumber || null,
      detectedModel: aiVerdict.detectedModel || null,
      smartHealth: aiVerdict.smartHealth || null,
      infoSource: aiVerdict.infoSource || (isVisionModel ? 'PHOTO_LABEL_OCR' : 'TEXT_FALLBACK'),
      pricePerGB: pricePerGB ? parseFloat(pricePerGB.toFixed(2)) : null,
      rejectionReason: status === 'ACCEPTED' ? null : rejectionReason,
      evidence: aiVerdict.evidence || (isVisionModel ? 'Verificato tramite Vision OCR' : 'Verificato tramite AI testuale'),
      photoUrl: cand.photoUrl,
      photoUrls: cand.photoUrls,
      inspectionMethod: isVisionModel ? 'VISION_AI' : 'TEXT_AI',
      
      // PSU Specific Fields
      detectedWattage: typeof aiVerdict.detectedWattage === 'number' ? aiVerdict.detectedWattage : null,
      detectedCertification: aiVerdict.detectedCertification || null,
      detectedProductionYear: typeof aiVerdict.detectedProductionYear === 'number' ? aiVerdict.detectedProductionYear : null
    };
  });

/**
 * Formats a report cell by interpolating placeholders from the verdict item
 */
function formatReportCell(template: string, item: AiInspectionVerdict): string {
  let sourceBadge = '📄 Testo';
  if (item.infoSource === 'PHOTO_LABEL_OCR') sourceBadge = '👁️ Foto Etichetta';
  else if (item.infoSource === 'PHOTO_SMART') sourceBadge = '📊 Screenshot SMART';
  else if (item.infoSource === 'PHOTO_VISION') sourceBadge = '👁️ Vision Foto';
  else if (item.infoSource === 'DETERMINISTIC_RULE') sourceBadge = '⚡ Regola Rapida';

  const placeholders: Record<string, string> = {
    listingId: item.listingId || '',
    title: item.title || '',
    brand: item.brand || 'N/D',
    price: item.price ? item.price.toFixed(2) : '0.00',
    currency: item.currency || 'EUR',
    url: item.url || '',
    formFactor: item.formFactor || 'N/D',
    detectedGeneration: item.detectedGeneration || 'N/D',
    detectedCapacityGB: item.detectedCapacityGB !== null ? `${item.detectedCapacityGB}` : 'N/D',
    detectedPartNumber: item.detectedPartNumber ? `${item.detectedPartNumber}` : '',
    detectedSerialNumber: item.detectedSerialNumber ? `${item.detectedSerialNumber}` : 'N/D',
    detectedModel: item.detectedModel || item.title,
    smartHealth: item.smartHealth ? `🟢 ${item.smartHealth}` : 'N/D',
    pricePerGB: item.pricePerGB ? item.pricePerGB.toFixed(2) : 'N/D',
    sourceBadge,
    evidence: item.evidence || 'Verificato',
    
    // PSU Specific
    detectedWattage: item.detectedWattage !== null && item.detectedWattage !== undefined ? `${item.detectedWattage}` : 'N/D',
    detectedCertification: item.detectedCertification || 'N/D',
    detectedProductionYear: item.detectedProductionYear !== null && item.detectedProductionYear !== undefined ? `${item.detectedProductionYear}` : 'N/D'
  };

  let out = template;
  for (const [key, val] of Object.entries(placeholders)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
  }
  return out;
}

  const accepted = finalVerdicts.filter(v => v.status === 'ACCEPTED');
  const reportConfig = compRule?.report_config;
  const sortBy = reportConfig?.sort_by || (isRam ? 'unit_price_asc' : 'price_asc');

  if (sortBy === 'unit_price_asc') {
    accepted.sort((a, b) => (a.pricePerGB || 999) - (b.pricePerGB || 999));
  } else if (sortBy === 'unit_price_desc') {
    accepted.sort((a, b) => (b.pricePerGB || 0) - (a.pricePerGB || 0));
  } else if (sortBy === 'price_desc') {
    accepted.sort((a, b) => b.price - a.price);
  } else {
    accepted.sort((a, b) => a.price - b.price);
  }

  const rejected = finalVerdicts.filter(v => v.status === 'REJECTED');

  const elapsedSecs = ((Date.now() - startTime) / 1000).toFixed(1);
  const overallTokensPerSec = totalCompletionTokens > 0 && totalAiDurationSec > 0 
    ? parseFloat((totalCompletionTokens / totalAiDurationSec).toFixed(1)) 
    : 0;

  const metrics: AiMetrics = {
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    totalAiDurationSec: parseFloat(totalAiDurationSec.toFixed(1)),
    tokensPerSec: overallTokensPerSec
  };

  // Build markdown report with prominent audit log and full statistics
  let report = `## 🤖 Report Analisi & Filtraggio Hardware (${compRule?.name || ruleModuleId})\n`;
  report += `- **Engine AI:** \`${baseUrl}\` | **Modello:** \`${model}\` (${isVisionModel ? 'Vision Multimodale Base64 + Normalizzazione JPEG' : 'Solo Testo'})\n`;
  report += `- **Annunci analizzati:** ${normalized.length} | **Accettati:** ${accepted.length} | **Scartati:** ${rejected.length} | **Tempo totale:** ${elapsedSecs}s\n`;

  if (options.apifyStats) {
    const apifyDuration = options.apifyStats.durationMillis ? `${(options.apifyStats.durationMillis / 1000).toFixed(1)}s` : 'N/D';
    const cuStr = options.apifyStats.computeUnits !== undefined ? `${options.apifyStats.computeUnits.toFixed(4)} CU` : 'N/D';
    report += `- **⚡ Statistiche Scraper Apify:** Tempo Actor: **${apifyDuration}** | Compute Units: **${cuStr}**${options.datasetUrl ? ` | [Dataset Console](${options.datasetUrl})` : ''}\n`;
  }

  report += `- **⚡ Metriche Inferenza AI (${model}):** **${totalPromptTokens.toLocaleString()} prompt tok** + **${totalCompletionTokens.toLocaleString()} completion tok** = **${metrics.totalTokens.toLocaleString()} tok totali** | Velocità: **${overallTokensPerSec} tok/s** | Tempo AI: **${metrics.totalAiDurationSec}s**\n\n`;

  report += `### 🟢 Annunci Convalidati\n\n`;
  if (accepted.length === 0) {
    report += `_Nessun annuncio ha superato tutti i criteri di validazione per i filtri specificati._\n\n`;
  } else {
    const defaultColumns = isNvme
      ? [
          { header: 'Modello / Titolo', value: '**{detectedModel}**' },
          { header: 'Brand', value: '{brand}' },
          { header: 'Capacità', value: '{detectedCapacityGB} GB' },
          { header: 'Seriale (S/N)', value: '`{detectedSerialNumber}`' },
          { header: 'Salute SMART', value: '{smartHealth}' },
          { header: 'Fonte Dato', value: '{sourceBadge}' },
          { header: 'Prezzo', value: '**{price} {currency}**' },
          { header: 'Link', value: '[Vedi Annuncio]({url})' }
        ]
      : (isRam
        ? [
            { header: 'Modello / Titolo', value: '[{title}]({url})' },
            { header: 'Brand', value: '{brand}' },
            { header: 'Capacità', value: '{detectedCapacityGB} GB' },
            { header: 'Prezzo', value: '**{price} {currency}**' },
            { header: 'Costo Unitario', value: '**{pricePerGB} €/GB**' },
            { header: 'Part Number / Note', value: '`{detectedPartNumber}`' },
            { header: 'Link', value: '[Vedi Annuncio]({url})' }
          ]
        : (isPsu
          ? [
              { header: 'Modello / Titolo', value: '[{detectedModel}]({url})' },
              { header: 'Brand', value: '{brand}' },
              { header: 'Form Factor', value: '`{formFactor}`' },
              { header: 'Potenza', value: '**{detectedWattage}W**' },
              { header: 'Certificazione 80 PLUS', value: '**{detectedCertification}**' },
              { header: 'Anno Produzione', value: '{detectedProductionYear}' },
              { header: 'Fonte', value: '{sourceBadge}' },
              { header: 'Prezzo', value: '**{price} {currency}**' },
              { header: 'Link', value: '[Vedi Annuncio]({url})' }
            ]
          : [
              { header: 'Modello / Titolo', value: '[{title}]({url})' },
              { header: 'Brand', value: '{brand}' },
              { header: 'Form Factor', value: '`{formFactor}`' },
              { header: 'Prezzo', value: '**{price} {currency}**' },
              { header: 'Note / Prova', value: '{evidence}' },
              { header: 'Link', value: '[Vedi Annuncio]({url})' }
            ]));

    const columns = (reportConfig?.columns && reportConfig.columns.length > 0)
      ? reportConfig.columns
      : defaultColumns;

    report += `| # | ${columns.map(c => c.header).join(' | ')} |\n`;
    report += `| :-: | ${columns.map(() => ':---').join(' | ')} |\n`;
    accepted.forEach((item, i) => {
      const rowValues = columns.map(c => formatReportCell(c.value, item));
      report += `| **${i + 1}** | ${rowValues.join(' | ')} |\n`;
    });
    report += `\n`;
  }

  report += `### 🔴 Annunci Scartati (Motivo di Esclusione)\n\n`;
  if (rejected.length === 0) {
    report += `_Nessun annuncio scartato._\n\n`;
  } else {
    report += `| # | Titolo Annuncio | Prezzo | Form Factor / Rilevazione | Motivo Scarto | Metodo | Link |\n`;
    report += `| :-: | :--- | :--- | :-: | :-: | :-: | :-: |\n`;
    rejected.forEach((item, i) => {
      const reasonStr = item.rejectionReason || 'Non conforme';
      const methodStr = item.inspectionMethod === 'DETERMINISTIC_RULE' ? '⚡ Pre-Filtro JSON' : (item.inspectionMethod === 'VISION_AI' ? '👁️ Vision OCR' : '📝 AI Testo');
      report += `| **${i + 1}** | [${item.title}](${item.url}) | ${item.price.toFixed(2)} ${item.currency} | \`${item.formFactor}\` (${item.detectedGeneration}) | ${reasonStr} | ${methodStr} | [Link](${item.url}) |\n`;
    });
    report += `\n`;
  }

  report += `### 📋 Log di Ispezione & Audit Trail\n`;
  report += `\`\`\`text\n`;
  report += auditLogs.join('\n') + `\n`;
  report += `[AI Inspector] 🏁 Completato in ${elapsedSecs}s (AI: ${metrics.totalAiDurationSec}s @ ${overallTokensPerSec} tok/s) - Accettati: ${accepted.length}, Scartati: ${rejected.length}\n`;
  report += `\`\`\`\n`;

  return {
    aiModelUsed: model,
    providerUrl: baseUrl,
    totalAnalyzed: normalized.length,
    accepted,
    rejected,
    markdownReport: report,
    metrics,
    apifyStats: options.apifyStats
  };
}

