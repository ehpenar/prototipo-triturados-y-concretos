import React from "react";
import { sum, cleanKey, formatMoney, normalizeText } from "../utils/helpers.js";
import { trendPoints } from "../utils/analysis.js";
import { EmptyState } from "../components/EmptyState.jsx";

const WORK_ORDERS_SPREADSHEET_ID = "1wWFSW2M3CdxHlr3q-L4eeMhmGMvmCaeUA0tGptWOqME";
const WORK_ORDERS_SHEET_ID = "1862269386";
const WORK_ORDERS_SOURCE_NAME = "Copia de ORDENES DE TRABAJO TYC";
const WORK_ORDERS_SHEET_NAME = "copia de prueba respuestas de formulario 1";

export function Dashboard({ documents, records, alerts, rankingMode, setRankingMode, runAnalysis }) {
  const totalCost = sum(records.map((record) => record.normalized.costNumber));
  const totalHours = sum(records.map((record) => record.normalized.hoursNumber));
  const equipments = new Set(records.map((record) => cleanKey(record.normalized.equipment)).filter(Boolean));
  const workOrderRows = countWorkOrderRows(records);

  return (
    <section className="view active">
      <div className="kpi-grid">
        <Kpi label="Registros" value={records.length} hint={`${documents.length} documentos conectados`} />
        <Kpi label="Filas OT" value={workOrderRows} hint="Columna OT en Copia de ORDENES DE TRABAJO TYC" />
        <Kpi label="Costo detectado" value={formatMoney(totalCost)} hint="Suma de columnas reconocidas como costo" />
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
    <div className="list">
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
  const field = { cost: "cost", equipment: "equipment", people: "technician", providers: "provider" }[mode];
  const keyField = field === "cost" ? "equipment" : field;
  const grouped = groupBy(records, (record) => cleanKey(record.normalized[keyField]));
  const ranking = Object.entries(grouped)
    .filter(([key]) => key)
    .map(([key, items]) => ({
      key,
      count: items.length,
      cost: sum(items.map((item) => item.normalized.costNumber)),
      hours: sum(items.map((item) => item.normalized.hoursNumber)),
    }))
    .sort((a, b) => (mode === "cost" ? b.cost - a.cost : b.count - a.count))
    .slice(0, 10);

  if (!ranking.length) return <EmptyState />;
  return (
    <div className="list">
      {ranking.map((item) => (
        <article className="item" key={`ranking-${mode}-${item.key}`}>
          <strong>{item.key}</strong>
          <small>
            {item.count} registros · {formatMoney(item.cost)} · {item.hours.toFixed(1)} horas
          </small>
        </article>
      ))}
    </div>
  );
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
