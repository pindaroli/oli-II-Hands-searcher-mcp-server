import { runSubitoBatch } from '../src/index.js';

async function testBatchApi() {
  console.log('--- Test Integrazione Programmabile: runSubitoBatch ---');

  try {
    const startTime = Date.now();
    const result = await runSubitoBatch({
      query: 'alimentatore gold 400w',
      maxItems: 5,
      cappingEnabled: false,
      onProgress: (p) => {
        console.log(`[Progress][${p.stage.toUpperCase()}] ${p.message}`);
      }
    });

    const elapsed = Date.now() - startTime;
    console.log(`\n========================================`);
    console.log(`Test completato in ${(elapsed / 1000).toFixed(2)}s`);
    console.log(`Query: "${result.query}"`);
    console.log(`URL di Ricerca: ${result.searchUrl}`);
    console.log(`Annunci Totali Trovati: ${result.totalFound}`);
    console.log(`Annunci Accettati: ${result.accepted.length}`);
    console.log(`Annunci Scartati: ${result.rejected.length}`);
    console.log(`========================================\n`);

    if (result.accepted.length > 0) {
      console.log('Primo annuncio accettato:');
      const first = result.accepted[0];
      console.log(`- Titolo: ${first.title}`);
      console.log(`- Prezzo: ${first.price} EUR`);
      console.log(`- Link: ${first.urls_default || first.url}`);
    } else {
      console.log('Nessun annuncio convalidato (coerente con i filtri).');
    }

  } catch (err: any) {
    console.error('Test FAILED con errore:', err.message || err);
    process.exit(1);
  }
}

testBatchApi();
