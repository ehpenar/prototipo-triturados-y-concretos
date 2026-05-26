import { CONFIG } from "../constants/config.js";

export function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.76;
  const aSet = new Set(a.split(" "));
  const bSet = new Set(b.split(" "));
  const intersection = [...aSet].filter((word) => bSet.has(word)).length;
  return intersection / Math.max(aSet.size, bSet.size);
}

export function cleanKey(value) {
  return normalizeText(value).toUpperCase();
}

export function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
}

export function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

export function parseMoney(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  let text = String(value).trim().replace(/\$/g, "").replace(/\s+/g, "").replace(/[^\d,.-]/g, "");
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

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value).trim();
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const fullYear = year.length === 2 ? `20${year}` : year;
  const parsed = new Date(Number(fullYear), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatMoney(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export function columnName(index) {
  let name = "";
  let current = Math.max(1, Number(index) || 1);
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26);
  }
  return name;
}

export function quoteSheetName(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

export function sheetRange(sheet) {
  const columnCount = Math.max(Number(sheet.columns) || 26, 26);
  const rowCount = Math.max(Number(sheet.rows) || 1000, 1000);
  return `${quoteSheetName(sheet.title)}!A1:${columnName(columnCount)}${rowCount}`;
}

export function extractSpreadsheetId(url) {
  return String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] || "";
}

export function loadSources() {
  const stored = localStorage.getItem("operation_ai_sources");
  if (!stored) return CONFIG.initialSources;
  try {
    let storedSources = JSON.parse(stored);
    let migrated = false;
    storedSources = storedSources.map((source) => {
      if (source.url.includes("1iMCO8CtmN7-2LEcNWbEau9CMWauvXsKIUO3kkym6jJM")) {
        migrated = true;
        return {
          ...source,
          url: "https://docs.google.com/spreadsheets/d/1wWFSW2M3CdxHlr3q-L4eeMhmGMvmCaeUA0tGptWOqME/edit?gid=1862269386#gid=1862269386",
        };
      }
      return source;
    });
    if (migrated) {
      localStorage.setItem("operation_ai_sources", JSON.stringify(storedSources));
    }

    const initialNames = new Set(CONFIG.initialSources.map((source) => source.name));
    const initialIds = new Set(CONFIG.initialSources.map((source) => extractSpreadsheetId(source.url)).filter(Boolean));
    const customSources = storedSources.filter((source) => {
      const spreadsheetId = extractSpreadsheetId(source.url);
      return !initialNames.has(source.name) && !initialIds.has(spreadsheetId);
    });
    return [...CONFIG.initialSources, ...customSources];
  } catch {
    return CONFIG.initialSources;
  }
}

export function saveSources(sources) {
  localStorage.setItem("operation_ai_sources", JSON.stringify(sources));
}

export function loadStored(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

export function saveStored(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
