import React from "react";
import { sum, cleanKey, formatMoney, normalizeText, parseMoney } from "../utils/helpers.js";
import { trendPoints } from "../utils/analysis.js";
import { EmptyState } from "../components/EmptyState.jsx";

const WORK_ORDERS_SPREADSHEET_ID = "1NUd2guWTtB1qEGUQ4i04kuARnU8Bu7trkJRhiSs79ns";
const WORK_ORDERS_SHEET_ID = "1862269386";
const WORK_ORDERS_SOURCE_NAME = "Copia de ORDENES DE TRABAJO TYC";
const WORK_ORDERS_SHEET_NAME = "copia de prueba respuestas de formulario 1";

export function Dashboard({ documents, records, alerts, rankingMode, setRankingMode, runAnalysis }) {
  const totalCost = calculateDashboardDetectedCost(records);
  const totalHours = sum(records.map((record) => record.normalized.hoursNumber));
  const equipments = new Set(records.map((record) => cleanKey(record.normalized.equipment)).filter(Boolean));
  const workOrderRows = countWorkOrderRows(records);

  return (
    <section className="view active">
      <div className="kpi-grid">
        <Kpi label="Registros" value={records.length} hint={`${documents.length} documentos conectados`} />
        <Kpi label="Filas OT" value={workOrderRows} hint="Columna OT en Copia de ORDENES DE TRABAJO TYC" />
        <Kpi label="Costo detectado" value={formatMoney(totalCost)} hint="FACTURACION + Matriz de Seguimiento" />
        <Kpi label="Horas" value={totalHours.toFixed(1)} hint="Horas reconocidas en reportes" />
        <Kpi label="Equipos" value={equipments.size} hint="Activos detectados dinamicamente" />
      </div>
      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>Alertas inteligentes</h2>
            <button type="button" onClick={runAnalysis}>
              Analizar
            </button>
          </div>
          <Alerts alerts={alerts} />
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
          <Rankings records={records} mode={rankingMode} />
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Tendencias operacionales</h2>
          <span>{trendPoints(records).length ? "Registros por mes" : "Sin fechas suficientes"}</span>
        </div>
        <TrendChart records={records} />
      </section>
    </section>
  );
}

function countWorkOrderRows(records) {
  return records.filter((record) => {
    if (!isWorkOrdersRecord(record)) return false;
    const matchingHeader = record.headers.find((header) => normalizeText(header) === "ot");
    const value = String(record.cells[matchingHeader] || "").trim();
    return matchingHeader && /\d/.test(value);
  }).length;
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

function calculateDashboardDetectedCost(records) {
  return sum(records.map((record) => {
    if (isDashboardMatrixCostRecord(record)) return getMatrixPurchaseValue(record);
    if (isDashboardBillingCostRecord(record)) return getBillingCostValue(record);
    return 0;
  }));
}

function Kpi({ label, value, hint }) {
  return (
    <article className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function Alerts({ alerts }) {
  if (!alerts.length) return <EmptyState />;
  return (
    <div className="list dashboard-scroll-list">
      {alerts.map((alert, index) => (
        <article className={`item severity-${alert.severity}`} key={`${alert.title}-${index}`}>
          <strong>{alert.title}</strong>
          <small>{alert.detail}</small>
        </article>
      ))}
    </div>
  );
}

function Rankings({ records, mode }) {
  const ranking = buildOperationalRanking(records, mode);

  if (!ranking.length) return <EmptyState />;
  return (
    <div className="list dashboard-scroll-list">
      {ranking.map((item) => (
        <article className="item" key={`ranking-${mode}-${item.key}`}>
          <strong>{item.key}</strong>
          <small>
            {item.detail || `${item.count} registros · ${formatMoney(item.cost)} · ${item.hours.toFixed(1)} horas`}
          </small>
        </article>
      ))}
    </div>
  );
}

function buildOperationalRanking(records, mode) {
  const otMetrics = buildOtMetrics(records);
  const rankingBuilders = {
    cost: () => rankOtsByCost(otMetrics, records),
    equipment: () => rankEquipmentByCost(otMetrics, records),
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
    }))
    .sort((a, b) => (mode === "cost" ? b.cost - a.cost : b.count - a.count))
    .slice(0, 10);
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

function TrendChart({ records }) {
  const points = trendPoints(records);
  if (!points.length) {
    return (
      <div className="chart">
        <EmptyState />
      </div>
    );
  }
  const max = Math.max(...points.map((point) => point.value), 1);
  return (
    <div className="chart">
      {points.map((point, index) => (
        <div
          className="bar"
          key={`trend-${point.month}-${index}`}
          style={{ height: `${Math.max(6, (point.value / max) * 210)}px` }}
          title={`${point.value} registros · ${formatMoney(point.cost)}`}
        >
          <span>{point.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
