import { normalizeText, parseDate } from "./helpers.js";

export const FINANCIAL_SUMMARY_SHEET = "Hoja 2";

export const FINANCIAL_SUMMARY_HEADERS = [
  "OT",
  "ESTATUS DE LA OT",
  "TIEMPO DE EJECUCION",
  "MANO OBRA",
  "#SP",
  "FECHA RECEPCION SP",
  "TIEMPO DE COMPRA",
  "ORDEN DE COMPRA",
  "TIEMPO APROBACION",
  "Estado Actual de la SP*",
  "VALOR DE LA COMPRA DE LA SP",
  "METODO_CRUCE_SP",
  "DETALLE_CRUCE_SP",
  "ORDENES DE COMPRA",
  "METODO_MANO_OBRA",
  "DETALLE_MANO_OBRA",
  "METODO_VALOR_COMPRA",
  "DETALLE_VALOR_COMPRA",
  "INFORME",
  "NUMERO DE COLABORADORES",
];

const SOURCE_NAMES = {
  orders: "Ordenes de Trabajo TYC",
  matrix: "Matriz de Seguimiento",
  activities: "Reporte de Actividades Mantenimiento",
  financial: "Resumen Financiero OTS",
};

export function buildFinancialSummaryRows(documents) {
  const records = documents.flatMap((document) => document.records || []);
  const orders = records.filter((record) => sourceMatches(record, SOURCE_NAMES.orders) && sheetMatches(record, "respuestas de formulario 1"));
  const matrix = records.filter((record) => sourceMatches(record, SOURCE_NAMES.matrix) && sheetMatches(record, "respuestas de formulario 1"));
  const activities = records.filter((record) => sourceMatches(record, SOURCE_NAMES.activities) && sheetMatches(record, "respuestas de formulario 1"));
  const billing = records.filter((record) => sourceMatches(record, SOURCE_NAMES.activities) && sheetMatches(record, "facturacion"));
  const personal = records.filter((record) => sourceMatches(record, SOURCE_NAMES.activities) && sheetMatches(record, "personal"));
  const financialSheetOne = records.filter((record) => sourceMatches(record, SOURCE_NAMES.financial) && sheetMatches(record, "hoja 1"));

  const matrixBySp = groupBy(matrix, getMatrixSp);
  const matrixByOt = groupBy(matrix, getMatrixOt);
  const personalRates = buildPersonalRates(personal);
  const activitiesByOt = groupBy(activities, getActivityOt);
  const collaboratorsByOt = groupCollaboratorsByOt(billing);
  const financialIndexes = buildFinancialIndexes(financialSheetOne);

  return orders
    .map((order) => buildSummaryRow(order, { activitiesByOt, collaboratorsByOt, financialIndexes, matrixByOt, matrixBySp, personalRates }))
    .filter(Boolean);
}

export function findFinancialSummaryDocument(documents) {
  return documents.find((document) => normalizeText(document.source?.name || document.title).includes(normalizeText(SOURCE_NAMES.financial))) || null;
}

export function findFinancialSummarySheet(document) {
  if (!document) return null;
  return document.sheets.find((sheet) => normalizeText(sheet.title) === normalizeText(FINANCIAL_SUMMARY_SHEET)) || null;
}

function buildSummaryRow(order, context) {
  const otNumber = getOrderNumber(order);
  if (!otNumber) return null;
  const spResult = resolveSp(order, context.matrixByOt, context.matrixBySp);
  const matrixRows = spResult.matrixRows || [];
  const matrixRecord = matrixRows[0] || null;
  const orderDate = parseFlexibleDate(getCell(order, ["Marca temporal"]) || getCell(order, ["FECHA DE SOLICITUD"]));
  const realDeliveryValue = getCell(order, ["FECHA REAL ENTREGA"], ["fecha real entrega"]);
  const deliveryDate = parseFlexibleDate(realDeliveryValue);
  const purchaseOrderDate = parseFlexibleDate(getCell(matrixRecord, ["FECHA ORDEN DE COMPRA"]));
  const spReceptionDate = parseFlexibleDate(firstValue(matrixRows, ["Fecha de Recepción de la SP  Nota: si no tiene fecha coloque la de la SP *", "Fecha de Recepcion de la SP", "Fecha de Recepción de la SP"]));
  const approvalDate = parseFlexibleDate(getCell(matrixRecord, ["FECHA APROBACION", "FECHA APROBACIÓN"]));
  const labor = calculateLabor(otNumber, context.activitiesByOt, context.personalRates);
  const purchaseValue = resolvePurchaseValue(otNumber, spResult.sp, matrixRecord, context.financialIndexes);
  const executionTime = getExecutionTime(order, orderDate, deliveryDate);
  const collaborators = formatCollaborators(context.collaboratorsByOt.get(normalizeKey(otNumber)) || []);

  // Obtener todas las órdenes de compra asociadas a esta OT en la Matriz de Seguimiento
  const otMatrixRows = context.matrixByOt.get(normalizeKey(otNumber)) || [];
  const purchaseOrders = otMatrixRows
    .map((row) => getCell(row, ["ORDENES DE COMPRA", "ORDEN DE COMPRA"]))
    .map((val) => String(val || "").trim())
    .filter(Boolean);
  const uniquePurchaseOrders = [...new Set(purchaseOrders)].sort();
  const concatenatedOrders = uniquePurchaseOrders.join(", ");

  return {
    OT: otNumber,
    "ESTATUS DE LA OT": buildOtStatusValue(order),
    "TIEMPO DE EJECUCION": executionTime,
    "MANO OBRA": labor.value || "",
    "#SP": spResult.sp,
    "FECHA RECEPCION SP": firstValue(matrixRows, ["Fecha de Recepción de la SP  Nota: si no tiene fecha coloque la de la SP *", "Fecha de Recepcion de la SP", "Fecha de Recepción de la SP"]),
    "TIEMPO DE COMPRA": diffDays(spReceptionDate, purchaseOrderDate),
    "ORDEN DE COMPRA": firstValue(matrixRows, ["ORDENES DE COMPRA", "ORDEN DE COMPRA"]),
    "TIEMPO APROBACION": diffDays(purchaseOrderDate, approvalDate),
    "Estado Actual de la SP*": firstValue(matrixRows, ["Estado Actual de la SP*", "Estado Actual de la SP"]),
    "VALOR DE LA COMPRA DE LA SP": purchaseValue.value || "",
    "METODO_CRUCE_SP": spResult.method,
    "DETALLE_CRUCE_SP": spResult.detail,
    "ORDENES DE COMPRA": concatenatedOrders,
    "METODO_MANO_OBRA": labor.method,
    "DETALLE_MANO_OBRA": labor.detail,
    "METODO_VALOR_COMPRA": purchaseValue.method,
    "DETALLE_VALOR_COMPRA": purchaseValue.detail,
    "NUMERO DE COLABORADORES": collaborators,
  };
}

function resolveSp(order, matrixByOt, matrixBySp) {
  const orderNumber = getOrderNumber(order);
  const directSp = normalizeSp(getCell(order, ["sp", "SP"]));
  if (directSp && matrixBySp.has(normalizeKey(directSp))) {
    return { sp: directSp, method: "directo_columna_sp", detail: "OT.sp cruza con Matriz.NUMERO DE LA SP", matrixRows: matrixBySp.get(normalizeKey(directSp)) };
  }
  const extractedSp = extractSp([
    getCell(order, ["COMENTARIOS"]),
    getCell(order, ["DESCRIPCIÓN GENERAL DEL FALLO O DE LA SOLICTUD", "DESCRIPCION GENERAL DEL FALLO O DE LA SOLICTUD"]),
    getCell(order, ["Si no tiene el formato por favor describa claramente su solicitud (cantidad, dimensiones, material, etc)"]),
  ].join(" "));
  if (extractedSp && matrixBySp.has(normalizeKey(extractedSp))) {
    return { sp: extractedSp, method: "truco_sp_en_texto", detail: `SP ${extractedSp} extraida de comentarios/descripcion de la OT`, matrixRows: matrixBySp.get(normalizeKey(extractedSp)) };
  }
  const matrixRows = matrixByOt.get(normalizeKey(orderNumber)) || [];
  if (matrixRows.length) {
    const sps = [...new Set(matrixRows.map(getMatrixSp).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    return { sp: sps[0] || "", method: "directo_matriz_ot", detail: `Matriz.OT=${orderNumber}; SPs encontrados=[${sps.join(", ")}]`, matrixRows };
  }
  if (extractedSp) {
    return { sp: extractedSp, method: "truco_sp_en_texto_sin_matriz", detail: `SP ${extractedSp} extraida, pero no existe en Matriz`, matrixRows: [] };
  }
  if (directSp) {
    return { sp: directSp, method: "sp_columna_sin_matriz", detail: `OT.sp=${directSp}, pero no existe en Matriz`, matrixRows: [] };
  }
  return { sp: "", method: "sin_cruce_sp", detail: "No hay OT en Matriz ni SP detectable en la OT", matrixRows: [] };
}

function calculateLabor(otNumber, activitiesByOt, personalRates) {
  const activities = activitiesByOt.get(normalizeKey(otNumber)) || [];
  let total = 0;
  let missingRates = 0;
  let totalHours = 0;
  activities.forEach((activity) => {
    const collaborator = normalizeKey(getCellByPosition(activity, 1) || getCell(activity, ["colaborador", "BELMER AVALO ALZATE"]));
    const hours = parseHours(getCell(activity, ["TIEMPO DE LA ACTIVIDAD"]));
    const rate = personalRates.get(collaborator) || 0;
    totalHours += hours;
    total += hours * rate;
    if (hours && !rate) missingRates += 1;
  });
  let detail = activities.length ? `${activities.length} actividades; ${roundMoney(totalHours)} horas` : "No hay actividades con esta OT";
  if (missingRates) detail += `; ${missingRates} actividades sin tarifa de PERSONAL`;
  return {
    value: total ? roundMoney(total) : "",
    method: activities.length ? "directo_actividades_ot" : "sin_actividades",
    detail,
  };
}

function resolvePurchaseValue(otNumber, sp, matrixRecord, indexes) {
  const byOt = indexes.byOt.get(normalizeKey(otNumber));
  if (byOt?.length) return { value: sumFinancialCosts(byOt), method: "directo_financiero_ot", detail: `OT=${otNumber}; ${byOt.length} filas en Hoja 1` };
  const bySp = indexes.bySp.get(normalizeKey(sp));
  if (bySp?.length) return { value: sumFinancialCosts(bySp), method: "directo_financiero_sp", detail: `SP=${sp}; ${bySp.length} filas en Hoja 1` };
  return { value: "", method: "sin_valor_compra", detail: "No hay fila en Hoja 1 por OT ni SP" };
}

function buildFinancialIndexes(records) {
  return {
    byOt: groupBy(records, (record) => getCell(record, ["Numero Orden de Trabajo", "Número Orden de Trabajo"])),
    bySp: groupBy(records, (record) => getCell(record, ["SP"])),
  };
}

function buildPersonalRates(records) {
  const rates = new Map();
  records.forEach((record) => {
    const collaborator = normalizeKey(getCellByPosition(record, 0) || getCell(record, ["i", "colaborador"]));
    const rate = parseFinancialMoney(getCellByPosition(record, 1) || getCell(record, ["VALOR HORA"]));
    if (collaborator && rate) rates.set(collaborator, rate);
  });
  return rates;
}

function groupCollaboratorsByOt(records) {
  const collaboratorsByOt = new Map();
  records.forEach((record) => {
    const ot = normalizeKey(getActivityOt(record));
    const collaborator = String(getCell(record, ["colaborador", "COLABORADOR", "Collaborador"]) || "").trim();
    if (!ot || !collaborator) return;
    if (!collaboratorsByOt.has(ot)) collaboratorsByOt.set(ot, new Map());
    const collaborators = collaboratorsByOt.get(ot);
    const collaboratorKey = normalizeKey(collaborator);
    if (collaboratorKey && !collaborators.has(collaboratorKey)) collaborators.set(collaboratorKey, collaborator);
  });
  return new Map(
    [...collaboratorsByOt.entries()].map(([ot, collaborators]) => [
      ot,
      [...collaborators.values()].sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" })),
    ]),
  );
}

function formatCollaborators(collaborators) {
  if (!collaborators.length) return "";
  return [`Numero : ${collaborators.length}`, ...collaborators].join("\n");
}

function getOrderNumber(record) {
  return normalizeOt(getCell(record, ["5", "OT"]) || record.normalized?.work_order);
}

function getMatrixSp(record) {
  return normalizeSp(getCell(record, ["NUMERO DE LA SP (solo el numero sin letras)*", "NUMERO DE LA SP", "NÚMERO DE LA SP", "SP"]));
}

function getMatrixOt(record) {
  return normalizeOt(getCell(record, ["OT"]));
}

function getActivityOt(record) {
  return normalizeOt(getCell(record, ["OT"]) || getCell(record, ["ORDEN DE TRABAJO/REPORTE DE CAMPO"]));
}

function sumFinancialCosts(records) {
  return roundMoney(records.reduce((total, record) => total + parseFinancialMoney(getCell(record, ["Costo Total", "COSTO TOTAL"])), 0));
}

function getCell(record, names, containsNames = []) {
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

function normalizeHeader(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function getCellByPosition(record, index) {
  const header = record?.headers?.[index];
  return header ? record.cells?.[header] : "";
}

function firstValue(records, names) {
  for (const record of records || []) {
    const value = getCell(record, names);
    if (value !== "") return value;
  }
  return "";
}

function indexBy(records, keyFn) {
  const map = new Map();
  records.forEach((record) => {
    const key = normalizeKey(keyFn(record));
    if (key && !map.has(key)) map.set(key, record);
  });
  return map;
}

function groupBy(records, keyFn) {
  const map = new Map();
  records.forEach((record) => {
    const key = normalizeKey(keyFn(record));
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  });
  return map;
}

function sourceMatches(record, sourceName) {
  const currentSource = normalizeText(record.sourceName);
  const targetSource = normalizeText(sourceName);
  return currentSource === targetSource || currentSource.includes(targetSource);
}

function sheetMatches(record, sheetName) {
  const currentSheet = normalizeText(record.sheetName);
  const targetSheet = normalizeText(sheetName);
  return currentSheet === targetSheet || currentSheet.includes(targetSheet);
}

function normalizeKey(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeOt(value) {
  const text = String(value || "").trim();
  const formulaMatch = text.match(/ROW\(A(\d+)\)/i);
  if (formulaMatch) return String(Math.max(0, Number(formulaMatch[1]) - 1));
  const match = text.match(/(?:OT\s*[-:]?\s*)?(\d+)/i);
  return match ? match[1] : text;
}

function normalizeSp(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:SP\s*[-:]?\s*)?(\d+)/i);
  return match ? match[1] : text;
}

function extractSp(text) {
  const match = String(text || "").match(/\bSP\s*#?\s*0*(\d{1,6})\b/i);
  return match ? match[1] : "";
}

function parseFlexibleDate(value) {
  const text = String(value || "").trim();
  const dateTimeMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dateTimeMatch) {
    const [, day, month, year, hours = "0", minutes = "0", seconds = "0"] = dateTimeMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    const parsed = new Date(Number(fullYear), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return parseDate(value);
}

function getExecutionTime(order, startDate, endDate) {
  const explicitValue = getCell(order, ["TIEMPO ENTREGA\n(dias)", "TIEMPO ENTREGA (dias)", "TIEMPO ENTREGA"], ["tiempo entrega", "tiempo entrega dias", "tiempo entreg a dias"]);
  if (hasValue(explicitValue)) return explicitValue;
  return diffDays(startDate, endDate);
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function diffDays(start, end) {
  if (!start || !end) return "";
  return Math.round(((end.getTime() - start.getTime()) / 86400000) * 10000000000) / 10000000000;
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

function parseFinancialMoney(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  let text = String(value).trim().replace(/\$/g, "").replace(/\s+/g, "");
  if (!text) return 0;

  if (text.includes(",") && text.includes(".")) {
    const firstComma = text.indexOf(",");
    const firstDot = text.indexOf(".");
    if (firstComma < firstDot) {
      text = text.replace(/,/g, "");
    } else {
      text = text.replace(/\./g, "").replace(",", ".");
    }
  } else if (text.includes(",")) {
    const parts = text.split(",");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      text = text.replace(/,/g, "");
    } else {
      text = text.replace(",", ".");
    }
  } else if (text.includes(".")) {
    const parts = text.split(".");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      text = text.replace(/\./g, "");
    }
  }
  return Number(text) || 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatLabel(label, value) {
  return value ? `${label}: ${value}` : "";
}

function buildOtStatusValue(order) {
  return [
    `Marca temporal: ${getCell(order, ["Marca temporal"]) || ""}`,
    `FECHA REAL ENTREGA: ${getCell(order, ["FECHA REAL ENTREGA"], ["fecha real entrega"]) || ""}`,
  ].join(" | ");
}
