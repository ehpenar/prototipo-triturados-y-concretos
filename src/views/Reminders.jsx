import React, { useState, useEffect, useMemo } from "react";
import { createId } from "../utils/helpers.js";
import { createSheetWithHeaders, appendSheetRow } from "../utils/googleSheets.js";
import { EmptyState } from "../components/EmptyState.jsx";

export function Reminders({ documents, notes, notificationConfig, setNotes, tokenRef, addLog, onSaved }) {
  const senderEmails = useMemo(() => getSenderEmails(notificationConfig), [notificationConfig]);
  const receiverEmails = useMemo(() => getReceiverEmails(notificationConfig), [notificationConfig]);
  const [draft, setDraft] = useState({
    title: "",
    detail: "",
    frequency: "Diario",
    date: "",
    startDate: "",
    endDate: "",
    channel: "Plataforma",
    senderEmail: senderEmails[0] || "",
    recipients: "",
  });
  const [sheetDraft, setSheetDraft] = useState({
    sourceId: documents[0]?.id || "",
    title: "Notas_Recordatorios",
    columns: "DATE,TITULO,DETALLE,FRECUENCIA,FECHA INICIO,FECHA FINALIZACIÓN,CORREO EMISOR,CORREO RECEPTOR,Canal,Destinatarios,Estado",
  });
  const [status, setStatus] = useState("");

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      senderEmail: current.senderEmail || senderEmails[0] || "",
      recipients: current.recipients || receiverEmails.join(", "),
    }));
  }, [receiverEmails, senderEmails]);

  useEffect(() => {
    if (!sheetDraft.sourceId && documents[0]?.id) setSheetDraft((current) => ({ ...current, sourceId: documents[0].id }));
  }, [documents, sheetDraft.sourceId]);

  const addNote = (event) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    setNotes((current) => [...current, { ...draft, id: createId(), createdAt: new Date().toISOString(), status: "Pendiente" }]);
    setDraft({ title: "", detail: "", frequency: "Diario", date: "", startDate: "", endDate: "", channel: "Plataforma", senderEmail: senderEmails[0] || "", recipients: receiverEmails.join(", ") });
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
          TITULO: note.title,
          Detalle: note.detail,
          DETALLE: note.detail,
          Frecuencia: note.frequency,
          FRECUENCIA: note.frequency,
          Fecha: note.date,
          DATE: note.date,
          "FECHA INICIO": note.startDate,
          "FECHA FINALIZACION": note.endDate,
          "FECHA FINALIZACIÓN": note.endDate,
          "CORREO EMISOR": note.senderEmail,
          "CORREO RECEPTOR": note.recipients,
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
                <option>Fecha específica</option>
              </select>
            </label>
            <label>
              Fecha
              <input type="datetime-local" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} />
            </label>
            <label>
              FECHA INICIO
              <input type="date" value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label>
              FECHA FINALIZACIÓN
              <input type="date" value={draft.endDate} onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))} />
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
              CORREO EMISOR
              <select value={draft.senderEmail} onChange={(event) => setDraft((current) => ({ ...current, senderEmail: event.target.value }))}>
                {!senderEmails.length && <option value="">No hay emisores configurados</option>}
                {senderEmails.map((email) => (
                  <option key={`reminder-sender-${email}`} value={email}>{email}</option>
                ))}
              </select>
            </label>
            <div>
              <span style={{ display: "block", marginBottom: "8px", fontSize: "12px", fontWeight: "700", color: "var(--muted)", textTransform: "uppercase" }}>
                CORREO RECEPTOR
              </span>
              {!receiverEmails.length ? (
                <p className="note" style={{ margin: 0 }}>No hay receptores configurados en Correos vinculados.</p>
              ) : (
                <div style={{ display: "grid", gap: "8px" }}>
                  {receiverEmails.map((email) => (
                    <label key={`reminder-receiver-${email}`} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                      <input
                        checked={recipientsToList(draft.recipients).some((item) => item.toLowerCase() === email.toLowerCase())}
                        type="checkbox"
                        onChange={() => setDraft((current) => ({ ...current, recipients: toggleRecipient(current.recipients, email) }))}
                      />
                      {email}
                    </label>
                  ))}
                </div>
              )}
              <p className="note" style={{ margin: "8px 0 0" }}>Seleccionados: {draft.recipients || "ninguno"}</p>
            </div>
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
                  {note.startDate || note.endDate ? ` · ${note.startDate || "sin inicio"} - ${note.endDate || "sin fin"}` : ""}
                  {note.senderEmail ? ` · emisor ${note.senderEmail}` : ""}
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

function getSenderEmails(config) {
  const accounts = Array.isArray(config?.emailAccounts) ? config.emailAccounts : [];
  const senders = accounts
    .filter((account) => account?.role === "sender" && account.email)
    .map((account) => account.email.trim())
    .filter(Boolean);
  if (senders.length) return [...new Set(senders)];
  return config?.senderEmail ? [String(config.senderEmail).trim()].filter(Boolean) : [];
}

function getReceiverEmails(config) {
  const accounts = Array.isArray(config?.emailAccounts) ? config.emailAccounts : [];
  const receivers = accounts
    .filter((account) => account?.role === "receiver" && account.email)
    .map((account) => account.email.trim())
    .filter(Boolean);
  if (!receivers.length) {
    String(config?.recipients || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((email) => receivers.push(email));
  }
  const sender = getSenderEmails(config)[0] || "";
  if (config?.includeSenderAsReceiver && sender) receivers.push(sender);
  return [...new Set(receivers)];
}

function recipientsToList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToRecipients(values) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].join(", ");
}

function toggleRecipient(currentValue, email) {
  const currentRecipients = recipientsToList(currentValue);
  const exists = currentRecipients.some((item) => item.toLowerCase() === email.toLowerCase());
  return listToRecipients(
    exists
      ? currentRecipients.filter((item) => item.toLowerCase() !== email.toLowerCase())
      : [...currentRecipients, email],
  );
}
