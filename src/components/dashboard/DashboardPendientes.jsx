import React, { useMemo, useState } from "react";
import { buildOperationalControlData } from "../../utils/dashboardOperations.js";
import { EmptyState } from "../EmptyState.jsx";
import { OpsIndicators, OpsRecordList, OpsSectionTabs } from "./OpsShared.jsx";

export function DashboardPendientes({ records }) {
  const [activeTab, setActiveTab] = useState("ot");
  const data = useMemo(() => buildOperationalControlData(records), [records]);
  const tabs = [
    { id: "ot", label: "Pendientes OT", count: data.otPending.length },
    { id: "sp", label: "Pendientes SP", count: data.spPending.length },
  ];
  const hasContent = data.otPending.length || data.spPending.length;

  return (
    <>
      <p className="source-note">
        Control operativo diario desde ORDENES DE TRABAJO TYC y Matriz de Seguimiento. Usa únicamente datos ya sincronizados.
      </p>
      <OpsIndicators indicators={data.indicators} />
      <OpsSectionTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      {!hasContent ? (
        <EmptyState />
      ) : activeTab === "ot" ? (
        <OpsRecordList
          items={data.otPending}
          emptyLabel="No se detectaron OT con condiciones de pendiente definidas."
        />
      ) : (
        <OpsRecordList
          items={data.spPending}
          emptyLabel="No se detectaron SP que requieran seguimiento."
        />
      )}
    </>
  );
}
