import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
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
  appendSheetRow,
  clearGoogleSession,
  createSheetWithHeaders,
  fetchSheetValues,
  getStoredGoogleToken,
  loadSpreadsheet,
  sendGmailMessage,
  shouldForceAccountSelect,
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
import { useDebouncedValue } from "./hooks/useDebouncedValue.js";

const Dashboard = lazy(() => import("./views/Dashboard.jsx").then((module) => ({ default: module.Dashboard })));
const Records = lazy(() => import("./views/Records.jsx").then((module) => ({ default: module.Records })));
const Relations = lazy(() => import("./views/Relations.jsx").then((module) => ({ default: module.Relations })));
const Equipment = lazy(() => import("./views/Equipment.jsx").then((module) => ({ default: module.Equipment })));
const Automation = lazy(() => import("./views/Automation.jsx").then((module) => ({ default: module.Automation })));
const Reminders = lazy(() => import("./views/Reminders.jsx").then((module) => ({ default: module.Reminders })));
const Reports = lazy(() => import("./views/Reports.jsx").then((module) => ({ default: module.Reports })));
const Integrations = lazy(() => import("./views/Integrations.jsx").then((module) => ({ default: module.Integrations })));
const Assistant = lazy(() => import("./views/Assistant.jsx").then((module) => ({ default: module.Assistant })));
const Settings = lazy(() => import("./views/Settings.jsx").then((module) => ({ default: module.Settings })));

const LINKED_EMAILS_SHEET = "Correos vinculados";
const LINKED_EMAILS_HEADERS = ["CORREOS EMISOR", "CORREOS RECEPTORES"];
const CHANGES_SHEET = "Cambios";
const CHANGES_HEADERS = [
  "documento",
  "Hoja",
  "donde se hizo el cambio",
  "cambio anterio",
  "cambio actual",
  "descripcion del fallo",
  "comentario",
  "enviado",
];
const CHANGE_DIGEST_THRESHOLD = 5;
const MAX_EMAIL_FIELD_VALUE_LENGTH = 500;
const MAX_TRACKED_CHANGE_VALUE_LENGTH = 80;
const MAX_TRACKED_FIELDS_PER_RECORD = 12;
const MAX_PERSISTED_OT_CHANGE_STATE_CHARS = 600000;
const EMAIL_SECTION_SEPARATOR = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
const GLOBAL_OT_CHANGE_STATE_KEY = "operation_ai_global_ot_change_state_v2";
const LEGACY_GLOBAL_OT_CHANGE_STATE_KEY = "operation_ai_global_ot_change_state";
const WORK_ORDER_SOURCE_KEYWORD = "ORDENES DE TRABAJO TYC";
const WORK_ORDER_FORM_SHEET_KEYWORD = "respuestas de formulario 1";
const WORK_ORDER_DESCRIPTION_ALIASES = [
  "DESCRIPCIÓN GENERAL DEL FALLO O DE LA SOLICITUD",
  "DESCRIPCION GENERAL DEL FALLO O DE LA SOLICITUD",
  "DESCRIPCIÓN GENERAL DEL FALLO O DE LA SOLICTUD",
  "DESCRIPCION GENERAL DEL FALLO O DE LA SOLICTUD",
  "DESCRIPCIÓN GENERAL DEL FALLO",
  "DESCRIPCION GENERAL DEL FALLO",
  "DESCRIPCIÓN DE LA SOLICITUD",
  "DESCRIPCION DE LA SOLICITUD",
];
const WORK_ORDER_COMMENT_ALIASES = [
  "COMENTARIOS",
  "COMENTARIO",
  "OBSERVACIONES",
  "OBSERVACIÓN",
  "OBSERVACION",
];
const TRACKED_CHANGE_FIELD_KEYWORDS = [
  "ot",
  "sp",
  "orden",
  "compra",
  "valor",
  "costo",
  "total",
  "proveedor",
  "fecha",
  "equipo",
  "actividad",
  "descripcion",
  "fallo",
  "comentario",
  "area",
  "solicita",
  "responsable",
  "colaborador",
  "tecnico",
  "facturacion",
  "repuesto",
  "entrega",
];

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
  const globalOtChangeStateRef = useRef(loadStored(GLOBAL_OT_CHANGE_STATE_KEY, {}));
  const debouncedSearch = useDebouncedValue(search);
  const debouncedEquipmentSearch = useDebouncedValue(equipmentSearch);

  const filteredRecords = useMemo(() => {
    const query = normalizeText(debouncedSearch);
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
  }, [records, debouncedSearch, filters]);

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
    cleanupLegacyOtChangeState();
  }, []);

  useEffect(() => {
    if (shouldForceAccountSelect()) {
      setSyncStatus("Selecciona cuenta Google para sincronizar");
      return;
    }
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
    const serialized = JSON.stringify(globalOtChangeStateRef.current || {});
    if (serialized.length > MAX_PERSISTED_OT_CHANGE_STATE_CHARS) {
      clearStoredValue(GLOBAL_OT_CHANGE_STATE_KEY);
      addLog("Monitoreo OT activo solo en memoria: el estado supera el limite seguro del navegador.");
      return;
    }
    saveStored(GLOBAL_OT_CHANGE_STATE_KEY, globalOtChangeStateRef.current);
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
    const currentStatuses = buildStatusSnapshot(records);
    const previousStatuses = globalStatusStateRef.current || {};
    const hasPreviousBaseline = Object.keys(previousStatuses).length > 0;

    if (!hasPreviousBaseline) {
      globalStatusStateRef.current = stripSnapshotEmailColumns(currentStatuses);
      saveGlobalStatusState();
      return;
    }

    const changes = [];
    Object.entries(currentStatuses).forEach(([key, item]) => {
      const previous = previousStatuses[key];
      if (!previous) return;
      if (normalizeText(previous.status) !== normalizeText(item.status)) {
        changes.push({ ...item, previousStatus: previous.status, changedAt: new Date().toLocaleString("es-CO") });
      }
    });

    globalStatusStateRef.current = stripSnapshotEmailColumns({ ...previousStatuses, ...currentStatuses });
    saveGlobalStatusState();
    if (!changes.length) return;

    globalStatusSendInProgressRef.current = true;
    try {
      const enrichedChanges = enrichChangesForChangeEmail(changes, records);
      const changeRows = enrichedChanges.map(mapStatusChangeToSheetRow);
      const pending = await prepareDetectedChanges(changeRows);
      if (!pending.spreadsheetId || !pending.pendingRows.length) return;
      const pendingChanges = pending.pendingIndexes.map((index) => enrichedChanges[index]);
      const recipients = getConfiguredEmailRecipients(notificationConfig);
      let sentIndexes = new Set();
      if (recipients) {
        sentIndexes = await sendChangeNotifications({
          changes: pendingChanges,
          recipients,
          getSubject: (change) => `Cambio de estado OT ${change.ot || ""}`.trim(),
          getMessage: buildAutomaticStatusChangeMessage,
          digestSubject: `Resumen de cambios de estado (${pendingChanges.length})`,
          digestTitle: "Resumen automatico de cambios de estado",
          logLabel: "Cambio de ESTADO",
        });
      } else {
        addLog(`Cambios de ESTADO detectados sin correo configurado: ${pendingChanges.length}.`);
      }
      await persistDetectedChanges(pending.spreadsheetId, markRowsAsSent(pending.pendingRows, sentIndexes));
    } finally {
      globalStatusSendInProgressRef.current = false;
    }
  }

  async function processGlobalOtFieldChanges() {
    if (globalOtChangeSendInProgressRef.current || !records.length) return;
    const currentSnapshot = buildOtFieldSnapshot(records);

    const previousSnapshot = globalOtChangeStateRef.current || {};
    const hasPreviousBaseline = Object.keys(previousSnapshot).length > 0;
    if (!hasPreviousBaseline) {
      globalOtChangeStateRef.current = stripSnapshotEmailColumns(currentSnapshot);
      saveGlobalOtChangeState();
      return;
    }

    const changes = collectOtFieldChanges(previousSnapshot, currentSnapshot);
    globalOtChangeStateRef.current = stripSnapshotEmailColumns(currentSnapshot);
    saveGlobalOtChangeState();
    if (!changes.length) return;

    globalOtChangeSendInProgressRef.current = true;
    try {
      const enrichedChanges = enrichChangesForChangeEmail(changes, records);
      const changeRows = enrichedChanges.map(mapOtFieldChangeToSheetRow);
      const pending = await prepareDetectedChanges(changeRows);
      if (!pending.spreadsheetId || !pending.pendingRows.length) return;
      const pendingChanges = pending.pendingIndexes.map((index) => enrichedChanges[index]);
      const recipients = getConfiguredEmailRecipients(notificationConfig);
      let sentIndexes = new Set();
      if (recipients) {
        sentIndexes = await sendChangeNotifications({
          changes: pendingChanges,
          recipients,
          getSubject: (change) => `Cambio en OT ${change.ot || ""}`.trim(),
          getMessage: buildAutomaticOtFieldChangeMessage,
          digestSubject: `Resumen de cambios en OT (${pendingChanges.length})`,
          digestTitle: "Resumen automatico de cambios en OT",
          logLabel: "Cambio en OT",
        });
      } else {
        addLog(`Cambios en OT detectados sin correo configurado: ${pendingChanges.length}.`);
      }
      await persistDetectedChanges(pending.spreadsheetId, markRowsAsSent(pending.pendingRows, sentIndexes));
    } finally {
      globalOtChangeSendInProgressRef.current = false;
    }
  }

  async function sendChangeNotifications({
    changes,
    recipients,
    getSubject,
    getMessage,
    digestSubject,
    digestTitle,
    logLabel,
  }) {
    const sentIndexes = new Set();
    if (changes.length > CHANGE_DIGEST_THRESHOLD) {
      try {
        await sendGmailMessage({
          from: notificationConfig.senderEmail,
          to: recipients,
          subject: digestSubject,
          message: buildChangeDigestMessage(digestTitle, changes, getMessage),
        }, tokenRef);
        addLog(`${logLabel}: resumen consolidado enviado por email con ${changes.length} cambios.`);
        changes.forEach((_, index) => sentIndexes.add(index));
      } catch (error) {
        addLog(`Error enviando resumen de ${logLabel}: ${error.message}`);
      }
      return sentIndexes;
    }

    for (const [index, change] of changes.entries()) {
      try {
        await sendGmailMessage({
          from: notificationConfig.senderEmail,
          to: recipients,
          subject: getSubject(change),
          message: getMessage(change),
        }, tokenRef);
        addLog(`${logLabel} enviado por email: ${change.ot || change.recordLabel}.`);
        sentIndexes.add(index);
      } catch (error) {
        addLog(`Error enviando ${logLabel}: ${error.message}`);
      }
    }
    return sentIndexes;
  }

  async function prepareDetectedChanges(rows) {
    if (!rows.length) return;
    const summarySource = sources.find((source) => normalizeText(source.name).includes(normalizeText("Resumen Financiero OTS")));
    const spreadsheetId = extractSpreadsheetId(summarySource?.url);
    if (!spreadsheetId) {
      addLog("Registro de cambios omitido: no se encontro HOJA RESUMEN FINANCIERO OTS.");
      return { spreadsheetId: "", pendingRows: [], pendingIndexes: [] };
    }

    try {
      await createSheetWithHeaders(spreadsheetId, CHANGES_SHEET, CHANGES_HEADERS, tokenRef);
      const existingRows = await fetchSheetValues(spreadsheetId, CHANGES_SHEET, tokenRef);
      const sentChangeKeys = buildSentChangeKeys(existingRows);
      const pendingRows = [];
      const pendingIndexes = [];
      rows.forEach((row, index) => {
        if (sentChangeKeys.has(buildChangeRowKey(row))) return;
        pendingRows.push(row);
        pendingIndexes.push(index);
      });
      const skipped = rows.length - pendingRows.length;
      if (skipped > 0) {
        addLog(`Cambios omitidos por ${CHANGES_SHEET}/enviado=si: ${skipped}.`);
      }
      return { spreadsheetId, pendingRows, pendingIndexes };
    } catch (error) {
      addLog(`Error revisando ${CHANGES_SHEET}: ${error.message}`);
      return { spreadsheetId, pendingRows: rows, pendingIndexes: rows.map((_, index) => index) };
    }
  }

  async function persistDetectedChanges(spreadsheetId, rows) {
    if (!spreadsheetId || !rows.length) return;
    try {
      await createSheetWithHeaders(spreadsheetId, CHANGES_SHEET, CHANGES_HEADERS, tokenRef);
      for (const row of rows) {
        await appendSheetRow(spreadsheetId, CHANGES_SHEET, CHANGES_HEADERS, row, tokenRef);
      }
      addLog(`Cambios registrados en HOJA RESUMEN FINANCIERO OTS / ${CHANGES_SHEET}: ${rows.length}.`);
    } catch (error) {
      addLog(`Error registrando cambios en ${CHANGES_SHEET}: ${error.message}`);
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
    const startedAt = nowMs();
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
    await yieldToBrowser();
    const nextRelations = detectRelations(nextRecords);
    await yieldToBrowser();
    await syncLinkedEmailConfig(loadedDocuments, allowAuthPrompt);
    await yieldToBrowser();
    await syncFinancialSummary(loadedDocuments, allowAuthPrompt);
    await yieldToBrowser();
    const nextAlerts = detectAnomalies(nextRecords, nextRelations);
    setDocuments(loadedDocuments);
    setRecords(nextRecords);
    setRelations(nextRelations);
    setAlerts(nextAlerts);
    setSyncStatus(`${successCount ? "Actualizado" : "Datos conservados"} ${new Date().toLocaleTimeString("es-CO")}`);
    addLog(`Rendimiento: sincronizacion completada en ${formatDuration(startedAt)}.`);
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
    const startedAt = nowMs();
    setAlerts(detectAnomalies(records, relations));
    addLog(`Analisis local completado en ${formatDuration(startedAt)}.`);
  };

  const chooseGoogleAccountAndSync = () => {
    clearGoogleSession(tokenRef);
    setSyncStatus("Selecciona cuenta Google para sincronizar");
    addLog("Sesion Google cerrada. El selector de cuentas se abrira para elegir otra cuenta.");
    syncAll(sources, true);
  };

  const closeGoogleAccountSession = () => {
    clearGoogleSession(tokenRef);
    setSyncStatus("Sesion Google cerrada manualmente");
    addLog("Sesion Google cerrada manualmente. Pulsa Sincronizar para iniciar sesion nuevamente.");
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
          <button className="secondary-button" onClick={chooseGoogleAccountAndSync} type="button">
            Cambiar cuenta Google
          </button>
          <button className="secondary-button" onClick={closeGoogleAccountSession} type="button">
            Cerrar sesion Google
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

        <Suspense fallback={<section className="panel"><p className="muted">Cargando vista...</p></section>}>
          {activeView === "dashboard" && (
            <Dashboard
              documents={documents}
              records={filteredRecords}
              sourceRecords={records}
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
              debouncedEquipmentSearch={debouncedEquipmentSearch}
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
        </Suspense>
      </main>
    </div>
  );
}

function noteUsesEmail(note) {
  const channel = normalizeText(note?.channel);
  return channel === "email" || channel === "email y telegram";
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function formatDuration(startedAt) {
  const elapsed = Math.max(0, Math.round(nowMs() - startedAt));
  return elapsed >= 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${elapsed}ms`;
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
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

function cleanupLegacyOtChangeState() {
  try {
    localStorage.removeItem(LEGACY_GLOBAL_OT_CHANGE_STATE_KEY);
  } catch {
    // Ignore cleanup errors; the compact v2 key is used from now on.
  }
}

function clearStoredValue(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore cleanup errors; the in-memory state remains available for this session.
  }
}

function buildStatusSnapshot(records) {
  return records.reduce((snapshot, record) => {
    const status = getRecordStatus(record);
    if (!status) return snapshot;
    const key = getRecordStatusKey(record);
    snapshot[key] = {
      status,
      ot: getRecordOtFromRecord(record),
      sourceName: record.sourceName || "",
      sheetName: record.sheetName || "",
      rowNumber: record.rowNumber || "",
      recordLabel: `${record.sourceName} / ${record.sheetName} / fila ${record.rowNumber}`,
      userResponsible: getRecordResponsibleUser(record),
      allColumns: buildEmailRecordColumns(record),
    };
    return snapshot;
  }, {});
}

function buildOtFieldSnapshot(records) {
  return records.reduce((snapshot, record) => {
    const ot = getRecordOtFromRecord(record);
    if (!ot) return snapshot;
    const key = getCompactRecordKey(record);
    snapshot[key] = {
      ot,
      sourceName: record.sourceName || "",
      sheetName: record.sheetName || "",
      rowNumber: record.rowNumber || "",
      recordLabel: `${record.sourceName} / ${record.sheetName} / fila ${record.rowNumber}`,
      userResponsible: getRecordResponsibleUser(record),
      fields: buildComparableRecordFields(record),
      allColumns: buildEmailRecordColumns(record),
    };
    return snapshot;
  }, {});
}

function buildComparableRecordFields(record) {
  return (record.headers || []).filter(isTrackedChangeField).slice(0, MAX_TRACKED_FIELDS_PER_RECORD).reduce((fields, header) => {
    if (normalizeText(header) === "estado") return fields;
    const value = normalizeComparableValue(record.cells?.[header]);
    if (value) fields[header] = value;
    return fields;
  }, {});
}

function collectOtFieldChanges(previousSnapshot, currentSnapshot) {
  const changes = [];
  Object.entries(currentSnapshot).forEach(([recordKey, current]) => {
    const previous = previousSnapshot[recordKey];
    if (!previous) return;
    if (normalizeOtForReminder(previous.ot) !== normalizeOtForReminder(current.ot)) return;
    const currentFields = current.fields || {};
    const previousFields = previous.fields || {};
    const fields = new Set([...Object.keys(previousFields), ...Object.keys(currentFields)]);
    fields.forEach((field) => {
      const newValue = currentFields[field] || "";
      const previousValue = previousFields[field];
      if (normalizeComparableValue(previousValue) === normalizeComparableValue(newValue)) return;
      changes.push({
        ot: current.ot,
        documentName: current.sourceName,
        sheetName: current.sheetName,
        rowNumber: current.rowNumber,
        field,
        previousValue,
        newValue,
        changedAt: new Date().toLocaleString("es-CO"),
        userResponsible: current.userResponsible || "NO DISPONIBLE",
        recordLabel: current.recordLabel,
        allColumns: current.allColumns || [],
      });
    });
  });
  return changes;
}

function stripSnapshotEmailColumns(snapshot) {
  return Object.entries(snapshot || {}).reduce((cleanSnapshot, [key, value]) => {
    const { allColumns: _allColumns, ...compactValue } = value || {};
    cleanSnapshot[key] = compactValue;
    return cleanSnapshot;
  }, {});
}

function getRecordStatusKey(record) {
  return `${record.sourceId}:${record.sheetName}:${record.rowNumber}`;
}

function getCompactRecordKey(record) {
  return [
    shortId(record.sourceId),
    normalizeText(record.sheetName).replace(/\s+/g, "_").slice(0, 36),
    record.rowNumber,
  ].filter(Boolean).join(":");
}

function shortId(value) {
  return String(value || "").slice(-10);
}

function isTrackedChangeField(header) {
  const normalized = normalizeText(header);
  if (!normalized || normalized === "estado") return false;
  return TRACKED_CHANGE_FIELD_KEYWORDS.some((keyword) => normalized.includes(keyword));
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

function buildEmailRecordColumns(record) {
  return (record?.headers || []).map((header) => ({
    header,
    value: compactEmailFieldValue(record.cells?.[header]),
  }));
}

function compactEmailFieldValue(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "VACIO";
  return text.length > MAX_EMAIL_FIELD_VALUE_LENGTH
    ? `${text.slice(0, MAX_EMAIL_FIELD_VALUE_LENGTH - 3)}...`
    : text;
}

function normalizeComparableValue(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > MAX_TRACKED_CHANGE_VALUE_LENGTH
    ? `${text.slice(0, MAX_TRACKED_CHANGE_VALUE_LENGTH - 3)}...`
    : text;
}

function normalizeOtForReminder(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:OT\s*[-:]?\s*)?(\d+)/i);
  return match ? String(Number(match[1])) : normalizeText(text);
}

function buildReminderEmailMessage(note, record, kind, statusInfo = {}) {
  if (kind === "cambio_estado") {
    const previousValue = formatChangeValue(statusInfo.previousStatus);
    const nextValue = formatChangeValue(statusInfo.currentStatus);
    return [
      "REGISTRO DE MODIFICACION",
      "",
      `OT: ${note.associatedOt || "NO ESPECIFICADO"}`,
      record ? `Documento: ${record.sourceName || "NO ESPECIFICADO"}` : "",
      record ? `Hoja: ${record.sheetName || "NO ESPECIFICADO"}` : "",
      "",
      EMAIL_SECTION_SEPARATOR,
      "",
      "CAMBIO REALIZADO",
      "",
      "Campo: ESTADO",
      "",
      `Valor anterior: ${previousValue}`,
      `Valor nuevo: ${nextValue}`,
      "",
      EMAIL_SECTION_SEPARATOR,
      "",
      "TRAZABILIDAD",
      "",
      `Fecha: ${new Date().toLocaleString("es-CO")}`,
      record ? `Usuario: ${getRecordResponsibleUser(record) || "NO DISPONIBLE"}` : "Usuario: NO DISPONIBLE",
      `Titulo: ${note.title || "NO ESPECIFICADO"}`,
      `Detalle: ${note.detail || "Sin detalle"}`,
      record ? `Registro: ${formatRecordTrace(record)}` : "",
      "",
      EMAIL_SECTION_SEPARATOR,
      "",
      "RESUMEN",
      "",
      buildChangeSummary("ESTADO", previousValue, nextValue),
      "Estado: Actualizado correctamente.",
      "",
      buildAllColumnsMessage(buildEmailRecordColumns(record)),
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
  const previousValue = formatChangeValue(change.previousStatus);
  const nextValue = formatChangeValue(change.status);
  return [
    "REGISTRO DE MODIFICACION",
    "",
    `OT: ${change.ot || "NO ESPECIFICADO"}`,
    `Documento: ${change.sourceName || extractDocumentFromRecordLabel(change.recordLabel) || "NO ESPECIFICADO"}`,
    `Hoja: ${change.sheetName || extractSheetFromRecordLabel(change.recordLabel) || "NO ESPECIFICADO"}`,
    "",
    EMAIL_SECTION_SEPARATOR,
    "",
    "CAMBIO REALIZADO",
    "",
    "Campo: ESTADO",
    "",
    `Valor anterior: ${previousValue}`,
    `Valor nuevo: ${nextValue}`,
    "",
    change.workOrderDescription ? `Descripcion del fallo:\n${change.workOrderDescription}` : "",
    change.workOrderComment ? `Comentario:\n${change.workOrderComment}` : "",
    "",
    EMAIL_SECTION_SEPARATOR,
    "",
    "TRAZABILIDAD",
    "",
    `Fecha: ${change.changedAt || new Date().toLocaleString("es-CO")}`,
    `Usuario: ${change.userResponsible || "NO DISPONIBLE"}`,
    `Registro: ${formatChangeRecordTrace(change)}`,
    "",
    EMAIL_SECTION_SEPARATOR,
    "",
    "RESUMEN",
    "",
    buildChangeSummary("ESTADO", previousValue, nextValue),
    "Estado: Actualizado correctamente.",
    "",
    buildAllColumnsMessage(change.allColumns),
  ].filter(Boolean).join("\n");
}

function buildAutomaticOtFieldChangeMessage(change) {
  const previousValue = formatChangeValue(change.previousValue);
  const nextValue = formatChangeValue(change.newValue);
  const field = change.field || "NO ESPECIFICADO";
  return [
    "REGISTRO DE MODIFICACION",
    "",
    `OT: ${change.ot || "NO ESPECIFICADO"}`,
    `Documento: ${change.documentName || "NO ESPECIFICADO"}`,
    `Hoja: ${change.sheetName || "NO ESPECIFICADO"}`,
    "",
    EMAIL_SECTION_SEPARATOR,
    "",
    "CAMBIO REALIZADO",
    "",
    `Campo: ${field}`,
    "",
    `Valor anterior: ${previousValue}`,
    `Valor nuevo: ${nextValue}`,
    "",
    change.workOrderDescription ? `Descripcion del fallo:\n${change.workOrderDescription}` : "",
    change.workOrderComment ? `Comentario:\n${change.workOrderComment}` : "",
    "",
    EMAIL_SECTION_SEPARATOR,
    "",
    "TRAZABILIDAD",
    "",
    `Fecha del cambio: ${change.changedAt || "NO ESPECIFICADO"}`,
    `Usuario: ${change.userResponsible || "NO DISPONIBLE"}`,
    `Registro: ${formatChangeRecordTrace(change)}`,
    "",
    EMAIL_SECTION_SEPARATOR,
    "",
    "RESUMEN",
    "",
    buildChangeSummary(field, previousValue, nextValue),
    "Estado: Actualizado correctamente.",
    "",
    buildAllColumnsMessage(change.allColumns),
  ].filter(Boolean).join("\n");
}

function buildChangeDigestMessage(title, changes, getMessage) {
  return [
    title.toUpperCase(),
    "",
    `Total de cambios detectados: ${changes.length}`,
    "",
    ...changes.flatMap((change, index) => [
      EMAIL_SECTION_SEPARATOR,
      `CAMBIO ${index + 1}`,
      EMAIL_SECTION_SEPARATOR,
      "",
      getMessage(change),
      "",
    ]),
  ].join("\n");
}

function buildAllColumnsMessage(columns) {
  if (!columns?.length) return "";
  return [
    EMAIL_SECTION_SEPARATOR,
    "",
    "TODAS LAS COLUMNAS DEL REGISTRO",
    "",
    ...columns.map((column) => `${column.header}: ${column.value}`),
  ].join("\n");
}

function buildChangeSummary(field, previousValue, nextValue) {
  return `Se actualizo el campo "${field}", cambiando el valor de "${previousValue}" a "${nextValue}".`;
}

function formatRecordTrace(record) {
  return [
    record?.sourceName || "NO ESPECIFICADO",
    record?.sheetName || "NO ESPECIFICADO",
    record?.rowNumber ? `Fila ${record.rowNumber}` : "",
  ].filter(Boolean).join(" -> ");
}

function formatChangeRecordTrace(change) {
  const documentName = change.sourceName || change.documentName || extractDocumentFromRecordLabel(change.recordLabel) || "NO ESPECIFICADO";
  const sheetName = change.sheetName || extractSheetFromRecordLabel(change.recordLabel) || "NO ESPECIFICADO";
  const rowNumber = change.rowNumber || extractRowFromRecordLabel(change.recordLabel);
  return [
    documentName,
    sheetName,
    rowNumber ? `Fila ${rowNumber}` : "",
  ].filter(Boolean).join(" -> ");
}

function mapStatusChangeToSheetRow(change) {
  return {
    documento: change.sourceName || extractDocumentFromRecordLabel(change.recordLabel),
    Hoja: change.sheetName || extractSheetFromRecordLabel(change.recordLabel),
    "donde se hizo el cambio": buildChangeLocation(change, "ESTADO"),
    "cambio anterio": formatChangeValue(change.previousStatus),
    "cambio actual": formatChangeValue(change.status),
    "descripcion del fallo": formatChangeValue(change.workOrderDescription),
    comentario: formatChangeValue(change.workOrderComment),
  };
}

function mapOtFieldChangeToSheetRow(change) {
  return {
    documento: change.documentName || extractDocumentFromRecordLabel(change.recordLabel),
    Hoja: change.sheetName || extractSheetFromRecordLabel(change.recordLabel),
    "donde se hizo el cambio": buildChangeLocation(change, change.field),
    "cambio anterio": formatChangeValue(change.previousValue),
    "cambio actual": formatChangeValue(change.newValue),
    "descripcion del fallo": formatChangeValue(change.workOrderDescription),
    comentario: formatChangeValue(change.workOrderComment),
  };
}

function enrichChangesForChangeEmail(changes, records) {
  return enrichChangesWithSourceRecordColumns(enrichChangesWithWorkOrderContext(changes, records), records);
}

function enrichChangesWithSourceRecordColumns(changes, records) {
  const columnsByRecordKey = buildEmailColumnsByRecordKey(records);
  return changes.map((change) => {
    const columns = columnsByRecordKey.get(buildChangeRecordKey(change));
    return columns?.length ? { ...change, allColumns: columns } : change;
  });
}

function buildEmailColumnsByRecordKey(records) {
  return (records || []).reduce((columnsByRecordKey, record) => {
    const key = buildRecordLookupKey(record.sourceName, record.sheetName, record.rowNumber);
    if (key) columnsByRecordKey.set(key, buildEmailRecordColumns(record));
    return columnsByRecordKey;
  }, new Map());
}

function buildChangeRecordKey(change) {
  const documentName = change.sourceName || change.documentName || extractDocumentFromRecordLabel(change.recordLabel);
  const sheetName = change.sheetName || extractSheetFromRecordLabel(change.recordLabel);
  const rowNumber = change.rowNumber || extractRowFromRecordLabel(change.recordLabel);
  return buildRecordLookupKey(documentName, sheetName, rowNumber);
}

function buildRecordLookupKey(documentName, sheetName, rowNumber) {
  return [
    normalizeText(documentName),
    normalizeText(sheetName),
    String(rowNumber || "").trim(),
  ].join("::");
}

function enrichChangesWithWorkOrderContext(changes, records) {
  const contextByOt = buildWorkOrderContextByOt(records);
  return changes.map((change) => {
    const otKey = normalizeOtForReminder(change.ot);
    const context = otKey ? contextByOt.get(otKey) : null;
    return context ? { ...change, ...context } : change;
  });
}

function buildWorkOrderContextByOt(records) {
  const contextByOt = new Map();
  (records || []).forEach((record) => {
    if (!isWorkOrderFormRecord(record)) return;
    const otKey = normalizeOtForReminder(getRecordOtFromRecord(record));
    if (!otKey || contextByOt.has(otKey)) return;
    contextByOt.set(otKey, {
      workOrderDescription: getRecordCellByAliases(record, WORK_ORDER_DESCRIPTION_ALIASES),
      workOrderComment: getRecordCellByAliases(record, WORK_ORDER_COMMENT_ALIASES),
    });
  });
  return contextByOt;
}

function isWorkOrderFormRecord(record) {
  return normalizeText(record?.sourceName).includes(normalizeText(WORK_ORDER_SOURCE_KEYWORD)) &&
    normalizeText(record?.sheetName).includes(normalizeText(WORK_ORDER_FORM_SHEET_KEYWORD));
}

function markRowsAsSent(rows, sentIndexes) {
  return rows.map((row, index) => ({
    ...row,
    enviado: sentIndexes.has(index) ? "si" : "",
  }));
}

function buildSentChangeKeys(values) {
  const headers = values?.[0] || [];
  if (!headers.length) return new Set();
  return new Set(
    values.slice(1)
      .map((row) => rowToChangeObject(headers, row))
      .filter((row) => isSentValue(row.enviado))
      .map(buildChangeRowKey),
  );
}

function rowToChangeObject(headers, row) {
  return CHANGES_HEADERS.reduce((object, header) => {
    const index = findHeaderIndex(headers, header);
    object[header] = index >= 0 ? row[index] || "" : "";
    return object;
  }, {});
}

function findHeaderIndex(headers, targetHeader) {
  return headers.findIndex((header) => normalizeText(header) === normalizeText(targetHeader));
}

function isSentValue(value) {
  return normalizeText(value) === "si";
}

function buildChangeRowKey(row) {
  return [
    row.documento,
    row.Hoja,
    row["donde se hizo el cambio"],
    row["cambio anterio"],
    row["cambio actual"],
  ].map((value) => normalizeText(value)).join("|");
}

function buildChangeLocation(change, field) {
  return [
    change.ot ? `OT ${change.ot}` : "",
    field || "",
    change.rowNumber ? `fila ${change.rowNumber}` : "",
  ].filter(Boolean).join(" / ") || change.recordLabel || "NO ESPECIFICADO";
}

function extractDocumentFromRecordLabel(label) {
  return String(label || "").split(" / ")[0] || "";
}

function extractSheetFromRecordLabel(label) {
  return String(label || "").split(" / ")[1] || "";
}

function extractRowFromRecordLabel(label) {
  const match = String(label || "").match(/fila\s+(\d+)/i);
  return match ? match[1] : "";
}

function formatChangeValue(value) {
  const text = String(value ?? "").trim();
  return text || "VACIO";
}

export default App;
