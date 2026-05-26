import { SEMANTIC_FIELDS, DOCUMENT_TYPES } from "../constants/config.js";
import {
  normalizeText,
  similarity,
  parseMoney,
  parseDate,
  cleanKey,
  groupBy,
  sum,
  formatMoney,
} from "./helpers.js";

export function parseValues(values, source, tab, spreadsheetId) {
  if (!values.length) return { profile: { headers: [], classified: {} }, records: [] };
  const headerIndex = detectHeaderRow(values);
  const maxColumns = Math.max(...values.map((row) => row.length));
  const headers = makeUniqueHeaders(Array.from({ length: maxColumns }, (_, index) => {
    const header = values[headerIndex][index];
    return String(header || `Columna ${index + 1}`).trim();
  }));
  const classified = classifyHeaders(headers);
  const rows = values.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell || "").trim()));
  const records = rows.map((row, rowIndex) => {
    const cells = {};
    headers.forEach((header, index) => {
      cells[header] = row[index] ?? "";
    });
    const normalized = normalizeRecord(cells, classified);
    return {
      id: `${spreadsheetId}:${tab.sheetId}:${headerIndex + rowIndex + 2}`,
      uid: `${source.instanceKey || spreadsheetId}:${spreadsheetId}:${tab.sheetId}:${headerIndex + rowIndex + 2}:${rowIndex}`,
      sourceId: spreadsheetId,
      sourceName: source.name,
      sheetName: tab.title,
      rowNumber: headerIndex + rowIndex + 2,
      headers,
      cells,
      normalized,
      type: classifyRow(source.name, tab.title, headers, cells, source.roleHint),
      text: Object.values(cells).join(" ").toLowerCase(),
    };
  });
  return {
    profile: {
      headers,
      classified,
      type: classifySheet(source.name, tab.title, headers, source.roleHint),
      rowCount: records.length,
    },
    records,
  };
}

export function detectHeaderRow(values) {
  let best = 0;
  let bestScore = -1;
  values.slice(0, 10).forEach((row, index) => {
    const filled = row.filter((cell) => String(cell || "").trim()).length;
    const semantic = row.reduce((score, cell) => score + (classifyHeader(cell) ? 2 : 0), 0);
    const score = filled + semantic;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

export function classifyHeaders(headers) {
  return headers.reduce((map, header) => {
    const field = classifyHeader(header);
    if (field) map[header] = field;
    return map;
  }, {});
}

export function makeUniqueHeaders(headers) {
  const counts = new Map();
  return headers.map((header, index) => {
    const base = String(header || `Columna ${index + 1}`).trim() || `Columna ${index + 1}`;
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

export function classifyHeader(header) {
  const normalized = normalizeText(header);
  let best = null;
  let bestScore = 0;
  Object.entries(SEMANTIC_FIELDS).forEach(([field, aliases]) => {
    aliases.forEach((alias) => {
      const score = similarity(normalized, normalizeText(alias));
      const contains = normalized.includes(normalizeText(alias)) ? 0.34 : 0;
      if (score + contains > bestScore) {
        best = field;
        bestScore = score + contains;
      }
    });
  });
  return bestScore >= 0.58 ? best : null;
}

export function normalizeRecord(cells, classified) {
  const normalized = {};
  Object.entries(classified).forEach(([header, field]) => {
    const value = cells[header];
    if (!normalized[field] && String(value || "").trim()) normalized[field] = value;
  });
  normalized.costNumber = parseMoney(normalized.cost);
  normalized.hoursNumber = parseFloat(String(normalized.hours || "").replace(",", ".")) || 0;
  normalized.dateValue = parseDate(normalized.date);
  return normalized;
}

export function classifySheet(sourceName, tabName, headers, roleHint = "") {
  const text = normalizeText([sourceName, tabName, roleHint, ...headers].join(" "));
  return bestDocumentType(text);
}

export function classifyRow(sourceName, tabName, headers, cells, roleHint = "") {
  const text = normalizeText([sourceName, tabName, roleHint, ...headers, ...Object.values(cells)].join(" "));
  return bestDocumentType(text);
}

export function classifyDocument(sourceName, sheets, roleHint = "") {
  const text = normalizeText([sourceName, roleHint, ...sheets.flatMap((sheet) => [sheet.title, ...(sheet.headers || [])])].join(" "));
  return bestDocumentType(text);
}

export function bestDocumentType(text) {
  let best = "operations";
  let score = 0;
  Object.entries(DOCUMENT_TYPES).forEach(([type, words]) => {
    const current = words.reduce((total, word) => total + (text.includes(normalizeText(word)) ? 1 : 0), 0);
    if (current > score) {
      best = type;
      score = current;
    }
  });
  return best;
}

export function detectRelations(records) {
  const byWorkOrder = groupBy(records, (record) => cleanKey(record.normalized.work_order));
  const byEquipment = groupBy(records, (record) => cleanKey(record.normalized.equipment));
  const relations = [];
  Object.entries(byWorkOrder).forEach(([key, items]) => {
    if (key && items.length >= 2) relations.push(makeRelation("work_order", key, items));
  });
  Object.entries(byEquipment).forEach(([key, items]) => {
    if (key && items.length >= 2) relations.push(makeRelation("equipment", key, items));
  });
  return relations;
}

export function makeRelation(kind, key, items) {
  return {
    kind,
    key,
    count: items.length,
    types: [...new Set(items.map((item) => item.type))],
    sources: [...new Set(items.map((item) => `${item.sourceName} / ${item.sheetName}`))],
    costs: sum(items.map((item) => item.normalized.costNumber)),
    hours: sum(items.map((item) => item.normalized.hoursNumber)),
    items,
  };
}

export function relationKey(relation, index, scope) {
  const firstItem = relation.items?.[0]?.id || "no-item";
  return `${scope}-${relation.kind}-${relation.key}-${firstItem}-${index}`;
}

export function prioritizeHeaders(headers) {
  const priority = ["fecha", "ot", "orden", "equipo", "estado", "responsable", "tecnico", "descripcion", "actividad", "costo", "valor", "observacion"];
  const scored = headers.map((header, index) => {
    const normalized = normalizeText(header);
    const score = priority.findIndex((word) => normalized.includes(word));
    return { header, index, score: score === -1 ? 999 + index : score };
  });
  return scored.sort((a, b) => a.score - b.score).map((item) => item.header).slice(0, 14);
}

export function detectAnomalies(records, relations) {
  const alerts = [];
  const costs = records.map((record) => record.normalized.costNumber).filter(Boolean);
  const avgCost = costs.length ? sum(costs) / costs.length : 0;
  records.forEach((record) => {
    const n = record.normalized;
    if (n.costNumber && avgCost && n.costNumber > avgCost * 2.5) {
      alerts.push({
        severity: "high",
        title: "Sobrecosto potencial",
        detail: `${formatMoney(n.costNumber)} en ${record.sourceName}, fila ${record.rowNumber}`,
      });
    }
    if (!n.status && ["work_orders", "purchases", "maintenance"].includes(record.type)) {
      alerts.push({
        severity: "medium",
        title: "Registro sin estado detectado",
        detail: `${record.sourceName} / ${record.sheetName}, fila ${record.rowNumber}`,
      });
    }
    if ((n.work_order || n.equipment) && !n.dateValue) {
      alerts.push({
        severity: "low",
        title: "Registro operacional sin fecha reconocida",
        detail: `${record.sourceName} / ${record.sheetName}, fila ${record.rowNumber}`,
      });
    }
  });
  relations.forEach((relation) => {
    if (relation.kind === "equipment" && relation.count >= 5) {
      alerts.push({
        severity: "medium",
        title: "Equipo con actividad repetitiva",
        detail: `${relation.key}: ${relation.count} registros relacionados, ${formatMoney(relation.costs)} acumulados`,
      });
    }
  });
  return alerts.slice(0, 40);
}

export function trendPoints(records) {
  const byMonth = groupBy(
    records.filter((record) => record.normalized.dateValue),
    (record) => {
      const date = record.normalized.dateValue;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    },
  );
  return Object.entries(byMonth)
    .map(([month, items]) => ({ month, value: items.length, cost: sum(items.map((item) => item.normalized.costNumber)) }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
}
