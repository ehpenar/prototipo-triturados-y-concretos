import { extractSpreadsheetId, loadStored, saveStored } from "./helpers.js";

const SYNC_CACHE_KEY = "operation_ai_sync_cache_v1";
const SYNC_CACHE_VERSION = 1;

export function readValidSyncCache(sources) {
  const cache = loadStored(SYNC_CACHE_KEY, null);
  if (!isSyncCacheValid(cache, sources)) return null;
  return cache;
}

export function isSyncCacheValid(cache, sources) {
  if (!cache || cache.version !== SYNC_CACHE_VERSION) return false;
  if (!Array.isArray(cache.records) || !cache.records.length) return false;
  if (!Array.isArray(cache.documents) || !cache.documents.length) return false;

  const cachedSourceIds = new Set((cache.sourceIds || []).map(String));
  const currentSourceIds = new Set(
    (sources || []).map((source) => extractSpreadsheetId(source.url)).filter(Boolean),
  );
  if (!currentSourceIds.size || cachedSourceIds.size !== currentSourceIds.size) return false;
  for (const sourceId of currentSourceIds) {
    if (!cachedSourceIds.has(sourceId)) return false;
  }
  return true;
}

export function persistSyncCache({
  documents,
  records,
  relations,
  alerts,
  fingerprint,
  sources,
}) {
  const payload = {
    version: SYNC_CACHE_VERSION,
    syncedAt: new Date().toISOString(),
    fingerprint: fingerprint || "",
    sourceIds: (sources || []).map((source) => extractSpreadsheetId(source.url)).filter(Boolean),
    documents,
    records,
    relations: relations || [],
    alerts: alerts || [],
  };

  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length > 4_500_000) {
      console.warn("Cache de sincronizacion omitida: supera el limite seguro del navegador.");
      return false;
    }
    saveStored(SYNC_CACHE_KEY, payload);
    return true;
  } catch (error) {
    console.warn("No se pudo guardar la cache de sincronizacion:", error);
    return false;
  }
}

export function formatSyncCacheStatus(syncedAt) {
  if (!syncedAt) return "Datos en cache";
  const date = new Date(syncedAt);
  if (Number.isNaN(date.getTime())) return "Datos en cache";
  return `Cache ${date.toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
