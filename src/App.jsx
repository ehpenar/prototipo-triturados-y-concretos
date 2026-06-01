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
import {
  createSheetWithHeaders,
  getStoredGoogleToken,
  loadSpreadsheet,
  sendGmailMessage,
  updateSheetCell,
  upsertSheetRows,
} from "./utils/googleSheets.js";
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

const LINKED_EMAILS_SHEET = "Correos vinculados";
const LINKED_EMAILS_HEADERS = ["CORREOS EMISOR", "CORREOS RECEPTORES"];

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
      includeSenderAsReceiver: false,
      subject: "Recordatorio operacional",
      emailMessage: "Tienes una novedad pendiente en la plataforma operacional.",
      telegramToken: "8700426249:AAE1LIISILPiLT4JzX_hj_TFTzWMcJKdOG8",
      telegramChats: "",
    }),
  );
  const tokenRef = useRef(getStoredGoogleToken());
  const syncInProgressRef = useRef(false);
  const reminderSendInProgressRef = useRef(false);
  const globalStatusSendInProgressRef = useRef(false);
  const globalOtChangeSendInProgressRef = useRef(false);
  const reminderStateRef = useRef(loadStored("operation_ai_reminder_delivery_state", {}));
  const globalStatusStateRef = useRef(loadStored("operation_ai_global_status_state", {}));
  const globalOtChangeStateRef = useRef(loadStored("operation_ai_global_ot_change_state", {}));

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

  useEffect(() => {
    const runReminderChecks = () => processEmailReminders();
    runReminderChecks();
    const timer = setInterval(runReminderChecks, 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, records, notificationConfig]);

  useEffect(() => {
    processGlobalStatusChanges();
    processGlobalOtFieldChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, notificationConfig]);

  const addLog = (message) => {
    setSyncLog((current) => [`[${new Date().toLocaleTimeString("es-CO")}] ${message}`, ...current].slice(0, 80));
  };

  const saveReminderState = () => {
    saveStored("operation_ai_reminder_delivery_state", reminderStateRef.current);
  };

  const saveGlobalStatusState = () => {
    saveStored("operation_ai_global_status_state", globalStatusStateRef.current);
  };

  const saveGlobalOtChangeState = () => {
    saveStored("operation_ai_global_ot_change_state", globalOtChangeStateRef.current);
  };

  const updateNotificationConfig = (updater) => {
    setNotificationConfig((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (shouldPersistLinkedEmailConfig(current, next)) persistLinkedEmailConfig(next, true);
      return next;
    });
  };

  async function processGlobalStatusChanges() {
    if (globalStatusSendInProgressRef.current || !records.length) return;
    const recipients = getConfiguredEmailRecipients(notificationConfig);
    if (!recipients) {
      initializeGlobalStatusBaseline(records);
      return;
    }

    const currentStatuses = buildStatusSnapshot(records);
    const previousStatuses = globalStatusStateRef.current || {};
    const hasPreviousBaseline = Object.keys(previousStatuses).length > 0;

    if (!hasPreviousBaseline) {
      globalStatusStateRef.current = currentStatuses;
      saveGlobalStatusState();
      return;
    }

    const changes = [];
    Object.entries(currentStatuses).forEach(([key, item]) => {
      const previous = previousStatuses[key];
      if (!previous) return;
      if (normalizeText(previous.status) !== normalizeText(item.status)) {
        changes.push({ ...item, previousStatus: previous.status });
      }
    });

    globalStatusStateRef.current = { ...previousStatuses, ...currentStatuses };
    saveGlobalStatusState();
    if (!changes.length) return;

    globalStatusSendInProgressRef.current = true;
    try {
      for (const change of changes) {
        try {
          await sendGmailMessage({
            from: notificationConfig.senderEmail,
            to: recipients,
            subject: `Cambio de estado OT ${change.ot || ""}`.trim(),
            message: buildAutomaticStatusChangeMessage(change),
          }, tokenRef);
          addLog(`Cambio de ESTADO enviado por email: ${change.ot || change.recordLabel}.`);
        } catch (error) {
          addLog(`Error enviando cambio de ESTADO: ${error.message}`);
        }
      }
    } finally {
      globalStatusSendInProgressRef.current = false;
    }
  }

  function initializeGlobalStatusBaseline(currentRecords) {
    const currentStatuses = buildStatusSnapshot(currentRecords);
    if (!Object.keys(globalStatusStateRef.current || {}).length && Object.keys(currentStatuses).length) {
      globalStatusStateRef.current = currentStatuses;
      saveGlobalStatusState();
    }
  }

  async function processGlobalOtFieldChanges() {
    if (globalOtChangeSendInProgressRef.current || !records.length) return;
    const recipients = getConfiguredEmailRecipients(notificationConfig);
    const currentSnapshot = buildOtFieldSnapshot(records);
    if (!recipients) {
      initializeGlobalOtFieldBaseline(currentSnapshot);
      return;
    }

    const previousSnapshot = globalOtChangeStateRef.current || {};
    const hasPreviousBaseline = Object.keys(previousSnapshot).length > 0;
    if (!hasPreviousBaseline) {
      globalOtChangeStateRef.current = currentSnapshot;
      saveGlobalOtChangeState();
      return;
    }

    const changes = collectOtFieldChanges(previousSnapshot, currentSnapshot);
    globalOtChangeStateRef.current = currentSnapshot;
    saveGlobalOtChangeState();
    if (!changes.length) return;

    globalOtChangeSendInProgressRef.current = true;
    try {
      for (const change of changes) {
        try {
          await sendGmailMessage({
            from: notificationConfig.senderEmail,
            to: recipients,
            subject: `Cambio en OT ${change.ot || ""}`.trim(),
            message: buildAutomaticOtFieldChangeMessage(change),
          }, tokenRef);
          addLog(`Cambio en OT enviado por email: ${change.ot || change.recordLabel} / ${change.field}.`);
        } catch (error) {
          addLog(`Error enviando cambio en OT: ${error.message}`);
        }
      }
    } finally {
      globalOtChangeSendInProgressRef.current = false;
    }
  }

  function initializeGlobalOtFieldBaseline(currentSnapshot) {
    if (!Object.keys(globalOtChangeStateRef.current || {}).length && Object.keys(currentSnapshot).length) {
      globalOtChangeStateRef.current = currentSnapshot;
      saveGlobalOtChangeState();
    }
  }

  async function processEmailReminders() {
    if (reminderSendInProgressRef.current || !records.length || !notes.length) return;
    const activeEmailNotes = notes.filter((note) => noteUsesEmail(note) && String(note.recipients || "").trim());
    if (!activeEmailNotes.length) return;

    reminderSendInProgressRef.current = true;
    try {
      const now = new Date();
      for (const note of activeEmailNotes) {
        if (!isReminderWithinActiveWindow(note, now)) continue;
        const record = findRecordForReminder(records, note);
        const currentStatus = getRecordStatus(record);
        if (shouldTrackStatus(note)) {
          await processStatusChangeReminder(note, currentStatus, record, now);
          continue;
        }
        if (shouldSendScheduledReminder(note, now)) {
          await processScheduledReminder(note, record, now);
        }
      }
    } finally {
      reminderSendInProgressRef.current = false;
    }
  }

  async function processScheduledReminder(note, record, now) {
    const deliveryKey = buildScheduledDeliveryKey(note, now);
    if (!deliveryKey || reminderStateRef.current[note.id]?.lastScheduledKey === deliveryKey) return;
    await sendReminderEmail(note, record, "recordatorio_programado");
    reminderStateRef.current[note.id] = {
      ...(reminderStateRef.current[note.id] || {}),
      lastScheduledKey: deliveryKey,
      lastScheduledAt: now.toISOString(),
    };
    saveReminderState();
    addLog(`Recordatorio enviado por email: ${note.title || note.associatedOt || "sin titulo"}.`);
  }

  async function processStatusChangeReminder(note, currentStatus, record, now) {
    const noteState = reminderStateRef.current[note.id] || {};
    if (!currentStatus) return;
    const previousBaseline = noteState.lastObservedStatus || note.initialStatus || "";
    if (!previousBaseline) {
      reminderStateRef.current[note.id] = { ...noteState, lastObservedStatus: currentStatus };
      saveReminderState();
      return;
    }
    if (normalizeText(previousBaseline) === normalizeText(currentStatus)) {
      if (!noteState.lastObservedStatus) {
        reminderStateRef.current[note.id] = { ...noteState, lastObservedStatus: currentStatus };
        saveReminderState();
      }
      return;
    }
    const previousStatus = previousBaseline;
    await sendReminderEmail(note, record, "cambio_estado", { previousStatus, currentStatus });
    reminderStateRef.current[note.id] = {
      ...noteState,
      lastObservedStatus: currentStatus,
      lastStatusEmailAt: now.toISOString(),
    };
    saveReminderState();
    addLog(`Cambio de estado notificado por email: ${note.associatedOt || note.title}.`);
  }

  async function sendReminderEmail(note, record, kind, statusInfo = {}) {
    const subject = kind === "cambio_estado"
      ? `Cambio de estado ${note.associatedOt || ""}`.trim()
      : note.title || notificationConfig.subject || "Recordatorio operacional";
    await sendGmailMessage({
      from: note.senderEmail || notificationConfig.senderEmail,
      to: note.recipients,
      subject,
      message: buildReminderEmailMessage(note, record, kind, statusInfo),
    }, tokenRef);
  }

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
    await syncLinkedEmailConfig(loadedDocuments, allowAuthPrompt);
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

  async function syncLinkedEmailConfig(loadedDocuments, allowAuthPrompt = false) {
    const summaryDocument = findFinancialSummaryDocument(loadedDocuments);
    if (!summaryDocument) {
      addLog("Correos vinculados omitidos: no se encontro HOJA RESUMEN FINANCIERO OTS.");
      return;
    }
    const linkedSheet = summaryDocument.sheets.find((sheet) => normalizeText(sheet.title) === normalizeText(LINKED_EMAILS_SHEET));
    if (!linkedSheet) {
      await persistLinkedEmailConfig(notificationConfig, allowAuthPrompt);
      return;
    }
    const linkedRecord = summaryDocument.records.find((record) => normalizeText(record.sheetName) === normalizeText(LINKED_EMAILS_SHEET));
    if (!linkedRecord) {
      await persistLinkedEmailConfig(notificationConfig, allowAuthPrompt);
      return;
    }
    const nextConfig = buildNotificationConfigFromLinkedEmails(notificationConfig, linkedRecord);
    setNotificationConfig(nextConfig);
    addLog("Correos vinculados cargados desde HOJA RESUMEN FINANCIERO OTS / Correos vinculados.");
  }

  async function persistLinkedEmailConfig(config, allowAuthPrompt = false) {
    const summarySource = sources.find((source) => normalizeText(source.name).includes(normalizeText("Resumen Financiero OTS")));
    const spreadsheetId = extractSpreadsheetId(summarySource?.url);
    if (!spreadsheetId) return;
    try {
      await createSheetWithHeaders(spreadsheetId, LINKED_EMAILS_SHEET, LINKED_EMAILS_HEADERS, tokenRef);
      const { senders, receivers } = buildLinkedEmailColumns(config);
      await updateSheetCell(spreadsheetId, LINKED_EMAILS_SHEET, "A", 2, senders, tokenRef);
      await updateSheetCell(spreadsheetId, LINKED_EMAILS_SHEET, "B", 2, receivers, tokenRef);
      addLog("Correos vinculados actualizados en HOJA RESUMEN FINANCIERO OTS.");
    } catch (error) {
      if (allowAuthPrompt) addLog(`Error guardando Correos vinculados: ${error.message}`);
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
            notificationConfig={notificationConfig}
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
            notificationConfig={notificationConfig}
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
          <Integrations config={notificationConfig} setConfig={updateNotificationConfig} tokenRef={tokenRef} />
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

function noteUsesEmail(note) {
  const channel = normalizeText(note?.channel);
  return channel === "email" || channel === "email y telegram";
}

function getConfiguredEmailRecipients(config) {
  const accounts = Array.isArray(config?.emailAccounts) ? config.emailAccounts : [];
  const receiverEmails = accounts
    .filter((account) => account?.role === "receiver" && account.email)
    .map((account) => account.email.trim())
    .filter(Boolean);
  if (!receiverEmails.length) {
    String(config?.recipients || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((email) => receiverEmails.push(email));
  }
  const senderEmail = getConfiguredSenderEmail(config);
  if (config?.includeSenderAsReceiver && senderEmail) receiverEmails.push(senderEmail);
  return [...new Set(receiverEmails)].join(", ");
}

function getConfiguredSenderEmail(config) {
  const accounts = Array.isArray(config?.emailAccounts) ? config.emailAccounts : [];
  const senderAccount = accounts.find((account) => account?.role === "sender" && account.email);
  return senderAccount?.email?.trim() || String(config?.senderEmail || "").trim();
}

function buildNotificationConfigFromLinkedEmails(currentConfig, record) {
  const senders = parseEmailList(getLinkedEmailCell(record, "CORREOS EMISOR"));
  const receivers = parseEmailList(getLinkedEmailCell(record, "CORREOS RECEPTORES"));
  if (!senders.length && !receivers.length) return currentConfig;
  const senderSet = new Set(senders.map((email) => email.toLowerCase()));
  const includeSenderAsReceiver = receivers.some((email) => senderSet.has(email.toLowerCase()));
  return {
    ...currentConfig,
    senderEmail: senders[0] || currentConfig.senderEmail || "",
    recipients: receivers.join(", "),
    includeSenderAsReceiver,
    emailAccounts: [
      ...senders.map((email) => ({ email, role: "sender" })),
      ...receivers
        .filter((email) => !senderSet.has(email.toLowerCase()))
        .map((email) => ({ email, role: "receiver" })),
    ],
  };
}

function buildLinkedEmailColumns(config) {
  const accounts = Array.isArray(config?.emailAccounts) ? config.emailAccounts : [];
  const senders = accounts
    .filter((account) => account?.role === "sender" && account.email)
    .map((account) => account.email.trim())
    .filter(Boolean);
  if (!senders.length && config?.senderEmail) senders.push(String(config.senderEmail).trim());

  const receivers = accounts
    .filter((account) => account?.role === "receiver" && account.email)
    .map((account) => account.email.trim())
    .filter(Boolean);
  if (!receivers.length) receivers.push(...parseEmailList(config?.recipients));
  if (config?.includeSenderAsReceiver) receivers.push(...senders);

  return {
    senders: uniqueEmails(senders).join(", "),
    receivers: uniqueEmails(receivers).join(", "),
  };
}

function shouldPersistLinkedEmailConfig(previousConfig, nextConfig) {
  const previousColumns = buildLinkedEmailColumns(previousConfig);
  const nextColumns = buildLinkedEmailColumns(nextConfig);
  return previousColumns.senders !== nextColumns.senders || previousColumns.receivers !== nextColumns.receivers;
}

function getLinkedEmailCell(record, header) {
  const currentHeader = record?.headers?.find((item) => normalizeText(item) === normalizeText(header));
  return currentHeader ? record.cells?.[currentHeader] : "";
}

function parseEmailList(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueEmails(emails) {
  const seen = new Set();
  return emails.filter((email) => {
    const key = email.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildStatusSnapshot(records) {
  return records.reduce((snapshot, record) => {
    const status = getRecordStatus(record);
    if (!status) return snapshot;
    const key = getRecordStatusKey(record);
    snapshot[key] = {
      status,
      ot: getRecordOtFromRecord(record),
      recordLabel: `${record.sourceName} / ${record.sheetName} / fila ${record.rowNumber}`,
    };
    return snapshot;
  }, {});
}

function buildOtFieldSnapshot(records) {
  return records.reduce((snapshot, record) => {
    const ot = getRecordOtFromRecord(record);
    if (!ot) return snapshot;
    const key = getRecordStatusKey(record);
    snapshot[key] = {
      ot,
      sourceName: record.sourceName || "",
      sheetName: record.sheetName || "",
      rowNumber: record.rowNumber || "",
      recordLabel: `${record.sourceName} / ${record.sheetName} / fila ${record.rowNumber}`,
      userResponsible: getRecordResponsibleUser(record),
      fields: buildComparableRecordFields(record),
    };
    return snapshot;
  }, {});
}

function buildComparableRecordFields(record) {
  return (record.headers || []).reduce((fields, header) => {
    if (normalizeText(header) === "estado") return fields;
    fields[header] = normalizeComparableValue(record.cells?.[header]);
    return fields;
  }, {});
}

function collectOtFieldChanges(previousSnapshot, currentSnapshot) {
  const changes = [];
  Object.entries(currentSnapshot).forEach(([recordKey, current]) => {
    const previous = previousSnapshot[recordKey];
    if (!previous) return;
    if (normalizeOtForReminder(previous.ot) !== normalizeOtForReminder(current.ot)) return;
    Object.entries(current.fields || {}).forEach(([field, newValue]) => {
      const previousFields = previous.fields || {};
      if (!Object.prototype.hasOwnProperty.call(previousFields, field)) return;
      const previousValue = previousFields[field];
      if (normalizeComparableValue(previousValue) === normalizeComparableValue(newValue)) return;
      changes.push({
        ot: current.ot,
        documentName: current.sourceName,
        sheetName: current.sheetName,
        field,
        previousValue,
        newValue,
        changedAt: new Date().toLocaleString("es-CO"),
        userResponsible: current.userResponsible || "NO DISPONIBLE",
        recordLabel: current.recordLabel,
      });
    });
  });
  return changes;
}

function getRecordStatusKey(record) {
  return `${record.sourceId}:${record.sheetName}:${record.rowNumber}`;
}

function shouldTrackStatus(note) {
  return normalizeText(note?.frequency) === "por cambio de estado" || normalizeText(note?.trigger) === "cambio de estado";
}

function shouldSendScheduledReminder(note, now) {
  const frequency = normalizeText(note?.frequency);
  if (!isNoonWindow(now)) return false;
  if (frequency === "diario") return true;
  if (frequency === "semanal") return now.getDay() === 5;
  if (frequency === "mensual") return now.getDate() === scheduledDayOfMonth(note, now);
  if (frequency === "fecha especifica") return isSameDate(note.date, now);
  return false;
}

function isReminderWithinActiveWindow(note, now) {
  const start = parseDateOnly(note?.startDate);
  if (start && start.getTime() > startOfDay(now).getTime()) return false;
  const end = parseDateOnly(note?.endDate);
  if (end && end.getTime() < startOfDay(now).getTime()) return false;
  return true;
}

function parseDateOnly(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function startOfDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function scheduledDayOfMonth(note, now) {
  const sourceDate = parseDateOnly(note?.date) || parseDateOnly(note?.startDate);
  const requestedDay = sourceDate?.getDate() || 1;
  return Math.min(requestedDay, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
}

function isNoonWindow(date) {
  return date.getHours() === 12;
}

function isSameDate(value, date) {
  if (!value) return false;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return false;
  return target.getFullYear() === date.getFullYear() &&
    target.getMonth() === date.getMonth() &&
    target.getDate() === date.getDate() &&
    date.getHours() === 12;
}

function buildScheduledDeliveryKey(note, date) {
  const frequency = normalizeText(note?.frequency);
  if (frequency === "diario") return `${note.id}:daily:${dateKey(date)}`;
  if (frequency === "semanal" && date.getDay() === 5) return `${note.id}:weekly:${weekKey(date)}`;
  if (frequency === "mensual" && date.getDate() === scheduledDayOfMonth(note, date)) return `${note.id}:monthly:${date.getFullYear()}-${date.getMonth() + 1}`;
  if (frequency === "fecha especifica" && isSameDate(note.date, date)) return `${note.id}:once:${dateKey(date)}`;
  return "";
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function weekKey(date) {
  const firstDay = new Date(date.getFullYear(), 0, 1);
  const dayOffset = Math.floor((date - firstDay) / 86400000);
  return `${date.getFullYear()}-${Math.ceil((dayOffset + firstDay.getDay() + 1) / 7)}`;
}

function findRecordForReminder(records, note) {
  const targetOt = normalizeOtForReminder(note?.associatedOt);
  if (!targetOt) return null;
  return records.find((record) => normalizeOtForReminder(getRecordOtFromRecord(record)) === targetOt) || null;
}

function getRecordOtFromRecord(record) {
  if (!record) return "";
  const otHeader = record.headers?.find((header) => normalizeText(header) === "ot");
  return String(record.cells?.[otHeader] || record.normalized?.work_order || "").trim();
}

function getRecordStatus(record) {
  if (!record) return "";
  const statusHeader = record.headers?.find((header) => normalizeText(header) === "estado");
  return String(record.cells?.[statusHeader] || record.normalized?.status || "").trim();
}

function getRecordResponsibleUser(record) {
  if (!record) return "";
  return getRecordCellByAliases(record, [
    "USUARIO RESPONSABLE",
    "RESPONSABLE",
    "EDITADO POR",
    "MODIFICADO POR",
    "DIRECCIÓN DE CORREO ELECTRÓNICO",
    "DIRECCION DE CORREO ELECTRONICO",
    "CORREO ELECTRONICO",
    "EMAIL",
  ]);
}

function getRecordCellByAliases(record, aliases) {
  for (const alias of aliases) {
    const header = record.headers?.find((item) => normalizeText(item) === normalizeText(alias));
    const value = header ? String(record.cells?.[header] || "").trim() : "";
    if (value) return value;
  }
  return "";
}

function normalizeComparableValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeOtForReminder(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:OT\s*[-:]?\s*)?(\d+)/i);
  return match ? String(Number(match[1])) : normalizeText(text);
}

function buildReminderEmailMessage(note, record, kind, statusInfo = {}) {
  if (kind === "cambio_estado") {
    return [
      "Notificacion de cambio de estado",
      "",
      `OT: ${note.associatedOt || "NO ESPECIFICADO"}`,
      `Estado anterior: ${statusInfo.previousStatus || "NO ESPECIFICADO"}`,
      `Estado nuevo: ${statusInfo.currentStatus || "NO ESPECIFICADO"}`,
      "",
      `Titulo: ${note.title || "NO ESPECIFICADO"}`,
      `Detalle: ${note.detail || "Sin detalle"}`,
      record ? `Registro: ${record.sourceName} / ${record.sheetName} / fila ${record.rowNumber}` : "",
    ].filter(Boolean).join("\n");
  }
  return [
    "Recordatorio operacional",
    "",
    `OT: ${note.associatedOt || "NO ESPECIFICADO"}`,
    `Titulo: ${note.title || "NO ESPECIFICADO"}`,
    `Detalle: ${note.detail || "Sin detalle"}`,
    `Frecuencia: ${note.frequency || "NO ESPECIFICADO"}`,
    note.startDate ? `Fecha inicio: ${note.startDate}` : "",
    note.endDate ? `Fecha finalizacion: ${note.endDate}` : "",
    record ? `Estado actual: ${getRecordStatus(record) || "NO ESPECIFICADO"}` : "",
    record ? `Registro: ${record.sourceName} / ${record.sheetName} / fila ${record.rowNumber}` : "",
  ].filter(Boolean).join("\n");
}

function buildAutomaticStatusChangeMessage(change) {
  return [
    "Notificacion automatica de cambio de estado",
    "",
    `OT: ${change.ot || "NO ESPECIFICADO"}`,
    `Estado anterior: ${change.previousStatus || "NO ESPECIFICADO"}`,
    `Estado nuevo: ${change.status || "NO ESPECIFICADO"}`,
    `Registro: ${change.recordLabel || "NO ESPECIFICADO"}`,
  ].join("\n");
}

function buildAutomaticOtFieldChangeMessage(change) {
  return [
    "Notificacion automatica de cambio en OT",
    "",
    `OT: ${change.ot || "NO ESPECIFICADO"}`,
    "",
    `Documento: ${change.documentName || "NO ESPECIFICADO"}`,
    `Hoja: ${change.sheetName || "NO ESPECIFICADO"}`,
    "",
    `Campo modificado: ${change.field || "NO ESPECIFICADO"}`,
    `Valor anterior: ${formatChangeValue(change.previousValue)}`,
    `Valor nuevo: ${formatChangeValue(change.newValue)}`,
    "",
    `Fecha del cambio: ${change.changedAt || "NO ESPECIFICADO"}`,
    `Usuario responsable: ${change.userResponsible || "NO DISPONIBLE"}`,
    change.recordLabel ? `Registro: ${change.recordLabel}` : "",
  ].filter(Boolean).join("\n");
}

function formatChangeValue(value) {
  const text = String(value ?? "").trim();
  return text || "VACIO";
}

export default App;
