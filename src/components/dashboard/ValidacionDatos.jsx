import React, { useMemo, useState } from "react";
import { buildOperationalControlData } from "../../utils/dashboardOperations.js";
import { EmptyState } from "../EmptyState.jsx";
import { OpsIndicators, OpsRecordList, OpsSectionTabs } from "./OpsShared.jsx";

export function ValidacionDatos({ records }) {
  const [activeTab, setActiveTab] = useState("all");
  const data = useMemo(() => buildOperationalControlData(records), [records]);
  const otIssues = data.validations.filter((issue) => issue.entityType === "OT");
  const spIssues = data.validations.filter((issue) => issue.entityType === "SP");
  const tabs = [
    { id: "all", label: "Todas", count: data.validations.length },
    { id: "ot", label: "OT", count: otIssues.length },
    { id: "sp", label: "SP", count: spIssues.length },
  ];
  const visibleIssues = activeTab === "ot" ? otIssues : activeTab === "sp" ? spIssues : data.validations;
  const listItems = visibleIssues.map((issue) => ({
    id: issue.id || `${issue.entityType}-${issue.entityId}-${issue.fieldName}`,
    severity: issue.severity || "medium",
    title: `${issue.entityType} ${issue.entityId}`,
    subtitle: issue.issueType,
    reasons: [issue.issueMessage || "Incidencia detectada"],
    fields: [
      { label: "Campo", value: issue.fieldName || "—" },
      { label: "Responsable", value: issue.responsible || "—" },
      { label: "Fecha detección", value: issue.detectedAt || "—" },
      { label: "Estado", value: issue.status || "open" },
      { label: "Fuente", value: issue.source === "computed" ? "Análisis en memoria" : "validation_issues" },
    ],
  }));

  return (
    <>
      <p className="source-note">
        Validación automática de OT y SP, combinando reglas en memoria y la hoja validation_issues cuando existe.
      </p>
      <OpsIndicators indicators={data.indicators.filter((item) => ["ot-incomplete", "sp-incomplete", "duplicates"].includes(item.id))} />
      <OpsSectionTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      {!listItems.length ? <EmptyState /> : <OpsRecordList items={listItems} />}
    </>
  );
}
