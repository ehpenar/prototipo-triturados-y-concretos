import React, { useState } from "react";
import { formatMoney, sum, createId } from "../utils/helpers.js";
import { EmptyState } from "../components/EmptyState.jsx";
import { Chips } from "../components/Chips.jsx";

export function Automation({
  alerts,
  automations,
  documents,
  setAutomations,
  pollInterval,
  records,
  relations,
  syncLog,
}) {
  const [draft, setDraft] = useState({
    name: "",
    process: "Mantenimiento",
    sourceId: "",
    sheetName: "",
    columns: [],
    range: "",
    customInfo: "",
    condition: "Nuevo registro o cambio detectado",
    action: "Enviar alerta",
    schedule: "Cada 5 minutos",
    channel: "Plataforma",
  });

  const selectedDocument = documents.find((document) => document.id === draft.sourceId) || documents[0] || null;
  const selectedSheet = selectedDocument?.sheets.find((sheet) => sheet.title === draft.sheetName) || selectedDocument?.sheets[0] || null;
  const availableColumns = selectedSheet?.headers || [];
  const selectedColumnSet = new Set(draft.columns);

  const processes = [
    ["Sincronizacion periodica", pollInterval === 0 ? "Manual" : `Activa cada ${pollInterval / 60000} min`],
    ["Clasificacion dinamica", `${records.length} registros clasificados`],
    ["Relacion OT-compras-actividades", `${relations.length} relaciones detectadas`],
    ["Validacion operacional", `${alerts.length} alertas generadas`],
    ["Consolidacion financiera", formatMoney(sum(records.map((record) => record.normalized.costNumber)))],
  ];

  const addAutomation = (event) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const automation = {
      ...draft,
      sourceId: draft.sourceId || selectedDocument?.id || "",
      sourceName: selectedDocument?.title || "",
      sheetName: draft.sheetName || selectedSheet?.title || "",
      columns: draft.columns.length ? draft.columns : availableColumns,
      id: createId(),
      createdAt: new Date().toISOString(),
      enabled: true,
    };
    setAutomations((current) => [...current, automation]);
    setDraft({
      name: "",
      process: "Mantenimiento",
      sourceId: selectedDocument?.id || "",
      sheetName: selectedSheet?.title || "",
      columns: [],
      range: "",
      customInfo: "",
      condition: "Nuevo registro o cambio detectado",
      action: "Enviar alerta",
      schedule: "Cada 5 minutos",
      channel: "Plataforma",
    });
  };

  const updateDocument = (sourceId) => {
    const document = documents.find((item) => item.id === sourceId);
    setDraft((current) => ({
      ...current,
      sourceId,
      sheetName: document?.sheets[0]?.title || "",
      columns: [],
    }));
  };

  const updateSheet = (sheetName) => {
    setDraft((current) => ({ ...current, sheetName, columns: [] }));
  };

  const toggleColumn = (column) => {
    setDraft((current) => {
      const next = new Set(current.columns);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return { ...current, columns: [...next] };
    });
  };

  const selectAllColumns = () => setDraft((current) => ({ ...current, columns: availableColumns }));
  const clearColumns = () => setDraft((current) => ({ ...current, columns: [] }));

  return (
    <section className="view active">
      <div className="split">
        <section className="panel">
          <h2>Procesos automaticos</h2>
          <div className="list">
            {processes.map(([title, detail]) => (
              <article className="item" key={title}>
                <strong>{title}</strong>
                <small>{detail}</small>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Registro de sincronizacion</h2>
          <div className="log">{syncLog.join("\n")}</div>
        </section>
      </div>
      <div className="split">
        <section className="panel">
          <h2>Crear automatizacion</h2>
          <form className="dynamic-form" onSubmit={addAutomation}>
            <label>
              Nombre
              <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label>
              Proceso
              <select value={draft.process} onChange={(event) => setDraft((current) => ({ ...current, process: event.target.value }))}>
                <option>Mantenimiento</option>
                <option>Compras</option>
                <option>Financiero</option>
                <option>Reportes</option>
              </select>
            </label>
            <label>
              Documento
              <select value={draft.sourceId || selectedDocument?.id || ""} onChange={(event) => updateDocument(event.target.value)}>
                {!documents.length && <option value="">Sin documentos sincronizados</option>}
                {documents.map((document, index) => (
                  <option key={`automation-doc-${document.id}-${index}`} value={document.id}>
                    {document.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Hoja
              <select value={draft.sheetName || selectedSheet?.title || ""} onChange={(event) => updateSheet(event.target.value)}>
                {!selectedDocument?.sheets.length && <option value="">Sin hojas disponibles</option>}
                {(selectedDocument?.sheets || []).map((sheet, index) => (
                  <option key={`automation-sheet-${selectedDocument.id}-${sheet.sheetId}-${sheet.title}-${index}`} value={sheet.title}>
                    {sheet.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rango de datos
              <input
                placeholder="Ej: A1:H200 o columnas completas"
                value={draft.range}
                onChange={(event) => setDraft((current) => ({ ...current, range: event.target.value }))}
              />
            </label>
            <label>
              Condicion
              <input value={draft.condition} onChange={(event) => setDraft((current) => ({ ...current, condition: event.target.value }))} />
            </label>
            <label className="wide-field">
              Informacion personalizada
              <textarea
                placeholder="Describe exactamente que datos debe usar la automatizacion, excepciones o reglas especiales."
                value={draft.customInfo}
                onChange={(event) => setDraft((current) => ({ ...current, customInfo: event.target.value }))}
              />
            </label>
            <div className="wide-field column-picker">
              <div className="panel-head">
                <h2>Columnas a utilizar</h2>
                <div className="inline-actions">
                  <button type="button" onClick={selectAllColumns}>Todas</button>
                  <button type="button" onClick={clearColumns}>Limpiar</button>
                </div>
              </div>
              {!availableColumns.length ? (
                <p className="note">Sin columnas detectadas para esta hoja.</p>
              ) : (
                <div className="column-grid">
                  {availableColumns.map((column, index) => (
                    <label className="check-row" key={`automation-column-${selectedSheet?.sheetId}-${column}-${index}`}>
                      <input
                        checked={selectedColumnSet.has(column)}
                        onChange={() => toggleColumn(column)}
                        type="checkbox"
                      />
                      <span>{column}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <label>
              Accion
              <select value={draft.action} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}>
                <option>Enviar alerta</option>
                <option>Generar informe IA</option>
                <option>Crear recordatorio</option>
                <option>Validar inconsistencias</option>
              </select>
            </label>
            <label>
              Frecuencia
              <select value={draft.schedule} onChange={(event) => setDraft((current) => ({ ...current, schedule: event.target.value }))}>
                <option>Cada 1 minuto</option>
                <option>Cada 5 minutos</option>
                <option>Diario</option>
                <option>Semanal</option>
                <option>Mensual</option>
              </select>
            </label>
            <label>
              Canal
              <select value={draft.channel} onChange={(event) => setDraft((current) => ({ ...current, channel: event.target.value }))}>
                <option>Plataforma</option>
                <option>Email</option>
                <option>Telegram</option>
                <option>Email y Telegram</option>
              </select>
            </label>
            <button type="submit">Guardar automatizacion</button>
          </form>
        </section>
        <section className="panel">
          <h2>Flujos personalizados</h2>
          {!automations.length ? (
            <EmptyState />
          ) : (
            <div className="list">
              {automations.map((automation) => (
                <article className="item" key={automation.id}>
                  <strong>{automation.name}</strong>
                  <small>
                    {automation.process} · {automation.sourceName || "Documento completo"} · {automation.sheetName || "Todas las hojas"} · {automation.action} · {automation.schedule} · {automation.channel}
                  </small>
                  <Chips values={[
                    automation.range ? `Rango ${automation.range}` : "Sin rango especifico",
                    `${automation.columns?.length || 0} columnas`,
                    automation.condition,
                  ]} />
                  {automation.customInfo && <p className="muted">{automation.customInfo}</p>}
                  <button type="button" onClick={() => setAutomations((current) => current.filter((item) => item.id !== automation.id))}>
                    Quitar
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
