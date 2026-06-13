import React, { Suspense, lazy, useMemo, useState } from "react";
import {
  OPS_TIME_FILTER_OPTIONS,
  buildOpsAvailableYears,
  filterRecordsByOpsTimeRange,
  getOpsMonthMatch,
  getOpsTimeFilterLabel,
} from "../../utils/opsTimeFilter.js";
import { buildOperationalControlData, parseAlertRules } from "../../utils/dashboardOperations.js";
import { OpsHelpTrigger } from "./OpsShared.jsx";
import { OperationalOpsContext } from "./OperationalOpsContext.jsx";

const DashboardPendientes = lazy(() =>
  import("./DashboardPendientes.jsx").then((module) => ({ default: module.DashboardPendientes })),
);
const ValidacionDatos = lazy(() =>
  import("./ValidacionDatos.jsx").then((module) => ({ default: module.ValidacionDatos })),
);
const BitacoraOT = lazy(() =>
  import("./BitacoraOT.jsx").then((module) => ({ default: module.BitacoraOT })),
);
const AlertasConfigurables = lazy(() =>
  import("./AlertasConfigurables.jsx").then((module) => ({ default: module.AlertasConfigurables })),
);
const DashboardSeguimiento = lazy(() =>
  import("./DashboardSeguimiento.jsx").then((module) => ({ default: module.DashboardSeguimiento })),
);

const OPERATIONS_SECTIONS = [
  {
    id: "pendientes",
    title: "Panel de pendientes",
    description: "Control operativo diario de OT y SP con indicadores, motivos de pendiente y responsables.",
    helpText: "Permite visualizar rápidamente elementos operativos que requieren seguimiento o cierre: OTs pendientes, SP pendientes, compras pendientes, informes pendientes, validaciones sin resolver y registros sin actividad reciente.",
    Component: DashboardPendientes,
  },
  {
    id: "validacion",
    title: "Validación de datos incompletos",
    description: "Inconsistencias automáticas en OT/SP y registros en validation_issues.",
    helpText: "Identifica registros con información faltante o inconsistente, como OT sin estado, SP sin orden de compra, fechas obligatorias vacías, valores vacíos, mano de obra incompleta y datos requeridos sin diligenciar.",
    Component: ValidacionDatos,
  },
  {
    id: "bitacora",
    title: "Bitácora por OT",
    description: "Trazabilidad integral por OT: seguimiento, compras, ejecución y cierre.",
    helpText: "Presenta un resumen cronológico por OT: creación, cambios de estado, SP asociadas, órdenes de compra, informes emitidos, validaciones detectadas, alertas registradas y resolución de incidencias.",
    Component: BitacoraOT,
  },
  {
    id: "alertas",
    title: "Alertas configurables",
    description: "Alertas automáticas, reglas en alert_rules e historial en alert_history.",
    helpText: "Permite definir y consultar reglas para detectar situaciones críticas: OT o SP abiertas más de X días, compras que superen un valor, información incompleta y falta de actividad reciente.",
    Component: AlertasConfigurables,
  },
  {
    id: "seguimiento",
    title: "Actividades de mantenimiento",
    description: "Consulta actividades desde FACTURACION y Respuestas de formulario 1 con filtros por equipo, personal y proceso.",
    helpText: "Unifica actividades del REPORTE DE ACTIVIDADES MANTENIMIENTO: horas, valor de actividad, OT, colaborador y equipo. Cruza FACTURACION con el formulario de campo sin duplicar registros.",
    Component: DashboardSeguimiento,
  },
];

export function DashboardOperaciones({ records }) {
  const [openSection, setOpenSection] = useState("pendientes");
  const [opsTimeFilter, setOpsTimeFilter] = useState("all");
  const [opsYearFilter, setOpsYearFilter] = useState(() => new Date().getFullYear());
  const isMonthFilter = getOpsMonthMatch(opsTimeFilter) !== null;
  const availableYears = useMemo(() => buildOpsAvailableYears(records), [records]);
  const filteredRecords = useMemo(
    () => filterRecordsByOpsTimeRange(records, opsTimeFilter, opsYearFilter),
    [records, opsTimeFilter, opsYearFilter],
  );
  const selectedTimeLabel = getOpsTimeFilterLabel(opsTimeFilter, opsYearFilter);
  const needsOperationalData = openSection === "pendientes" || openSection === "validacion";
  const needsAlertRules = openSection === "alertas";
  const operationalData = useMemo(
    () => (needsOperationalData ? buildOperationalControlData(filteredRecords) : null),
    [filteredRecords, needsOperationalData],
  );
  const alertRules = useMemo(
    () => (needsAlertRules ? parseAlertRules(filteredRecords) : null),
    [filteredRecords, needsAlertRules],
  );
  const activeSection = OPERATIONS_SECTIONS.find((section) => section.id === openSection) || OPERATIONS_SECTIONS[0];
  const ActiveComponent = activeSection.Component;

  return (
    <OperationalOpsContext.Provider value={{ data: operationalData, rules: alertRules }}>
    <section className="panel dashboard-ops-panel">
      <div className="panel-head">
        <div>
          <h2 className="ops-title-with-help">
            Herramientas operativas
            <OpsHelpTrigger text="Módulos independientes para control operativo. No alteran KPIs, alertas inteligentes ni filtros globales del Dashboard." />
          </h2>
          <p className="note">Análisis local sobre datos ya sincronizados. El filtro temporal aplica solo dentro de esta sección.</p>
        </div>
      </div>

      <section className="panel compact-panel dashboard-ops-time-filter">
        <div>
          <h3>Filtro temporal de herramientas operativas</h3>
          <p className="note">Periodo activo: {selectedTimeLabel}</p>
        </div>
        <div className="dashboard-kpi-filter-controls">
          <label>
            Periodo
            <select value={opsTimeFilter} onChange={(event) => setOpsTimeFilter(event.target.value)}>
              {OPS_TIME_FILTER_OPTIONS.map((option) => (
                <option key={`ops-time-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {isMonthFilter && (
            <label>
              Año
              <select value={opsYearFilter} onChange={(event) => setOpsYearFilter(Number(event.target.value))}>
                {availableYears.map((year) => (
                  <option key={`ops-year-${year}`} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <div className="dashboard-ops-nav">
        {OPERATIONS_SECTIONS.map((section) => (
          <button
            type="button"
            key={section.id}
            className={openSection === section.id ? "active" : ""}
            onClick={() => setOpenSection(section.id)}
            title={section.helpText}
          >
            {section.title}
          </button>
        ))}
      </div>

      <section className="dashboard-ops-section">
        <div className="dashboard-source-card">
          <strong className="ops-title-with-help">
            {activeSection.title}
            <OpsHelpTrigger text={activeSection.helpText} />
          </strong>
          <span>{activeSection.description}</span>
          <small>Mostrando información del periodo: {selectedTimeLabel}</small>
        </div>
        <Suspense fallback={<p className="muted">Cargando módulo...</p>}>
          <ActiveComponent records={filteredRecords} timeLabel={selectedTimeLabel} />
        </Suspense>
      </section>
    </section>
    </OperationalOpsContext.Provider>
  );
}
