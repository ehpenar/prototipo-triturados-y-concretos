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
  const [otFilter, setOtFilter] = useState("");
  const [columnWidths, setColumnWidths] = useState({});
  const targetRecords = useMemo(() => records, [records]);
  const otOptions = useMemo(() => {
    const values = sourceRecords.filter((record) => isTargetRecord(record)).map(getRecordOt).filter(Boolean);
    return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), "es", { numeric: true }));
  }, [sourceRecords]);
  const tableRecords = useMemo(() => {
    const query = normalizeText(otFilter);
    if (!query) return targetRecords;
    return targetRecords.filter((record) => normalizeText(getRecordOt(record)).includes(query));
  }, [targetRecords, otFilter]);
  const headers = useMemo(() => tableRecords[0]?.headers || [], [tableRecords]);
  const totalPages = Math.max(1, Math.ceil(tableRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRecords = useMemo(() => tableRecords.slice((safePage - 1) * pageSize, safePage * pageSize), [tableRecords, safePage, pageSize]);
  const selectedRecord = tableRecords.find((record) => record.uid === selectedRecordId) || null;
  const selectedSheet = useMemo(() => {
    const document = findFilteredDocument(documents, filters) || documents.find((item) => item.sheets.some((sheet) => isTargetSheet(sheet)));
    const sheet = findFilteredSheet(document, filters) || document?.sheets.find((item) => isTargetSheet(item)) || document?.sheets[0];
    return document && sheet ? { document, sheet } : null;
  }, [documents, filters]);
  const selectedDocumentForFilters = useMemo(() => findFilteredDocument(documents, filters) || documents[0] || null, [documents, filters]);
  const sheetFilterValues = useMemo(
    () => selectedDocumentForFilters?.sheets.map((sheet) => sheet.title) || [],
    [selectedDocumentForFilters],
  );
  const embeddedSheet = useMemo(() => findEmbeddedSheet(documents, filters), [documents, filters]);
  const embedUrl = buildGoogleSheetsEmbedUrl(embeddedSheet);

  useEffect(() => {
    if (!filters.document || !documents.length) return;
    const document = findFilteredDocument(documents, filters);
    const firstSheet = document?.sheets[0]?.title || "";
    if (firstSheet && !document.sheets.some((sheet) => sheet.title === filters.sheet)) {
      setFilters((current) => ({ ...current, sheet: firstSheet }));
    }
  }, [documents, filters.document, filters.sheet, setFilters]);

  useEffect(() => {
    setPage(1);
  }, [filters, tableRecords.length, viewMode, otFilter]);

  const resizeColumn = (header, startEvent) => {
    startEvent.preventDefault();
    const startX = startEvent.clientX;
    const startWidth = columnWidths[header] || defaultColumnWidth(header);
    const onMove = (moveEvent) => {
      const nextWidth = Math.max(72, startWidth + moveEvent.clientX - startX);
      setColumnWidths((current) => ({ ...current, [header]: nextWidth }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

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

      <section className="records-toolbar panel">
        <div className="filters">
          <FilterSelect
            label="Todos los documentos"
            value={filters.document}
            values={[...new Set(sourceRecords.map((record) => record.sourceName))]}
            onChange={(document) => setFilters((current) => ({ ...current, document }))}
          />
          <FilterSelect
            allowAll={false}
            label="Todas las pestanas"
            value={filters.sheet}
            values={sheetFilterValues}
            onChange={(sheet) => setFilters((current) => ({ ...current, sheet }))}
          />
          <FilterSelect
            label="Todos los tipos"
            value={filters.type}
            values={[...new Set(sourceRecords.map((record) => record.type))]}
            onChange={(type) => setFilters((current) => ({ ...current, type }))}
          />
          <label className="ot-filter">
            <span>Filtrar OT</span>
            <input
              list="ot-options"
              placeholder="Escribe o selecciona OT"
              value={otFilter}
              onChange={(event) => setOtFilter(event.target.value)}
            />
            <datalist id="ot-options">
              {otOptions.map((ot, index) => (
                <option key={`ot-option-${ot}-${index}`} value={ot} />
              ))}
            </datalist>
          </label>
          {otFilter && (
            <button type="button" onClick={() => setOtFilter("")}>
              Limpiar OT
            </button>
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
            <AppendRecordPanel document={selectedSheet.document} records={targetRecords} sheet={selectedSheet.sheet} tokenRef={tokenRef} onSaved={onSaved} />
          )}

          {showStructure && (
            <RecordsSheetManager documents={documents} tokenRef={tokenRef} addLog={addLog} onSaved={onSaved} />
          )}

          <div className={`records-layout ${selectedRecord ? "with-detail" : "table-only"}`}>
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
                        <th className="action-column">Accion</th>
                        {headers.map((header, index) => (
                          <ResizableHeader
                            header={header}
                            key={`header-${header}-${index}`}
                            onResizeStart={resizeColumn}
                            width={columnWidths[header] || defaultColumnWidth(header)}
                          />
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
                          widths={columnWidths}
                          onSelect={() => setSelectedRecordId(record.uid)}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {selectedRecord && (
              <RecordSidePanel
                record={selectedRecord}
                records={targetRecords}
                notes={notes}
                otOptions={otOptions}
                setNotes={setNotes}
                tokenRef={tokenRef}
                onClose={() => setSelectedRecordId("")}
                onSaved={onSaved}
              />
            )}
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

function getRecordOt(record) {
  const otHeader = record.headers?.find((header) => normalizeText(header) === "ot");
  return String(record.cells?.[otHeader] || record.normalized?.work_order || "").trim();
}

function findRecordByOt(records, ot) {
  const target = normalizeText(ot);
  return records.find((record) => normalizeText(getRecordOt(record)) === target);
}

function findEmbeddedSheet(documents, filters) {
  const matchingDocument = findFilteredDocument(documents, filters) || documents.find((document) =>
    document.sheets.some((sheet) => isTargetSheet(sheet)),
  );
  const matchingSheet = findFilteredSheet(matchingDocument, filters) || matchingDocument?.sheets.find((sheet) => isTargetSheet(sheet));
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

function findFilteredDocument(documents, filters) {
  if (!filters.document) return null;
  return documents.find((document) => document.source?.name === filters.document || document.title === filters.document) || null;
}

function findFilteredSheet(document, filters) {
  if (!document || !filters.sheet) return null;
  return document.sheets.find((sheet) => sheet.title === filters.sheet) || null;
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

function ResizableHeader({ header, onResizeStart, width }) {
  return (
    <th className={isOtHeader(header) ? "ot-column" : ""} style={{ width, minWidth: width, maxWidth: width }}>
      <span>{header}</span>
      <button
        aria-label={`Ajustar ancho de ${header}`}
        className="column-resizer"
        onMouseDown={(event) => onResizeStart(header, event)}
        type="button"
      />
    </th>
  );
}

function RecordReadOnlyRow({ headers, isSelected, record, widths, onSelect }) {
  return (
    <tr className={isSelected ? "selected-row" : ""}>
      <td className="action-column">
        <button className="edit-record-button" type="button" onClick={onSelect}>Editar</button>
      </td>
      {headers.map((header, index) => (
        <td
          className={isOtHeader(header) ? "ot-column" : ""}
          key={`${record.uid}-readonly-${header}-${index}`}
          style={{
            width: widths[header] || defaultColumnWidth(header),
            minWidth: widths[header] || defaultColumnWidth(header),
            maxWidth: widths[header] || defaultColumnWidth(header),
          }}
        >
          {record.cells[header] ?? ""}
        </td>
      ))}
    </tr>
  );
}

function defaultColumnWidth(header) {
  if (isOtHeader(header)) return 96;
  return 180;
}

function isOtHeader(header) {
  return normalizeText(header) === "ot";
}

function RecordSidePanel({ record, records, notes, otOptions, setNotes, tokenRef, onClose, onSaved }) {
  const headers = record?.headers || [];
  const currentOt = getRecordOt(record);
  const [draft, setDraft] = useState(record?.cells || {});
  const [status, setStatus] = useState("");
  const [noteDraft, setNoteDraft] = useState({
    title: "",
    detail: "",
    associatedOt: currentOt,
    startDate: "",
    endDate: "",
    frequency: "Fecha especifica",
    channel: "Plataforma",
    trigger: "Manual",
  });
  const dirty = record && JSON.stringify(draft) !== JSON.stringify(record.cells);

  useEffect(() => {
    setDraft(record?.cells || {});
    setNoteDraft((current) => ({ ...current, associatedOt: getRecordOt(record) }));
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
    const associatedOt = noteDraft.associatedOt.trim();
    if (!associatedOt) return;
    const associatedRecord = findRecordByOt(records, associatedOt) || record;
    setNotes((current) => {
      const nextNote = {
        ...noteDraft,
        title: noteDraft.title.trim() || `Asociacion ${associatedOt}`,
        associatedOt,
        recordId: associatedRecord.uid,
        recordLabel: `${associatedOt} / ${associatedRecord.sourceName} / ${associatedRecord.sheetName} / fila ${associatedRecord.rowNumber}`,
        updatedAt: new Date().toISOString(),
        status: "Pendiente",
      };
      const existingIndex = current.findIndex((note) => normalizeText(note.associatedOt) === normalizeText(associatedOt));
      if (existingIndex === -1) {
        return [{ ...nextNote, id: createId(), createdAt: new Date().toISOString() }, ...current];
      }
      return current.map((note, index) => (
        index === existingIndex
          ? { ...note, ...nextNote, id: note.id, createdAt: note.createdAt }
          : note
      ));
    });
    setNoteDraft({
      title: "",
      detail: "",
      associatedOt: currentOt,
      startDate: "",
      endDate: "",
      frequency: "Fecha especifica",
      channel: "Plataforma",
      trigger: "Manual",
    });
  };

  const recordNotes = notes.filter((n) => n.recordId === record.uid || n.associatedOt === currentOt);

  return (
    <aside className="panel record-side-panel">
      <div className="panel-head">
        <h2>Detalle del registro</h2>
        <div className="inline-actions">
          <button disabled={!dirty} onClick={save} type="button">Guardar cambios</button>
          <button onClick={onClose} type="button">Cerrar</button>
        </div>
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
        <h2>Asociar registro</h2>
        <form className="record-note-form" onSubmit={addRecordNote}>
          <label>
            OT asociado
            <input
              list="record-ot-options"
              value={noteDraft.associatedOt}
              onChange={(event) => setNoteDraft((current) => ({ ...current, associatedOt: event.target.value }))}
            />
            <datalist id="record-ot-options">
              {otOptions.map((ot, index) => (
                <option key={`record-ot-option-${ot}-${index}`} value={ot} />
              ))}
            </datalist>
          </label>
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
            <label>
              Fecha inicial
              <input type="date" value={noteDraft.startDate} onChange={(event) => setNoteDraft((current) => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label>
              Fecha final
              <input type="date" value={noteDraft.endDate} onChange={(event) => setNoteDraft((current) => ({ ...current, endDate: event.target.value }))} />
            </label>
          </div>
          <div>
            <select value={noteDraft.channel} onChange={(event) => setNoteDraft((current) => ({ ...current, channel: event.target.value }))}>
              <option>Plataforma</option>
              <option>Email</option>
              <option>Telegram</option>
              <option>Email y Telegram</option>
            </select>
          </div>
          <button type="submit">Asociar OT</button>
        </form>
        <div className="list compact-list">
          {recordNotes.map((note, index) => (
            <article className="item" key={`record-note-${note.id}-${index}`}>
              <strong>{note.title}</strong>
              <small>
                {note.associatedOt || currentOt} / {note.startDate || "sin inicio"} - {note.endDate || "sin fin"} / {note.frequency} / {note.trigger} / {note.channel}
              </small>
              <p className="muted">{note.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

function AppendRecordPanel({ document, records, sheet, tokenRef, onSaved }) {
  const headers = sheet.headers || [];
  const [draft, setDraft] = useState(() => buildInitialRecordDraft(headers, records));
  const [status, setStatus] = useState("");

  useEffect(() => {
    setDraft(buildInitialRecordDraft(headers, records));
    setStatus("");
  }, [sheet.title, headers, records]);

  const append = async (event) => {
    event.preventDefault();
    setStatus("Agregando...");
    try {
      await appendSheetRow(document.id, sheet.title, headers, draft, tokenRef);
      setStatus("Registro agregado");
      setDraft(buildInitialRecordDraft(headers, records));
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
            <input
              type={inputTypeForHeader(header)}
              value={draft[header] ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, [header]: event.target.value }))}
            />
          </label>
        ))}
        <button type="submit">Agregar dato</button>
      </form>
    </section>
  );
}

function buildInitialRecordDraft(headers, records) {
  const draft = Object.fromEntries(headers.map((header) => [header, ""]));
  const nextSequence = getNextRecordSequence(headers, records);
  const sequenceHeader = headers.find((header) => normalizeText(header) === "5");
  const otHeader = headers.find((header) => normalizeText(header) === "ot");

  if (sequenceHeader && nextSequence) draft[sequenceHeader] = String(nextSequence);
  if (otHeader && nextSequence) draft[otHeader] = `OT-${nextSequence}`;

  headers.forEach((header) => {
    if (isDateHeader(header)) draft[header] = defaultDateValueForHeader(header);
  });

  return draft;
}

function getNextRecordSequence(headers, records) {
  const sequenceHeader = headers.find((header) => normalizeText(header) === "5");
  const otHeader = headers.find((header) => normalizeText(header) === "ot");
  const lastRecord = [...records]
    .sort((a, b) => Number(b.rowNumber || 0) - Number(a.rowNumber || 0))
    .find((record) => {
      const sequence = sequenceHeader ? parseSequenceNumber(record.cells?.[sequenceHeader]) : 0;
      const ot = otHeader ? parseSequenceNumber(record.cells?.[otHeader]) : 0;
      return sequence || ot;
    });
  const lastSequence = Math.max(
    sequenceHeader ? parseSequenceNumber(lastRecord?.cells?.[sequenceHeader]) : 0,
    otHeader ? parseSequenceNumber(lastRecord?.cells?.[otHeader]) : 0,
  );
  return lastSequence ? lastSequence + 1 : "";
}

function parseSequenceNumber(value) {
  const match = String(value || "").match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : 0;
}

function inputTypeForHeader(header) {
  if (!isDateHeader(header)) return "text";
  return isDateTimeHeader(header) ? "datetime-local" : "date";
}

function isDateHeader(header) {
  const normalized = normalizeText(header);
  return normalized.includes("fecha") || normalized.includes("marca temporal");
}

function isDateTimeHeader(header) {
  const normalized = normalizeText(header);
  return normalized.includes("hora") || normalized.includes("marca temporal");
}

function defaultDateValueForHeader(header) {
  const now = new Date();
  if (isDateTimeHeader(header)) {
    const offsetDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return offsetDate.toISOString().slice(0, 16);
  }
  return now.toISOString().slice(0, 10);
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
