import { parseDate } from "./helpers.js";
import { getCell } from "./dashboardOperations.js";

export const OPS_TIME_FILTER_OPTIONS = [
  { value: "all", label: "Total histórico" },
  { value: "current-year", label: "Año actual" },
  { value: "last-6-months", label: "Últimos 6 meses" },
  { value: "last-3-months", label: "Últimos 3 meses" },
  { value: "last-month", label: "Último mes" },
  { value: "last-week", label: "Última semana" },
  { value: "this-week", label: "Esta semana" },
  { value: "today", label: "Hoy" },
  { value: "month-0", label: "Enero" },
  { value: "month-1", label: "Febrero" },
  { value: "month-2", label: "Marzo" },
  { value: "month-3", label: "Abril" },
  { value: "month-4", label: "Mayo" },
  { value: "month-5", label: "Junio" },
  { value: "month-6", label: "Julio" },
  { value: "month-7", label: "Agosto" },
  { value: "month-8", label: "Septiembre" },
  { value: "month-9", label: "Octubre" },
  { value: "month-10", label: "Noviembre" },
  { value: "month-11", label: "Diciembre" },
];

const OPERATIONAL_DATE_FIELDS = [
  "Marca temporal",
  "FECHA DE SOLICITUD",
  "FECHA DE ENTREGA",
  "FECHA REAL ENTREGA",
  "FECHA ORDEN DE COMPRA",
  "FECHA APROBACION",
  "FECHA APROBACIÓN",
  "Fecha de Recepción de la SP  Nota: si no tiene fecha coloque la de la SP *",
  "Fecha de Recepcion de la SP",
  "Fecha de Recepción de la SP",
  "detected_at",
  "FECHA",
];

export function filterRecordsByOpsTimeRange(records, filter, selectedYear) {
  if (filter === "all") return records;
  const now = new Date();
  const monthMatch = getOpsMonthMatch(filter);
  return (records || []).filter((record) => {
    const date = getOperationalRecordDate(record);
    if (!date) return false;
    if (filter === "today") return isSameCalendarDay(date, now);
    if (monthMatch !== null) return date.getMonth() === monthMatch && date.getFullYear() === selectedYear;
    const range = getOpsDateRange(filter, now);
    if (!range) return true;
    return date >= range.start && date <= range.end;
  });
}

export function buildOpsAvailableYears(records) {
  const currentYear = new Date().getFullYear();
  const years = new Set([currentYear]);
  (records || []).forEach((record) => {
    const date = getOperationalRecordDate(record);
    if (date) years.add(date.getFullYear());
  });
  return [...years].sort((left, right) => right - left);
}

export function getOpsMonthMatch(filter) {
  if (!filter.startsWith("month-")) return null;
  const month = Number(filter.replace("month-", ""));
  return Number.isInteger(month) && month >= 0 && month <= 11 ? month : null;
}

export function getOpsTimeFilterLabel(filter, selectedYear) {
  const option = OPS_TIME_FILTER_OPTIONS.find((item) => item.value === filter) || OPS_TIME_FILTER_OPTIONS[0];
  const monthMatch = getOpsMonthMatch(filter);
  return monthMatch !== null ? `${option.label} ${selectedYear}` : option.label;
}

export function getOperationalRecordDate(record) {
  if (record?.normalized?.dateValue instanceof Date && !Number.isNaN(record.normalized.dateValue.getTime())) {
    return record.normalized.dateValue;
  }
  for (const field of OPERATIONAL_DATE_FIELDS) {
    const parsed = parseDate(getCell(record, [field]));
    if (parsed) return parsed;
  }
  return null;
}

function getOpsDateRange(filter, now) {
  if (filter === "current-year") {
    return { start: startOfDay(new Date(now.getFullYear(), 0, 1)), end: endOfDay(now) };
  }
  if (filter === "last-6-months") {
    return { start: startOfDay(addMonths(now, -6)), end: endOfDay(now) };
  }
  if (filter === "last-3-months") {
    return { start: startOfDay(addMonths(now, -3)), end: endOfDay(now) };
  }
  if (filter === "last-month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { start: startOfDay(start), end };
  }
  if (filter === "last-week") {
    return { start: startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), end: endOfDay(now) };
  }
  if (filter === "this-week") {
    return { start: getStartOfCalendarWeek(now), end: endOfDay(now) };
  }
  return null;
}

export function getStartOfCalendarWeek(date) {
  const day = date.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysFromMonday));
}

function isSameCalendarDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}
