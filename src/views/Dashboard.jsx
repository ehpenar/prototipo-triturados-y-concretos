import React, { Suspense, lazy, useMemo, useState } from "react";
import { sum, cleanKey, formatMoney, normalizeText, parseMoney, parseDate } from "../utils/helpers.js";
import { EmptyState } from "../components/EmptyState.jsx";
import { useDeferredMount } from "../components/dashboard/useDeferredMount.js";
import { buildDashboardSmartAlerts } from "../utils/dashboardSmartAlerts.js";
import {
  OPS_TIME_FILTER_OPTIONS,
  buildOpsAvailableYears,
  filterRecordsByOpsTimeRange,
  getOpsMonthMatch,
  getOpsTimeFilterLabel,
  getStartOfCalendarWeek,
} from "../utils/opsTimeFilter.js";

const DashboardOperaciones = lazy(() =>
  import("../components/dashboard/DashboardOperaciones.jsx").then((module) => ({ default: module.DashboardOperaciones })),
);

const WORK_ORDERS_SPREADSHEET_ID = "1NUd2guWTtB1qEGUQ4i04kuARnU8Bu7trkJRhiSs79ns";
const WORK_ORDERS_SHEET_ID = "1862269386";
const WORK_ORDERS_SOURCE_NAME = "ORDENES DE TRABAJO TYC";
const WORK_ORDERS_SHEET_NAME = "copia de prueba respuestas de formulario 1";

const KPI_SOURCE_DETAILS = {
  records: "Fuente: todos los documentos sincronizados desde Fuentes.",
  workOrders: "Fuente: ORDENES DE TRABAJO TYC / copia de prueba respuestas de formulario 1. Columna usada: OT.",
  cost: "Fuente: Matriz de Seguimiento / Respuestas de formulario 1. Columna usada: VALOR COMPRA.",
  hours: "Fuente: registros clasificados con columnas de tiempo y consolidado actual de mano de obra.",
  equipment: "Fuente: todos los documentos sincronizados. Columnas: EQUIPO, MAQUINA, MÁQUINA o ACTIVO.",
};

const RANKING_SOURCE_DETAILS = {
  cost: {
    label: "Ranking por costos",
    description: "Cruza OTs y costos detectados. Usa MANO OBRA desde HOJA RESUMEN FINANCIERO OTS / Hoja 2 y compras desde Matriz de Seguimiento. Si no hay costos válidos, muestra una agrupación secundaria por equipo detectado.",
    columns: "OT, MANO OBRA, VALOR COMPRA (AGREGAR), VALOR COMPRA, VALOR DE COMPRA, VALOR DE LA COMPRA, ORDENES DE COMPRA",
  },
  equipment: {
    label: "Ranking por equipos",
    description: "Agrupa registros por equipo detectado en las hojas sincronizadas y suma los costos/horas relacionados por OT cuando existen.",
    columns: "EQUIPO, MAQUINA, MÁQUINA, ACTIVO, OT",
  },
  people: {
    label: "Ranking por técnicos",
    description: "Agrupa actividades por colaborador o técnico y acumula horas cuando la hoja trae columnas de tiempo.",
    columns: "COLABORADOR, TECNICO, TÉCNICO, TIEMPO DE LA ACTIVIDAD, HORAS, HH",
  },
  providers: {
    label: "Ranking por proveedores",
    description: "Usa solamente registros de Matriz de Seguimiento para agrupar compras por proveedor.",
    columns: "PROVEEDOR, EMPRESA, TERCERO, VALOR COMPRA, ORDENES DE COMPRA",
  },
};

const ALERTS_SOURCE_DETAIL = "Fuente: ORDENES DE TRABAJO TYC y Matriz de Seguimiento. Detecta OT en SIN REVISAR, fechas compromiso vencidas, SP sin orden de compra, compras elevadas y validaciones críticas. El periodo filtra por Marca temporal, FECHA DE SOLICITUD o recepción de SP.";
const TREND_MODE_OPTIONS = [
  {
    value: "ots",
    label: "OTs creadas",
    subtitle: "Nuevas OT por mes (ORDENES DE TRABAJO TYC)",
    sourceDetail: "Fuente: ORDENES DE TRABAJO TYC. Fecha: Marca temporal o FECHA DE SOLICITUD. Desglose por columna ESTADO: EN PROCESO, SIN REVISAR, MATERIALES PENDIENTES, TERMINADO u otros.",
    valueLabel: "OTs",
    format: "count",
  },
  {
    value: "sps",
    label: "SPs en matriz",
    subtitle: "Solicitudes de pedido por mes (Matriz de Seguimiento)",
    sourceDetail: "Fuente: Matriz de Seguimiento. Fecha: Fecha de Recepción de la SP. Desglose por Estado Actual de la SP: ENTREGADO, EN PROCESO DE PAGO u otras pendientes.",
    valueLabel: "SPs",
    format: "count",
  },
  {
    value: "matrix-cost",
    label: "Costo compras",
    subtitle: "Valor de compra por mes",
    sourceDetail: "Fuente: Matriz de Seguimiento / Respuestas de formulario 1. Suma VALOR COMPRA por mes según fecha de recepción de la SP.",
    valueLabel: "Costo",
    format: "money",
  },
];
const KPI_TIME_FILTER_OPTIONS = [
  { value: "all", label: "Total histórico" },
  { value: "current-year", label: "Año actual" },
  { value: "last-6-months", label: "Últimos 6 meses" },
  { value: "last-3-months", label: "Últimos 3 meses" },
  { value: "last-month", label: "Último mes" },
  { value: "last-week", label: "Última semana" },
  { value: "this-week", label: "Esta semana" },
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

export function Dashboard({ documents, records, sourceRecords, rankingMode, setRankingMode }) {
  const [kpiTimeFilter, setKpiTimeFilter] = useState("all");
  const [kpiYearFilter, setKpiYearFilter] = useState(() => new Date().getFullYear());
  const [trendMode, setTrendMode] = useState("ots");
  const [alertsTimeFilter, setAlertsTimeFilter] = useState("all");
  const [alertsYearFilter, setAlertsYearFilter] = useState(() => new Date().getFullYear());
  const isMonthFilter = getKpiMonthMatch(kpiTimeFilter) !== null;
  const isAlertsMonthFilter = getOpsMonthMatch(alertsTimeFilter) !== null;
  const availableYears = useMemo(() => buildAvailableYears(records), [records]);
  const timeFilteredRecords = useMemo(
    () => filterRecordsByKpiTimeRange(records, kpiTimeFilter, kpiYearFilter),
    [records, kpiTimeFilter, kpiYearFilter],
  );
  const selectedTimeFilter = KPI_TIME_FILTER_OPTIONS.find((option) => option.value === kpiTimeFilter) || KPI_TIME_FILTER_OPTIONS[0];
  const selectedTimeLabel = isMonthFilter ? `${selectedTimeFilter.label} ${kpiYearFilter}` : selectedTimeFilter.label;
  const dashboardMetrics = useMemo(
    () => buildDashboardMetrics(records, timeFilteredRecords),
    [records, timeFilteredRecords],
  );
  const otMetrics = useMemo(() => buildOtMetrics(records), [records]);
  const rankingsByMode = useMemo(
    () => ({
      cost: buildOperationalRanking(records, "cost", otMetrics),
      equipment: buildOperationalRanking(records, "equipment", otMetrics),
      people: buildOperationalRanking(records, "people", otMetrics),
      providers: buildOperationalRanking(records, "providers", otMetrics),
    }),
    [records, otMetrics],
  );
  const operationalRecords = sourceRecords || records;
  const alertsAvailableYears = useMemo(() => buildOpsAvailableYears(operationalRecords), [operationalRecords]);
  const alertsFilteredRecords = useMemo(
    () => filterRecordsByOpsTimeRange(operationalRecords, alertsTimeFilter, alertsYearFilter),
    [operationalRecords, alertsTimeFilter, alertsYearFilter],
  );
  const alertsTimeLabel = getOpsTimeFilterLabel(alertsTimeFilter, alertsYearFilter);
  const smartAlerts = useMemo(
    () => buildDashboardSmartAlerts(alertsFilteredRecords),
    [alertsFilteredRecords],
  );
  const operationalTrend = useMemo(() => buildOperationalTrend(records, trendMode), [records, trendMode]);
  const selectedTrendMode = TREND_MODE_OPTIONS.find((option) => option.value === trendMode) || TREND_MODE_OPTIONS[0];
  const { isReady: showOperations, sentinelRef: operationsSentinelRef } = useDeferredMount();

  return (
    <section className="view active">
      <section className="panel dashboard-kpi-filter">
        <div>
          <h2>Filtro temporal de KPIs</h2>
          <p className="note">
            Aplica solo a Costo detectado y Horas. Los demás indicadores conservan el total histórico.
          </p>
        </div>
        <div className="dashboard-kpi-filter-controls">
          <label>
            Periodo
            <select value={kpiTimeFilter} onChange={(event) => setKpiTimeFilter(event.target.value)}>
              {KPI_TIME_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {isMonthFilter && (
            <label>
              Año
              <select value={kpiYearFilter} onChange={(event) => setKpiYearFilter(Number(event.target.value))}>
                {availableYears.map((year) => (
                  <option key={`kpi-year-${year}`} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>
      <div className="kpi-grid">
        <Kpi label="Registros" value={records.length} hint={`${documents.length} documentos conectados`} source={KPI_SOURCE_DETAILS.records} />
        <Kpi label="Filas OT" value={dashboardMetrics.workOrderRows} hint="Columna OT en ORDENES DE TRABAJO TYC" source={KPI_SOURCE_DETAILS.workOrders} />
        <Kpi label="Costo detectado" value={formatMoney(dashboardMetrics.totalCost)} hint={`Compras realizadas (VALOR COMPRA) · ${selectedTimeLabel}`} source={KPI_SOURCE_DETAILS.cost} />
        <Kpi
          label="Horas"
          value={`${dashboardMetrics.totalHours.toFixed(1)} horas`}
          hint={`Horas reconocidas en reportes · ${selectedTimeLabel}`}
          source={KPI_SOURCE_DETAILS.hours}
          extraDetail={`Valor Mano de Obra: ${formatMoney(dashboardMetrics.totalLaborValue)}`}
        />
        <Kpi label="Equipos" value={dashboardMetrics.equipmentCount} hint="Activos detectados dinamicamente" source={KPI_SOURCE_DETAILS.equipment} />
      </div>
      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>Alertas inteligentes</h2>
            <span className="muted">{smartAlerts.length} alertas · {alertsTimeLabel}</span>
          </div>
          <div className="dashboard-kpi-filter-controls dashboard-alerts-filter">
            <label>
              Periodo
              <select value={alertsTimeFilter} onChange={(event) => setAlertsTimeFilter(event.target.value)}>
                {OPS_TIME_FILTER_OPTIONS.map((option) => (
                  <option key={`alerts-time-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {isAlertsMonthFilter && (
              <label>
                Año
                <select value={alertsYearFilter} onChange={(event) => setAlertsYearFilter(Number(event.target.value))}>
                  {alertsAvailableYears.map((year) => (
                    <option key={`alerts-year-${year}`} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <SourceNote text={ALERTS_SOURCE_DETAIL} />
          <Alerts alerts={smartAlerts} />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Rankings dinamicos</h2>
            <select value={rankingMode} onChange={(event) => setRankingMode(event.target.value)}>
              <option value="cost">Costos</option>
              <option value="equipment">Equipos</option>
              <option value="people">Tecnicos</option>
              <option value="providers">Proveedores</option>
            </select>
          </div>
          <Rankings ranking={rankingsByMode[rankingMode] || []} mode={rankingMode} />
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Tendencias operacionales</h2>
          <select value={trendMode} onChange={(event) => setTrendMode(event.target.value)}>
            {TREND_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <p className="note" style={{ marginTop: 0 }}>
          {selectedTrendMode.subtitle} · últimos 12 meses calendario
        </p>
        <SourceNote text={selectedTrendMode.sourceDetail} />
        <TrendComparison comparison={operationalTrend.comparison} format={selectedTrendMode.format} valueLabel={selectedTrendMode.valueLabel} />
        <TrendChart format={selectedTrendMode.format} mode={trendMode} points={operationalTrend.points} />
        <p className="muted trend-legend">
          Eje: mes/año · Altura: {selectedTrendMode.format === "money" ? "suma de VALOR COMPRA" : `cantidad de ${selectedTrendMode.valueLabel}`}
          {trendMode === "ots" ? " · Pasa el cursor sobre cada barra para ver EN PROCESO, SIN REVISAR, MATERIALES PENDIENTES, etc." : ""}
          {trendMode === "sps" ? " · Pasa el cursor sobre cada barra para ver ENTREGADO, EN PROCESO DE PAGO u otras pendientes" : ""}
        </p>
      </section>
      <div ref={operationsSentinelRef} style={{ height: 1, width: "100%" }} aria-hidden="true" />
      {showOperations ? (
        <Suspense fallback={<section className="panel"><p className="muted">Cargando herramientas operativas...</p></section>}>
          <DashboardOperaciones records={operationalRecords} />
        </Suspense>
      ) : (
        <section className="panel">
          <p className="muted">Las herramientas operativas se cargan al acercarte a esta sección.</p>
        </section>
      )}
    </section>
  );
}

function buildDashboardMetrics(allRecords, timeFilteredRecords) {
  const equipmentKeys = new Set();
  let workOrderRows = 0;
  let totalCost = 0;
  let totalHours = 0;
  let totalLaborValue = 0;

  allRecords.forEach((record) => {
    const equipment = cleanKey(record.normalized.equipment);
    if (equipment) equipmentKeys.add(equipment);

    if (isWorkOrdersRecord(record)) {
      const matchingHeader = record.headers.find((header) => normalizeText(header) === "ot");
      const value = String(record.cells[matchingHeader] || "").trim();
      if (matchingHeader && /\d/.test(value)) workOrderRows += 1;
    }
  });

  timeFilteredRecords.forEach((record) => {
    if (isDashboardMatrixCostRecord(record)) totalCost += getMatrixPurchaseValue(record);
    totalHours += record.normalized.hoursNumber || 0;
    if (isDashboardBillingCostRecord(record)) totalLaborValue += getBillingCostValue(record);
  });

  return {
    totalCost,
    totalHours,
    totalLaborValue,
    equipmentCount: equipmentKeys.size,
    workOrderRows,
  };
}

function buildOperationalTrend(records, mode) {
  const trendByMonth = new Map();

  records.forEach((record) => {
    const date = getTrendDateForRecord(record, mode);
    if (!date) return;

    const month = formatMonthKey(date);
    const current = trendByMonth.get(month) || createTrendBucket(mode, month);
    if (mode === "matrix-cost") {
      current.value += getMatrixPurchaseValue(record);
    } else if (mode === "sps") {
      current.value += 1;
      const spBucket = classifySpTrendStatus(getSpStatus(record));
      current[spBucket] += 1;
    } else {
      current.value += 1;
      const otBucket = classifyOtTrendStatus(getOtStatus(record));
      current[otBucket] += 1;
    }
    trendByMonth.set(month, current);
  });

  const points = buildTrendMonthSeries(trendByMonth, mode);

  return {
    points,
    comparison: buildTrendComparison(points),
  };
}

const TREND_MIN_YEAR = 2020;

function buildTrendMonthSeries(trendByMonth, mode) {
  const validMonths = [...trendByMonth.keys()].sort();
  if (!validMonths.length) return [];

  const latestMonth = validMonths[validMonths.length - 1];
  const [latestYear, latestMonthNumber] = latestMonth.split("-").map(Number);
  const monthKeys = [];
  let year = latestYear;
  let month = latestMonthNumber;

  for (let index = 0; index < 12; index += 1) {
    monthKeys.unshift(formatMonthKeyFromParts(year, month));
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }

  return monthKeys.map((monthKey) => trendByMonth.get(monthKey) || createTrendBucket(mode, monthKey));
}

function formatMonthKeyFromParts(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function isValidTrendDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const year = date.getFullYear();
  const maxYear = new Date().getFullYear() + 1;
  return year >= TREND_MIN_YEAR && year <= maxYear;
}

function parseTrendDate(value) {
  const date = parseDate(value);
  return isValidTrendDate(date) ? date : null;
}

function createTrendBucket(mode, month) {
  if (mode === "ots") {
    return {
      month,
      value: 0,
      enProceso: 0,
      sinRevisar: 0,
      materialesPendientes: 0,
      terminado: 0,
      otros: 0,
    };
  }
  if (mode === "sps") {
    return {
      month,
      value: 0,
      entregadas: 0,
      enProcesoPago: 0,
      otrasPendientes: 0,
    };
  }
  return { month, value: 0 };
}

function getTrendDateForRecord(record, mode) {
  if (mode === "ots") {
    if (!isWorkOrdersRecord(record)) return null;
    const ot = getRecordOt(record);
    if (!ot || !/\d/.test(ot)) return null;
    return (
      parseTrendDate(getCell(record, ["Marca temporal"]))
      || parseTrendDate(getCell(record, ["FECHA DE SOLICITUD"]))
      || parseTrendDate(getCell(record, ["FECHA"]))
      || null
    );
  }

  if (mode === "sps" || mode === "matrix-cost") {
    if (!isMatrixRecord(record)) return null;
    if (mode === "matrix-cost" && !isDashboardMatrixCostRecord(record)) return null;
    return (
      parseTrendDate(getCell(record, [
        "Fecha de Recepción de la SP  Nota: si no tiene fecha coloque la de la SP *",
        "Fecha de Recepcion de la SP",
        "Fecha de Recepción de la SP",
      ]))
      || parseTrendDate(getCell(record, ["Marca temporal"]))
      || null
    );
  }

  return null;
}

function getOtStatus(record) {
  return String(getCell(record, ["ESTADO"]) || record.normalized?.status || "").trim();
}

function getSpStatus(record) {
  return String(getCell(record, ["Estado Actual de la SP*", "Estado Actual de la SP", "Estado Actual", "Estado"]) || "").trim();
}

function classifyOtTrendStatus(status) {
  const text = normalizeText(status);
  if (!text) return "otros";
  if (text.includes("materialespendientes") || text.includes("materialpendiente")) return "materialesPendientes";
  if (text.includes("sinrevisar")) return "sinRevisar";
  if (text.includes("enproceso")) return "enProceso";
  if (["terminado", "cerrado", "finalizado", "completado", "revision"].some((item) => text.includes(item))) return "terminado";
  return "otros";
}

function classifySpTrendStatus(status) {
  const text = normalizeText(status);
  if (!text) return "otrasPendientes";
  if (text.includes("entregado")) return "entregadas";
  if (text.includes("procesodepago")) return "enProcesoPago";
  return "otrasPendientes";
}

function buildTrendTooltip(point, format, mode) {
  const parts = [`Total: ${formatTrendValue(point.value, format)}`];
  if (mode === "ots") {
    if (point.enProceso) parts.push(`EN PROCESO: ${point.enProceso}`);
    if (point.sinRevisar) parts.push(`SIN REVISAR: ${point.sinRevisar}`);
    if (point.materialesPendientes) parts.push(`MATERIALES PENDIENTES: ${point.materialesPendientes}`);
    if (point.terminado) parts.push(`TERMINADO: ${point.terminado}`);
    if (point.otros) parts.push(`Otros estado: ${point.otros}`);
  }
  if (mode === "sps") {
    if (point.entregadas) parts.push(`ENTREGADO: ${point.entregadas}`);
    if (point.enProcesoPago) parts.push(`EN PROCESO DE PAGO: ${point.enProcesoPago}`);
    if (point.otrasPendientes) parts.push(`Otras pendientes: ${point.otrasPendientes}`);
  }
  return parts.join(" · ");
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatTrendMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return monthKey;
  return `${names[monthIndex]} ${year}`;
}

function formatTrendValue(value, format) {
  return format === "money" ? formatMoney(value) : String(Math.round(value));
}

function buildTrendComparison(points) {
  if (points.length < 2) return null;
  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  const percentChange = previous.value
    ? ((current.value - previous.value) / previous.value) * 100
    : (current.value ? 100 : 0);
  return { current, previous, percentChange };
}

function TrendComparison({ comparison, format, valueLabel }) {
  if (!comparison) return null;
  const { current, previous, percentChange } = comparison;
  const trendLabel = percentChange > 0 ? "sube" : percentChange < 0 ? "baja" : "se mantiene";
  const signedChange = `${percentChange > 0 ? "+" : ""}${percentChange.toFixed(1)}%`;
  return (
    <p className="note trend-comparison">
      Comparación mensual: {formatTrendMonthLabel(current.month)} ({formatTrendValue(current.value, format)} {valueLabel})
      {" vs "}
      {formatTrendMonthLabel(previous.month)} ({formatTrendValue(previous.value, format)} {valueLabel})
      {" · "}
      Variación: <strong>{signedChange}</strong> ({trendLabel})
    </p>
  );
}

function isWorkOrdersRecord(record) {
  const isTargetDocument =
    record.sourceId === WORK_ORDERS_SPREADSHEET_ID ||
    normalizeText(record.sourceName).includes(normalizeText(WORK_ORDERS_SOURCE_NAME));
  const isTargetSheet =
    String(record.id || "").includes(`:${WORK_ORDERS_SHEET_ID}:`) ||
    normalizeText(record.sheetName) === normalizeText(WORK_ORDERS_SHEET_NAME);

  return isTargetDocument && isTargetSheet;
}

function filterRecordsByKpiTimeRange(records, filter, selectedYear) {
  if (filter === "all") return records;
  const now = new Date();
  const rangeStart = getKpiRangeStart(filter, now);
  const monthMatch = getKpiMonthMatch(filter);
  return records.filter((record) => {
    const date = record.normalized.dateValue;
    if (!date) return false;
    if (monthMatch !== null) return date.getMonth() === monthMatch && date.getFullYear() === selectedYear;
    return rangeStart ? date >= rangeStart && date <= now : true;
  });
}

function buildAvailableYears(records) {
  const currentYear = new Date().getFullYear();
  const years = new Set([currentYear]);
  records.forEach((record) => {
    const date = record.normalized.dateValue;
    if (date) years.add(date.getFullYear());
  });
  return [...years].sort((left, right) => right - left);
}

function getKpiRangeStart(filter, now) {
  if (filter === "current-year") return new Date(now.getFullYear(), 0, 1);
  if (filter === "last-6-months") return addMonths(now, -6);
  if (filter === "last-3-months") return addMonths(now, -3);
  if (filter === "last-month") return addMonths(now, -1);
  if (filter === "last-week") return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  if (filter === "this-week") return getStartOfCalendarWeek(now);
  return null;
}

function getKpiMonthMatch(filter) {
  if (!filter.startsWith("month-")) return null;
  const month = Number(filter.replace("month-", ""));
  return Number.isInteger(month) && month >= 0 && month <= 11 ? month : null;
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}

function Kpi({ label, value, hint, source, extraDetail }) {
  return (
    <article className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
      {extraDetail && <small>{extraDetail}</small>}
      <small className="source-detail">{source}</small>
    </article>
  );
}

function SourceNote({ text }) {
  return <p className="source-note">{text}</p>;
}

function Alerts({ alerts }) {
  if (!alerts.length) return <EmptyState />;
  return (
    <div className="list dashboard-scroll-list">
      {alerts.map((alert, index) => (
        <article className={`item severity-${alert.severity}`} key={alert.id || `${alert.title}-${index}`}>
          <strong>{alert.title}</strong>
          <small>{alert.detail}</small>
        </article>
      ))}
    </div>
  );
}

function Rankings({ ranking, mode }) {
  const sourceDetail = RANKING_SOURCE_DETAILS[mode] || RANKING_SOURCE_DETAILS.cost;

  if (!ranking.length) {
    return (
      <>
        <RankingSourceCard sourceDetail={sourceDetail} />
        <EmptyState />
      </>
    );
  }
  return (
    <>
      <RankingSourceCard sourceDetail={sourceDetail} />
      <div className="list dashboard-scroll-list">
        {ranking.map((item) => (
          <article className="item" key={`ranking-${mode}-${item.key}`}>
            <strong>{item.key}</strong>
            <small>
              {item.detail || `${item.count} registros · ${formatMoney(item.cost)} · ${item.hours.toFixed(1)} horas`}
            </small>
            <small className="source-detail">{item.sourceDetail}</small>
          </article>
        ))}
      </div>
    </>
  );
}

function RankingSourceCard({ sourceDetail }) {
  return (
    <div className="dashboard-source-card">
      <strong>{sourceDetail.label}</strong>
      <span>{sourceDetail.description}</span>
      <small>Columnas buscadas: {sourceDetail.columns}</small>
    </div>
  );
}

function buildOperationalRanking(records, mode, otMetrics = null) {
  const metrics = otMetrics || buildOtMetrics(records);
  const getOtMetrics = () => metrics;
  const rankingBuilders = {
    cost: () => rankOtsByCost(getOtMetrics(), records),
    equipment: () => rankEquipmentByCost(getOtMetrics(), records),
    people: () => rankPeopleByActivity(records),
    providers: () => rankProvidersByPurchases(records),
  };
  const ranking = rankingBuilders[mode]?.() || [];
  return ranking.length ? ranking : buildGenericRanking(records, mode);
}

function buildOtMetrics(records) {
  const metrics = new Map();
  records.forEach((record) => {
    const ot = getRecordOt(record);
    if (!ot) return;
    const key = normalizeOtKey(ot);
    if (!key) return;
    const metric = getOrCreateMetric(metrics, key, ot);
    metric.count += 1;

    const equipment = getRecordEquipment(record);
    if (equipment) metric.equipment = equipment;

    if (isMatrixRecord(record)) {
      metric.purchaseValue += getMatrixPurchaseValue(record);
      const purchaseOrder = getCell(record, ["ORDENES DE COMPRA", "ORDEN DE COMPRA"]);
      if (purchaseOrder) metric.purchaseOrders.add(String(purchaseOrder).trim());
    }

    if (isFinancialSummaryRecord(record)) {
      metric.laborValue = Math.max(metric.laborValue, parseMoney(getCell(record, ["MANO OBRA"])));
      metric.financialPurchaseValue = Math.max(
        metric.financialPurchaseValue,
        parseMoney(getCell(record, ["VALOR DE LA COMPRA DE LA SP", "VALOR COMPRA", "VALOR DE COMPRA"])),
      );
    }

    if (isBillingRecord(record)) {
      metric.hours += parseHours(getCell(record, ["TIEMPO DE LA ACTIVIDAD", "HORAS", "HH"]) || record.normalized.hoursNumber);
      const collaborator = getCell(record, ["COLABORADOR", "colaborador", "TECNICO", "TÉCNICO"]) || record.normalized.technician;
      if (collaborator) metric.collaborators.add(String(collaborator).trim());
    }
  });

  metrics.forEach((metric) => {
    metric.cost = metric.laborValue + Math.max(metric.purchaseValue, metric.financialPurchaseValue);
  });
  return metrics;
}

function rankOtsByCost(otMetrics, records) {
  const ranking = [...otMetrics.values()]
    .filter((metric) => metric.cost > 0)
    .map((metric) => ({
      key: `OT ${metric.ot}`,
      count: metric.count,
      cost: metric.cost,
      hours: metric.hours,
      detail: `${formatMoney(metric.cost)} total · compras ${formatMoney(Math.max(metric.purchaseValue, metric.financialPurchaseValue))} · mano de obra ${formatMoney(metric.laborValue)} · ${metric.purchaseOrders.size} OC`,
      sourceDetail: "Origen: HOJA RESUMEN FINANCIERO OTS / Hoja 2 (MANO OBRA, VALOR DE LA COMPRA DE LA SP) + Matriz de Seguimiento (VALOR COMPRA, ORDENES DE COMPRA).",
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);
  return ranking.length ? ranking : buildGenericRanking(records, "cost");
}

function rankEquipmentByCost(otMetrics, records) {
  const byEquipment = new Map();
  otMetrics.forEach((metric) => {
    const key = cleanKey(metric.equipment);
    if (!key) return;
    const current = byEquipment.get(key) || { key, count: 0, cost: 0, hours: 0, ots: new Set() };
    current.count += metric.count;
    current.cost += metric.cost;
    current.hours += metric.hours;
    current.ots.add(metric.ot);
    byEquipment.set(key, current);
  });
  const ranking = [...byEquipment.values()]
    .filter((item) => item.cost || item.count)
    .map((item) => ({
      ...item,
      detail: `${item.ots.size} OT · ${formatMoney(item.cost)} · ${item.hours.toFixed(1)} horas · ${item.count} registros`,
      sourceDetail: "Origen: registros con columnas de equipo (EQUIPO, MAQUINA, MÁQUINA o ACTIVO), cruzados por OT cuando existe.",
    }))
    .sort((a, b) => (b.cost || b.count) - (a.cost || a.count))
    .slice(0, 10);
  return ranking.length ? ranking : buildGenericRanking(records, "equipment");
}

function rankPeopleByActivity(records) {
  const people = new Map();
  records.forEach((record) => {
    const name = getCell(record, ["COLABORADOR", "colaborador", "TECNICO", "TÉCNICO"]) || record.normalized.technician;
    const key = cleanKey(name);
    if (!key) return;
    const current = people.get(key) || { key, count: 0, cost: 0, hours: 0, ots: new Set() };
    current.count += 1;
    current.hours += parseHours(getCell(record, ["TIEMPO DE LA ACTIVIDAD", "HORAS", "HH"]) || record.normalized.hoursNumber);
    current.cost += Number(record.normalized.costNumber) || 0;
    const ot = getRecordOt(record);
    if (ot) current.ots.add(normalizeOtKey(ot));
    people.set(key, current);
  });
  return [...people.values()]
    .map((item) => ({
      ...item,
      detail: `${item.count} actividades/registros · ${item.hours.toFixed(1)} horas · ${item.ots.size} OT`,
      sourceDetail: "Origen: REPORTE DE ACTIVIDADES MANTENIMIENTO o registros con COLABORADOR/TECNICO y columnas de horas.",
    }))
    .sort((a, b) => (b.hours || b.count) - (a.hours || a.count))
    .slice(0, 10);
}

function rankProvidersByPurchases(records) {
  const providers = new Map();
  records.filter(isMatrixRecord).forEach((record) => {
    const provider = getCell(record, ["PROVEEDOR", "Proveedor", "EMPRESA", "TERCERO"]) || record.normalized.provider;
    const key = cleanKey(provider);
    if (!key) return;
    const current = providers.get(key) || { key, count: 0, cost: 0, hours: 0, ots: new Set(), purchaseOrders: new Set() };
    current.count += 1;
    current.cost += getMatrixPurchaseValue(record) || Number(record.normalized.costNumber) || 0;
    const ot = getRecordOt(record);
    const purchaseOrder = getCell(record, ["ORDENES DE COMPRA", "ORDEN DE COMPRA"]);
    if (ot) current.ots.add(normalizeOtKey(ot));
    if (purchaseOrder) current.purchaseOrders.add(String(purchaseOrder).trim());
    providers.set(key, current);
  });
  return [...providers.values()]
    .map((item) => ({
      ...item,
      detail: `${formatMoney(item.cost)} en compras · ${item.ots.size} OT · ${item.purchaseOrders.size} OC · ${item.count} registros`,
      sourceDetail: "Origen: Matriz de Seguimiento. Columnas: PROVEEDOR/EMPRESA/TERCERO, VALOR COMPRA y ORDENES DE COMPRA.",
    }))
    .sort((a, b) => (b.cost || b.count) - (a.cost || a.count))
    .slice(0, 10);
}

function buildGenericRanking(records, mode) {
  const field = { cost: "cost", equipment: "equipment", people: "technician", providers: "provider" }[mode];
  const keyField = field === "cost" ? "equipment" : field;
  const grouped = groupBy(records, (record) => cleanKey(record.normalized[keyField]));
  return Object.entries(grouped)
    .filter(([key]) => key)
    .map(([key, items]) => ({
      key,
      count: items.length,
      cost: sum(items.map((item) => item.normalized.costNumber)),
      hours: sum(items.map((item) => item.normalized.hoursNumber)),
      sourceDetail: buildGenericSourceDetail(items, mode),
    }))
    .sort((a, b) => (mode === "cost" ? b.cost - a.cost : b.count - a.count))
    .slice(0, 10);
}

function buildGenericSourceDetail(items, mode) {
  const sourceLines = [...new Set(items.map((item) => `${item.sourceName} / ${item.sheetName}`))]
    .filter(Boolean)
    .slice(0, 3);
  const field = { cost: "equipo detectado", equipment: "equipo detectado", people: "tecnico detectado", providers: "proveedor detectado" }[mode] || "campo detectado";
  const sourceText = sourceLines.length ? sourceLines.join(" | ") : "origen no identificado";
  return `Origen: agrupacion secundaria por ${field}. Hojas: ${sourceText}.`;
}

function getOrCreateMetric(metrics, key, ot) {
  if (!metrics.has(key)) {
    metrics.set(key, {
      key,
      ot,
      count: 0,
      cost: 0,
      equipment: "",
      financialPurchaseValue: 0,
      hours: 0,
      laborValue: 0,
      purchaseOrders: new Set(),
      purchaseValue: 0,
      collaborators: new Set(),
    });
  }
  return metrics.get(key);
}

function getRecordOt(record) {
  return normalizeOt(getCell(record, ["OT", "5", "ORDEN DE TRABAJO", "ORDEN TRABAJO"]) || record.normalized?.work_order);
}

function getRecordEquipment(record) {
  return getCell(record, ["EQUIPO", "MAQUINA", "MÁQUINA", "ACTIVO"]) || record.normalized?.equipment || "";
}

function getMatrixPurchaseValue(record) {
  return parseMoney(getCell(record, [
    "VALOR COMPRA (AGREGAR)",
    "VALOR COMPRA",
    "VALOR DE COMPRA",
    "VALOR DE LA COMPRA",
  ]));
}

function getBillingCostValue(record) {
  return parseMoney(getCell(record, [
    "Costo Total",
    "COSTO TOTAL",
    "VALOR TOTAL",
    "TOTAL",
  ]) || record.normalized.costNumber);
}

function getCell(record, names) {
  if (!record) return "";
  for (const name of names) {
    const header = record.headers?.find((item) => normalizeHeader(item) === normalizeHeader(name));
    if (header && record.cells?.[header] !== undefined) return record.cells[header];
  }
  return "";
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeOt(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:OT\s*[-:]?\s*)?(\d+)/i);
  return match ? String(Number(match[1])) : text;
}

function normalizeOtKey(value) {
  return normalizeText(normalizeOt(value));
}

function parseHours(value) {
  return parseFloat(String(value || "").replace(",", ".")) || 0;
}

function sourceIncludes(record, sourceName) {
  return normalizeText(record.sourceName).includes(normalizeText(sourceName));
}

function sheetIncludes(record, sheetName) {
  return normalizeText(record.sheetName).includes(normalizeText(sheetName));
}

function isMatrixRecord(record) {
  return sourceIncludes(record, "Matriz de Seguimiento");
}

function isDashboardMatrixCostRecord(record) {
  return sourceIncludes(record, "Matriz de Seguimiento") && sheetIncludes(record, "Respuestas de formulario 1");
}

function isDashboardBillingCostRecord(record) {
  return sourceIncludes(record, "Reporte de Actividades Mantenimiento") && normalizeText(record.sheetName) === normalizeText("FACTURACION");
}

function isFinancialSummaryRecord(record) {
  return sourceIncludes(record, "Resumen Financiero OTS") && normalizeText(record.sheetName) === normalizeText("Hoja 2");
}

function isBillingRecord(record) {
  const hasBillingHeaders = record.headers?.some((header) => normalizeText(header) === normalizeText("COLABORADOR")) &&
    record.headers?.some((header) => normalizeText(header) === normalizeText("ACTIVIDAD REALIZADA"));
  return sheetIncludes(record, "FACTURACION") || hasBillingHeaders;
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
}

function TrendChart({ points, format = "count", mode = "ots" }) {
  if (!points.length) {
    return (
      <div className="chart-wrap">
        <div className="chart">
          <EmptyState />
        </div>
      </div>
    );
  }
  const max = Math.max(...points.map((point) => point.value), 1);
  return (
    <div className="chart-wrap">
      <div className="chart trend-chart" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(56px, 1fr))` }}>
        {points.map((point, index) => (
          <div
            className="bar"
            key={`trend-${point.month}-${index}`}
            style={{ height: `${Math.max(6, (point.value / max) * 210)}px` }}
            title={`${formatTrendMonthLabel(point.month)} · ${buildTrendTooltip(point, format, mode)}`}
          >
            <span>{formatTrendMonthLabel(point.month)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
