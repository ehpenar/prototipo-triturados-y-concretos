import React, { useState } from "react";
import { EmptyState } from "../EmptyState.jsx";
import { OpsIndicators, OpsRecordList, OpsSectionTabs } from "./OpsShared.jsx";
import { useOperationalOpsData } from "./OperationalOpsContext.jsx";

const OT_FILTER_IDS = new Set(["ot-open", "ot-overdue", "ot-sin-revisar", "ot-incomplete", "ot-closed"]);
const SP_FILTER_IDS = new Set(["sp-open", "sp-sin-oc", "sp-incomplete"]);

export function DashboardPendientes({ records, timeLabel = "Total histórico" }) {
  const [activeTab, setActiveTab] = useState("ot");
  const [activeFilter, setActiveFilter] = useState(null);
  const data = useOperationalOpsData()?.data;
  if (!data) return <p className="muted">Cargando panel de pendientes...</p>;
  const tabs = [
    { id: "ot", label: "Pendientes OT", count: data.otPending.length },
    { id: "sp", label: "Pendientes SP", count: data.spPending.length },
  ];
  const activeIndicator = data.indicators.find((item) => item.id === activeFilter);
  const filteredItems = activeFilter ? (data.indicatorFilters[activeFilter] || []) : null;
  const defaultItems = activeTab === "ot" ? data.otPending : data.spPending;
  const displayItems = filteredItems ?? defaultItems;
  const hasContent = data.otPending.length || data.spPending.length || data.indicators.some((item) => item.value > 0);

  const handleFilterClick = (filterId) => {
    setActiveFilter(filterId);
    if (OT_FILTER_IDS.has(filterId)) setActiveTab("ot");
    if (SP_FILTER_IDS.has(filterId)) setActiveTab("sp");
  };

  const clearFilter = () => setActiveFilter(null);

  return (
    <>
      <p className="source-note">
        Control operativo diario desde ORDENES DE TRABAJO TYC y Matriz de Seguimiento. Periodo: {timeLabel}.
        {activeFilter ? ` Filtro activo: ${activeIndicator?.label || activeFilter}.` : ""}
      </p>
      <OpsIndicators
        indicators={data.indicators}
        activeFilterId={activeFilter}
        onFilterClick={handleFilterClick}
      />
      {activeFilter && (
        <div className="dashboard-ops-filter-actions">
          <button type="button" className="secondary-button" onClick={clearFilter}>
            Mostrar todos
          </button>
        </div>
      )}
      {!activeFilter && <OpsSectionTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />}
      {!hasContent ? (
        <EmptyState />
      ) : (
        <OpsRecordList
          items={displayItems}
          emptyLabel={
            activeFilter
              ? `No hay registros para el filtro "${activeIndicator?.label || activeFilter}".`
              : activeTab === "ot"
                ? "No se detectaron OT con condiciones de pendiente definidas."
                : "No se detectaron SP que requieran seguimiento."
          }
        />
      )}
    </>
  );
}
