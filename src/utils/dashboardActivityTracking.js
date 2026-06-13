import { cleanKey, formatMoney, normalizeText, parseDate, parseMoney } from "./helpers.js";
import { getCell as getOpsCell } from "./dashboardOperations.js";

const MAINTENANCE_SOURCE = "Reporte de Actividades Mantenimiento";

export function isMaintenanceSourceRecord(record) {
  return normalizeText(record?.sourceName).includes(normalizeText(MAINTENANCE_SOURCE));
}

export function isMaintenanceBillingRecord(record) {
  if (!isMaintenanceSourceRecord(record)) return false;
  const hasBillingHeaders = record.headers?.some((header) => normalizeText(header) === normalizeText("COLABORADOR"))
    && record.headers?.some((header) => normalizeText(header) === normalizeText("ACTIVIDAD REALIZADA"));
  return normalizeText(record?.sheetName || "").includes(normalizeText("FACTURACION")) || hasBillingHeaders;
}

export function isMaintenanceFormRecord(record) {
  if (!isMaintenanceSourceRecord(record)) return false;
  if (normalizeText(record?.sheetName) === normalizeText("FACTURACION")) return false;
  if (!normalizeText(record?.sheetName || "").includes(normalizeText("respuestas de formulario 1"))) return false;
  const hasCollaborator = record.headers?.some((header) => normalizeText(header) === normalizeText("COLABORADOR"));
  const hasActivityTime = record.headers?.some((header) => normalizeText(header).includes(normalizeText("tiempo de la actividad")));
  return hasCollaborator && hasActivityTime;
}

export function buildMaintenanceActivityTracking(records, filters = {}) {
  return applyMaintenanceActivityFilters(buildMergedMaintenanceActivities(records), filters);
}

export function buildMergedMaintenanceActivities(records) {
  const formRecords = [];
  const billingRecords = [];

  for (const record of records || []) {
    if (!isMaintenanceSourceRecord(record)) continue;
    if (isMaintenanceFormRecord(record)) formRecords.push(record);
    if (isMaintenanceBillingRecord(record)) billingRecords.push(record);
  }

  const formEquipmentByKey = new Map();
  const formDetailsByKey = new Map();

  formRecords.forEach((record) => {
    const key = buildActivityMatchKey(record);
    const equipment = getActivityEquipment(record);
    if (equipment && !isPlaceholderEquipment(equipment)) formEquipmentByKey.set(key, equipment);
    formDetailsByKey.set(key, extractFormActivityDetails(record));
  });

  const merged = new Map();

  billingRecords.forEach((record) => {
    upsertMaintenanceActivity(merged, record, formEquipmentByKey, formDetailsByKey, true);
  });

  formRecords.forEach((record) => {
    upsertMaintenanceActivity(merged, record, formEquipmentByKey, formDetailsByKey, false);
  });

  return [...merged.values()]
    .map(formatMaintenanceActivity)
    .filter((activity) => activity.collaborator || activity.equipment);
}

export function applyMaintenanceActivityFilters(activities, filters = {}) {
  const equipmentOptions = buildFilterOptions(activities, "equipment");
  const collaboratorOptions = buildFilterOptions(activities, "collaborator");
  const processOptions = buildFilterOptions(activities, "process");
  const filtered = activities.filter((activity) => matchesMaintenanceFilters(activity, filters));
  const summary = buildMaintenanceSummary(filtered);

  return {
    summary,
    activities: filtered.sort((left, right) => (right.date?.getTime() || 0) - (left.date?.getTime() || 0)),
    equipmentOptions,
    collaboratorOptions,
    processOptions,
    totalInPeriod: activities.length,
  };
}

function upsertMaintenanceActivity(target, record, formEquipmentByKey, formDetailsByKey, isBilling) {
  const key = buildActivityMatchKey(record);
  const formDetails = formDetailsByKey.get(key) || {};
  const equipment = resolveActivityEquipment(record, formEquipmentByKey) || formDetails.equipment || "";
  const collaborator = getActivityCollaborator(record) || formDetails.collaborator || "";
  if (!collaborator && (!equipment || isPlaceholderEquipment(equipment))) return;

  const hours = getActivityHours(record);
  const cost = getActivityLaborCost(record);
  const existing = target.get(key) || {
    id: key,
    date: null,
    collaborator: "",
    equipment: "",
    ot: "",
    process: "",
    activityType: "",
    description: "",
    spareParts: "",
    hours: 0,
    cost: 0,
    sources: new Set(),
  };

  const date = getActivityRecordDate(record) || existing.date;
  existing.date = date || existing.date;
  existing.collaborator = collaborator || existing.collaborator;
  existing.equipment = (!isPlaceholderEquipment(equipment) ? equipment : "") || existing.equipment;
  existing.ot = getActivityOt(record) || formDetails.ot || existing.ot;
  existing.process = getActivityProcess(record) || formDetails.process || existing.process;
  existing.activityType = getActivityType(record) || formDetails.activityType || existing.activityType;
  existing.description = getActivityDescription(record) || formDetails.description || existing.description;
  existing.spareParts = getActivitySpareParts(record) || formDetails.spareParts || existing.spareParts;
  existing.hours = Math.max(existing.hours, hours, formDetails.hours || 0);
  existing.cost = Math.max(existing.cost, cost);
  existing.sources.add(isBilling ? "FACTURACION" : "Formulario 1");
  target.set(key, existing);
}

function formatMaintenanceActivity(activity) {
  return {
    ...activity,
    sources: [...activity.sources],
    dateLabel: formatActivityDateLabel(activity.date),
    equipmentKey: cleanKey(activity.equipment),
    collaboratorKey: cleanKey(activity.collaborator),
    processKey: cleanKey(activity.process),
  };
}

function buildMaintenanceSummary(activities) {
  const ots = new Set();
  let hours = 0;
  let cost = 0;
  activities.forEach((activity) => {
    hours += activity.hours || 0;
    cost += activity.cost || 0;
    if (activity.ot && !isPlaceholderOt(activity.ot)) ots.add(normalizeActivityOtKey(activity.ot));
  });
  return {
    activities: activities.length,
    hours,
    cost,
    ots: ots.size,
  };
}

function buildFilterOptions(activities, field) {
  const keyField = field === "equipment" ? "equipmentKey" : field === "collaborator" ? "collaboratorKey" : "processKey";
  const labelField = field === "equipment" ? "equipment" : field === "collaborator" ? "collaborator" : "process";
  const options = new Map();
  activities.forEach((activity) => {
    const key = activity[keyField];
    const label = String(activity[labelField] || "").trim();
    if (!key || !label) return;
    options.set(key, label);
  });
  return [...options.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
}

function matchesMaintenanceFilters(activity, filters) {
  if (filters.equipment && activity.equipmentKey !== filters.equipment) return false;
  if (filters.collaborator && activity.collaboratorKey !== filters.collaborator) return false;
  if (filters.process && activity.processKey !== filters.process) return false;
  return true;
}

function extractFormActivityDetails(record) {
  return {
    equipment: getActivityEquipment(record),
    collaborator: getActivityCollaborator(record),
    ot: getActivityOt(record),
    process: getActivityProcess(record),
    activityType: getActivityType(record),
    description: getActivityDescription(record),
    spareParts: getActivitySpareParts(record),
    hours: getActivityHours(record),
  };
}

function resolveActivityEquipment(record, formEquipmentByKey) {
  const directEquipment = getActivityEquipment(record);
  if (directEquipment && !isPlaceholderEquipment(directEquipment)) return directEquipment;
  return formEquipmentByKey.get(buildActivityMatchKey(record)) || "";
}

function getActivityEquipment(record) {
  const billingEquipment = getCell(record, ["EQUIPO INTERVENIDO"], ["equipo intervenido"]);
  if (billingEquipment && !isPlaceholderEquipment(billingEquipment)) return billingEquipment;

  const equipmentColumns = [
    "EQUIPO PRODUCCION",
    "EQUIPO OBRAS",
    "EQUIPO LOGISTICA",
    "EQUIPO MANTENIMIENTO",
    "EQUIPO ALQUILADO",
    "DESCRIPCION DEL EQUIPO INTERVENIDO",
    "DESCRIPCION DEL EQUIPO ALQUILADO",
    "OTRO EQUIPO",
    "EQUIPO",
    "MAQUINA",
    "MÁQUINA",
    "ACTIVO",
  ];
  for (const column of equipmentColumns) {
    const value = String(getCell(record, [column]) || "").trim();
    if (value && !isPlaceholderEquipment(value)) return value;
  }

  const normalizedEquipment = String(record.normalized?.equipment || "").trim();
  return normalizedEquipment && !isPlaceholderEquipment(normalizedEquipment) ? normalizedEquipment : "";
}

function getActivityCollaborator(record) {
  return String(getCell(record, ["COLABORADOR", "colaborador", "TECNICO", "TÉCNICO"]) || record.normalized?.technician || "").trim();
}

function getActivityOt(record) {
  const candidates = [
    getCell(record, ["OT - REPORTE DE CAMPO"]),
    getCell(record, ["ORDEN DE TRABAJO/REPORTE DE CAMPO"]),
    getCell(record, ["OT"]),
    getCell(record, ["ORDEN DE TRABAJO"]),
    record.normalized?.work_order,
  ];
  for (const raw of candidates) {
    const label = formatActivityOtLabel(raw);
    if (label) return label;
  }
  return "";
}

function formatActivityOtLabel(raw) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text || isPlaceholderOt(text)) return "";
  return text;
}

function isPlaceholderOt(value) {
  const text = normalizeText(value);
  return !text || text === "na" || text === "n/a" || text === "n-a" || text === "n a" || text === "sin ot";
}

function normalizeActivityOtKey(value) {
  const text = String(value || "").trim();
  if (!text || isPlaceholderOt(text)) return "";
  const match = text.match(/(?:OT\s*[-:]?\s*)?(\d+)/i);
  return match ? String(Number(match[1])) : cleanKey(text);
}

function getActivityHours(record) {
  return parseActivityHours(
    getCell(record, ["TIEMPO DE LA ACTIVIDAD", "HORAS", "HH"]) || record.normalized?.hoursNumber,
  );
}

function getActivityProcess(record) {
  return String(getCell(record, [
    "PROCESO AL QUE SE FACTURA LA ACTIVIDAD",
    "PROCESO AL QUE PERTENECE EL EQUIPO",
    "PROCESO",
  ]) || "").trim();
}

function getActivityType(record) {
  return String(getCell(record, [
    "ACTIVIDAD REALIZADA",
    "TIPO DE ACTIVIDAD",
    "ACTIVIDAD",
  ]) || "").trim();
}

function getActivityDescription(record) {
  const billingActivity = getCell(record, ["ACTIVIDAD REALIZADA", "ACTIVIDAD"]);
  const formDescription = getCell(record, ["DESCRIPCION DE LA ACTIVIDAD", "DESCRIPCIÓN DE LA ACTIVIDAD"]);
  return String(billingActivity || formDescription || "").trim();
}

function getActivitySpareParts(record) {
  return String(getCell(record, ["REPUESTOS UTILIZADOS", "REPUESTOS"]) || "").trim();
}

function getActivityLaborCost(record) {
  return parseMoney(getCell(record, [
    "VALOR DE LA ACTIVIDAD",
    "Costo Total",
    "COSTO TOTAL",
    "VALOR TOTAL",
    "TOTAL",
  ]));
}

function buildActivityMatchKey(record) {
  const stamp = String(getCell(record, ["FECHA REPORTE", "Marca temporal", "FECHA"]) || "").trim();
  const collaborator = cleanKey(getActivityCollaborator(record));
  const base = `${stamp}|${collaborator}`;
  return base.replace(/\|/g, "") ? base : (record.uid || record.id || base);
}

function getActivityRecordDate(record) {
  return (
    parseDate(getCell(record, ["Marca temporal"]))
    || parseDate(getCell(record, ["FECHA REPORTE"]))
    || parseDate(getCell(record, ["FECHA"]))
    || null
  );
}

function formatActivityDateLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isPlaceholderEquipment(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  if (raw.startsWith("#")) return true;
  const text = normalizeText(raw);
  return !text || text === "na" || text === "n/a" || text === "n-a" || text === "n a";
}

function parseActivityHours(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getHours() + value.getMinutes() / 60 + value.getSeconds() / 3600;
  if (typeof value === "number") return value >= 0 && value <= 1 ? value * 24 : value;
  const text = String(value || "").trim().replace(",", ".");
  if (!text) return 0;
  if (text.includes(":")) {
    const [hours = 0, minutes = 0, seconds = 0] = text.split(":").map((part) => Number(part) || 0);
    return hours + minutes / 60 + seconds / 3600;
  }
  return Number(text) || 0;
}

const HEADER_LOOKUP_CACHE = new WeakMap();

function getCell(record, names, containsNames = []) {
  if (!record) return "";
  const lookup = getHeaderLookup(record);
  if (lookup) {
    for (const name of names) {
      const header = lookup.byNormalizedHeader.get(normalizeHeader(name));
      const value = header ? record.cells?.[header] : "";
      if (header && value !== undefined && String(value || "").trim()) return value;
    }
    for (const name of containsNames) {
      const target = normalizeHeader(name);
      const match = lookup.normalizedHeaders.find((item) => item.normalized.includes(target));
      const value = match ? record.cells?.[match.header] : "";
      if (match && value !== undefined && String(value || "").trim()) return value;
    }
  }
  return getOpsCell(record, names, containsNames);
}

function getHeaderLookup(record) {
  const headers = record?.headers;
  if (!headers?.length) return null;
  let cached = HEADER_LOOKUP_CACHE.get(record);
  if (cached) return cached;
  const byNormalizedHeader = new Map();
  const normalizedHeaders = [];
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (!byNormalizedHeader.has(normalized)) byNormalizedHeader.set(normalized, header);
    normalizedHeaders.push({ header, normalized });
  }
  cached = { byNormalizedHeader, normalizedHeaders };
  HEADER_LOOKUP_CACHE.set(record, cached);
  return cached;
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

export function formatMaintenanceSummaryLine(summary) {
  return `${summary.activities} actividades · ${formatMoney(summary.cost)} · ${summary.hours.toFixed(1)} horas · ${summary.ots} OT`;
}
