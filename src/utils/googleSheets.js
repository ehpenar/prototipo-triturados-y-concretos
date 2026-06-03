import { CONFIG } from "../constants/config.js";
import {
  extractSpreadsheetId,
  quoteSheetName,
  sheetRange,
  columnName,
  chunkArray,
} from "./helpers.js";
import { parseValues, classifyDocument } from "./analysis.js";

const GOOGLE_ACCESS_TOKEN_KEY = "google_access_token";
const GOOGLE_TOKEN_EXPIRES_AT_KEY = "google_access_token_expires_at";
const GOOGLE_TOKEN_LINKED_AT_KEY = "google_access_token_linked_at";
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

export async function loadSpreadsheet(source, tokenRef, allowAuthPrompt = true) {
  const spreadsheetId = extractSpreadsheetId(source.url);
  if (!spreadsheetId) throw new Error("URL de Google Sheets invalida");
  const metadata = await fetchSheetMetadata(spreadsheetId, tokenRef, allowAuthPrompt);
  const sheets = [];
  const records = [];
  const valuesBySheet = await fetchAllSheetValues(spreadsheetId, metadata.sheets, tokenRef, allowAuthPrompt);
  for (const tab of metadata.sheets) {
    const values = valuesBySheet[tab.title] || [];
    const parsed = parseValues(values, source, tab, spreadsheetId);
    sheets.push({ ...tab, ...parsed.profile });
    records.push(...parsed.records);
  }
  return {
    id: spreadsheetId,
    source,
    title: metadata.title || source.name,
    sheets,
    records,
    profile: classifyDocument(source.name, sheets, source.roleHint),
  };
}

export async function fetchSheetMetadata(spreadsheetId, tokenRef, allowAuthPrompt = true) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties(title,sheetId,index,hidden,gridProperties(rowCount,columnCount))`;
  const data = await googleFetch(url, tokenRef, {}, allowAuthPrompt);
  return {
    title: data.properties?.title,
    sheets: (data.sheets || []).map((sheet) => ({
      title: sheet.properties.title,
      sheetId: sheet.properties.sheetId,
      index: sheet.properties.index,
      hidden: Boolean(sheet.properties.hidden),
      rows: sheet.properties.gridProperties?.rowCount || 0,
      columns: sheet.properties.gridProperties?.columnCount || 0,
    })),
  };
}

export async function fetchAllSheetValues(spreadsheetId, sheets, tokenRef, allowAuthPrompt = true) {
  const result = {};
  const chunks = chunkArray(sheets, 20);
  for (const chunk of chunks) {
    const params = new URLSearchParams({
      majorDimension: "ROWS",
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    chunk.forEach((sheet) => params.append("ranges", sheetRange(sheet)));
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params.toString()}`;
    const data = await googleFetch(url, tokenRef, {}, allowAuthPrompt);
    (data.valueRanges || []).forEach((range, index) => {
      result[chunk[index].title] = range.values || [];
    });
  }
  return result;
}

export async function updateSheetRow(record, headers, cells, tokenRef) {
  const values = headers.map((header) => cells[header] ?? "");
  const sheetRowRange = `${quoteSheetName(record.sheetName)}!A${record.rowNumber}:${columnName(headers.length)}${record.rowNumber}`;
  const range = encodeURIComponent(sheetRowRange);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${record.sourceId}/values/${range}?valueInputOption=USER_ENTERED`;
  return googleFetch(url, tokenRef, {
    method: "PUT",
    body: JSON.stringify({ range: sheetRowRange, majorDimension: "ROWS", values: [values] }),
  });
}

export async function appendSheetRow(spreadsheetId, sheetName, headers, cells, tokenRef) {
  const values = headers.map((header) => cells[header] ?? "");
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}!A:${columnName(headers.length)}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  return googleFetch(url, tokenRef, {
    method: "POST",
    body: JSON.stringify({ majorDimension: "ROWS", values: [values] }),
  });
}

export async function upsertSheetRows(spreadsheetId, sheetName, headers, rows, keyHeader, tokenRef, allowAuthPrompt = true) {
  if (!rows.length) return { added: 0, changed: 0, unchanged: 0 };
  const existing = await fetchSheetValues(spreadsheetId, sheetName, tokenRef, allowAuthPrompt);
  const existingHeaders = existing[0]?.length ? existing[0] : headers;
  const finalHeaders = mergeHeaders(existingHeaders, headers);
  const keyIndex = finalHeaders.findIndex((header) => header === keyHeader);
  if (keyIndex === -1) throw new Error(`No existe la llave ${keyHeader} para actualizar ${sheetName}`);

  const bodyRows = existing.slice(1);
  const rowByKey = new Map();
  bodyRows.forEach((row, index) => {
    const key = normalizeSheetKey(row[keyIndex]);
    if (key) rowByKey.set(key, { index, row });
  });

  let added = 0;
  let changed = 0;
  let unchanged = 0;
  const nextBodyRows = bodyRows.map((row) => padRow(row, finalHeaders.length));

  rows.forEach((rowObject) => {
    const key = normalizeSheetKey(rowObject[keyHeader]);
    if (!key) return;
    const existingRow = rowByKey.get(key);
    const nextRow = finalHeaders.map((header, index) => {
      if (Object.prototype.hasOwnProperty.call(rowObject, header)) return rowObject[header] ?? "";
      return existingRow ? existingRow.row[index] ?? "" : "";
    });
    if (!existingRow) {
      nextBodyRows.push(nextRow);
      added += 1;
      return;
    }
    if (rowsEqual(existingRow.row, nextRow, finalHeaders.length)) {
      unchanged += 1;
      return;
    }
    nextBodyRows[existingRow.index] = nextRow;
    changed += 1;
  });

  const values = [finalHeaders, ...nextBodyRows];
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}!A1:${columnName(finalHeaders.length)}${values.length}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;
  await googleFetch(url, tokenRef, {
    method: "PUT",
    body: JSON.stringify({ majorDimension: "ROWS", values }),
  }, allowAuthPrompt);
  return { added, changed, unchanged };
}

export async function fetchSheetValues(spreadsheetId, sheetName, tokenRef, allowAuthPrompt = true) {
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}!A1:ZZ`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const data = await googleFetch(url, tokenRef, {}, allowAuthPrompt);
  return data.values || [];
}

export async function createSheetWithHeaders(spreadsheetId, title, headers, tokenRef) {
  const addUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  try {
    await googleFetch(addUrl, tokenRef, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title,
                gridProperties: { rowCount: 1000, columnCount: Math.max(headers.length, 10) },
              },
            },
          },
        ],
      }),
    });
  } catch (error) {
    if (!String(error.message).includes("already exists") && !String(error.message).includes("400")) throw error;
  }
  const range = encodeURIComponent(`${quoteSheetName(title)}!A1:${columnName(headers.length)}1`);
  const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;
  return googleFetch(valuesUrl, tokenRef, {
    method: "PUT",
    body: JSON.stringify({ majorDimension: "ROWS", values: [headers] }),
  });
}

export async function updateSheetCell(spreadsheetId, sheetName, column, row, value, tokenRef) {
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}!${column}${row}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;
  return googleFetch(url, tokenRef, {
    method: "PUT",
    body: JSON.stringify({ majorDimension: "ROWS", values: [[value]] }),
  });
}

export async function sendGmailMessage({ from = "", to = "", subject = "", message = "" }, tokenRef) {
  const recipients = String(to || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!recipients.length) throw new Error("Falta al menos un correo receptor");

  const headers = [
    from ? `From: ${sanitizeEmailHeader(from)}` : "",
    `To: ${recipients.map(sanitizeEmailHeader).join(", ")}`,
    `Subject: ${encodeMimeHeader(subject || "Prueba de correo")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ].filter(Boolean);
  const mime = `${headers.join("\r\n")}\r\n\r\n${message || ""}`;
  const url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

  return googleFetch(url, tokenRef, {
    method: "POST",
    body: JSON.stringify({ raw: toBase64Url(mime) }),
  });
}

function sanitizeEmailHeader(value) {
  return String(value || "").replace(/[\r\n]/g, "").trim();
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${toBase64(String(value || "").replace(/[\r\n]/g, " "))}?=`;
}

function toBase64Url(value) {
  return toBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function mergeHeaders(existingHeaders, requiredHeaders) {
  const result = [...existingHeaders];
  requiredHeaders.forEach((header) => {
    if (!result.includes(header)) result.push(header);
  });
  return result;
}

function normalizeSheetKey(value) {
  return String(value || "").trim().toLowerCase();
}

function padRow(row, length) {
  return Array.from({ length }, (_, index) => row[index] ?? "");
}

function rowsEqual(left, right, length) {
  for (let index = 0; index < length; index += 1) {
    if (String(left[index] ?? "") !== String(right[index] ?? "")) return false;
  }
  return true;
}

export async function googleFetch(url, tokenRef, options = {}, allowAuthPrompt = true, authRetried = false) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (tokenRef.current && isStoredGoogleTokenExpired()) {
    clearStoredGoogleToken();
    tokenRef.current = "";
  }
  if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 || response.status === 403) {
    const detail = await response.text();
    clearStoredGoogleToken();
    tokenRef.current = "";
    if (authRetried) {
      throw new Error(buildGoogleAuthError(response.status, detail));
    }
    if (!allowAuthPrompt) {
      try {
        const token = await requestGoogleToken("");
        tokenRef.current = token;
        return googleFetch(url, tokenRef, options, allowAuthPrompt, true);
      } catch {
        throw new Error("Autorizacion requerida. Pulsa Sincronizar para iniciar sesion con Google.");
      }
    }
    const token = await requestGoogleTokenWithFallback();
    tokenRef.current = token;
    return googleFetch(url, tokenRef, options, allowAuthPrompt, true);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google API ${response.status}: ${detail.slice(0, 180)}`);
  }
  if (response.status === 204) return {};
  return response.json();
}

export function getStoredGoogleToken() {
  try {
    const token = localStorage.getItem(GOOGLE_ACCESS_TOKEN_KEY) || "";
    if (!token) return "";
    if (isStoredGoogleTokenExpired()) {
      clearStoredGoogleToken();
      return "";
    }
    return token;
  } catch {
    return "";
  }
}

export function requestGoogleToken(prompt = "") {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      loadGoogleIdentity()
        .then(() => requestGoogleToken(prompt).then(resolve).catch(reject))
        .catch(reject);
      return;
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.google.clientId,
      scope: CONFIG.google.scopes,
      callback: (tokenResponse) => {
        if (tokenResponse.error) reject(new Error(tokenResponse.error));
        else {
          persistGoogleToken(tokenResponse);
          resolve(tokenResponse.access_token);
        }
      },
    });
    client.requestAccessToken({ prompt });
  });
}

async function requestGoogleTokenWithFallback() {
  try {
    return await requestGoogleToken("");
  } catch {
    return requestGoogleToken("select_account consent");
  }
}

function buildGoogleAuthError(status, detail) {
  const text = String(detail || "");
  if (status === 403) {
    return `Google API 403: la cuenta autorizada no tiene acceso a este archivo. Usa Sincronizar y selecciona una cuenta con permisos, o comparte el Google Sheet con esa cuenta. ${text.slice(0, 120)}`;
  }
  return `Google API ${status}: autorizacion requerida. ${text.slice(0, 160)}`;
}

function persistGoogleToken(tokenResponse) {
  const token = tokenResponse.access_token || "";
  if (!token) return;
  const now = Date.now();
  const expiresInMs = Math.max(0, Number(tokenResponse.expires_in || 0) * 1000);
  localStorage.setItem(GOOGLE_ACCESS_TOKEN_KEY, token);
  localStorage.setItem(GOOGLE_TOKEN_LINKED_AT_KEY, new Date(now).toISOString());
  if (expiresInMs) localStorage.setItem(GOOGLE_TOKEN_EXPIRES_AT_KEY, String(now + expiresInMs));
}

function isStoredGoogleTokenExpired() {
  try {
    const expiresAt = Number(localStorage.getItem(GOOGLE_TOKEN_EXPIRES_AT_KEY) || 0);
    return Boolean(expiresAt && Date.now() >= expiresAt - TOKEN_REFRESH_MARGIN_MS);
  } catch {
    return false;
  }
}

function clearStoredGoogleToken() {
  try {
    localStorage.removeItem(GOOGLE_ACCESS_TOKEN_KEY);
    localStorage.removeItem(GOOGLE_TOKEN_EXPIRES_AT_KEY);
    localStorage.removeItem(GOOGLE_TOKEN_LINKED_AT_KEY);
  } catch {
    // Ignore storage cleanup errors; the next request will ask Google again.
  }
}

export function loadGoogleIdentity() {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-google-identity]");
    if (existing) {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("No se pudo cargar Google Identity Services")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = resolve;
    script.onerror = () => reject(new Error("No se pudo cargar Google Identity Services"));
    document.head.appendChild(script);
  });
}
