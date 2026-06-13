import { buildOperationalControlData } from "./dashboardOperations.js";

export function buildDashboardSmartAlerts(records, limit = 40) {
  const data = buildOperationalControlData(records || []);
  return data.alerts.slice(0, limit).map((alert) => ({
    id: alert.id || `${alert.entityType}-${alert.entityId}-${alert.alertMessage}`,
    severity: alert.severity || "medium",
    title: alert.entityName || `${alert.entityType || "Registro"} ${alert.entityId || ""}`.trim(),
    detail: [
      alert.alertMessage,
      alert.detectedAt ? `Detectada: ${alert.detectedAt}` : "",
      alert.source === "rule" ? "Origen: regla configurada" : "",
    ].filter(Boolean).join(" · "),
  }));
}
