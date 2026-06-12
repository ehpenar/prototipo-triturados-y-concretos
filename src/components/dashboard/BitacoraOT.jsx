import React, { useMemo, useState } from "react";
import { buildIntegralBitacora, listAvailableOts } from "../../utils/dashboardOperations.js";
import { EmptyState } from "../EmptyState.jsx";
import { OpsBitacoraSection } from "./OpsShared.jsx";

export function BitacoraOT({ records, timeLabel = "Total histórico" }) {
  const availableOts = useMemo(() => listAvailableOts(records), [records]);
  const [selectedOt, setSelectedOt] = useState("");
  const activeOt = selectedOt || availableOts[0] || "";
  const bitacora = useMemo(() => (activeOt ? buildIntegralBitacora(records, activeOt) : null), [records, activeOt]);

  if (!availableOts.length) {
    return (
      <>
        <p className="source-note">Bitácora integral por OT. No se detectaron OTs disponibles en los datos sincronizados.</p>
        <EmptyState />
      </>
    );
  }

  if (!bitacora) return <EmptyState />;

  return (
    <>
      <p className="source-note">
        Vista consolidada de trazabilidad: creación, seguimiento, compras, ejecución y cierre de la OT seleccionada. Periodo: {timeLabel}.
      </p>
      <label className="dashboard-ops-select">
        OT
        <select value={activeOt} onChange={(event) => setSelectedOt(event.target.value)}>
          {availableOts.map((ot) => (
            <option key={`bitacora-ot-${ot}`} value={ot}>
              OT {ot}
            </option>
          ))}
        </select>
      </label>

      <OpsBitacoraSection title="Información general">
        <div className="ops-record-fields ops-record-fields-grid">
          <Field label="OT" value={bitacora.general.ot} />
          <Field label="Fecha creación" value={bitacora.general.fechaCreacion} />
          <Field label="Responsable" value={bitacora.general.responsable} />
          <Field label="Área solicitante" value={bitacora.general.area} />
          <Field label="Equipo / centro de costo" value={bitacora.general.equipoCentroCosto} />
          <Field label="Estado" value={bitacora.general.estado} />
        </div>
        <p className="ops-bitacora-text">{bitacora.general.descripcion}</p>
      </OpsBitacoraSection>

      <OpsBitacoraSection title="Seguimiento">
        <BitacoraList items={bitacora.seguimiento.estados.map((item) => `${item.label}: ${item.value}`)} />
        <BitacoraList items={bitacora.seguimiento.comentarios.map((item) => `${item.source}: ${item.value}`)} emptyLabel="Sin comentarios registrados." />
        <BitacoraList items={bitacora.seguimiento.actualizaciones.map((item) => `${item.label}: ${item.value}`)} emptyLabel="Sin fechas de actualización." />
        <BitacoraList items={bitacora.seguimiento.responsables} emptyLabel="Sin responsables adicionales." />
      </OpsBitacoraSection>

      <OpsBitacoraSection title="Relación con compras">
        <Field label="Valor compra total" value={bitacora.compras.valorCompraTotal} />
        <BitacoraList items={bitacora.compras.ordenesCompra.map((oc) => `OC: ${oc}`)} emptyLabel="Sin órdenes de compra." />
        <div className="list dashboard-scroll-list">
          {bitacora.compras.sps.map((sp) => (
            <article className="item" key={`bitacora-sp-${sp.spNumber}-${sp.estado}`}>
              <strong>SP {sp.spNumber}</strong>
              <small>{sp.estado} · OC {sp.ordenCompra} · {sp.valorCompra}</small>
            </article>
          ))}
        </div>
      </OpsBitacoraSection>

      <OpsBitacoraSection title="Ejecución">
        <BitacoraList items={bitacora.ejecucion.pendientes.map((item) => `Pendiente: ${item}`)} emptyLabel="Sin pendientes detectados." />
        <div className="list dashboard-scroll-list">
          {bitacora.ejecucion.actividades.map((activity, index) => (
            <article className="item" key={`bitacora-act-${index}`}>
              <strong>{activity.actividad || "Actividad"}</strong>
              <small>{activity.fecha} · {activity.colaborador} · {activity.repuestos || "Sin repuestos"}</small>
            </article>
          ))}
        </div>
        <BitacoraList items={bitacora.ejecucion.evidencias.map((item) => `${item.label}: ${item.value}`)} emptyLabel="Sin evidencias o enlaces." />
      </OpsBitacoraSection>

      <OpsBitacoraSection title="Cierre">
        <div className="ops-record-fields ops-record-fields-grid">
          <Field label="Fecha finalización" value={bitacora.cierre.fechaFinalizacion} />
          <Field label="Responsable cierre" value={bitacora.cierre.responsableCierre} />
          <Field label="Informe" value={bitacora.cierre.informe} />
        </div>
        <p className="ops-bitacora-text">{bitacora.cierre.observacionesFinales}</p>
      </OpsBitacoraSection>

      <OpsBitacoraSection title="Línea de tiempo">
        <div className="list dashboard-scroll-list dashboard-ops-timeline">
          {bitacora.timeline.map((event) => (
            <article className={`item severity-${event.severity || "low"}`} key={event.id}>
              <strong>{event.title}</strong>
              <small>{formatEventDate(event.date)}{event.detail ? ` · ${event.detail}` : ""}</small>
            </article>
          ))}
        </div>
      </OpsBitacoraSection>
    </>
  );
}

function Field({ label, value }) {
  return (
    <div className="ops-record-field">
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function BitacoraList({ items, emptyLabel = "Sin información." }) {
  if (!items?.length) return <p className="note">{emptyLabel}</p>;
  return (
    <div className="list">
      {items.map((item, index) => (
        <article className="item" key={`bitacora-line-${index}`}>
          <small>{item}</small>
        </article>
      ))}
    </div>
  );
}

function formatEventDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Fecha no reconocida";
  return date.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric" });
}
