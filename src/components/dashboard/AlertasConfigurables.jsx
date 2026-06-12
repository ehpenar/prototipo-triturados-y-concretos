import React, { useMemo } from "react";
import { buildOperationalControlData, parseAlertRules } from "../../utils/dashboardOperations.js";
import { EmptyState } from "../EmptyState.jsx";
import { OpsIndicators, OpsRecordList } from "./OpsShared.jsx";

export function AlertasConfigurables({ records }) {
  const data = useMemo(() => buildOperationalControlData(records), [records]);
  const rules = useMemo(() => parseAlertRules(records), [records]);
  const activeRules = rules.filter((rule) => rule.active !== false);
  const listItems = data.alerts.map((alert) => ({
    id: alert.id || `${alert.entityType}-${alert.entityId}-${alert.detectedAt}`,
    severity: alert.severity || "medium",
    title: alert.entityName || `${alert.entityType} ${alert.entityId}`,
    subtitle: alert.status || "open",
    reasons: [alert.alertMessage],
    fields: [
      { label: "Entidad", value: `${alert.entityType || "—"} ${alert.entityId || ""}`.trim() },
      { label: "Detectada", value: alert.detectedAt || "—" },
      { label: "Origen", value: alert.source === "rule" ? "Regla configurada" : alert.source === "automatic" ? "Alerta automática" : "alert_history" },
    ],
  }));

  return (
    <>
      <p className="source-note">
        Alertas automáticas por condiciones operativas, reglas en alert_rules e historial en alert_history.
      </p>
      <OpsIndicators indicators={data.indicators.filter((item) => item.id === "alerts-critical")} />
      {activeRules.length > 0 && (
        <div className="dashboard-source-card">
          <strong>Reglas configuradas ({activeRules.length})</strong>
          <div className="list">
            {activeRules.slice(0, 8).map((rule) => (
              <article className="item" key={`rule-${rule.id || rule.name}`}>
                <strong>{rule.name || rule.conditionType}</strong>
                <small>{rule.description || `${rule.conditionType} · umbral ${rule.thresholdValue || "—"} ${rule.thresholdUnit || ""}`.trim()}</small>
              </article>
            ))}
          </div>
        </div>
      )}
      {!listItems.length ? <EmptyState /> : <OpsRecordList items={listItems} />}
    </>
  );
}
