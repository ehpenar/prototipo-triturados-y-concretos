import React, { useEffect, useMemo, useRef, useState } from "react";
import { CONFIG, VIEWS, viewLabels } from "./constants/config.js";
import {
  loadSources,
  saveSources,
  loadStored,
  saveStored,
  normalizeText,
  extractSpreadsheetId,
} from "./utils/helpers.js";
import { loadSpreadsheet, upsertSheetRows } from "./utils/googleSheets.js";
import { detectRelations, detectAnomalies } from "./utils/analysis.js";
import {
  FINANCIAL_SUMMARY_HEADERS,
  FINANCIAL_SUMMARY_SHEET,
  buildFinancialSummaryRows,
  findFinancialSummaryDocument,
  findFinancialSummarySheet,
} from "./utils/financialSummary.js";
import { answerLocally, askOpenAI } from "./utils/ai.js";

// Import Modular Views
import { Dashboard } from "./views/Dashboard.jsx";
import { Records } from "./views/Records.jsx";
import { Relations } from "./views/Relations.jsx";
import { Equipment } from "./views/Equipment.jsx";
import { Automation } from "./views/Automation.jsx";
import { Reminders } from "./views/Reminders.jsx";
import { Reports } from "./views/Reports.jsx";
import { Integrations } from "./views/Integrations.jsx";
import { Assistant } from "./views/Assistant.jsx";
import { Settings } from "./views/Settings.jsx";

function App() {
  const [sources, setSources] = useState(loadSources);
  const [documents, setDocuments] = useState([]);
  const [records, setRecords] = useState([]);
  const [relations, setRelations] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [syncStatus, setSyncStatus] = useState("Sin sincronizar");
  const [syncLog, setSyncLog] = useState([]);
  const [activeView, setActiveView] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [pollInterval, setPollInterval] = useState(60000);
  const [filters, setFilters] = useState({ document: "", sheet: "", type: "" });
  const [rankingMode, setRankingMode] = useState("cost");
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [newSource, setNewSource] = useState({ name: "", url: "" });
  const [notes, setNotes] = useState(() => loadStored("operation_ai_notes", []));
  const [automations, setAutomations] = useState(() => loadStored("operation_ai_custom_automations", []));
  const [reports, setReports] = useState(() => loadStored("operation_ai_reports", []));
  const [notificationConfig, setNotificationConfig] = useState(() =>
    loadStored("operation_ai_notification_config", {
      senderEmail: "",
      recipients: "",
      emailAccounts: [],
      subject: "Recordatorio operacional",
      emailMessage: "Tienes una novedad pendiente en la plataforma operacional.",
      telegramToken: "8700426249:AAE1LIISILPiLT4JzX_hj_TFTzWMcJKdOG8",
      telegramChats: "",
    }),
  );
  const tokenRef = useRef(localStorage.getItem("google_access_token") || "");
  const syncInProgressRef = useRef(false);

  const filteredRecords = useMemo(() => {
    const query = normalizeText(search);
    return records.filter((record) => {
      const matchesSearch =
        !query ||
        record.text.includes(query) ||
        normalizeText(Object.values(record.normalized).join(" ")).includes(query);
      const matchesDocument = !filters.document || record.sourceName === filters.document;
      const matchesSheet = !filters.sheet || record.sheetName === filters.sheet;
      const matchesType = !filters.type || record.type === filters.type;
      return matchesSearch && matchesDocument && matchesSheet && matchesType;
    });
  }, [records, search, filters]);

  useEffect(() => {
    saveSources(sources);
  }, [sources]);

  useEffect(() => {
    saveStored("operation_ai_notes", notes);
  }, [notes]);

  useEffect(() => {
    saveStored("operation_ai_custom_automations", automations);
  }, [automations]);

  useEffect(() => {
    saveStored("operation_ai_reports", reports);
  }, [reports]);

  useEffect(() => {
    saveStored("operation_ai_notification_config", notificationConfig);
  }, [notificationConfig]);

  useEffect(() => {
    syncAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pollInterval) return undefined;
    const runAutomaticSync = () => syncAll(sources, false, true);
    const timer = setInterval(runAutomaticSync, pollInterval);
    const syncWhenVisible = () => {
      if (!document.hidden) runAutomaticSync();
    };
    window.addEventListener("focus", runAutomaticSync);
    document.addEventListener("visibilitychange", syncWhenVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", runAutomaticSync);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollInterval, sources]);

  const addLog = (message) => {
    setSyncLog((current) => [`[${new Date().toLocaleTimeString("es-CO")}] ${message}`, ...current].slice(0, 80));
  };

  async function syncAll(sourceList = sources, allowAuthPrompt = false, automatic = false) {
    if (syncInProgressRef.current) {
      addLog("Sincronizacion omitida: ya hay una sincronizacion en curso.");
      return;
    }
    syncInProgressRef.current = true;
    setSyncStatus("Sincronizando...");
    addLog(automatic ? "Inicio de sincronizacion automatica." : "Inicio de sincronizacion.");
    const loadedDocuments = [];
    let successCount = 0;
    for (const source of sourceList) {
      const sourceId = extractSpreadsheetId(source.url);
      try {
        const document = await loadSpreadsheet({ ...source, instanceKey: source.instanceKey || `${sourceId}-${loadedDocuments.length}` }, tokenRef, allowAuthPrompt);
        loadedDocuments.push(document);
        successCount += 1;
        addLog(`OK ${source.name}: ${document.sheets.length} pestanas, ${document.records.length} registros.`);
      } catch (error) {
        addLog(`Error ${source.name}: ${error.message}`);
        const previousDocument = documents.find((document) => document.id === sourceId || document.source?.name === source.name);
        if (previousDocument) {
          loadedDocuments.push(previousDocument);
          addLog(`Se conservan los ultimos datos cargados de ${source.name}.`);
        }
      }
    }
    if (!successCount && !loadedDocuments.length) {
      setSyncStatus(`Sin conexion ${new Date().toLocaleTimeString("es-CO")}`);
      syncInProgressRef.current = false;
      return;
    }
    const nextRecords = loadedDocuments.flatMap((document) => document.records);
    const nextRelations = detectRelations(nextRecords);
    await syncFinancialSummary(loadedDocuments, allowAuthPrompt);
    setDocuments(loadedDocuments);
    setRecords(nextRecords);
    setRelations(nextRelations);
    setAlerts(detectAnomalies(nextRecords, nextRelations));
    setSyncStatus(`${successCount ? "Actualizado" : "Datos conservados"} ${new Date().toLocaleTimeString("es-CO")}`);
    syncInProgressRef.current = false;
  }

  async function syncFinancialSummary(loadedDocuments, allowAuthPrompt = false) {
    const summaryDocument = findFinancialSummaryDocument(loadedDocuments);
    const summarySheet = findFinancialSummarySheet(summaryDocument);
    if (!summaryDocument || !summarySheet) {
      addLog("Resumen financiero omitido: no se encontro Resumen Financiero OTS / Hoja 2.");
      return;
    }
    const rows = buildFinancialSummaryRows(loadedDocuments);
    if (!rows.length) {
      addLog("Resumen financiero omitido: no hay OTs fuente para calcular.");
      return;
    }
    try {
      const result = await upsertSheetRows(
        summaryDocument.id,
        FINANCIAL_SUMMARY_SHEET,
        FINANCIAL_SUMMARY_HEADERS,
        rows,
        "OT",
        tokenRef,
        allowAuthPrompt,
      );
      addLog(`Resumen financiero: ${result.added} creadas, ${result.changed} actualizadas, ${result.unchanged} sin cambios.`);
    } catch (error) {
      addLog(`Error resumen financiero: ${error.message}`);
    }
  }

  const runAnalysis = () => {
    setAlerts(detectAnomalies(records, relations));
    addLog("Analisis local completado.");
  };

  const addSource = (event) => {
    event.preventDefault();
    if (!newSource.name.trim() || !newSource.url.trim()) return;
    const nextSources = [...sources, { ...newSource, name: newSource.name.trim(), url: newSource.url.trim(), roleHint: "" }];
    setSources(nextSources);
    setNewSource({ name: "", url: "" });
    syncAll(nextSources, true);
  };

  const removeSource = (index) => {
    setSources((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const exportCurrentRecords = () => {
    const data = JSON.stringify(filteredRecords, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `operacion-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const askAssistant = async (event) => {
    event.preventDefault();
    const question = assistantQuestion.trim();
    if (!question) return;
    setAssistantQuestion("");
    setAssistantMessages((current) => [...current, { role: "user", text: question }]);
    const localAnswer = answerLocally(question, records, relations, alerts, documents);
    setAssistantMessages((current) => [...current, { role: "assistant", text: localAnswer }]);
    if (!CONFIG.openai.apiKey) return;
    try {
      const aiAnswer = await askOpenAI(question, records, relations, alerts, documents);
      setAssistantMessages((current) => [...current, { role: "assistant", text: aiAnswer }]);
    } catch (error) {
      setAssistantMessages((current) => [
        ...current,
        { role: "assistant", text: `No pude consultar OpenAI desde el navegador: ${error.message}. El analisis local queda disponible.` },
      ]);
    }
  };

  const [title, subtitle] = VIEWS[activeView];

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">OI</span>
          <div className="brand-text">
            <strong>Operacion IA</strong>
            <small>Sheets ERP dinamico</small>
          </div>
        </div>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((current) => !current)}
          title={sidebarCollapsed ? "Mostrar menu" : "Ocultar menu"}
          type="button"
        >
          {sidebarCollapsed ? ">" : "<"}
        </button>

        <nav className="nav">
          {Object.entries(VIEWS).map(([view]) => (
            <button
              className={`nav-item ${activeView === view ? "active" : ""}`}
              data-view={view}
              key={view}
              onClick={() => setActiveView(view)}
              type="button"
            >
              <span>{viewLabels[view]}</span>
            </button>
          ))}
        </nav>

        <div className="sync-card">
          <span>{syncStatus}</span>
          <button onClick={() => syncAll(sources, true)} type="button">
            Sincronizar
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="top-actions">
            <input
              type="search"
              placeholder="Buscar OT, equipo, proveedor, tecnico, costo..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              title="Intervalo de sincronizacion"
              value={pollInterval}
              onChange={(event) => setPollInterval(Number(event.target.value))}
            >
              <option value={0}>Manual</option>
              <option value={30000}>Cada 30 seg</option>
              <option value={60000}>Cada 1 min</option>
              <option value={300000}>Cada 5 min</option>
            </select>
          </div>
        </header>

        {activeView === "dashboard" && (
          <Dashboard
            documents={documents}
            records={filteredRecords}
            alerts={alerts}
            rankingMode={rankingMode}
            setRankingMode={setRankingMode}
            runAnalysis={runAnalysis}
          />
        )}

        {activeView === "records" && (
          <Records
            addLog={addLog}
            documents={documents}
            filters={filters}
            notes={notes}
            records={filteredRecords}
            setFilters={setFilters}
            setNotes={setNotes}
            sourceRecords={records}
            exportCurrentRecords={exportCurrentRecords}
            tokenRef={tokenRef}
            onSaved={syncAll}
          />
        )}

        {activeView === "relations" && <Relations relations={relations} />}

        {activeView === "equipment" && (
          <Equipment
            relations={relations}
            equipmentSearch={equipmentSearch}
            setEquipmentSearch={setEquipmentSearch}
          />
        )}

        {activeView === "automation" && (
          <Automation
            alerts={alerts}
            automations={automations}
            documents={documents}
            setAutomations={setAutomations}
            pollInterval={pollInterval}
            records={records}
            relations={relations}
            syncLog={syncLog}
          />
        )}

        {activeView === "reminders" && (
          <Reminders
            documents={documents}
            notes={notes}
            setNotes={setNotes}
            tokenRef={tokenRef}
            addLog={addLog}
            onSaved={syncAll}
          />
        )}

        {activeView === "reports" && (
          <Reports
            alerts={alerts}
            documents={documents}
            notificationConfig={notificationConfig}
            records={records}
            relations={relations}
            reports={reports}
            setReports={setReports}
          />
        )}

        {activeView === "integrations" && (
          <Integrations config={notificationConfig} setConfig={setNotificationConfig} />
        )}

        {activeView === "assistant" && (
          <Assistant
            messages={assistantMessages}
            question={assistantQuestion}
            setQuestion={setAssistantQuestion}
            onSubmit={askAssistant}
          />
        )}

        {activeView === "settings" && (
          <Settings
            sources={sources}
            newSource={newSource}
            setNewSource={setNewSource}
            addSource={addSource}
            removeSource={removeSource}
          />
        )}
      </main>
    </div>
  );
}

export default App;
