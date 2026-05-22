import React, { useState, useEffect, useMemo } from "react";
import { CONFIG } from "../constants/config.js";
import { createId, extractSpreadsheetId, normalizeText } from "../utils/helpers.js";
import {
  updateSheetRow,
  appendSheetRow,
  createSheetWithHeaders,
} from "../utils/googleSheets.js";
import { FilterSelect } from "../components/FilterSelect.jsx";
import { EmptyState } from "../components/EmptyState.jsx";

const TARGET_RECORDS_SHEET = "copia de prueba respuestas de formulario 1";
const TARGET_SPREADSHEET_ID = "1iMCO8CtmN7-2LEcNWbEau9CMWauvXsKIUO3kkym6jJM";
const TARGET_SHEET_ID = "1147287460";

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
  const [viewMode, setViewMode] = useState("sheets");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(75);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [showAppend, setShowAppend] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const tableRecords = useMemo(
    () => sourceRecords.filter((record) => isTargetRecord(record)),
    [sourceRecords],
  );
  const headers = useMemo(() => tableRecords[0]?.headers || [], [tableRecords]);
  const totalPages = Math.max(1, Math.ceil(tableRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRecords = useMemo(() => tableRecords.slice((safePage - 1) * pageSize, safePage * pageSize), [tableRecords, safePage, pageSize]);
  const selectedRecord = tableRecords.find((record) => record.uid === selectedRecordId) || pageRecords[0] || null;
  const selectedSheet = useMemo(() => {
    const document = documents.find((item) => item.sheets.some((sheet) => isTargetSheet(sheet)));
    const sheet = document?.sheets.find((item) => isTargetSheet(item));
    return document && sheet ? { document, sheet } : null;
  }, [documents]);
  const embeddedSheet = useMemo(() => findEmbeddedSheet(documents), [documents]);
  const embedUrl = buildGoogleSheetsEmbedUrl(embeddedSheet);

  useEffect(() => {
    setPage(1);
  }, [filters, tableRecords.length, viewMode]);

  return (
    <section className="view active records-view">
      <section className="records-toolbar panel">
        <div>
          <h2>Registros</h2>
          <p className="note">
            Alterna entre la hoja embebida y la vista editable con acciones internas.
          </p>
        </div>
        <div className="view-toggle">
          <button className={viewMode === "sheets" ? "active-toggle" : ""} type="button" onClick={() => setViewMode("sheets")}>
            Vista Google Sheets
          </button>
          <button className={viewMode === "editable" ? "active-toggle" : ""} type="button" onClick={() => setViewMode("editable")}>
            Vista editable
          </button>
        </div>
        <div className="record-summary">
          <strong>{tableRecords.length}</strong>
          <span>registros de {TARGET_RECORDS_SHEET}</span>
          <strong>{headers.length}</strong>
          <span>columnas detectadas</span>
          <strong>{documents.reduce((total, document) => total + document.sheets.length, 0)}</strong>
          <span>hojas leidas</span>
          {embeddedSheet?.editUrl && (
            <a className="button-link" href={embeddedSheet.editUrl} rel="noreferrer" target="_blank">
              Abrir en Google Sheets
            </a>
          )}
        </div>
      </section>

      {viewMode === "sheets" ? (
        <section className="panel sheet-embed-panel">
          {!embedUrl ? (
            <EmptyState />
          ) : (
            <iframe
              className="sheet-embed"
              src={embedUrl}
              title={`Google Sheets - ${TARGET_RECORDS_SHEET}`}
            />
          )}
        </section>
      ) : (
        <>
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
        </>
      )}
    </section>
  );
}

function isTargetSheet(sheet) {
  const title = typeof sheet === "string" ? sheet : sheet?.title;
  const sheetId = typeof sheet === "string" ? "" : String(sheet?.sheetId || "");
  return normalizeText(title) === normalizeText(TARGET_RECORDS_SHEET) || sheetId === TARGET_SHEET_ID;
}

function isTargetRecord(record) {
  return (
    isTargetSheet(record.sheetName) ||
    (record.sourceId === TARGET_SPREADSHEET_ID && String(record.id || "").includes(`:${TARGET_SHEET_ID}:`))
  );
}

function findEmbeddedSheet(documents) {
  const matchingDocument = documents.find((document) =>
    document.sheets.some((sheet) => isTargetSheet(sheet)),
  );
  const matchingSheet = matchingDocument?.sheets.find((sheet) => isTargetSheet(sheet));
  const fallbackSource = CONFIG.initialSources[0];
  const sourceUrl = matchingDocument?.source?.url || fallbackSource.url;
  const spreadsheetId = matchingDocument?.id || extractSpreadsheetId(sourceUrl);
  const gid = matchingSheet?.sheetId ?? extractGid(sourceUrl);

  return {
    editUrl: buildGoogleSheetsEditUrl(spreadsheetId, gid),
    gid,
    spreadsheetId,
  };
}

function buildGoogleSheetsEmbedUrl(sheet) {
  if (!sheet?.spreadsheetId) return "";
  const params = new URLSearchParams({
    gid: String(sheet.gid || 0),
    rm: "minimal",
  });
  return `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit?${params.toString()}`;
}

function buildGoogleSheetsEditUrl(spreadsheetId, gid) {
  if (!spreadsheetId) return "";
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid || 0}#gid=${gid || 0}`;
}

function extractGid(url) {
  return String(url).match(/[?#&]gid=(\d+)/)?.[1] || "0";
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
