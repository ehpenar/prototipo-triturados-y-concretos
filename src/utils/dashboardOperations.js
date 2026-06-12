import { FINANCIAL_SUMMARY_SHEET } from "./financialSummary.js";
import { formatMoney, normalizeText, parseDate, parseMoney } from "./helpers.js";

export const FINANCIAL_SUMMARY_SPREADSHEET_ID = "1Aaaj5rxLEl6KakxsXGV9BlIDkCyrqSZad6eayyAX4TQ";
export const VALIDATION_ISSUES_SHEET = "validation_issues";
export const ALERT_HISTORY_SHEET = "alert_history";
export const ALERT_RULES_SHEET = "alert_rules";
export const CHANGES_SHEET = "Cambios";

const WORK_ORDER_DESCRIPTION_ALIASES = [
  "DESCRIPCIÓN GENERAL DEL FALLO O DE LA SOLICITUD",
  "DESCRIPCION GENERAL DEL FALLO O DE LA SOLICITUD",
  "DESCRIPCIÓN GENERAL DEL FALLO O DE LA SOLICTUD",
  "DESCRIPCION GENERAL DEL FALLO O DE LA SOLICTUD",
];

const CLOSED_OT_STATUSES = new Set(["terminado", "cerrado", "cerrada", "finalizado", "completado", "cerradaot"]);
const OPEN_ISSUE_STATUSES = new Set(["open", "abierto", "pendiente", "sinresolver", "activo"]);
const OPEN_ALERT_STATUSES = new Set(["open", "abierto", "pendiente", "activo"]);
const SP_DELIVERED_STATUSES = ["entregado", "entregada"];
const PENDING_COMMENT_KEYWORDS = ["pendiente", "falta", "sin entregar", "esperando", "no se ha podido", "por definir"];
const SP_PRIORITY_KEYWORDS = ["urgente", "importante", "alta prioridad", "critico", "crítico"];

export const DEFAULT_OPS_CONFIG = {
  otDaysWithoutClose: 30,
  otSinRevisarDays: 7,
  spPendingDays: 15,
  otStaleDays: 14,
  purchaseLimit: 50000000,
};

export function getFinancialSheetRecords(records, sheetName) {
  return (records || []).filter(
    (record) =>
      record.sourceId === FINANCIAL_SUMMARY_SPREADSHEET_ID &&
      normalizeText(record.sheetName) === normalizeText(sheetName),
  );
}

export function getCell(record, names, containsNames = []) {
  if (!record) return "";
  for (const name of names) {
    const header = record.headers?.find((item) => normalizeHeader(item) === normalizeHeader(name));
    if (header && record.cells?.[header] !== undefined) return record.cells[header];
  }
  for (const name of containsNames) {
    const target = normalizeHeader(name);
    const header = record.headers?.find((item) => normalizeHeader(item).includes(target));
    if (header && record.cells?.[header] !== undefined) return record.cells[header];
  }
  return "";
}

export function normalizeOtKey(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:OT\s*[-:]?\s*)?(\d+)/i);
  return match ? String(Number(match[1])) : normalizeText(text);
}

export function getRecordOt(record) {
  return String(getCell(record, ["OT", "5", "ORDEN DE TRABAJO"]) || record.normalized?.work_order || "").trim();
}

export function buildSourceRecordIndexes(sourceRecords) {
  const indexes = {
    billingByOt: new Map(),
    financialByOt: new Map(),
    matrixByOt: new Map(),
    purchaseOrdersByOt: new Map(),
    workOrderByOt: new Map(),
  };

  (sourceRecords || []).forEach((record) => {
    const otKey = normalizeOtKey(getRecordOt(record));
    if (!otKey) return;

    if (isMatrixSource(record)) {
      addRecordToIndex(indexes.matrixByOt, otKey, record);
      addPurchaseOrdersToIndex(indexes.purchaseOrdersByOt, otKey, record);
    }

    if (isWorkOrderSourceRecord(record) && !indexes.workOrderByOt.has(otKey)) {
      indexes.workOrderByOt.set(otKey, record);
    }

    if (isBillingSourceRecord(record)) {
      addRecordToIndex(indexes.billingByOt, otKey, record);
    }

    if (isFinancialSummarySourceRecord(record) && !indexes.financialByOt.has(otKey)) {
      indexes.financialByOt.set(otKey, record);
    }
  });

  indexes.purchaseOrdersByOt.forEach((orders, key) => {
    indexes.purchaseOrdersByOt.set(key, [...orders].sort());
  });

  return indexes;
}

export function buildOperationalControlData(sourceRecords, config = DEFAULT_OPS_CONFIG) {
  const indexes = buildExtendedIndexes(sourceRecords);
  const sheetValidations = parseValidationIssues(sourceRecords).filter((issue) => isOpenIssueStatus(issue.status));
  const computedValidations = buildComputedValidations(sourceRecords, indexes);
  const validations = mergeValidationIssues(computedValidations, sheetValidations);
  const otPending = buildOtPendingList(indexes, config);
  const spPending = buildSpPendingList(indexes, config);
  const duplicates = detectDuplicates(indexes);
  const rules = parseAlertRules(sourceRecords);
  const alerts = buildAutomaticAlerts(sourceRecords, indexes, config, rules, otPending, spPending, validations, duplicates);
  const indicators = buildOperationalIndicators(indexes, otPending, spPending, validations, alerts, duplicates);

  return {
    config,
    indicators,
    otPending,
    spPending,
    validations,
    alerts,
    duplicates,
  };
}

export function buildPendingSummary(sourceRecords, config = DEFAULT_OPS_CONFIG) {
  const data = buildOperationalControlData(sourceRecords, config);
  const categories = [
    { id: "ots-open", label: "OTs pendientes", items: data.otPending.map(toLegacyPendingItem) },
    { id: "sp-pending", label: "SP pendientes", items: data.spPending.map(toLegacyPendingItem) },
    { id: "validation-open", label: "Validaciones sin resolver", items: data.validations.slice(0, 20).map(toLegacyValidationItem) },
    { id: "alerts-active", label: "Alertas activas", items: data.alerts.slice(0, 20).map(toLegacyAlertItem) },
  ];
  return categories
    .map((category) => ({ ...category, count: category.items.length }))
    .filter((category) => category.count > 0);
}

function buildExtendedIndexes(sourceRecords) {
  const indexes = buildSourceRecordIndexes(sourceRecords);
  indexes.allMatrix = (sourceRecords || []).filter(isMatrixSource);
  indexes.allWorkOrders = (sourceRecords || []).filter(isWorkOrderSourceRecord);
  indexes.spByNumber = new Map();
  indexes.allMatrix.forEach((record) => {
    const spNumber = normalizeSpKey(getSpNumber(record));
    if (!spNumber) return;
    if (!indexes.spByNumber.has(spNumber)) indexes.spByNumber.set(spNumber, []);
    indexes.spByNumber.get(spNumber).push(record);
  });
  return indexes;
}

function buildOtPendingList(indexes, config) {
  const pending = [];
  indexes.workOrderByOt.forEach((record, otKey) => {
    const reasons = collectOtPendingReasons(record, indexes, otKey, config);
    if (!reasons.length) return;
    const detail = extractWorkOrderDetail(record, otKey);
    pending.push({
      id: `ot-pending-${otKey}`,
      severity: reasons.some((reason) => reason.includes("vencida") || reason.includes("sin revisar")) ? "high" : "medium",
      title: `OT ${detail.ot}`,
      subtitle: detail.estado || "Sin estado",
      reasons,
      fields: [
        { label: "Fecha solicitud", value: detail.fechaSolicitud },
        { label: "Responsable", value: detail.responsable },
        { label: "Área", value: detail.area },
        { label: "Equipo / CC", value: detail.equipoCentroCosto },
        { label: "Estado", value: detail.estado },
        { label: "Días transcurridos", value: detail.diasTranscurridos },
        { label: "Fecha compromiso", value: detail.fechaCompromiso },
      ],
      otKey,
      record,
    });
  });
  return pending.sort((left, right) => Number(right.severity === "high") - Number(left.severity === "high"));
}

function buildSpPendingList(indexes, config) {
  const pending = [];
  const seen = new Set();
  indexes.allMatrix.forEach((record, index) => {
    const spNumber = getSpNumber(record) || `SP-${index + 1}`;
    const dedupeKey = `${normalizeSpKey(spNumber)}-${record.rowNumber}`;
    if (seen.has(dedupeKey)) return;
    const reasons = collectSpPendingReasons(record, config);
    if (!reasons.length) return;
    seen.add(dedupeKey);
    const detail = extractSpDetail(record);
    pending.push({
      id: `sp-pending-${normalizeSpKey(spNumber)}-${record.rowNumber}`,
      severity: reasons.some((reason) => reason.includes("plazo") || reason.includes("sin orden")) ? "high" : "medium",
      title: `SP ${spNumber}`,
      subtitle: detail.ot ? `OT ${detail.ot}` : "Sin OT asociada",
      reasons,
      fields: [
        { label: "Fecha recepción", value: detail.fechaRecepcion },
        { label: "Área solicitante", value: detail.area },
        { label: "Responsable compra", value: detail.responsableCompra },
        { label: "Estado", value: detail.estado },
        { label: "Orden de compra", value: detail.ordenCompra },
        { label: "Valor compra", value: detail.valorCompra },
        { label: "Días radicación", value: detail.diasRadicacion },
        { label: "Prioridad", value: detail.prioridad },
      ],
      spNumber,
      record,
    });
  });
  return pending.sort((left, right) => Number(right.severity === "high") - Number(left.severity === "high"));
}

function buildOperationalIndicators(indexes, otPending, spPending, validations, alerts, duplicates) {
  const otOpen = [...indexes.workOrderByOt.values()].filter((record) => !isClosedOtStatus(getCell(record, ["ESTADO"]))).length;
  const otOverdue = otPending.filter((item) => item.reasons.some((reason) => reason.toLowerCase().includes("vencida"))).length;
  const otSinRevisar = otPending.filter((item) => normalizeText(item.subtitle) === "sinrevisar").length;
  const otIncomplete = validations.filter((item) => item.entityType === "OT").length;
  const spOpen = spPending.length;
  const spSinOc = spPending.filter((item) => item.reasons.some((reason) => reason.toLowerCase().includes("orden de compra"))).length;
  const spIncomplete = validations.filter((item) => item.entityType === "SP").length;
  const criticalAlerts = alerts.filter((item) => item.severity === "high").length;
  const duplicateCount = duplicates.ot.length + duplicates.sp.length;

  return [
    { id: "ot-open", label: "OT abiertas", value: otOpen },
    { id: "ot-overdue", label: "OT vencidas", value: otOverdue, critical: otOverdue > 0 },
    { id: "ot-sin-revisar", label: "OT sin revisar", value: otSinRevisar, critical: otSinRevisar > 0 },
    { id: "ot-incomplete", label: "OT incompletas", value: otIncomplete },
    { id: "sp-open", label: "SP pendientes", value: spOpen },
    { id: "sp-sin-oc", label: "SP sin OC", value: spSinOc, critical: spSinOc > 0 },
    { id: "sp-incomplete", label: "SP incompletas", value: spIncomplete },
    { id: "alerts-critical", label: "Alertas críticas", value: criticalAlerts, critical: criticalAlerts > 0 },
    { id: "duplicates", label: "Duplicados", value: duplicateCount, critical: duplicateCount > 0 },
  ];
}

function collectOtPendingReasons(record, indexes, otKey, config) {
  const reasons = [];
  const detail = extractWorkOrderDetail(record, otKey);
  const status = normalizeText(detail.estado);
  const matrixRecords = indexes.matrixByOt.get(otKey) || [];

  if (status === "sinrevisar") reasons.push("Estado SIN REVISAR");
  if (status === "enproceso" && isDatePast(detail.fechaCompromisoDate)) {
    reasons.push("EN PROCESO con fecha compromiso vencida");
  }
  if (containsPendingKeywords(detail.comentarios)) reasons.push("Comentarios con palabras de seguimiento pendiente");
  if (!String(detail.responsable || "").trim() || detail.responsable === "—") reasons.push("OT sin responsable asignado");
  if (hasInvalidOtDates(detail)) reasons.push("Fechas inconsistentes o inválidas");
  if (!detail.fechaCierre && !isClosedOtStatus(detail.estado)) reasons.push("OT sin fecha de cierre");
  if (isStaleOpenOt(detail, config.otStaleDays)) reasons.push("Sin actualizaciones recientes");

  const pendingSp = matrixRecords.filter((matrixRecord) => !isSpDelivered(getSpStatus(matrixRecord)));
  if (pendingSp.length) reasons.push(`SP asociada sin gestionar/entregar (${pendingSp.length})`);

  return [...new Set(reasons)];
}

function collectSpPendingReasons(record, config) {
  const reasons = [];
  const detail = extractSpDetail(record);
  if (isSpDelivered(detail.estado)) return reasons;
  const status = normalizeText(detail.estado);

  reasons.push("Estado diferente de ENTREGADO");
  if (!String(detail.ordenCompra || "").trim() || detail.ordenCompra === "—") reasons.push("SP sin orden de compra registrada");
  if (status.includes("legaliz") && !status.includes("legalizad")) reasons.push("Orden de compra pendiente de legalización");
  if (isDeliveryOverdue(record, detail)) reasons.push("SP excede plazo de entrega definido");
  if (!parseMoney(detail.valorCompraRaw)) reasons.push("SP sin valor de compra registrado");
  if (isPrioritySpOpen(record, detail.estado)) reasons.push("SP prioritaria aún abierta");
  if (detail.diasRadicacion !== "—" && Number(detail.diasRadicacion) > config.spPendingDays) {
    reasons.push(`SP pendiente más de ${config.spPendingDays} días`);
  }
  return [...new Set(reasons)];
}

function buildComputedValidations(sourceRecords, indexes) {
  const issues = [];
  const today = formatDateLabel(new Date());

  indexes.workOrderByOt.forEach((record, otKey) => {
    const detail = extractWorkOrderDetail(record, otKey);
    const responsible = detail.responsable;
    const pushIssue = (fieldName, issueType, issueMessage, severity = "medium") => {
      issues.push({
        id: `computed-ot-${otKey}-${fieldName}`,
        entityType: "OT",
        entityId: detail.ot,
        fieldName,
        issueType,
        issueMessage,
        severity,
        detectedAt: today,
        status: "open",
        responsible,
        source: "computed",
      });
    };

    if (!detail.estado || detail.estado === "—") pushIssue("ESTADO", "missing_required_field", "OT sin estado definido");
    if (!responsible || responsible === "—") pushIssue("QUIEN SOLICITA", "missing_responsible", "OT sin responsable asignado");
    if (!detail.fechaCompromiso || detail.fechaCompromiso === "—") pushIssue("FECHA DE ENTREGA", "missing_required_field", "OT sin fecha compromiso");
    if (!detail.descripcion || detail.descripcion === "—") pushIssue("DESCRIPCIÓN", "missing_required_field", "OT sin descripción de la solicitud");
    if (!detail.correo || detail.correo === "—") pushIssue("CORREO", "missing_required_field", "OT sin correo de contacto");
    if (hasInvalidOtDates(detail)) pushIssue("FECHAS", "invalid_date", "OT con fechas inconsistentes");
    if (hasMissingSpReference(record, indexes)) pushIssue("SP", "missing_reference", "OT con referencia a SP inexistente en Matriz");
  });

  const otDuplicates = detectDuplicates(indexes).ot;
  otDuplicates.forEach((duplicate) => {
    issues.push({
      id: `dup-ot-${duplicate.key}`,
      entityType: "OT",
      entityId: duplicate.key,
      fieldName: "OT",
      issueType: "duplicated_record",
      issueMessage: `OT duplicada (${duplicate.count} registros)`,
      severity: "high",
      detectedAt: today,
      status: "open",
      responsible: "—",
      source: "computed",
    });
  });

  indexes.allMatrix.forEach((record, index) => {
    const detail = extractSpDetail(record);
    const spNumber = detail.spNumber || `SP-${index + 1}`;
    const responsible = detail.responsableCompra;
    const pushIssue = (fieldName, issueType, issueMessage, severity = "medium") => {
      issues.push({
        id: `computed-sp-${normalizeSpKey(spNumber)}-${record.rowNumber}-${fieldName}`,
        entityType: "SP",
        entityId: spNumber,
        fieldName,
        issueType,
        issueMessage,
        severity,
        detectedAt: today,
        status: "open",
        responsible,
        source: "computed",
      });
    };

    if (!detail.responsableCompra || detail.responsableCompra === "—") pushIssue("ENCARGADO", "missing_responsible", "SP sin encargado asignado");
    if (!detail.estado || detail.estado === "—") pushIssue("ESTADO", "missing_required_field", "SP sin estado definido");
    if (!parseMoney(detail.valorCompraRaw)) pushIssue("VALOR COMPRA", "missing_required_field", "SP sin valor de compra");
    if (requiresPurchaseOrder(detail) && (!detail.ordenCompra || detail.ordenCompra === "—")) {
      pushIssue("ORDEN DE COMPRA", "missing_purchase_order", "SP sin orden de compra cuando es requerida");
    }
    if (!detail.fechaRecepcion || detail.fechaRecepcion === "—") pushIssue("FECHA RECEPCIÓN", "missing_required_field", "SP sin fecha de recepción");
    if (!detail.area || detail.area === "—") pushIssue("PROCESO", "missing_required_field", "SP con campo obligatorio vacío (área/proceso)");
  });

  detectDuplicates(indexes).sp.forEach((duplicate) => {
    issues.push({
      id: `dup-sp-${duplicate.key}`,
      entityType: "SP",
      entityId: duplicate.key,
      fieldName: "SP",
      issueType: "duplicated_record",
      issueMessage: `SP duplicada (${duplicate.count} registros)`,
      severity: "high",
      detectedAt: today,
      status: "open",
      responsible: "—",
      source: "computed",
    });
  });

  return issues;
}

function buildAutomaticAlerts(sourceRecords, indexes, config, rules, otPending, spPending, validations, duplicates) {
  const alerts = [];
  const today = formatDateLabel(new Date());
  const pushAlert = (entityType, entityId, entityName, alertMessage, severity = "medium") => {
    alerts.push({
      id: `auto-${entityType}-${entityId}-${normalizeText(alertMessage).slice(0, 40)}`,
      entityType,
      entityId,
      entityName,
      alertMessage,
      severity,
      status: "open",
      detectedAt: today,
      source: "automatic",
    });
  };

  indexes.workOrderByOt.forEach((record, otKey) => {
    const detail = extractWorkOrderDetail(record, otKey);
    const daysOpen = Number(detail.diasTranscurridos) || 0;
    if (!isClosedOtStatus(detail.estado) && daysOpen > config.otDaysWithoutClose) {
      pushAlert("OT", otKey, `OT ${detail.ot}`, `OT lleva más de ${config.otDaysWithoutClose} días sin cierre`, "high");
    }
    if (normalizeText(detail.estado) === "sinrevisar" && daysOpen > config.otSinRevisarDays) {
      pushAlert("OT", otKey, `OT ${detail.ot}`, `OT en SIN REVISAR después de ${config.otSinRevisarDays} días`, "high");
    }
    if (normalizeText(detail.estado) === "enproceso" && isDatePast(detail.fechaCompromisoDate)) {
      pushAlert("OT", otKey, `OT ${detail.ot}`, "OT con fecha compromiso vencida", "high");
    }
    if (isStaleOpenOt(detail, config.otStaleDays)) {
      pushAlert("OT", otKey, `OT ${detail.ot}`, "OT sin avances ni comentarios recientes", "medium");
    }
  });

  spPending.forEach((item) => {
    if (item.reasons.some((reason) => reason.includes("sin orden de compra"))) {
      pushAlert("SP", item.spNumber, item.title, "SP sin orden de compra asociada", "high");
    }
    if (item.reasons.some((reason) => reason.includes("más de"))) {
      pushAlert("SP", item.spNumber, item.title, item.reasons.find((reason) => reason.includes("más de")) || "SP pendiente prolongada", "medium");
    }
  });

  indexes.matrixByOt.forEach((matrixRecords, otKey) => {
    const totalPurchase = matrixRecords.reduce(
      (sum, record) => sum + parseMoney(getCell(record, ["VALOR COMPRA (AGREGAR)", "VALOR COMPRA", "VALOR DE COMPRA"])),
      0,
    );
    if (totalPurchase > config.purchaseLimit) {
      pushAlert("OT", otKey, `OT ${otKey}`, `Compra supera el valor límite (${formatMoneyValue(totalPurchase)})`, "high");
    }
  });

  validations.filter((issue) => issue.severity === "high" || issue.issueType === "missing_required_field").forEach((issue) => {
    pushAlert(issue.entityType, issue.entityId, `${issue.entityType} ${issue.entityId}`, issue.issueMessage, issue.severity || "medium");
  });

  duplicates.ot.forEach((duplicate) => pushAlert("OT", duplicate.key, `OT ${duplicate.key}`, "Registro OT duplicado detectado", "high"));
  duplicates.sp.forEach((duplicate) => pushAlert("SP", duplicate.key, `SP ${duplicate.key}`, "Registro SP duplicado detectado", "high"));

  const ruleAlerts = evaluateActiveAlertRules(sourceRecords, rules).map((alert) => ({ ...alert, source: "rule" }));
  const merged = [...alerts, ...ruleAlerts, ...parseAlertHistory(sourceRecords).filter((alert) => isOpenAlertStatus(alert.status))];
  const unique = new Map();
  merged.forEach((alert) => {
    const key = `${alert.entityType}-${alert.entityId}-${normalizeText(alert.alertMessage)}`;
    if (!unique.has(key)) unique.set(key, alert);
  });
  return [...unique.values()].sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
}

export function buildIntegralBitacora(sourceRecords, otInput) {
  const otKey = normalizeOtKey(otInput);
  if (!otKey) return null;
  const indexes = buildExtendedIndexes(sourceRecords);
  const workOrder = indexes.workOrderByOt.get(otKey);
  const financial = indexes.financialByOt.get(otKey);
  const matrixRecords = indexes.matrixByOt.get(otKey) || [];
  const billingRecords = indexes.billingByOt.get(otKey) || [];
  const detail = workOrder ? extractWorkOrderDetail(workOrder, otKey) : null;
  const pendientes = buildOtPendingList(indexes, DEFAULT_OPS_CONFIG).filter((item) => item.otKey === otKey);
  const timeline = buildBitacoraEvents(sourceRecords, otKey);

  return {
    general: detail ? {
      ot: detail.ot,
      fechaCreacion: detail.fechaSolicitud,
      responsable: detail.responsable,
      area: detail.area,
      equipoCentroCosto: detail.equipoCentroCosto,
      descripcion: detail.descripcion,
      estado: detail.estado,
      correo: detail.correo,
    } : { ot: otKey },
    seguimiento: {
      estados: collectStatusHistory(workOrder, financial, sourceRecords, otKey),
      comentarios: collectComments(workOrder, financial),
      actualizaciones: collectUpdates(workOrder, financial, billingRecords),
      responsables: collectResponsibles(workOrder, matrixRecords, billingRecords),
    },
    compras: {
      sps: matrixRecords.map((record) => extractSpDetail(record)),
      ordenesCompra: [...new Set(matrixRecords.map((record) => getCell(record, ["ORDENES DE COMPRA", "ORDEN DE COMPRA"])).filter(Boolean))],
      valorCompraTotal: formatMoneyValue(matrixRecords.reduce(
        (sum, record) => sum + parseMoney(getCell(record, ["VALOR COMPRA (AGREGAR)", "VALOR COMPRA", "VALOR DE COMPRA"])),
        0,
      )),
    },
    ejecucion: {
      actividades: billingRecords.map((record) => ({
        fecha: formatDateLabel(record.normalized?.dateValue || parseDate(getCell(record, ["FECHA"]))),
        colaborador: getCell(record, ["COLABORADOR", "colaborador"]),
        actividad: getCell(record, ["ACTIVIDAD REALIZADA", "ACTIVIDAD"]),
        repuestos: getCell(record, ["REPUESTOS UTILIZADOS", "REPUESTOS"]),
      })),
      pendientes: pendientes.flatMap((item) => item.reasons),
      evidencias: collectEvidenceLinks(workOrder, matrixRecords),
    },
    cierre: {
      fechaFinalizacion: detail?.fechaCierre || getCell(financial, ["FECHA REAL ENTREGA"]) || "—",
      resultado: detail?.descripcion || "—",
      responsableCierre: detail?.responsable || "—",
      observacionesFinales: detail?.comentarios || "—",
      informe: getCell(financial, ["INFORME"]) || "—",
    },
    timeline,
  };
}

export function parseValidationIssues(sourceRecords) {
  return getFinancialSheetRecords(sourceRecords, VALIDATION_ISSUES_SHEET)
    .map((record) => ({
      id: getCell(record, ["id"]),
      entityType: getCell(record, ["entity_type"]),
      entityId: getCell(record, ["entity_id"]),
      fieldName: getCell(record, ["field_name"]),
      issueType: getCell(record, ["issue_type"]),
      issueMessage: getCell(record, ["issue_message"]),
      severity: normalizeSeverity(getCell(record, ["severity"])),
      detectedAt: getCell(record, ["detected_at"]),
      status: getCell(record, ["status"]),
      resolvedAt: getCell(record, ["resolved_at"]),
      notes: getCell(record, ["notes"]),
    }))
    .filter((issue) => issue.entityId || issue.issueMessage || issue.issueType);
}

export function parseAlertHistory(sourceRecords) {
  return getFinancialSheetRecords(sourceRecords, ALERT_HISTORY_SHEET)
    .map((record) => ({
      id: getCell(record, ["id"]),
      ruleId: getCell(record, ["rule_id"]),
      entityType: getCell(record, ["entity_type"]),
      entityId: getCell(record, ["entity_id"]),
      entityName: getCell(record, ["entity_name"]),
      alertMessage: getCell(record, ["alert_message"]),
      severity: normalizeSeverity(getCell(record, ["severity"])),
      status: getCell(record, ["status"]),
      detectedAt: getCell(record, ["detected_at"]),
      resolvedAt: getCell(record, ["resolved_at"]),
      resolvedBy: getCell(record, ["resolved_by"]),
      notes: getCell(record, ["notes"]),
    }))
    .filter((alert) => alert.entityId || alert.alertMessage);
}

export function parseAlertRules(sourceRecords) {
  return getFinancialSheetRecords(sourceRecords, ALERT_RULES_SHEET)
    .map((record) => ({
      id: getCell(record, ["id"]),
      active: parseBoolean(getCell(record, ["active"])),
      name: getCell(record, ["name"]),
      description: getCell(record, ["description"]),
      entityType: getCell(record, ["entity_type"]),
      conditionType: getCell(record, ["condition_type"]),
      fieldName: getCell(record, ["field_name"]),
      operator: getCell(record, ["operator"]),
      thresholdValue: getCell(record, ["threshold_value"]),
      thresholdUnit: getCell(record, ["threshold_unit"]),
      severity: normalizeSeverity(getCell(record, ["severity"])),
      messageTemplate: getCell(record, ["message_template"]),
    }))
    .filter((rule) => rule.name || rule.conditionType);
}

export function evaluateActiveAlertRules(sourceRecords, rules) {
  const activeRules = (rules || []).filter((rule) => rule.active !== false);
  if (!activeRules.length) return [];

  const indexes = buildSourceRecordIndexes(sourceRecords);
  const generated = [];

  activeRules.forEach((rule) => {
    if (rule.conditionType === "days_without_close") {
      indexes.financialByOt.forEach((record, otKey) => {
        const status = String(getCell(record, ["ESTATUS DE LA OT"]) || "").trim();
        if (isClosedOtStatus(status)) return;
        const days = daysSince(record.normalized?.dateValue || parseDate(getCell(record, ["FECHA RECEPCION SP"])));
        if (days !== null && days > Number(rule.thresholdValue || 0)) {
          generated.push(buildGeneratedAlert(rule, "OT", otKey, `OT ${otKey}`, days, "días sin cierre"));
        }
      });
    }

    if (rule.conditionType === "missing_purchase_order") {
      indexes.matrixByOt.forEach((matrixRecords, otKey) => {
        const missing = matrixRecords.some((record) => !String(getCell(record, ["ORDENES DE COMPRA", "ORDEN DE COMPRA"]) || "").trim());
        if (missing) {
          generated.push(buildGeneratedAlert(rule, "OT", otKey, `OT ${otKey}`, null, "falta orden de compra"));
        }
      });
    }

    if (rule.conditionType === "amount_greater_than") {
      indexes.matrixByOt.forEach((matrixRecords, otKey) => {
        const totalPurchase = matrixRecords.reduce(
          (sum, record) => sum + parseMoney(getCell(record, ["VALOR COMPRA (AGREGAR)", "VALOR COMPRA", "VALOR DE COMPRA"])),
          0,
        );
        if (totalPurchase > Number(rule.thresholdValue || 0)) {
          generated.push(buildGeneratedAlert(rule, "OT", otKey, `OT ${otKey}`, totalPurchase, "valor de compra"));
        }
      });
    }

    if (rule.conditionType === "no_related_activity") {
      indexes.financialByOt.forEach((record, otKey) => {
        if (!(indexes.billingByOt.get(otKey) || []).length) {
          generated.push(buildGeneratedAlert(rule, "OT", otKey, `OT ${otKey}`, null, "sin actividad relacionada"));
        }
      });
    }
  });

  return generated;
}

export function buildBitacoraEvents(sourceRecords, otInput) {
  const otKey = normalizeOtKey(otInput);
  if (!otKey) return [];

  const indexes = buildSourceRecordIndexes(sourceRecords);
  const events = [];
  const workOrder = indexes.workOrderByOt.get(otKey);
  const financial = indexes.financialByOt.get(otKey);
  const matrixRecords = indexes.matrixByOt.get(otKey) || [];
  const billingRecords = indexes.billingByOt.get(otKey) || [];
  const purchaseOrders = indexes.purchaseOrdersByOt.get(otKey) || [];

  if (workOrder) {
    events.push({
      id: `wo-${otKey}`,
      date: parseDate(getCell(workOrder, ["Marca temporal", "FECHA DE SOLICITUD"])) || workOrder.normalized?.dateValue,
      title: "Creación de OT",
      detail: String(getCell(workOrder, WORK_ORDER_DESCRIPTION_ALIASES) || getCell(workOrder, ["DESCRIPCIÓN GENERAL DEL FALLO O DE LA SOLICTUD"]) || "Solicitud registrada").trim(),
      kind: "creation",
    });
  }

  matrixRecords.forEach((record, index) => {
    const sp = getCell(record, ["NUMERO DE LA SP (solo el numero sin letras)*", "NUMERO DE LA SP", "SP"]);
    events.push({
      id: `sp-${otKey}-${index}`,
      date: parseDate(getCell(record, ["Fecha de Recepción de la SP  Nota: si no tiene fecha coloque la de la SP *", "Fecha de Recepcion de la SP"])) || record.normalized?.dateValue,
      title: `SP ${sp || "relacionada"}`,
      detail: String(getCell(record, ["Estado Actual de la SP*", "Estado Actual de la SP"]) || "SP detectada en Matriz de Seguimiento").trim(),
      kind: "sp",
    });
  });

  purchaseOrders.forEach((order, index) => {
    events.push({
      id: `po-${otKey}-${index}`,
      date: null,
      title: "Orden de compra",
      detail: order,
      kind: "purchase",
    });
  });

  if (financial) {
    const status = getCell(financial, ["ESTATUS DE LA OT"]);
    if (status) {
      events.push({
        id: `status-${otKey}`,
        date: financial.normalized?.dateValue,
        title: "Estado financiero OT",
        detail: status,
        kind: "status",
      });
    }

    const report = getCell(financial, ["INFORME"]);
    if (report) {
      events.push({
        id: `report-${otKey}`,
        date: null,
        title: "Informe generado",
        detail: report,
        kind: "report",
      });
    }
  }

  billingRecords.forEach((record, index) => {
    events.push({
      id: `activity-${otKey}-${index}`,
      date: record.normalized?.dateValue || parseDate(getCell(record, ["FECHA"])),
      title: "Actividad registrada",
      detail: String(getCell(record, ["ACTIVIDAD REALIZADA", "ACTIVIDAD"]) || getCell(record, ["COLABORADOR"]) || "Actividad de mantenimiento").trim(),
      kind: "activity",
    });
  });

  parseValidationIssues(sourceRecords)
    .filter((issue) => normalizeOtKey(issue.entityId) === otKey)
    .forEach((issue, index) => {
      events.push({
        id: `validation-${otKey}-${index}`,
        date: parseDate(issue.detectedAt),
        title: "Validación detectada",
        detail: issue.issueMessage || issue.issueType,
        kind: "validation",
        severity: issue.severity,
      });
    });

  parseAlertHistory(sourceRecords)
    .filter((alert) => normalizeOtKey(alert.entityId) === otKey)
    .forEach((alert, index) => {
      events.push({
        id: `alert-${otKey}-${index}`,
        date: parseDate(alert.detectedAt),
        title: "Alerta registrada",
        detail: alert.alertMessage,
        kind: "alert",
        severity: alert.severity,
      });
    });

  getFinancialSheetRecords(sourceRecords, CHANGES_SHEET)
    .filter((record) => normalizeOtKey(getCell(record, ["documento", "donde se hizo el cambio"])) === otKey || String(getCell(record, ["descripcion del fallo", "comentario"]) || "").includes(otKey))
    .forEach((record, index) => {
      events.push({
        id: `change-${otKey}-${index}`,
        date: record.normalized?.dateValue,
        title: "Cambio detectado",
        detail: `${getCell(record, ["cambio anterio"]) || "—"} → ${getCell(record, ["cambio actual"]) || "—"}`,
        kind: "change",
      });
    });

  return events
    .sort((left, right) => {
      const leftTime = left.date instanceof Date ? left.date.getTime() : Number.POSITIVE_INFINITY;
      const rightTime = right.date instanceof Date ? right.date.getTime() : Number.POSITIVE_INFINITY;
      return leftTime - rightTime;
    });
}

export function listAvailableOts(sourceRecords) {
  const indexes = buildSourceRecordIndexes(sourceRecords);
  const otKeys = new Set();
  indexes.financialByOt.forEach((_record, otKey) => otKeys.add(otKey));
  indexes.workOrderByOt.forEach((_record, otKey) => otKeys.add(otKey));
  return [...otKeys].sort((left, right) => Number(left) - Number(right));
}


function extractWorkOrderDetail(record, otKey) {
  const fechaSolicitudDate = parseDate(getCell(record, ["FECHA DE SOLICITUD", "Marca temporal"])) || record.normalized?.dateValue;
  const fechaCompromisoDate = parseDate(getCell(record, ["FECHA DE ENTREGA"]));
  const fechaCierreDate = parseDate(getCell(record, ["FECHA REAL ENTREGA"]));
  const comentarios = String(getCell(record, ["COMENTARIOS", "COMENTARIO", "OBSERVACIONES"]) || "").trim();
  const descripcion = String(getCell(record, WORK_ORDER_DESCRIPTION_ALIASES) || "").trim();
  const equipo = String(getCell(record, ["EQUIPO"]) || "").trim();
  const centroCosto = String(getCell(record, ["CENTRO DE COSTO (SOLO NUMEROS SIN ESPACIOS)", "CENTRO DE COSTO"]) || "").trim();
  return {
    ot: getRecordOt(record) || otKey,
    fechaSolicitud: formatDateLabel(fechaSolicitudDate),
    fechaSolicitudDate,
    fechaCompromiso: formatDateLabel(fechaCompromisoDate),
    fechaCompromisoDate,
    fechaCierre: formatDateLabel(fechaCierreDate),
    fechaCierreDate,
    responsable: String(getCell(record, ["QUIEN SOLICITA", "QUIÉN SOLICITA"]) || "").trim() || "—",
    area: String(getCell(record, ["ÁREA QUE SOLICITA", "AREA QUE SOLICITA", "ÁREA DE SOLICITUD", "AREA DE SOLICITUD"]) || "").trim() || "—",
    equipoCentroCosto: [equipo, centroCosto].filter(Boolean).join(" · ") || "—",
    estado: String(getCell(record, ["ESTADO", "ESTATUS DE LA OT"]) || "").trim() || "—",
    diasTranscurridos: daysSince(fechaSolicitudDate) ?? "—",
    descripcion: descripcion || "—",
    comentarios: comentarios || "—",
    correo: String(getCell(record, ["Dirección de correo electrónico", "CORREO"]) || "").trim() || "—",
    formatoActividades: String(getCell(record, ["Por favor anexe el formato de actividades", "FORMATO DE ACTIVIDADES"]) || "").trim() || "—",
  };
}

function extractSpDetail(record) {
  const fechaRecepcionDate = parseDate(getCell(record, [
    "Fecha de Recepción de la SP  Nota: si no tiene fecha coloque la de la SP *",
    "Fecha de Recepcion de la SP",
    "Fecha de Recepción de la SP",
    "Marca temporal",
  ]));
  const valorRaw = getCell(record, ["VALOR COMPRA (AGREGAR)", "VALOR COMPRA", "VALOR DE COMPRA"]);
  const clase = String(getCell(record, ["Clase de Solicitud", "Clase de solicitud", "Clase"]) || "").trim();
  return {
    spNumber: getSpNumber(record),
    ot: getRecordOt(record) || "—",
    fechaRecepcion: formatDateLabel(fechaRecepcionDate),
    fechaRecepcionDate,
    area: String(getCell(record, ["Proceso que solicita la SP*", "Proceso que solicita la SP", "Proceso"]) || "").trim() || "—",
    responsableCompra: String(getCell(record, ["Nombre de quien solicita/autoriza la SP", "Nombre de quien solicita", "Solicitante"]) || "").trim() || "—",
    estado: getSpStatus(record) || "—",
    ordenCompra: String(getCell(record, ["ORDENES DE COMPRA", "ORDEN DE COMPRA"]) || "").trim() || "—",
    valorCompra: formatMoneyValue(parseMoney(valorRaw)),
    valorCompraRaw: valorRaw,
    diasRadicacion: daysSince(fechaRecepcionDate) ?? "—",
    prioridad: clase || detectPriorityLabel(record),
    plazoEntrega: String(getCell(record, ["PLAZO DE ENTREGA", "Plazo de Entrega"]) || "").trim() || "—",
    observacion: String(getCell(record, ["Observación (Descripción General SP)", "Observación", "Descripcion General SP"]) || "").trim() || "—",
  };
}

function getSpNumber(record) {
  return String(getCell(record, ["NUMERO DE LA SP (solo el numero sin letras)*", "NUMERO DE LA SP", "NÚMERO DE LA SP", "SP"]) || "").trim();
}

function normalizeSpKey(value) {
  const text = String(value || "").trim();
  const match = text.match(/(\d+)/);
  return match ? String(Number(match[1])) : normalizeText(text);
}

function getSpStatus(record) {
  return String(getCell(record, ["Estado Actual de la SP*", "Estado Actual de la SP", "Estado Actual", "Estado"]) || "").trim();
}

function isSpDelivered(status) {
  const text = normalizeText(status);
  return SP_DELIVERED_STATUSES.some((item) => text.includes(item));
}

function containsPendingKeywords(text) {
  const normalized = normalizeText(text);
  return PENDING_COMMENT_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function isDatePast(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return target < today;
}

function hasInvalidOtDates(detail) {
  const { fechaSolicitudDate, fechaCompromisoDate, fechaCierreDate } = detail;
  if (fechaSolicitudDate && fechaCompromisoDate && fechaSolicitudDate > fechaCompromisoDate) return true;
  if (fechaSolicitudDate && fechaCierreDate && fechaCierreDate < fechaSolicitudDate) return true;
  return false;
}

function isStaleOpenOt(detail, staleDays) {
  if (isClosedOtStatus(detail.estado)) return false;
  const lastSignal = detail.fechaCierreDate || detail.fechaCompromisoDate || detail.fechaSolicitudDate;
  const days = daysSince(lastSignal);
  const hasRecentComment = containsPendingKeywords(detail.comentarios);
  return days !== null && days > staleDays && !hasRecentComment;
}

function hasMissingSpReference(record, indexes) {
  const mentions = `${getCell(record, ["COMENTARIOS"])} ${getCell(record, ["sp", "SP"])}`;
  const matches = [...mentions.matchAll(/\bSP\s*#?\s*0*(\d{1,6})\b/gi)].map((match) => normalizeSpKey(match[1]));
  return matches.some((spKey) => spKey && !indexes.spByNumber.has(spKey));
}

function requiresPurchaseOrder(detail) {
  const status = normalizeText(detail.estado);
  return !status.includes("borrador") && !isSpDelivered(detail.estado);
}

function isDeliveryOverdue(record, detail) {
  const plazo = parseDate(getCell(record, ["FECHA ENTREGA", "Fecha Entrega", "Fecha de entrega"]));
  if (plazo) return isDatePast(plazo) && !isSpDelivered(detail.estado);
  const dias = Number(detail.diasRadicacion);
  const plazoDias = Number(String(detail.plazoEntrega || "").replace(/[^\d]/g, ""));
  if (Number.isFinite(plazoDias) && plazoDias > 0 && Number.isFinite(dias)) return dias > plazoDias;
  return false;
}

function isPrioritySpOpen(record, status) {
  if (isSpDelivered(status)) return false;
  const text = normalizeText(`${getCell(record, ["Clase de Solicitud", "Clase"])} ${getCell(record, ["Observación (Descripción General SP)", "Observación"])}`);
  return SP_PRIORITY_KEYWORDS.some((keyword) => text.includes(normalizeText(keyword)));
}

function detectPriorityLabel(record) {
  const text = normalizeText(`${getCell(record, ["Clase de Solicitud", "Clase"])} ${getCell(record, ["Observación (Descripción General SP)", "Observación"])}`);
  if (text.includes("urgente")) return "Urgente";
  if (text.includes("importante")) return "Importante";
  if (text.includes("alta prioridad")) return "Alta prioridad";
  return "—";
}

function detectDuplicates(indexes) {
  const otCounts = new Map();
  indexes.allWorkOrders.forEach((record) => {
    const otKey = normalizeOtKey(getRecordOt(record));
    if (!otKey) return;
    otCounts.set(otKey, (otCounts.get(otKey) || 0) + 1);
  });
  const spCounts = new Map();
  indexes.allMatrix.forEach((record) => {
    const spKey = normalizeSpKey(getSpNumber(record));
    if (!spKey) return;
    spCounts.set(spKey, (spCounts.get(spKey) || 0) + 1);
  });
  return {
    ot: [...otCounts.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count })),
    sp: [...spCounts.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count })),
  };
}

function mergeValidationIssues(computed, sheetIssues) {
  const map = new Map();
  [...computed, ...sheetIssues].forEach((issue) => {
    const key = `${issue.entityType}-${issue.entityId}-${issue.fieldName}-${issue.issueType}`;
    if (!map.has(key)) map.set(key, issue);
  });
  return [...map.values()].sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
}

function collectStatusHistory(workOrder, financial, sourceRecords, otKey) {
  const statuses = [];
  if (workOrder) statuses.push({ label: "Estado OT", value: getCell(workOrder, ["ESTADO"]) });
  if (financial) statuses.push({ label: "Estado financiero", value: getCell(financial, ["ESTATUS DE LA OT"]) });
  getFinancialSheetRecords(sourceRecords, CHANGES_SHEET)
    .filter((record) => normalizeText(getCell(record, ["cambio actual"])) === "estado" || normalizeText(getCell(record, ["donde se hizo el cambio"])).includes(otKey))
    .forEach((record) => statuses.push({ label: "Cambio detectado", value: `${getCell(record, ["cambio anterio"])} → ${getCell(record, ["cambio actual"])}` }));
  return statuses;
}

function collectComments(workOrder, financial) {
  const comments = [];
  if (workOrder) {
    const comment = getCell(workOrder, ["COMENTARIOS", "COMENTARIO"]);
    if (comment) comments.push({ source: "OT", value: comment });
  }
  if (financial) {
    const informe = getCell(financial, ["INFORME"]);
    if (informe) comments.push({ source: "Informe", value: informe });
  }
  return comments;
}

function collectUpdates(workOrder, financial, billingRecords) {
  const updates = [];
  if (workOrder) updates.push({ label: "Solicitud", value: formatDateLabel(parseDate(getCell(workOrder, ["FECHA DE SOLICITUD", "Marca temporal"]))) });
  if (financial) updates.push({ label: "Resumen financiero", value: formatDateLabel(financial.normalized?.dateValue) });
  billingRecords.slice(-3).forEach((record, index) => {
    updates.push({ label: `Actividad ${index + 1}`, value: formatDateLabel(record.normalized?.dateValue || parseDate(getCell(record, ["FECHA"]))) });
  });
  return updates;
}

function collectResponsibles(workOrder, matrixRecords, billingRecords) {
  const people = new Set();
  if (workOrder) {
    const requester = getCell(workOrder, ["QUIEN SOLICITA", "QUIÉN SOLICITA"]);
    if (requester) people.add(requester);
  }
  matrixRecords.forEach((record) => {
    const buyer = getCell(record, ["Nombre de quien solicita/autoriza la SP", "Solicitante"]);
    if (buyer) people.add(buyer);
  });
  billingRecords.forEach((record) => {
    const collaborator = getCell(record, ["COLABORADOR", "colaborador"]);
    if (collaborator) people.add(collaborator);
  });
  return [...people];
}

function collectEvidenceLinks(workOrder, matrixRecords) {
  const links = [];
  if (workOrder) {
    const formatLink = getCell(workOrder, ["Por favor anexe el formato de actividades", "FORMATO DE ACTIVIDADES"]);
    if (formatLink) links.push({ label: "Formato actividades", value: formatLink });
    const infoLink = getCell(workOrder, ["LINK CON INFORMACIÓN"]);
    if (infoLink) links.push({ label: "Información adjunta", value: infoLink });
  }
  matrixRecords.forEach((record, index) => {
    const observation = getCell(record, ["Observación (Descripción General SP)", "Observación"]);
    if (String(observation).includes("http")) links.push({ label: `Evidencia SP ${index + 1}`, value: observation });
  });
  return links;
}

function toLegacyPendingItem(item) {
  return {
    id: item.id,
    title: item.title,
    detail: item.reasons?.[0] || item.subtitle,
    severity: item.severity,
  };
}

function toLegacyValidationItem(issue) {
  return {
    id: issue.id,
    title: `${issue.entityType} ${issue.entityId}`,
    detail: issue.issueMessage || issue.issueType,
    severity: issue.severity,
  };
}

function toLegacyAlertItem(alert) {
  return {
    id: alert.id,
    title: alert.entityName || `${alert.entityType} ${alert.entityId}`,
    detail: alert.alertMessage,
    severity: alert.severity,
  };
}

function formatDateLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric" });
}

function formatMoneyValue(value) {
  return formatMoney(Number(value) || 0);
}

function severityRank(severity) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function buildGeneratedAlert(rule, entityType, entityId, entityName, metricValue, metricLabel) {
  const template = rule.messageTemplate || rule.description || rule.name || "Alerta configurada";
  const message = metricValue == null
    ? template
    : template.replace("{value}", String(metricValue)).replace("{metric}", metricLabel);
  return {
    id: `generated-${rule.id || rule.name}-${entityId}`,
    ruleId: rule.id,
    entityType,
    entityId,
    entityName,
    alertMessage: message,
    severity: rule.severity || "warning",
    status: "open",
    detectedAt: new Date().toISOString().slice(0, 10),
    source: "rule",
  };
}

function addRecordToIndex(index, key, record) {
  const items = index.get(key) || [];
  items.push(record);
  index.set(key, items);
}

function addPurchaseOrdersToIndex(index, key, record) {
  const purchaseOrder = getCell(record, ["ORDENES DE COMPRA", "ORDEN DE COMPRA"]);
  const text = String(purchaseOrder || "").trim();
  if (!text) return;
  const orders = index.get(key) || new Set();
  orders.add(text);
  index.set(key, orders);
}

function isMatrixSource(record) {
  return normalizeText(record?.sourceName).includes(normalizeText("Matriz de Seguimiento"));
}

function isWorkOrderSourceRecord(record) {
  const isWorkOrderSource = normalizeText(record?.sourceName).includes(normalizeText("Ordenes de Trabajo TYC"));
  const isFormSheet = normalizeText(record?.sheetName).includes(normalizeText("respuestas de formulario 1"));
  return isWorkOrderSource && isFormSheet;
}

function isBillingSourceRecord(record) {
  const isActivitiesSource = normalizeText(record?.sourceName).includes(normalizeText("Reporte de Actividades Mantenimiento"));
  const isBillingSheet = normalizeText(record?.sheetName) === normalizeText("FACTURACION") || hasBillingTableHeaders(record);
  return isActivitiesSource && isBillingSheet;
}

function isFinancialSummarySourceRecord(record) {
  return (
    record?.sourceId === FINANCIAL_SUMMARY_SPREADSHEET_ID &&
    normalizeText(record?.sheetName) === normalizeText(FINANCIAL_SUMMARY_SHEET)
  );
}

function hasBillingTableHeaders(record) {
  const headers = record?.headers || [];
  const hasCollaborator = headers.some((header) => normalizeText(header) === normalizeText("COLABORADOR"));
  const hasBillingOt = headers.some((header) => normalizeText(header) === normalizeText("OT"));
  const hasActivity = headers.some((header) => normalizeText(header) === normalizeText("ACTIVIDAD REALIZADA"));
  return hasCollaborator && hasBillingOt && hasActivity;
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeSeverity(value) {
  const text = normalizeText(value);
  if (text === "critical" || text === "critico" || text === "alta") return "high";
  if (text === "warning" || text === "advertencia" || text === "media") return "medium";
  if (text === "info" || text === "baja") return "low";
  return text || "medium";
}

function isClosedOtStatus(status) {
  return CLOSED_OT_STATUSES.has(normalizeText(status));
}

function isPendingSpStatus(status) {
  const text = normalizeText(status);
  if (!text) return true;
  return !["aprobada", "completada", "cerrada", "finalizada", "entregada", "facturada"].some((item) => text.includes(item));
}

function isOpenIssueStatus(status) {
  const text = normalizeText(status);
  if (!text) return true;
  return OPEN_ISSUE_STATUSES.has(text);
}

export function isOpenAlertStatus(status) {
  const text = normalizeText(status);
  if (!text) return true;
  return OPEN_ALERT_STATUSES.has(text);
}

function parseBoolean(value) {
  const text = normalizeText(value);
  return !["false", "0", "no", "inactive", "inactivo"].includes(text);
}

function daysSince(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}
