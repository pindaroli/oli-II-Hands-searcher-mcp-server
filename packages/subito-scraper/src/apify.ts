import { ApifyClient, ApifyApiError } from 'apify-client';

export const SUBITO_ACTOR_ID = 'azzouzana/subito-scraper-pro-by-search-url';

export interface ScrapeSubitoOptions {
  searchUrl: string;
  maxItems?: number;
  token?: string;
  timeoutSecs?: number;
  memoryMbytes?: number;
}

export interface ApifyRunStats {
  durationMillis?: number;
  computeUnits?: number;
  costUsd?: number;
  startedAt?: Date | string;
  finishedAt?: Date | string;
}

export interface ApifyRunResult {
  runId: string;
  status: string;
  defaultDatasetId: string;
  itemsCount: number;
  items: Record<string, unknown>[];
  datasetUrl: string;
  actorUrl: string;
  stats?: ApifyRunStats;
}

/**
 * Resolves the Apify token from various sources in order of priority:
 * 1. Explicitly passed in call
 * 2. Process env APIFY_TOKEN
 * 3. Process env APIFY_API_TOKEN
 */
export function resolveApifyToken(explicitToken?: string): string {
  const token = explicitToken || process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;
  if (!token || token.trim().length === 0) {
    throw new Error(
      'Apify API token is missing. Please provide it via the APIFY_TOKEN / APIFY_API_TOKEN environment variable, via the --token CLI option, or as a tool argument.'
    );
  }
  return token.trim();
}

export function hasApifyToken(explicitToken?: string): boolean {
  const token = explicitToken || process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;
  return !!token && token.trim().length > 0;
}

/**
 * Creates an instance of ApifyClient with the specified or resolved token
 */
export function getApifyClient(token?: string): ApifyClient {
  const resolvedToken = resolveApifyToken(token);
  return new ApifyClient({ token: resolvedToken });
}

/**
 * Runs the subito-scraper-pro actor and retrieves the dataset items
 */
export async function runSubitoScraper(options: ScrapeSubitoOptions): Promise<ApifyRunResult> {
  const client = getApifyClient(options.token);

  const requestedLimit = options.maxItems ?? 30;
  const actorMaxItems = Math.max(10, requestedLimit);

  const actorInput: Record<string, unknown> = {
    searchUrl: options.searchUrl,
    maxItems: actorMaxItems
  };

  const runOptions: { timeout?: number; memory?: number; waitSecs?: number; log: null } = { log: null };
  if (options.timeoutSecs) {
    runOptions.timeout = options.timeoutSecs;
    runOptions.waitSecs = options.timeoutSecs;
  }
  if (options.memoryMbytes) {
    runOptions.memory = options.memoryMbytes;
  }

  // Run the Actor and wait for it to finish
  const run = await client.actor(SUBITO_ACTOR_ID).call(actorInput, runOptions);

  if (!run || !run.defaultDatasetId) {
    throw new Error(`Apify Actor run failed or did not return a valid dataset ID. Run status: ${run?.status}`);
  }

  // Fetch the dataset items
  const { items, total } = await client.dataset(run.defaultDatasetId).listItems({
    limit: requestedLimit
  });

  const slicedItems = (items as Record<string, unknown>[]).slice(0, requestedLimit);

  const stats: ApifyRunStats = {
    durationMillis: (run.stats as any)?.durationMillis || (run.finishedAt && run.startedAt ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() : undefined),
    computeUnits: (run.stats as any)?.computeUnits ?? (run.usage as any)?.ACTOR_COMPUTE_UNITS,
    costUsd: (run.usage as any)?.TOTAL_COST_USD || (run.stats as any)?.costUsd,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt
  };

  return {
    runId: run.id,
    status: run.status,
    defaultDatasetId: run.defaultDatasetId,
    itemsCount: total ?? items.length,
    items: slicedItems,
    datasetUrl: `https://console.apify.com/storage/datasets/${run.defaultDatasetId}`,
    actorUrl: `https://apify.com/${SUBITO_ACTOR_ID}`,
    stats
  };
}

/**
 * Fetches items from an existing dataset ID
 */
export async function getDatasetItems(
  datasetId: string,
  limit = 50,
  offset = 0,
  token?: string
): Promise<{ total: number; count: number; items: Record<string, unknown>[] }> {
  const client = getApifyClient(token);
  const { items, total } = await client.dataset(datasetId).listItems({
    limit,
    offset
  });

  return {
    total: total ?? items.length,
    count: items.length,
    items: items as Record<string, unknown>[]
  };
}

/**
 * Verifies Apify token and returns user details
 */
export async function checkApifyStatus(token?: string): Promise<Record<string, unknown>> {
  const client = getApifyClient(token);
  const user = await client.user().get();
  return {
    id: user?.id,
    username: user?.username,
    email: user?.email,
    plan: user?.plan?.id,
    isPaying: user?.isPaying,
    proxyCredits: user?.proxy
  };
}

/**
 * Formats an Apify or network error into an actionable diagnostic message with troubleshooting steps
 */
export function formatApifyError(error: unknown): string {
  if (!error) return 'Errore sconosciuto.';

  // Check if it's an ApifyApiError
  if (error instanceof ApifyApiError) {
    const status = error.statusCode;
    const type = error.type || '';
    const msg = error.message || '';

    if (status === 401 || type.includes('token') || type.includes('unauthorized')) {
      return (
        `🔴 **DIAGNOSTICA: Token Apify non valido o non autorizzato (HTTP 401)**\n` +
        `- **Dettaglio:** ${msg || 'Il token specificato non è stato riconosciuto dai server di Apify.'}\n` +
        `💡 **Come risolvere:**\n` +
        `  1. Accedi alla console di Apify: https://console.apify.com/settings/integrations\n` +
        `  2. Genera o copia il tuo **Personal API Token** (inizia con \`apify_api_...\`).\n` +
        `  3. Inseriscilo nel file \`.env\` come \`APIFY_TOKEN=tuo_token\` o configuralo nelle impostazioni MCP.`
      );
    }

    if (status === 402 || type.includes('payment') || type.includes('insufficient') || type.includes('limit')) {
      return (
        `🔴 **DIAGNOSTICA: Crediti Apify esauriti o limite di spesa raggiunto (HTTP 402)**\n` +
        `- **Dettaglio:** ${msg || 'Il tuo account Apify ha esaurito i crediti disponibili per eseguire questo Actor.'}\n` +
        `💡 **Come risolvere:**\n` +
        `  1. Verifica il saldo crediti o il piano attivo su: https://console.apify.com/billing\n` +
        `  2. L'Actor \`azzouzana/subito-scraper-pro-by-search-url\` applica una tariffa pay-per-event ($1 / 1.000 annunci). Assicurati di avere crediti residui o un piano attivo.`
      );
    }

    if (status === 429 || type.includes('rate-limit')) {
      return (
        `🔴 **DIAGNOSTICA: Troppe richieste / Rate limit superato (HTTP 429)**\n` +
        `- **Dettaglio:** ${msg || 'Hai superato il numero massimo di richieste al secondo o le esecuzioni contemporanee consentite.'}\n` +
        `💡 **Come risolvere:**\n` +
        `  1. Attendi 1 o 2 minuti prima di rilanciare la ricerca.\n` +
        `  2. Sul piano gratuito Apify c'è un intervallo minimo di 1 minuto tra le esecuzioni.`
      );
    }

    if (status === 404) {
      return (
        `🔴 **DIAGNOSTICA: Risorsa non trovata (HTTP 404)**\n` +
        `- **Dettaglio:** ${msg || `L'Actor \`${SUBITO_ACTOR_ID}\` o il dataset richiesto non esiste.`}`
      );
    }

    return (
      `🔴 **DIAGNOSTICA: Errore API Apify (HTTP ${status} - ${type || 'Errore'})**\n` +
      `- **Dettaglio:** ${msg}`
    );
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('token is missing') || message.includes('APIFY_TOKEN')) {
    return (
      `🔴 **DIAGNOSTICA: Token Apify non configurato**\n` +
      `- **Dettaglio:** Nessun token API è stato trovato nelle variabili d'ambiente o nei parametri.\n` +
      `💡 **Come risolvere:**\n` +
      `  1. Crea un file \`.env\` nel progetto con il contenuto: \`APIFY_TOKEN=il_tuo_token_apify\`\n` +
      `  2. Oppure passa il token direttamente come parametro nel tool.`
    );
  }

  return `🔴 **DIAGNOSTICA: Errore durante l'operazione:**\n- **Dettaglio:** ${message}`;
}
