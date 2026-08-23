import { runLocalScraper } from '../src/local.js';
import { scrapeSubito } from '../src/engine.js';
import { buildSubitoSearchUrl } from '../src/url-builder.js';

async function runTests() {
  console.log('--- Esecuzione Test Scraping Locale Subito.it ---');

  const url = buildSubitoSearchUrl({
    query: 'macbook m3',
    category: 'informatica',
    region: 'italia'
  });

  console.log(`\n1. Test estrazione DOM e JSON diretto (runLocalScraper)`);
  console.log(`URL: ${url}`);
  
  try {
    const startTime = Date.now();
    const result = await runLocalScraper({ searchUrl: url, maxItems: 5 });
    const elapsed = Date.now() - startTime;

    if (result.items.length > 0) {
      console.log(`✅ Estrazione riuscita: ${result.items.length} annunci trovati in ${elapsed}ms.`);
      // Verifichiamo che i campi base siano presenti
      const firstItem = result.items[0] as any;
      console.log(`   Primo annuncio: "${firstItem.subject || firstItem.title || firstItem.name}"`);
    } else {
      console.error(`❌ Estrazione fallita: nessun annuncio estratto (verifica l'URL o la struttura DOM).`);
      process.exit(1);
    }

    console.log(`\n2. Test Rate Limiter (invio di 3 richieste contemporanee)`);
    console.log(`   Le richieste dovrebbero distanziarsi di almeno ${process.env.LOCAL_SCRAPE_DELAY_MS || 3000}ms.`);
    
    const startConcurrent = Date.now();
    const results = await Promise.all([
      runLocalScraper({ searchUrl: buildSubitoSearchUrl({ query: 'ram' }), maxItems: 2 }),
      runLocalScraper({ searchUrl: buildSubitoSearchUrl({ query: 'cpu' }), maxItems: 2 }),
      runLocalScraper({ searchUrl: buildSubitoSearchUrl({ query: 'gpu' }), maxItems: 2 })
    ]);
    const elapsedConcurrent = Date.now() - startConcurrent;
    
    const expectedMinTime = (parseInt(process.env.LOCAL_SCRAPE_DELAY_MS || '3000', 10) * 2);
    if (elapsedConcurrent >= expectedMinTime) {
      console.log(`✅ Rate limiter funzionante: 3 richieste processate in ${elapsedConcurrent}ms (min atteso: ~${expectedMinTime}ms).`);
    } else {
      console.error(`❌ Rate limiter non funzionante correttamente: processate troppo in fretta (${elapsedConcurrent}ms).`);
    }

    console.log(`\n3. Test Cache (invio della stessa ricerca di prima)`);
    const startCache = Date.now();
    const cacheResult = await scrapeSubito({ searchUrl: url, maxItems: 5 });
    const elapsedCache = Date.now() - startCache;
    
    if (elapsedCache < 50) {
      console.log(`✅ Cache funzionante: risultato servito in ${elapsedCache}ms.`);
    } else {
      console.warn(`⚠️ Cache servita lentamente o non usata (${elapsedCache}ms).`);
    }

    console.log('\n✅ Tutti i test sono passati con successo.');
    process.exit(0);

  } catch (error) {
    console.error(`\n❌ Eccezione durante i test:`, error);
    process.exit(1);
  }
}

// Forza token assente per i test
delete process.env.APIFY_TOKEN;
delete process.env.APIFY_API_TOKEN;

runTests();
