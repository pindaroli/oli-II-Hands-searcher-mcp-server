#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { runSubitoBatch, SubitoBatchOptions } from './batch.js';

function printUsage() {
  console.log(`
Uso: npm run search-batch -- [opzioni]

Opzioni:
  --query, -q          Parola chiave da cercare su Subito.it (es. "alimentatore gold") [Obbligatorio]
  --maxItems, -m       Numero massimo di elementi da scaricare (default: 30)
  --category, -c       Categoria di Subito.it (default: "informatica")
  --region, -r         Regione geografica (default: "italia")
  --minPrice           Prezzo minimo in EUR
  --maxPrice           Prezzo massimo in EUR
  --maxPricePerGB      Prezzo massimo per GB (solo RAM/SSD)
  --ruleModuleId       Modulo di regole hardware (es. "psu", "nvme")
  --targetQuery, -t    Target specifico dell'ispezione AI (es. "alimentatore gold max 400w")
  --output, -o         File di output per scrivere il report markdown (default: result_report.md)
  --outputJson         File di output per scrivere i dati JSON (default: none)
  --help, -h           Mostra questo messaggio di aiuto
  `);
}

async function main() {
  const args = process.argv.slice(2);
  const options: SubitoBatchOptions = { query: '' };
  let outputFile = 'result_report.md';
  let outputJsonFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let key = arg;
    let val: string | undefined;

    if (arg.startsWith('--') && arg.includes('=')) {
      const idx = arg.indexOf('=');
      key = arg.slice(0, idx);
      val = arg.slice(idx + 1);
    }

    if (key === '--help' || key === '-h') {
      printUsage();
      process.exit(0);
    }

    const getVal = (): string | undefined => {
      if (val !== undefined) return val;
      if (i + 1 < args.length) {
        const nextVal = args[i + 1];
        i++;
        return nextVal;
      }
      return undefined;
    };

    if (key === '--query' || key === '-q') {
      options.query = getVal() || '';
    } else if (key === '--maxItems' || key === '-m') {
      const v = getVal();
      if (v) options.maxItems = parseInt(v, 10);
    } else if (key === '--category' || key === '-c') {
      options.category = getVal();
    } else if (key === '--region' || key === '-r') {
      options.region = getVal();
    } else if (key === '--minPrice') {
      const v = getVal();
      if (v) options.minPrice = parseFloat(v);
    } else if (key === '--maxPrice') {
      const v = getVal();
      if (v) options.maxPrice = parseFloat(v);
    } else if (key === '--maxPricePerGB') {
      const v = getVal();
      if (v) options.maxPricePerGB = parseFloat(v);
    } else if (key === '--ruleModuleId') {
      options.ruleModuleId = getVal();
    } else if (key === '--targetQuery' || key === '-t') {
      options.targetQuery = getVal();
    } else if (key === '--output' || key === '-o') {
      outputFile = getVal() || 'result_report.md';
    } else if (key === '--outputJson') {
      outputJsonFile = getVal();
    }
  }

  if (!options.query) {
    console.error('Errore: La query è obbligatoria.');
    printUsage();
    process.exit(1);
  }

  console.log(`[Batch CLI] Inizio elaborazione batch per la query: "${options.query}"`);
  console.log(`[Batch CLI] Parametri: maxItems=${options.maxItems || 30}, categoria=${options.category || 'informatica'}, regione=${options.region || 'italia'}`);

  try {
    const result = await runSubitoBatch({
      ...options,
      cappingEnabled: false, // In modalità batch CLI disattiviamo il capping AI per elaborare tutto
      onProgress: (p) => {
        const progressIndicator = p.current !== undefined && p.total !== undefined ? ` (${p.current}/${p.total})` : '';
        console.log(`[Batch CLI][${p.stage.toUpperCase()}] ${p.message}${progressIndicator}`);
      }
    });

    console.log('\n========================================');
    console.log('🏁 Batch completato con successo!');
    console.log(`Trovati: ${result.totalFound} annunci`);
    console.log(`Analizzati dall'AI: ${result.analyzedCount} annunci`);
    console.log(`Accettati: ${result.accepted.length} annunci`);
    console.log(`Scartati: ${result.rejected.length} annunci`);
    console.log('========================================\n');

    // Assicurati che la directory dei risultati esista
    const outDir = path.dirname(outputFile);
    if (outDir && outDir !== '.' && !fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Scrivi il report Markdown
    fs.writeFileSync(outputFile, result.markdownReport, 'utf8');
    console.log(`[Batch CLI] Report Markdown scritto con successo in: ${outputFile}`);

    // Scrivi il file JSON dei dati (se richiesto)
    if (outputJsonFile) {
      const outJsonDir = path.dirname(outputJsonFile);
      if (outJsonDir && outJsonDir !== '.' && !fs.existsSync(outJsonDir)) {
        fs.mkdirSync(outJsonDir, { recursive: true });
      }
      const jsonData = {
        query: result.query,
        searchUrl: result.searchUrl,
        totalFound: result.totalFound,
        analyzedCount: result.analyzedCount,
        accepted: result.accepted,
        rejected: result.rejected
      };
      fs.writeFileSync(outputJsonFile, JSON.stringify(jsonData, null, 2), 'utf8');
      console.log(`[Batch CLI] Dati JSON scritti con successo in: ${outputJsonFile}`);
    }

  } catch (err: any) {
    console.error('[Batch CLI] Errore critico durante l\'esecuzione:', err.message || err);
    process.exit(1);
  }
}

main();
