import React, { Suspense, lazy, useState } from "react";

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

const OPERATIONS_SECTIONS = [
  {
    id: "pendientes",
    title: "Panel de pendientes",
    description: "Control operativo diario de OT y SP con indicadores, motivos de pendiente y responsables.",
    Component: DashboardPendientes,
  },
  {
    id: "validacion",
    title: "Validación de datos incompletos",
    description: "Inconsistencias automáticas en OT/SP y registros en validation_issues.",
    Component: ValidacionDatos,
  },
  {
    id: "bitacora",
    title: "Bitácora por OT",
    description: "Trazabilidad integral por OT: seguimiento, compras, ejecución y cierre.",
    Component: BitacoraOT,
  },
  {
    id: "alertas",
    title: "Alertas configurables",
    description: "Alertas automáticas, reglas en alert_rules e historial en alert_history.",
    Component: AlertasConfigurables,
  },
];

export function DashboardOperaciones({ records }) {
  const [openSection, setOpenSection] = useState("pendientes");

  return (
    <section className="panel dashboard-ops-panel">
      <div className="panel-head">
        <div>
          <h2>Herramientas operativas</h2>
          <p className="note">Módulos independientes. Se cargan bajo demanda sin alterar KPIs ni alertas actuales.</p>
        </div>
      </div>
      <div className="dashboard-ops-nav">
        {OPERATIONS_SECTIONS.map((section) => (
          <button
            type="button"
            key={section.id}
            className={openSection === section.id ? "active" : ""}
            onClick={() => setOpenSection(section.id)}
          >
            {section.title}
          </button>
        ))}
      </div>
      {OPERATIONS_SECTIONS.map((section) => {
        if (openSection !== section.id) return null;
        const SectionComponent = section.Component;
        return (
          <section className="dashboard-ops-section" key={section.id}>
            <div className="dashboard-source-card">
              <strong>{section.title}</strong>
              <span>{section.description}</span>
            </div>
            <Suspense fallback={<p className="muted">Cargando módulo...</p>}>
              <SectionComponent records={records} />
            </Suspense>
          </section>
        );
      })}
    </section>
  );
}
