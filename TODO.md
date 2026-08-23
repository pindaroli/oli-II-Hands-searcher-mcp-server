# 📋 TODO: Evoluzione Architetturale & Batch Orchestrator

Questo file tiene traccia delle attività future per lo sviluppo di `subito-scraper` e l'integrazione asincrona nel cluster Kubernetes (Homelab).

---

## 🛠️ Fase 1: Consolidamento e Test (Corrente)
- [ ] **Eseguire Reload Window** dell'IDE (`Cmd+Shift+P` -> *Developer: Reload Window*) per riavviare il server MCP caricando il nuovo eseguibile `bin.js`.
- [ ] **Testare la Ricerca MCP**: Verificare che la ricerca standard con AI Vision (cappata a 21 elementi e a concorrenza 1) funzioni in chat senza andare in timeout.
- [ ] **Testare il CLI Batch**: Eseguire test con ricerche massive da riga di comando per raccogliere dati reali e salvarli in `results/`.

---

## 🚀 Fase 2: Architettura Programmabile & CLI (Completata)
- [x] Separazione dell'entrypoint MCP (`bin.ts`) dall'entrypoint di libreria (`index.ts`).
- [x] Implementazione della funzione batch programmabile `runSubitoBatch()` in `batch.ts`.
- [x] Creazione dello script CLI `batch-cli.ts` con parser robusto dei parametri.
- [x] Test di integrazione superati sia programmaticamente che da riga di comando.

---

## ☁️ Fase 3: Orchestrazione Asincrona Homelab (Futuro)
Proposta di integrazione basata sull'approccio "External Orchestration" discusso in data 23 Agosto 2026:

### 1. Containerizzazione dello Scraper
- [ ] Creare un `Dockerfile` multi-stage per pacchettizzare lo scraper in un'immagine Docker leggera.
- [ ] Configurare una pipeline locale per compilare e fare il push dell'immagine sul Container Registry locale dell'Homelab.

### 2. Disaccoppiamento via Kubernetes API
- [ ] Implementare un tool MCP (es. `trigger_k8s_batch_search`) che:
  * Generi un manifesto YAML di tipo `Job` di Kubernetes partendo da un template.
  * Utilizzi la libreria client di Kubernetes (`@kubernetes/client-node`) per applicare il Job direttamente nel cluster Homelab (es. in un namespace dedicato `scraper-jobs`).
  * Restituisca immediatamente all'agente MCP il nome del Job creato (es. `subito-batch-gold-psu-xxxx`).

### 3. Persistenza dei Report e Notifiche
- [ ] Configurare il Job per scrivere il report JSON/Markdown finale su un volume persistente condiviso (PVC agganciato a uno share NFS/SMB su TrueNAS).
- [ ] Implementare un tool di consultazione `get_job_report` per consentire all'agente MCP di verificare lo stato del Job (tramite le API di Kubernetes) e recuperare il contenuto del report una volta completato.

### 4. Valutazione Specifica SEP-1686 (Tasks)
- [ ] Monitorare gli aggiornamenti dei client MCP (Cursor, Claude Desktop) per implementare l'estensione nativa Tasks `SEP-1686` (`tasks/get`, `tasks/result`) non appena le capabilities saranno supportate nativamente dalle interfacce degli IDE.
