import React, { useState, useEffect } from "react";
import { createId } from "../utils/helpers.js";
import { createSheetWithHeaders, appendSheetRow } from "../utils/googleSheets.js";
import { EmptyState } from "../components/EmptyState.jsx";

export function Reminders({ documents, notes, setNotes, tokenRef, addLog, onSaved }) {
  const [draft, setDraft] = useState({
    title: "",
    detail: "",
    frequency: "Diario",
    date: "",
    channel: "Plataforma",
    recipients: "",
  });
  const [sheetDraft, setSheetDraft] = useState({
    sourceId: documents[0]?.id || "",
    title: "Notas_Recordatorios",
    columns: "Titulo,Detalle,Frecuencia,Fecha,Canal,Destinatarios,Estado",
  });
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!sheetDraft.sourceId && documents[0]?.id) setSheetDraft((current) => ({ ...current, sourceId: documents[0].id }));
  }, [documents, sheetDraft.sourceId]);

  const addNote = (event) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    setNotes((current) => [...current, { ...draft, id: createId(), createdAt: new Date().toISOString(), status: "Pendiente" }]);
    setDraft({ title: "", detail: "", frequency: "Diario", date: "", channel: "Plataforma", recipients: "" });
  };

  const createSheet = async (event) => {
    event.preventDefault();
    setStatus("Creando hoja...");
    try {
      const columns = sheetDraft.columns.split(",").map((column) => column.trim()).filter(Boolean);
      await createSheetWithHeaders(sheetDraft.sourceId, sheetDraft.title, columns, tokenRef);
      setStatus("Hoja creada");
      addLog(`Hoja ${sheetDraft.title} creada para notas y recordatorios.`);
      onSaved();
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const pushNoteToSheet = async (note) => {
    setStatus("Enviando nota a Sheets...");
    try {
      const columns = sheetDraft.columns.split(",").map((column) => column.trim()).filter(Boolean);
      await appendSheetRow(
        sheetDraft.sourceId,
        sheetDraft.title,
        columns,
        {
          Titulo: note.title,
          Detalle: note.detail,
          Frecuencia: note.frequency,
          Fecha: note.date,
          Canal: note.channel,
          Destinatarios: note.recipients,
          Estado: note.status,
        },
        tokenRef,
      );
      setStatus("Nota guardada en Sheets");
      onSaved();
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <section className="view active">
      <div className="split">
        <section className="panel">
          <h2>Crear nota o recordatorio</h2>
          <form className="dynamic-form" onSubmit={addNote}>
            <label>
              Titulo
              <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              Detalle
              <textarea value={draft.detail} onChange={(event) => setDraft((current) => ({ ...current, detail: event.target.value }))} />
            </label>
            <label>
              Frecuencia
              <select value={draft.frequency} onChange={(event) => setDraft((current) => ({ ...current, frequency: event.target.value }))}>
                <option>Diario</option>
                <option>Semanal</option>
                <option>Mensual</option>
                <option>Fecha especifica</option>
              </select>
            </label>
            <label>
              Fecha
              <input type="datetime-local" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} />
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
            <label>
              Destinatarios
              <input value={draft.recipients} onChange={(event) => setDraft((current) => ({ ...current, recipients: event.target.value }))} />
            </label>
            <button type="submit">Crear recordatorio</button>
          </form>
        </section>
        <section className="panel">
          <h2>Crear hoja y columnas en Sheets</h2>
          <form className="dynamic-form" onSubmit={createSheet}>
            <label>
              Documento destino
              <select value={sheetDraft.sourceId} onChange={(event) => setSheetDraft((current) => ({ ...current, sourceId: event.target.value }))}>
                {documents.map((document, index) => (
                  <option key={`reminder-doc-${document.id}-${index}`} value={document.id}>
                    {document.title || document.source?.name || document.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nombre de hoja
              <input value={sheetDraft.title} onChange={(event) => setSheetDraft((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              Columnas separadas por coma
              <textarea value={sheetDraft.columns} onChange={(event) => setSheetDraft((current) => ({ ...current, columns: event.target.value }))} />
            </label>
            <button disabled={!sheetDraft.sourceId} type="submit">Crear hoja</button>
          </form>
          {status && <p className="note">{status}</p>}
        </section>
      </div>
      <section className="panel">
        <h2>Recordatorios activos</h2>
        {!notes.length ? (
          <EmptyState />
        ) : (
          <div className="list">
            {notes.map((note, index) => (
              <article className="item" key={`note-${note.id || note.title}-${index}`}>
                <strong>{note.title}</strong>
                <small>
                  {note.frequency} · {note.date || "Sin fecha"} · {note.channel} · {note.recipients || "Sin destinatarios"}
                </small>
                <p className="muted">{note.detail}</p>
                <div className="inline-actions">
                  <button type="button" onClick={() => pushNoteToSheet(note)}>Guardar en Sheets</button>
                  <button type="button" onClick={() => setNotes((current) => current.filter((item) => item.id !== note.id))}>Quitar</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
