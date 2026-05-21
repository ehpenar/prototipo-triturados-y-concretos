import React, { useState, useEffect, useMemo } from "react";
import { createId, normalizeText } from "../utils/helpers.js";
import {
  updateSheetRow,
  appendSheetRow,
  createSheetWithHeaders,
} from "../utils/googleSheets.js";
import { FilterSelect } from "../components/FilterSelect.jsx";
import { EmptyState } from "../components/EmptyState.jsx";

const TARGET_RECORDS_SHEET = "Respuestas de formulario 1";

export function Records({
  addLog,
  documents,
  filters,
  notes,
  records,
  setFilters,
  setNotes,
  sourceRecords,
  exportCurrentRecords,
  tokenRef,
  onSaved,
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(75);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [showAppend, setShowAppend] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const tableRecords = useMemo(
    () => records.filter((record) => isTargetSheet(record.sheetName)),
    [records],
  );
  const headers = useMemo(() => tableRecords[0]?.headers || [], [tableRecords]);
  const totalPages = Math.max(1, Math.ceil(tableRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRecords = useMemo(() => tableRecords.slice((safePage - 1) * pageSize, safePage * pageSize), [tableRecords, safePage, pageSize]);
  const selectedRecord = tableRecords.find((record) => record.uid === selectedRecordId) || pageRecords[0] || null;
  const selectedNotes = notes.filter((note) => note.recordId && selectedRecord && note.recordId === selectedRecord.uid);
  const selectedSheet = useMemo(() => {
    if (!filters.document || !filters.sheet) return null;
    const document = documents.find((item) => item.source.name === filters.document || item.title === filters.document);
    return document?.sheets.find((sheet) => sheet.title === filters.sheet)
      ? { document, sheet: document.sheets.find((sheet) => sheet.title === filters.sheet) }
      : null;
  }, [documents, filters.document, filters.sheet]);

  useEffect(() => {
    setPage(1);
  }, [filters, tableRecords.length]);

  return (
    <section className="view active records-view">
      <section className="records-toolbar panel">
        <div className="filters">
          <FilterSelect
            label="Todos los documentos"
            value={filters.document}
            values={[...new Set(sourceRecords.map((record) => record.sourceName))]}
            onChange={(document) => setFilters((current) => ({ ...current, document }))}
          />
          <FilterSelect
            label="Todas las pestanas"
            value={filters.sheet}
            values={[...new Set(sourceRecords.map((record) => record.sheetName))]}
            onChange={(sheet) => setFilters((current) => ({ ...current, sheet }))}
          />
          <FilterSelect
            label="Todos los tipos"
            value={filters.type}
            values={[...new Set(sourceRecords.map((record) => record.type))]}
            onChange={(type) => setFilters((current) => ({ ...current, type }))}
          />
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={50}>50 filas</option>
            <option value={75}>75 filas</option>
            <option value={150}>150 filas</option>
            <option value={300}>300 filas</option>
          </select>
          <button type="button" onClick={() => setShowAppend((current) => !current)}>
            Nuevo registro
          </button>
          <button type="button" onClick={() => setShowStructure((current) => !current)}>
            Hojas y columnas
          </button>
          <button type="button" onClick={exportCurrentRecords}>
            Exportar JSON
          </button>
        </div>
        <div className="record-summary">
          <strong>{tableRecords.length}</strong>
          <span>registros de {TARGET_RECORDS_SHEET}</span>
          <strong>{headers.length}</strong>
          <span>columnas detectadas</span>
          <strong>{documents.reduce((total, document) => total + document.sheets.length, 0)}</strong>
          <span>hojas leidas</span>
        </div>
      </section>

      {showAppend && selectedSheet && (
        <AppendRecordPanel document={selectedSheet.document} sheet={selectedSheet.sheet} tokenRef={tokenRef} onSaved={onSaved} />
      )}

      {showStructure && (
        <RecordsSheetManager documents={documents} tokenRef={tokenRef} addLog={addLog} onSaved={onSaved} />
      )}

      <div className="records-layout">
        <section className="panel records-table-panel">
          <div className="panel-head">
            <h2>Registros sincronizados</h2>
            <span className="muted">Solo {TARGET_RECORDS_SHEET}</span>
            <div className="inline-actions">
              <button disabled={safePage <= 1} type="button" onClick={() => setPage((current) => Math.max(1, current - 1))}>
                Anterior
              </button>
              <span className="muted">Pagina {safePage} de {totalPages}</span>
              <button disabled={safePage >= totalPages} type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                Siguiente
              </button>
            </div>
          </div>
          <div className="table-wrap records-table-wrap">
            {!tableRecords.length ? (
              <EmptyState />
            ) : (
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Accion</th>
                    {headers.map((header, index) => (
                      <th key={`header-${header}-${index}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRecords.map((record, recordIndex) => (
                    <RecordReadOnlyRow
                      headers={headers}
                      isSelected={selectedRecord?.uid === record.uid}
                      key={`record-row-${record.uid}-${recordIndex}`}
                      record={record}
                      onSelect={() => setSelectedRecordId(record.uid)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <RecordSidePanel
          record={selectedRecord}
          notes={notes}
          setNotes={setNotes}
          tokenRef={tokenRef}
          onSaved={onSaved}
        />
      </div>
    </section>
  );
}

function isTargetSheet(sheetName) {
  return normalizeText(sheetName) === normalizeText(TARGET_RECORDS_SHEET);
}

function RecordReadOnlyRow({ headers, isSelected, record, onSelect }) {
  return (
    <tr className={isSelected ? "selected-row" : ""}>
      <td>
        <button type="button" onClick={onSelect}>Editar</button>
      </td>
      {headers.map((header, index) => (
        <td key={`${record.uid}-readonly-${header}-${index}`}>{record.cells[header] ?? ""}</td>
      ))}
    </tr>
  );
}

function RecordSidePanel({ record, notes, setNotes, tokenRef, onSaved }) {
  const headers = record?.headers || [];
  const [draft, setDraft] = useState(record?.cells || {});
  const [status, setStatus] = useState("");
  const [noteDraft, setNoteDraft] = useState({
    title: "",
    detail: "",
    frequency: "Fecha especifica",
    date: "",
    channel: "Plataforma",
    trigger: "Manual",
  });
  const dirty = record && JSON.stringify(draft) !== JSON.stringify(record.cells);

  useEffect(() => {
    setDraft(record?.cells || {});
    setStatus("");
  }, [record]);

  if (!record) {
    return (
      <aside className="panel record-side-panel">
        <EmptyState />
      </aside>
    );
  }

  const save = async () => {
    setStatus("Guardando...");
    try {
      await updateSheetRow(record, headers, draft, tokenRef);
      setStatus("Guardado");
      onSaved();
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const addRecordNote = (event) => {
    event.preventDefault();
    if (!noteDraft.title.trim()) return;
    setNotes((current) => [
      {
        ...noteDraft,
        id: createId(),
        recordId: record.uid,
        recordLabel: `${record.sourceName} / ${record.sheetName} / fila ${record.rowNumber}`,
        createdAt: new Date().toISOString(),
        status: "Pendiente",
      },
      ...current,
    ]);
    setNoteDraft({ title: "", detail: "", frequency: "Fecha especifica", date: "", channel: "Plataforma", trigger: "Manual" });
  };

  const recordNotes = notes.filter((n) => n.recordId === record.uid);

  return (
    <aside className="panel record-side-panel">
      <div className="panel-head">
        <h2>Detalle del registro</h2>
        <button disabled={!dirty} onClick={save} type="button">Guardar cambios</button>
      </div>
      <p className="muted">{record.sourceName} / {record.sheetName} / fila {record.rowNumber}</p>
      {status && <p className="note">{status}</p>}
      <div className="record-editor-grid">
        {headers.map((header, index) => (
          <label key={`editor-${record.uid}-${header}-${index}`}>
            {header}
            <textarea
              value={draft[header] ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, [header]: event.target.value }))}
            />
          </label>
        ))}
      </div>
      <section className="record-note-box">
        <h2>Nota o recordatorio</h2>
        <form className="record-note-form" onSubmit={addRecordNote}>
          <input placeholder="Titulo" value={noteDraft.title} onChange={(event) => setNoteDraft((current) => ({ ...current, title: event.target.value }))} />
          <textarea placeholder="Observacion, detalle o accion requerida" value={noteDraft.detail} onChange={(event) => setNoteDraft((current) => ({ ...current, detail: event.target.value }))} />
          <div className="two-col">
            <select value={noteDraft.frequency} onChange={(event) => setNoteDraft((current) => ({ ...current, frequency: event.target.value }))}>
              <option>Fecha especifica</option>
              <option>Diario</option>
              <option>Semanal</option>
              <option>Mensual</option>
              <option>Por cambio de estado</option>
            </select>
            <select value={noteDraft.trigger} onChange={(event) => setNoteDraft((current) => ({ ...current, trigger: event.target.value }))}>
              <option>Manual</option>
              <option>Cambio de estado</option>
              <option>Registro incompleto</option>
              <option>Sobrecosto</option>
              <option>Vencimiento</option>
            </select>
          </div>
          <div className="two-col">
            <input type="datetime-local" value={noteDraft.date} onChange={(event) => setNoteDraft((current) => ({ ...current, date: event.target.value }))} />
            <select value={noteDraft.channel} onChange={(event) => setNoteDraft((current) => ({ ...current, channel: event.target.value }))}>
              <option>Plataforma</option>
              <option>Email</option>
              <option>Telegram</option>
              <option>Email y Telegram</option>
            </select>
          </div>
          <button type="submit">Asociar al registro</button>
        </form>
        <div className="list compact-list">
          {recordNotes.map((note, index) => (
            <article className="item" key={`record-note-${note.id}-${index}`}>
              <strong>{note.title}</strong>
              <small>{note.frequency} / {note.trigger} / {note.channel}</small>
              <p className="muted">{note.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

function AppendRecordPanel({ document, sheet, tokenRef, onSaved }) {
  const headers = sheet.headers || [];
  const [draft, setDraft] = useState(() => Object.fromEntries(headers.map((header) => [header, ""])));
  const [status, setStatus] = useState("");

  useEffect(() => {
    setDraft(Object.fromEntries(headers.map((header) => [header, ""])));
    setStatus("");
  }, [sheet.title]);

  const append = async (event) => {
    event.preventDefault();
    setStatus("Agregando...");
    try {
      await appendSheetRow(document.id, sheet.title, headers, draft, tokenRef);
      setStatus("Registro agregado");
      setDraft(Object.fromEntries(headers.map((header) => [header, ""])));
      onSaved();
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  if (!headers.length) return null;
  return (
    <section className="panel compact-panel">
      <div className="panel-head">
        <h2>Agregar registro en {sheet.title}</h2>
        {status && <span className="muted">{status}</span>}
      </div>
      <form className="dynamic-form" onSubmit={append}>
        {headers.map((header, index) => (
          <label key={`append-${sheet.title}-${header}-${index}`}>
            {header}
            <input value={draft[header] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [header]: event.target.value }))} />
          </label>
        ))}
        <button type="submit">Agregar dato</button>
      </form>
    </section>
  );
}

function RecordsSheetManager({ documents, tokenRef, addLog, onSaved }) {
  const [draft, setDraft] = useState({
    sourceId: documents[0]?.id || "",
    title: "Nueva_Estructura",
    columns: "Fecha,Tipo,Responsable,Estado,Observaciones",
  });
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!draft.sourceId && documents[0]?.id) setDraft((current) => ({ ...current, sourceId: documents[0].id }));
  }, [documents, draft.sourceId]);

  const createStructure = async (event) => {
    event.preventDefault();
    const columns = draft.columns.split(",").map((column) => column.trim()).filter(Boolean);
    if (!draft.sourceId || !draft.title.trim() || !columns.length) return;
    setStatus("Creando estructura...");
    try {
      await createSheetWithHeaders(draft.sourceId, draft.title.trim(), columns, tokenRef);
      setStatus("Hoja y columnas creadas");
      addLog(`Estructura ${draft.title} creada desde Registro.`);
      onSaved();
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <section className="panel records-structure-panel">
      <div className="panel-head">
        <h2>Gestion dinamica de Google Sheets</h2>
        {status && <span className="muted">{status}</span>}
      </div>
      <form className="dynamic-form" onSubmit={createStructure}>
        <label>
          Documento destino
          <select value={draft.sourceId} onChange={(event) => setDraft((current) => ({ ...current, sourceId: event.target.value }))}>
            {!documents.length && <option value="">Sin documentos sincronizados</option>}
            {documents.map((document, index) => (
              <option key={`records-structure-doc-${document.id}-${index}`} value={document.id}>
                {document.title || document.source?.name || document.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nombre de hoja
          <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label className="wide-field">
          Columnas
          <textarea value={draft.columns} onChange={(event) => setDraft((current) => ({ ...current, columns: event.target.value }))} />
        </label>
        <button disabled={!draft.sourceId} type="submit">Crear hoja y columnas</button>
      </form>
    </section>
  );
}
