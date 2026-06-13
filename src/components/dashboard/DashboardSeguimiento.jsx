import React, { useMemo, useState } from "react";
import { formatMoney } from "../../utils/helpers.js";
import {
  applyMaintenanceActivityFilters,
  buildMergedMaintenanceActivities,
} from "../../utils/dashboardActivityTracking.js";
import { EmptyState } from "../EmptyState.jsx";
import { OpsIndicators, OpsRecordList, OpsSectionTabs } from "./OpsShared.jsx";

export function DashboardSeguimiento({ records, timeLabel = "Total histórico" }) {
  const [activeTab, setActiveTab] = useState("all");
  const [equipmentFilter, setEquipmentFilter] = useState("");
  const [collaboratorFilter, setCollaboratorFilter] = useState("");
  const [processFilter, setProcessFilter] = useState("");

  const mergedActivities = useMemo(
    () => buildMergedMaintenanceActivities(records),
    [records],
  );

  const tracking = useMemo(
    () => applyMaintenanceActivityFilters(mergedActivities, {
      equipment: equipmentFilter,
      collaborator: collaboratorFilter,
      process: processFilter,
    }),
    [mergedActivities, equipmentFilter, collaboratorFilter, processFilter],
  );

  const tabCounts = useMemo(() => ({
    all: tracking.activities.length,
    equipment: tracking.activities.filter((activity) => activity.equipment).length,
    personal: tracking.activities.filter((activity) => activity.collaborator).length,
  }), [tracking.activities]);

  const tabbedActivities = useMemo(() => {
    if (activeTab === "equipment") {
      return tracking.activities.filter((activity) => activity.equipment);
    }
    if (activeTab === "personal") {
      return tracking.activities.filter((activity) => activity.collaborator);
    }
    return tracking.activities;
  }, [tracking.activities, activeTab]);

  const listItems = useMemo(
    () => tabbedActivities.map((activity) => ({
      id: activity.id,
      severity: activity.cost > 0 ? "medium" : "low",
      title: activity.equipment || activity.collaborator || "Actividad de mantenimiento",
      subtitle: [
        activity.dateLabel,
        activity.collaborator,
        activity.ot,
      ].filter(Boolean).join(" · "),
      reasons: [
        activity.activityType || activity.description || "Sin descripción de actividad",
      ],
      fields: [
        { label: "Equipo", value: activity.equipment || "—" },
        { label: "Colaborador", value: activity.collaborator || "—" },
        { label: "Horas", value: `${activity.hours.toFixed(1)} h` },
        { label: "Valor actividad", value: formatMoney(activity.cost) },
        { label: "Proceso", value: activity.process || "—" },
        { label: "OT", value: activity.ot || "—" },
        { label: "Fuente", value: activity.sources.join(" + ") || "—" },
        ...(activity.spareParts ? [{ label: "Repuestos", value: activity.spareParts }] : []),
      ],
    })),
    [tabbedActivities],
  );

  const indicators = [
    { id: "activities", label: "Actividades", value: tracking.summary.activities },
    { id: "hours", label: "Horas", value: tracking.summary.hours.toFixed(1) },
    { id: "cost", label: "Valor actividades", value: formatMoney(tracking.summary.cost) },
    { id: "ots", label: "OTs", value: tracking.summary.ots },
  ];

  const tabs = [
    { id: "all", label: "Todas", count: tabCounts.all },
    { id: "equipment", label: "Con equipo", count: tabCounts.equipment },
    { id: "personal", label: "Con personal", count: tabCounts.personal },
  ];

  const hasLocalFilters = Boolean(equipmentFilter || collaboratorFilter || processFilter);
  const activeFilterCount = [equipmentFilter, collaboratorFilter, processFilter].filter(Boolean).length;

  const clearFilters = () => {
    setEquipmentFilter("");
    setCollaboratorFilter("");
    setProcessFilter("");
  };

  return (
    <>
      <p className="source-note">
        Actividades desde REPORTE DE ACTIVIDADES MANTENIMIENTO (FACTURACION y Respuestas de formulario 1).
        Periodo: {timeLabel}. Sincronizadas en periodo: {tracking.totalInPeriod}.
        {hasLocalFilters ? ` ${activeFilterCount} filtro(s) local(es) activo(s).` : ""}
      </p>

      <OpsIndicators indicators={indicators} />

      <div className="dashboard-ops-local-filters">
        <div>
          <h3>Filtros por equipo, personal y proceso</h3>
          <p className="note">Adicionales al periodo global. No afectan otros módulos.</p>
        </div>
        <div className="dashboard-ops-local-filter-grid">
          <label>
            Equipo
            <select value={equipmentFilter} onChange={(event) => setEquipmentFilter(event.target.value)}>
              <option value="">Todos</option>
              {tracking.equipmentOptions.map((option) => (
                <option key={`tracking-equipment-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Personal
            <select value={collaboratorFilter} onChange={(event) => setCollaboratorFilter(event.target.value)}>
              <option value="">Todos</option>
              {tracking.collaboratorOptions.map((option) => (
                <option key={`tracking-collaborator-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Proceso
            <select value={processFilter} onChange={(event) => setProcessFilter(event.target.value)}>
              <option value="">Todos</option>
              {tracking.processOptions.map((option) => (
                <option key={`tracking-process-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {hasLocalFilters && (
        <div className="dashboard-ops-filter-actions">
          <button type="button" className="secondary-button" onClick={clearFilters}>
            Mostrar todos
          </button>
        </div>
      )}

      <OpsSectionTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {!listItems.length ? (
        <EmptyState />
      ) : (
        <OpsRecordList
          items={listItems}
          emptyLabel={
            hasLocalFilters
              ? "No hay actividades para los filtros seleccionados."
              : activeTab === "equipment"
                ? "No se detectaron actividades con equipo en este periodo."
                : activeTab === "personal"
                  ? "No se detectaron actividades con personal en este periodo."
                  : "No se detectaron actividades de mantenimiento en este periodo."
          }
        />
      )}
    </>
  );
}
