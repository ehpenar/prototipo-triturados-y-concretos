import React, { Suspense, lazy, useMemo, useState, useDeferredValue } from "react";
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
  formatOpsPeriodDetail,
} from "../utils/opsTimeFilter.js";

const DashboardOperaciones = lazy(() =>
  import("../components/dashboard/DashboardOperaciones.jsx").then((module) => ({ default: module.DashboardOperaciones })),
);

const WORK_ORDERS_SPREADSHEET_ID = "1NUd2guWTtB1qEGUQ4i04kuARnU8Bu7trkJRhiSs79ns";
const WORK_ORDERS_SHEET_ID = "1862269386";
const WORK_ORDERS_SOURCE_NAME = "ORDENES DE TRABAJO TYC";
const WORK_ORDERS_SHEET_NAME = "copia de prueba respuestas de formulario 1";
const HEADER_LOOKUP_CACHE = new WeakMap();

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
    description: "Agrupa actividades de mantenimiento por equipo intervenido. Usa FACTURACION (EQUIPO INTERVENIDO, VALOR DE LA ACTIVIDAD) y Respuestas de formulario 1 (columnas EQUIPO por proceso).",
    columns: "EQUIPO INTERVENIDO, EQUIPO PRODUCCION, EQUIPO OBRAS, EQUIPO LOGISTICA, EQUIPO MANTENIMIENTO, DESCRIPCION DEL EQUIPO INTERVENIDO, TIEMPO DE LA ACTIVIDAD, VALOR DE LA ACTIVIDAD",
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
  const [rankingTimeFilter, setRankingTimeFilter] = useState("all");
  const [rankingYearFilter, setRankingYearFilter] = useState(() => new Date().getFullYear());
  const isMonthFilter = getKpiMonthMatch(kpiTimeFilter) !== null;
  const isAlertsMonthFilter = getOpsMonthMatch(alertsTimeFilter) !== null;
  const isRankingMonthFilter = getOpsMonthMatch(rankingTimeFilter) !== null;
  const deferredKpiTimeFilter = useDeferredValue(kpiTimeFilter);
  const deferredKpiYearFilter = useDeferredValue(kpiYearFilter);
  const deferredAlertsTimeFilter = useDeferredValue(alertsTimeFilter);
  const deferredAlertsYearFilter = useDeferredValue(alertsYearFilter);
  const deferredRankingTimeFilter = useDeferredValue(rankingTimeFilter);
  const deferredRankingYearFilter = useDeferredValue(rankingYearFilter);
  const operationalRecords = sourceRecords || records;
  const availableYears = useMemo(() => buildAvailableYears(records), [records]);
  const operationalAvailableYears = useMemo(() => buildOpsAvailableYears(operationalRecords), [operationalRecords]);
  const timeFilteredRecords = useMemo(
    () => filterRecordsByKpiTimeRange(records, deferredKpiTimeFilter, deferredKpiYearFilter),
    [records, deferredKpiTimeFilter, deferredKpiYearFilter],
  );
  const selectedTimeFilter = KPI_TIME_FILTER_OPTIONS.find((option) => option.value === kpiTimeFilter) || KPI_TIME_FILTER_OPTIONS[0];
  const selectedTimeLabel = isMonthFilter ? `${selectedTimeFilter.label} ${kpiYearFilter}` : selectedTimeFilter.label;
  const dashboardMetrics = useMemo(
    () => buildDashboardMetrics(records, timeFilteredRecords),
    [records, timeFilteredRecords],
  );
  const rankingFilteredRecords = useMemo(
    () => filterRecordsByOpsTimeRange(operationalRecords, deferredRankingTimeFilter, deferredRankingYearFilter),
    [operationalRecords, deferredRankingTimeFilter, deferredRankingYearFilter],
  );
  const rankingTimeLabel = formatOpsPeriodDetail(rankingTimeFilter, rankingYearFilter);
  const otMetrics = useMemo(
    () => (rankingMode === "cost" ? buildOtMetrics(rankingFilteredRecords) : null),
    [rankingFilteredRecords, rankingMode],
  );
  const activeRanking = useMemo(
    () => buildOperationalRanking(
      rankingFilteredRecords,
      rankingMode,
      rankingMode === "cost" ? otMetrics : null,
    ),
    [rankingFilteredRecords, rankingMode, otMetrics],
  );
  const alertsFilteredRecords = useMemo(
    () => filterRecordsByOpsTimeRange(operationalRecords, deferredAlertsTimeFilter, deferredAlertsYearFilter),
    [operationalRecords, deferredAlertsTimeFilter, deferredAlertsYearFilter],
  );
  const alertsTimeLabel = getOpsTimeFilterLabel(alertsTimeFilter, alertsYearFilter);
  const smartAlerts = useMemo(
    () => buildDashboardSmartAlerts(alertsFilteredRecords),
    [alertsFilteredRecords],
  );
  const allOperationalTrends = useMemo(() => buildAllOperationalTrends(records), [records]);
  const operationalTrend = allOperationalTrends[trendMode] || allOperationalTrends.ots;
  const selectedTrendMode = TREND_MODE_OPTIONS.find((option) => option.value === trendMode) || TREND_MODE_OPTIONS[0];
  const { isReady: showTrends, sentinelRef: trendsSentinelRef } = useDeferredMount();
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
        <MemoKpi label="Registros" value={records.length} hint={`${documents.length} documentos conectados`} source={KPI_SOURCE_DETAILS.records} />
        <MemoKpi label="Filas OT" value={dashboardMetrics.workOrderRows} hint="Columna OT en ORDENES DE TRABAJO TYC" source={KPI_SOURCE_DETAILS.workOrders} />
        <MemoKpi label="Costo detectado" value={formatMoney(dashboardMetrics.totalCost)} hint={`Compras realizadas (VALOR COMPRA) · ${selectedTimeLabel}`} source={KPI_SOURCE_DETAILS.cost} />
        <MemoKpi
          label="Horas"
          value={`${dashboardMetrics.totalHours.toFixed(1)} horas`}
          hint={`Horas reconocidas en reportes · ${selectedTimeLabel}`}
          source={KPI_SOURCE_DETAILS.hours}
          extraDetail={`Valor Mano de Obra: ${formatMoney(dashboardMetrics.totalLaborValue)}`}
        />
        <MemoKpi label="Equipos" value={dashboardMetrics.equipmentCount} hint="Activos detectados dinamicamente" source={KPI_SOURCE_DETAILS.equipment} />
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
                  {operationalAvailableYears.map((year) => (
                    <option key={`alerts-year-${year}`} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <SourceNote text={ALERTS_SOURCE_DETAIL} />
          <MemoAlerts alerts={smartAlerts} />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Rankings dinamicos</h2>
            <div className="dashboard-ranking-head-controls">
              <span className="muted">Top 10 · {rankingTimeLabel}</span>
              <select value={rankingMode} onChange={(event) => setRankingMode(event.target.value)}>
                <option value="cost">Costos</option>
                <option value="equipment">Equipos</option>
                <option value="people">Tecnicos</option>
                <option value="providers">Proveedores</option>
              </select>
            </div>
          </div>
          <div className="dashboard-kpi-filter-controls dashboard-alerts-filter">
            <label>
              Periodo
              <select value={rankingTimeFilter} onChange={(event) => setRankingTimeFilter(event.target.value)}>
                {OPS_TIME_FILTER_OPTIONS.map((option) => (
                  <option key={`ranking-time-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {isRankingMonthFilter && (
              <label>
                Año
                <select value={rankingYearFilter} onChange={(event) => setRankingYearFilter(Number(event.target.value))}>
                  {operationalAvailableYears.map((year) => (
                    <option key={`ranking-year-${year}`} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <MemoRankings ranking={activeRanking} mode={rankingMode} periodLabel={rankingTimeLabel} />
        </section>
      </div>
      <div ref={trendsSentinelRef} style={{ height: 1, width: "100%" }} aria-hidden="true" />
      {showTrends ? (
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
        <MemoTrendComparison comparison={operationalTrend.comparison} format={selectedTrendMode.format} valueLabel={selectedTrendMode.valueLabel} />
        <MemoTrendChart format={selectedTrendMode.format} mode={trendMode} points={operationalTrend.points} />
        <p className="muted trend-legend">
          Eje: mes/año · Altura: {selectedTrendMode.format === "money" ? "suma de VALOR COMPRA" : `cantidad de ${selectedTrendMode.valueLabel}`}
          {trendMode === "ots" ? " · Pasa el cursor sobre cada barra para ver EN PROCESO, SIN REVISAR, MATERIALES PENDIENTES, etc." : ""}
          {trendMode === "sps" ? " · Pasa el cursor sobre cada barra para ver ENTREGADO, EN PROCESO DE PAGO u otras pendientes" : ""}
        </p>
      </section>
      ) : (
        <section className="panel">
          <p className="muted">Las tendencias operacionales se cargan al acercarte a esta sección.</p>
        </section>
      )}
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

function buildAllOperationalTrends(records) {
  const trendByMode = {
    ots: new Map(),
    sps: new Map(),
    "matrix-cost": new Map(),
  };

  (records || []).forEach((record) => {
    if (isWorkOrdersRecord(record)) {
      const ot = getRecordOt(record);
      if (!ot || !/\d/.test(ot)) return;
      const date = (
        parseTrendDate(getCell(record, ["Marca temporal"]))
        || parseTrendDate(getCell(record, ["FECHA DE SOLICITUD"]))
        || parseTrendDate(getCell(record, ["FECHA"]))
      );
      if (date) accumulateTrendRecord(trendByMode.ots, "ots", date, record);
    }

    if (isMatrixRecord(record)) {
      const date = (
        parseTrendDate(getCell(record, [
          "Fecha de Recepción de la SP  Nota: si no tiene fecha coloque la de la SP *",
          "Fecha de Recepcion de la SP",
          "Fecha de Recepción de la SP",
        ]))
        || parseTrendDate(getCell(record, ["Marca temporal"]))
      );
      if (!date) return;
      accumulateTrendRecord(trendByMode.sps, "sps", date, record);
      if (isDashboardMatrixCostRecord(record)) {
        accumulateTrendRecord(trendByMode["matrix-cost"], "matrix-cost", date, record);
      }
    }
  });

  return {
    ots: finalizeOperationalTrend(trendByMode.ots, "ots"),
    sps: finalizeOperationalTrend(trendByMode.sps, "sps"),
    "matrix-cost": finalizeOperationalTrend(trendByMode["matrix-cost"], "matrix-cost"),
  };
}

function accumulateTrendRecord(trendByMonth, mode, date, record) {
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
}

function finalizeOperationalTrend(trendByMonth, mode) {
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

const MemoTrendComparison = React.memo(TrendComparison);

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

const MemoKpi = React.memo(Kpi);

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

const MemoAlerts = React.memo(Alerts);

function Rankings({ ranking, mode, periodLabel = "" }) {
  const sourceDetail = RANKING_SOURCE_DETAILS[mode] || RANKING_SOURCE_DETAILS.cost;

  if (!ranking.length) {
    return (
      <>
        <MemoRankingSourceCard sourceDetail={sourceDetail} periodLabel={periodLabel} />
        <EmptyState />
      </>
    );
  }
  return (
    <>
      <MemoRankingSourceCard sourceDetail={sourceDetail} periodLabel={periodLabel} />
      <div className="list dashboard-scroll-list">
        {ranking.map((item) => (
          <article className="item" key={`ranking-${mode}-${item.key}`}>
            <strong>{item.key}</strong>
            <small>
              {item.detail || `${item.count} registros · ${formatMoney(item.cost)} · ${item.hours.toFixed(1)} horas`}
            </small>
            {item.dateLabel && <small className="muted">{item.dateLabel}</small>}
            <small className="source-detail">{item.sourceDetail}</small>
          </article>
        ))}
      </div>
    </>
  );
}

const MemoRankings = React.memo(Rankings);

function RankingSourceCard({ sourceDetail, periodLabel }) {
  return (
    <div className="dashboard-source-card">
      <strong>{sourceDetail.label}</strong>
      {periodLabel && <span className="muted">Periodo: {periodLabel}</span>}
      <span>{sourceDetail.description}</span>
      <small>Columnas buscadas: {sourceDetail.columns}</small>
    </div>
  );
}

const MemoRankingSourceCard = React.memo(RankingSourceCard);

function buildOperationalRanking(records, mode, otMetrics = null) {
  const metrics = otMetrics || buildOtMetrics(records);
  const getOtMetrics = () => metrics;
  const rankingBuilders = {
    cost: () => rankOtsByCost(getOtMetrics(), records),
    equipment: () => rankEquipmentByActivity(records),
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

    const equipment = getActivityEquipment(record);
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

function rankEquipmentByActivity(records) {
  const formEquipmentByKey = new Map();
  const mergedActivities = new Map();

  records.filter(isActivityFormRecord).forEach((record) => {
    const key = buildActivityMatchKey(record);
    const equipment = getActivityEquipment(record);
    if (equipment && !isPlaceholderEquipment(equipment)) {
      formEquipmentByKey.set(key, equipment);
    }
  });

  records.filter(isBillingRecord).forEach((record) => {
    upsertMergedActivity(mergedActivities, record, resolveActivityEquipment(record, formEquipmentByKey));
  });

  records.filter(isActivityFormRecord).forEach((record) => {
    upsertMergedActivity(mergedActivities, record, resolveActivityEquipment(record, formEquipmentByKey));
  });

  const byEquipment = new Map();
  mergedActivities.forEach((activity) => {
    const equipment = activity.equipment;
    const key = cleanKey(equipment);
    if (!key || isPlaceholderEquipment(equipment)) return;

    const current = byEquipment.get(key) || {
      key: String(equipment).trim(),
      count: 0,
      cost: 0,
      hours: 0,
      ots: new Set(),
      dates: [],
    };
    current.count += 1;
    current.cost += activity.cost;
    current.hours += activity.hours;
    activity.ots.forEach((otKey) => current.ots.add(otKey));
    activity.dates.forEach((date) => current.dates.push(date));
    byEquipment.set(key, current);
  });

  const ranking = [...byEquipment.values()]
    .filter((item) => item.cost > 0 || item.hours > 0 || item.count > 0)
    .map((item) => ({
      ...item,
      detail: `${item.count} actividades · ${formatMoney(item.cost)} · ${item.hours.toFixed(1)} horas · ${item.ots.size} OT`,
      dateLabel: formatRankingDateRange(item.dates),
      sourceDetail: "Origen: REPORTE DE ACTIVIDADES MANTENIMIENTO / FACTURACION y Respuestas de formulario 1.",
    }))
    .sort((left, right) => (right.cost || right.hours || right.count) - (left.cost || left.hours || left.count))
    .slice(0, 10);

  return ranking.length ? ranking : buildGenericRanking(records, "equipment");
}

function upsertMergedActivity(target, record, equipment) {
  if (!equipment || isPlaceholderEquipment(equipment)) return;

  const key = buildActivityMatchKey(record);
  const hours = parseHours(getCell(record, ["TIEMPO DE LA ACTIVIDAD", "HORAS", "HH"]) || record.normalized.hoursNumber);
  const cost = getActivityLaborCost(record);
  const ot = getRecordOt(record);
  const date = getActivityRecordDate(record);
  const existing = target.get(key) || {
    equipment: "",
    hours: 0,
    cost: 0,
    ots: new Set(),
    dates: [],
  };

  existing.equipment = equipment;
  existing.hours = Math.max(existing.hours, hours);
  existing.cost = Math.max(existing.cost, cost);
  if (ot) existing.ots.add(normalizeOtKey(ot));
  if (date) existing.dates.push(date);
  target.set(key, existing);
}

function resolveActivityEquipment(record, formEquipmentByKey) {
  const directEquipment = getActivityEquipment(record);
  if (directEquipment && !isPlaceholderEquipment(directEquipment)) return directEquipment;
  return formEquipmentByKey.get(buildActivityMatchKey(record)) || "";
}

function buildActivityMatchKey(record) {
  const stamp = String(getCell(record, ["FECHA REPORTE", "Marca temporal", "FECHA"]) || "").trim();
  const collaborator = cleanKey(getCell(record, ["COLABORADOR", "colaborador", "TECNICO", "TÉCNICO"]));
  const time = normalizeActivityTimeKey(getCell(record, ["TIEMPO DE LA ACTIVIDAD", "HORAS", "HH"]) || record.normalized.hoursNumber);
  const base = `${stamp}|${collaborator}|${time}`;
  return base.replace(/\|/g, "") ? base : (record.uid || record.id || base);
}

function normalizeActivityTimeKey(value) {
  const hours = parseHours(value);
  return hours > 0 ? hours.toFixed(4) : String(value || "").trim();
}

function getActivityRecordDate(record) {
  return (
    parseDate(getCell(record, ["Marca temporal"]))
    || parseDate(getCell(record, ["FECHA REPORTE"]))
    || parseDate(getCell(record, ["FECHA"]))
    || null
  );
}

function formatRankingDateRange(dates) {
  const validDates = (dates || []).filter((date) => date instanceof Date && !Number.isNaN(date.getTime())).sort((left, right) => left - right);
  if (!validDates.length) return "";
  const first = formatRankingDateLabel(validDates[0]);
  const last = formatRankingDateLabel(validDates[validDates.length - 1]);
  return first === last ? `Fecha actividad: ${first}` : `Fechas actividad: ${first} – ${last}`;
}

function formatRankingDateLabel(date) {
  return date.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
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
    current.cost += getActivityLaborCost(record) || Number(record.normalized.costNumber) || 0;
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
  return normalizeOt(
    getCell(record, [
      "OT",
      "5",
      "ORDEN DE TRABAJO",
      "ORDEN TRABAJO",
      "OT - REPORTE DE CAMPO",
      "ORDEN DE TRABAJO/REPORTE DE CAMPO",
    ]) || record.normalized?.work_order,
  );
}

function getRecordEquipment(record) {
  return getActivityEquipment(record);
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

function getActivityLaborCost(record) {
  return parseMoney(getCell(record, [
    "VALOR DE LA ACTIVIDAD",
    "VALOR DE LA ACTIVIDAD ",
    "Costo Total",
    "COSTO TOTAL",
    "VALOR TOTAL",
    "TOTAL",
  ]));
}

function isPlaceholderEquipment(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  if (raw.startsWith("#")) return true;
  const text = normalizeText(raw);
  return !text || text === "na" || text === "n/a" || text === "n-a" || text === "n a";
}

function isEquipmentActivityRecord(record) {
  return isBillingRecord(record) || isActivityFormRecord(record);
}

function isActivityFormRecord(record) {
  if (!sourceIncludes(record, "Reporte de Actividades Mantenimiento")) return false;
  if (normalizeText(record.sheetName) === normalizeText("FACTURACION")) return false;
  if (!sheetIncludes(record, "respuestas de formulario 1")) return false;
  const hasCollaborator = record.headers?.some((header) => normalizeText(header) === normalizeText("COLABORADOR"));
  const hasActivityTime = record.headers?.some((header) => normalizeText(header).includes(normalizeText("tiempo de la actividad")));
  return hasCollaborator && hasActivityTime;
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
  return "";
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

function normalizeOt(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:OT\s*[-:]?\s*)?(\d+)/i);
  return match ? String(Number(match[1])) : text;
}

function normalizeOtKey(value) {
  return normalizeText(normalizeOt(value));
}

function parseHours(value) {
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

const MemoTrendChart = React.memo(TrendChart);
