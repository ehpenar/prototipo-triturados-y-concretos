import React, { useState, useEffect, useMemo } from "react";
import { CONFIG } from "../constants/config.js";
import { createId, extractSpreadsheetId, normalizeText } from "../utils/helpers.js";
import {
  updateSheetRow,
  updateSheetCell,
  appendSheetRow,
  createSheetWithHeaders,
} from "../utils/googleSheets.js";
import { generateOtReport } from "../utils/ai.js";
import { FINANCIAL_SUMMARY_SHEET } from "../utils/financialSummary.js";
import { FilterSelect } from "../components/FilterSelect.jsx";
import { EmptyState } from "../components/EmptyState.jsx";

const TARGET_RECORDS_SHEET = "copia de prueba respuestas de formulario 1";
const TARGET_SPREADSHEET_ID = "1wWFSW2M3CdxHlr3q-L4eeMhmGMvmCaeUA0tGptWOqME";
const TARGET_SHEET_ID = "1862269386";
const FINANCIAL_SUMMARY_SPREADSHEET_ID = "1Aaaj5rxLEl6KakxsXGV9BlIDkCyrqSZad6eayyAX4TQ";
const FINANCIAL_REPORT_COLUMN = "S";

export function Records({
  addLog,
  documents,
  filters,
  notes,
  notificationConfig,
  records,
  setFilters,
  setNotes,
  sourceRecords,
  exportCurrentRecords,
  tokenRef,
  onSaved,
}) {
  const [viewMode, setViewMode] = useState("editable");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(75);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [detailedRecordId, setDetailedRecordId] = useState("");
  const [showAppend, setShowAppend] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const [otFilter, setOtFilter] = useState("");
  const [columnWidths, setColumnWidths] = useState({});
  const [reportStatus, setReportStatus] = useState("");
  const [otReports, setOtReports] = useState({});
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
  const detailedRecord = tableRecords.find((record) => record.uid === detailedRecordId) || null;
  const detailedFinancialRecord = detailedRecord ? findFinancialReportTarget(detailedRecord, sourceRecords)?.record || detailedRecord : null;
  const detailedReport = detailedRecord
    ? otReports[detailedRecord.uid] || getCell(detailedFinancialRecord, ["INFORME"], ["informe"])
    : "";
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

  useEffect(() => {
    setReportStatus("");
  }, [detailedRecordId]);

  const generateReportForDetailedRecord = async () => {
    if (!detailedRecord) return;
    const ot = getRecordOt(detailedRecord);
    const target = findFinancialReportTarget(detailedRecord, sourceRecords);
    if (!target?.rowNumber) {
      setReportStatus("No se encontro la fila de Hoja 2 para guardar el informe.");
      return;
    }
    setReportStatus("Generando informe...");
    try {
      const consolidatedData = buildOtReportPayload(detailedRecord, sourceRecords, target.record || detailedRecord);
      const report = await generateOtReport(consolidatedData);
      await updateSheetCell(
        target.spreadsheetId,
        FINANCIAL_SUMMARY_SHEET,
        FINANCIAL_REPORT_COLUMN,
        target.rowNumber,
        report,
        tokenRef,
      );
      setOtReports((current) => ({ ...current, [detailedRecord.uid]: report }));
      setReportStatus(`Informe guardado en Hoja 2 columna ${FINANCIAL_REPORT_COLUMN}.`);
      addLog?.(`Informe generado para OT ${ot || "NO ESPECIFICADO"} y guardado en columna ${FINANCIAL_REPORT_COLUMN}.`);
      onSaved?.();
    } catch (error) {
      setReportStatus(`Error generando informe: ${error.message}`);
    }
  };

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
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div className="item severity-medium" style={{ background: "#fffbeb", padding: "16px", borderRadius: "8px", borderLeft: "4px solid var(--warn)" }}>
            <h3 style={{ margin: "0 0 6px 0", fontSize: "15px", color: "var(--ink)", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>🔒</span> Información de Seguridad y Privacidad (Google Sheets)
            </h3>
            <p className="note" style={{ margin: 0, fontSize: "13px", lineHeight: "1.5", color: "var(--ink)" }}>
              Por políticas estrictas de Google (Content Security Policy y protección contra ataques de Clickjacking), las hojas de cálculo privadas de Google Sheets <strong>no permiten ser editadas interactivamente dentro de un iframe</strong> en páginas de terceros. Por ello, verás errores como <code>frame-ancestors 'self'</code> o archivos no encontrados en la consola del navegador.
            </p>
            <div style={{ display: "flex", gap: "10px", marginTop: "12px", flexWrap: "wrap" }}>
              {embeddedSheet?.editUrl && (
                <a 
                  className="button-link" 
                  href={embeddedSheet.editUrl} 
                  rel="noreferrer" 
                  target="_blank"
                  style={{ background: "var(--accent)", color: "#fff", borderColor: "var(--accent)", fontWeight: "600", textDecoration: "none" }}
                >
                  Abrir en Google Sheets (Pestaña nueva) ↗
                </a>
              )}
              <button 
                type="button" 
                onClick={() => setViewMode("editable")}
                style={{ fontWeight: "600", borderColor: "var(--line)" }}
              >
                Usar "Vista editable" de la App (Recomendado) ⚡
              </button>
            </div>
            <p style={{ margin: "8px 0 0 0", fontSize: "11px", color: "var(--muted)" }}>
              * Si realmente deseas integrarla de forma embebida aquí, debes abrir tu documento en Google Sheets, ir a <strong>Archivo &gt; Compartir &gt; Publicar en la Web</strong> y usar esa URL pública en los ajustes.
            </p>
          </div>
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
        </div>
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
                        <th className="action-column" style={{ width: "170px", minWidth: "170px", maxWidth: "170px" }}>Accion</th>
                        {headers.map((header, index) => (
                          <ResizableHeader
                            header={header}
                            key={`header-${header}-${index}`}
                            onResizeStart={resizeColumn}
                            width={columnWidths[header] || defaultColumnWidth(header)}
                            tooltip={calculateHeaderTooltip(header, tableRecords, sourceRecords)}
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
                          onDetailClick={() => setDetailedRecordId(record.uid)}
                          sourceRecords={sourceRecords}
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
                notificationConfig={notificationConfig}
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

      {/* Modal Ver Detalle */}
      {detailedRecord && (
        <div className="modal-overlay" style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(17, 24, 39, 0.7)",
          backdropFilter: "blur(8px)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 1000
        }}>
          <div className="modal-card" style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "16px",
            boxShadow: "0 25px 60px rgba(0, 0, 0, 0.25)",
            width: "min(95vw, 760px)",
            maxHeight: "90vh",
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
            padding: "32px",
            position: "relative"
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--line)", paddingBottom: "18px" }}>
              <div>
                <span style={{ 
                  background: "var(--accent)", 
                  color: "#fff", 
                  padding: "4px 12px", 
                  borderRadius: "6px", 
                  fontSize: "12px", 
                  fontWeight: "700",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase" 
                }}>
                  OT - {getRecordOt(detailedRecord)}
                </span>
                <h2 style={{ margin: "8px 0 2px 0", fontSize: "24px", color: "var(--ink)", fontWeight: "800" }}>
                  Consolidado Completo de la OT
                </h2>
                <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
                  Información integrada de Resumen Financiero y Solicitudes de Pedido (SP)
                </p>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  disabled={reportStatus === "Generando informe..."}
                  onClick={generateReportForDetailedRecord}
                  style={{
                    background: "var(--accent)",
                    border: "1px solid var(--accent)",
                    borderRadius: "8px",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: "700",
                    padding: "9px 14px",
                    textTransform: "uppercase",
                  }}
                  type="button"
                >
                  {reportStatus === "Generando informe..." ? "Generando..." : "Generar informe"}
                </button>
                <button
                  onClick={() => setDetailedRecordId("")}
                  style={{
                    background: "#f1f5f9",
                    border: 0,
                    borderRadius: "50%",
                    width: "36px",
                    height: "36px",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                    fontWeight: "bold",
                    color: "var(--muted)",
                    transition: "all 150ms ease"
                  }}
                  type="button"
                  aria-label="Cerrar modal"
                >
                  ✕
                </button>
              </div>
            </div>
            {reportStatus && (
              <p className="note" style={{ margin: "-12px 0 0 0" }}>
                {reportStatus}
              </p>
            )}

            {/* Content Area */}
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              
              {/* SECTION 1: RESUMEN FINANCIERO (HOJA 2) */}
              <div style={{ background: "#f8fafc", border: "1px solid var(--line)", borderRadius: "12px", padding: "20px" }}>
                <h3 style={{ margin: "0 0 16px 0", fontSize: "14px", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: "700" }}>
                  📊 Resumen Financiero y Mano de Obra (Hoja 2)
                </h3>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                  {/* Mano Obra */}
                  <div style={{ background: "var(--surface)", padding: "14px", borderRadius: "8px", border: "1px solid var(--line)", borderLeft: "4px solid var(--accent)" }}>
                    <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)", fontWeight: "600" }}>
                      MANO DE OBRA (Col D)
                    </span>
                    <strong style={{ display: "block", fontSize: "18px", color: "var(--ink)", marginTop: "4px" }}>
                      {getCell(detailedFinancialRecord, ["MANO OBRA"]) || "0"}
                    </strong>
                  </div>

                  {/* Detalle Mano Obra */}
                  <div style={{ background: "var(--surface)", padding: "14px", borderRadius: "8px", border: "1px solid var(--line)", borderLeft: "4px solid var(--warn)" }}>
                    <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)", fontWeight: "600" }}>
                      DETALLE MANO DE OBRA (Col O)
                    </span>
                    <span style={{ display: "block", fontSize: "14px", color: "var(--ink)", marginTop: "6px", fontWeight: "600" }}>
                      {getCell(detailedFinancialRecord, ["DETALLE_MANO_OBRA"]) || "Sin detalle registrado"}
                    </span>
                  </div>

                  {/* Informe */}
                  <div style={{ background: "var(--surface)", padding: "14px", borderRadius: "8px", border: "1px solid var(--line)", borderLeft: "4px solid #6366f1" }}>
                    <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)", fontWeight: "600" }}>
                      INFORME (Col S)
                    </span>
                    <span style={{ display: "block", fontSize: "14px", color: "var(--ink)", marginTop: "6px", fontWeight: "600" }}>
                      {detailedReport ? "Disponible" : "-"}
                    </span>
                  </div>
                </div>
              </div>

              {detailedReport && (
                <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: "12px", padding: "20px" }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#4338ca", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: "700" }}>
                    Informe generado
                  </h3>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: "1.55", color: "var(--ink)" }}>
                    {detailedReport}
                  </div>
                </div>
              )}

              {/* SECTION 2: SOLICITUDES DE PEDIDO RELACIONADAS (MATRIZ DE SEGUIMIENTO) */}
              <div>
                <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", color: "var(--ink)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: "700", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>📦 Solicitudes de Pedido (Matriz de Seguimiento)</span>
                  <span style={{ background: "#e2e8f0", color: "var(--muted)", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", textTransform: "none", letterSpacing: "normal" }}>
                    {((sourceRecords || []).filter((rec) => normalizeText(rec.sourceName).includes(normalizeText("Matriz de Seguimiento")) && getRecordOt(rec) === getRecordOt(detailedRecord))).length} Relacionadas
                  </span>
                </h3>

                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {((sourceRecords || []).filter((rec) => {
                    const isMatrix = normalizeText(rec.sourceName).includes(normalizeText("Matriz de Seguimiento"));
                    if (!isMatrix) return false;
                    const matrixOt = getRecordOt(rec);
                    return matrixOt && normalizeText(matrixOt) === normalizeText(getRecordOt(detailedRecord));
                  })).length === 0 ? (
                    <div style={{ padding: "24px", border: "1px dashed var(--line)", borderRadius: "10px", textAlign: "center", color: "var(--muted)" }}>
                      No se encontraron Solicitudes de Pedido (SP) vinculadas a esta OT en la Matriz de Seguimiento.
                    </div>
                  ) : (
                    ((sourceRecords || []).filter((rec) => {
                      const isMatrix = normalizeText(rec.sourceName).includes(normalizeText("Matriz de Seguimiento"));
                      if (!isMatrix) return false;
                      const matrixOt = getRecordOt(rec);
                      return matrixOt && normalizeText(matrixOt) === normalizeText(getRecordOt(detailedRecord));
                    })).map((spRecord, spIndex) => {
                      const spNumber = getMatrixField(spRecord, ["NUMERO DE LA SP (solo el numero sin letras)*", "NUMERO DE LA SP", "NÚMERO DE LA SP", "SP"]);
                      const solicitante = getMatrixField(spRecord, ["Nombre de quien solicita/autoriza la SP", "Nombre de quien solicita", "Solicitante"]).toUpperCase();
                      const proceso = getMatrixField(spRecord, ["Proceso que solicita la SP*", "Proceso que solicita la SP", "Proceso"]).toUpperCase();
                      const clase = getMatrixField(spRecord, ["Clase de Solicitud", "Clase de solicitud", "Clase"]);
                      const ordenCompra = getMatrixField(spRecord, ["ORDENES DE COMPRA", "ORDEN DE COMPRA", "ORDEN_DE_COMPRA", "OC"]);
                      const plazoEntrega = getMatrixField(spRecord, ["PLAZO DE ENTREGA", "Plazo de Entrega", "Plazo de entrega", "Plazo"]);
                      const estado = getMatrixField(spRecord, ["Estado Actual de la SP*", "Estado Actual de la SP", "Estado Actual", "Estado"]);
                      const observacion = getMatrixField(spRecord, ["Observación (Descripción General SP)", "Observación", "Descripción General SP", "Observacion (Descripcion General SP)", "Observacion", "Descripcion General SP", "DESCRIPCIÓN GENERAL DEL FALLO O DE LA SOLICTUD"]);
                      
                      // Fechas
                      const fechaRecepcion = getMatrixField(spRecord, ["Fecha de Recepción de la SP  Nota: si no tiene fecha coloque la de la SP *", "Fecha de Recepcion de la SP", "Fecha de Recepción de la SP"]);
                      const fechaOc = getMatrixField(spRecord, ["FECHA ORDEN DE COMPRA", "Fecha Orden de Compra", "Fecha OC"]);
                      const fechaAprobacion = getMatrixField(spRecord, ["FECHA APROBACION", "FECHA APROBACIÓN", "Fecha Aprobacion"]);

                      return (
                        <div key={`sp-card-${spNumber}-${spIndex}`} style={{ border: "1px solid var(--line)", borderRadius: "12px", padding: "18px", background: "var(--surface)", boxShadow: "0 2px 8px rgba(0,0,0,0.02)" }}>
                          {/* Card Header */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: "10px", marginBottom: "12px" }}>
                            <strong style={{ fontSize: "15px", color: "var(--accent)" }}>
                              📦 SP #{spNumber}
                            </strong>
                            {estado && estado !== "NO ESPECIFICADO" && (
                              <span style={{ 
                                background: estado.toLowerCase().includes("entrega") ? "#e6f4ea" : "#fef3c7", 
                                color: estado.toLowerCase().includes("entrega") ? "#137333" : "#b25e00", 
                                padding: "2px 8px", 
                                borderRadius: "10px", 
                                fontSize: "11px", 
                                fontWeight: "700",
                                textTransform: "uppercase"
                              }}>
                                {estado}
                              </span>
                            )}
                          </div>

                          {/* Card Grid Info */}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", fontSize: "13px" }}>
                            <div>
                              <span style={{ color: "var(--muted)", display: "block", fontSize: "10px", textTransform: "uppercase" }}>Proceso Solicitante</span>
                              <strong style={{ color: "var(--ink)", textTransform: "uppercase" }}>{proceso}</strong>
                            </div>
                            <div>
                              <span style={{ color: "var(--muted)", display: "block", fontSize: "10px", textTransform: "uppercase" }}>Nombre Autoriza</span>
                              <strong style={{ color: "var(--ink)", textTransform: "uppercase" }}>{solicitante}</strong>
                            </div>
                            <div>
                              <span style={{ color: "var(--muted)", display: "block", fontSize: "10px", textTransform: "uppercase" }}>Clase Solicitud</span>
                              <span style={{ color: "var(--ink)", fontWeight: "600" }}>{clase}</span>
                            </div>
                            <div>
                              <span style={{ color: "var(--muted)", display: "block", fontSize: "10px", textTransform: "uppercase" }}>Orden de Compra</span>
                              <span style={{ color: "var(--ink)", fontWeight: "600" }}>{ordenCompra}</span>
                            </div>
                            <div>
                              <span style={{ color: "var(--muted)", display: "block", fontSize: "10px", textTransform: "uppercase" }}>Plazo de Entrega</span>
                              <span style={{ color: "var(--ink)", fontWeight: "600" }}>{plazoEntrega}</span>
                            </div>
                          </div>

                          {/* Observación inside card */}
                          {observacion && observacion !== "NO ESPECIFICADO" && (
                            <div style={{ marginTop: "12px", background: "#f8fafc", padding: "10px", borderRadius: "6px", fontSize: "12px" }}>
                              <span style={{ color: "var(--muted)", display: "block", fontSize: "10px", textTransform: "uppercase", marginBottom: "4px" }}>Observación / Descripción General</span>
                              <span style={{ color: "var(--ink)", lineHeight: "1.4", whiteSpace: "pre-wrap" }}>{observacion}</span>
                            </div>
                          )}

                          {/* Fechas inside card */}
                          {(fechaRecepcion !== "NO ESPECIFICADO" || fechaOc !== "NO ESPECIFICADO" || fechaAprobacion !== "NO ESPECIFICADO") && (
                            <div style={{ marginTop: "12px", display: "flex", gap: "14px", flexWrap: "wrap", borderTop: "1px dashed var(--line)", paddingTop: "10px", fontSize: "11px" }}>
                              {fechaRecepcion !== "NO ESPECIFICADO" && (
                                <div>
                                  <span style={{ color: "var(--muted)" }}>Recepción SP: </span>
                                  <strong style={{ color: "var(--ink)" }}>{fechaRecepcion}</strong>
                                </div>
                              )}
                              {fechaOc !== "NO ESPECIFICADO" && (
                                <div>
                                  <span style={{ color: "var(--muted)" }}>Orden Compra: </span>
                                  <strong style={{ color: "var(--ink)" }}>{fechaOc}</strong>
                                </div>
                              )}
                              {fechaAprobacion !== "NO ESPECIFICADO" && (
                                <div>
                                  <span style={{ color: "var(--muted)" }}>Aprobación: </span>
                                  <strong style={{ color: "var(--ink)" }}>{fechaAprobacion}</strong>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* SECTION 3: REPORTE DE ACTIVIDADES (FACTURACION) */}
              <div>
                <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", color: "var(--ink)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: "700", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Reporte de actividades (Facturacion)</span>
                  <span style={{ background: "#e2e8f0", color: "var(--muted)", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", textTransform: "none", letterSpacing: "normal" }}>
                    {getRelatedBillingRecords(sourceRecords, getRecordOt(detailedRecord)).length} actividades
                  </span>
                </h3>

                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {getRelatedBillingRecords(sourceRecords, getRecordOt(detailedRecord)).length === 0 ? (
                    <div style={{ padding: "24px", border: "1px dashed var(--line)", borderRadius: "10px", textAlign: "center", color: "var(--muted)" }}>
                      No se encontraron actividades de facturacion vinculadas a esta OT.
                    </div>
                  ) : (
                    getRelatedBillingRecords(sourceRecords, getRecordOt(detailedRecord)).map((activityRecord, activityIndex) => {
                      const collaborator = getBillingField(activityRecord, ["colaborador", "COLABORADOR"]);
                      const billedProcess = getBillingField(activityRecord, ["proceso al que se factura la actividad", "PROCESO AL QUE SE FACTURA LA ACTIVIDAD", "proceso al que se facturo la actividad", "PROCESO AL QUE SE FACTURO LA ACTIVIDAD", "proceso"]);
                      const equipment = getBillingField(activityRecord, ["equipo intervenido", "EQUIPO INTERVENIDO", "equipo"]);
                      const fieldReportOt = getBillingField(activityRecord, ["OT - REPORTE DE CAMPO", "OT reporte de campo", "OT REPORTE DE CAMPO", "ORDEN DE TRABAJO/REPORTE DE CAMPO"]);
                      const hourmeter = getBillingField(activityRecord, ["HOROMETRO - KILOMETRAJE", "orometro dilometraje", "horometro kilometraje", "HOROMETRO/KILOMETRAJE", "HOROMETRO", "KILOMETRAJE"]);
                      const activity = getBillingField(activityRecord, ["actividad realizada", "ACTIVIDAD REALIZADA", "actividad"]);
                      const spareParts = getBillingField(activityRecord, ["respuestos utilizados", "repuestos utilizados", "REPUESTOS UTILIZADOS"]);

                      return (
                        <div key={`billing-activity-${activityRecord.uid}-${activityIndex}`} style={{ border: "1px solid var(--line)", borderRadius: "12px", padding: "18px", background: "var(--surface)", boxShadow: "0 2px 8px rgba(0,0,0,0.02)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: "10px", marginBottom: "12px", gap: "10px" }}>
                            <strong style={{ fontSize: "15px", color: "var(--accent)" }}>
                              Actividad #{activityIndex + 1}
                            </strong>
                            <span style={{ background: "#ecfeff", color: "#0f766e", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "700" }}>
                              OT {fieldReportOt}
                            </span>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", fontSize: "13px" }}>
                            <ActivityField label="Colaborador" value={collaborator} />
                            <ActivityField label="Proceso facturado" value={billedProcess} />
                            <ActivityField label="Equipo intervenido" value={equipment} />
                            <ActivityField label="OT reporte de campo" value={fieldReportOt} />
                            <ActivityField label="Orometro / Kilometraje" value={hourmeter} />
                          </div>

                          <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
                            <ActivityTextBlock label="Actividad realizada" value={activity} />
                            <ActivityTextBlock label="Repuestos utilizados" value={spareParts} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* SECTION 3: DATOS COMPLEMENTARIOS DE LA OT */}
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: "18px" }}>
                <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: "700" }}>
                  📋 Datos Generales de la OT
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
                  {detailedRecord.headers.slice(0, 8).map((h) => (
                    <div key={`tech-${h}`} style={{ background: "#f1f5f9", padding: "8px 12px", borderRadius: "6px" }}>
                      <span style={{ display: "block", fontSize: "10px", color: "var(--muted)" }}>{h}</span>
                      <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--ink)" }}>{detailedRecord.cells[h] || "-"}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
              <button 
                onClick={() => setDetailedRecordId("")} 
                style={{ 
                  padding: "10px 24px", 
                  background: "var(--accent)", 
                  color: "#fff", 
                  border: 0, 
                  borderRadius: "7px", 
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "14px"
                }}
                type="button"
              >
                Cerrar detalle
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ActivityField({ label, value }) {
  return (
    <div>
      <span style={{ color: "var(--muted)", display: "block", fontSize: "10px", textTransform: "uppercase" }}>{label}</span>
      <strong style={{ color: "var(--ink)", textTransform: "uppercase" }}>{value || "NO ESPECIFICADO"}</strong>
    </div>
  );
}

function ActivityTextBlock({ label, value }) {
  return (
    <div style={{ background: "#f8fafc", padding: "10px", borderRadius: "6px", fontSize: "12px" }}>
      <span style={{ color: "var(--muted)", display: "block", fontSize: "10px", textTransform: "uppercase", marginBottom: "4px" }}>{label}</span>
      <span style={{ color: "var(--ink)", lineHeight: "1.4", whiteSpace: "pre-wrap" }}>{value || "NO ESPECIFICADO"}</span>
    </div>
  );
}

function buildOtReportPayload(otRecord, sourceRecords, financialRecord = otRecord) {
  const ot = getRecordOt(otRecord) || "NO ESPECIFICADO";
  const resumenFinanciero = recordToObject(financialRecord);
  const datosGeneralesOT = recordToObject(otRecord);
  const solicitudesPedido = getRelatedMatrixRecords(sourceRecords, ot).map(buildSpReportItem);
  const ordenesCompra = [...new Set(solicitudesPedido.map((sp) => sp.ordenCompra).filter((value) => value && value !== "NO ESPECIFICADO"))].sort();

  return {
    ot,
    fuente: {
      resumenFinanciero: "Resumen Financiero OTS / Hoja 2",
      matrizSeguimiento: "Copia de Matriz de Seguimiento / respuestas",
    },
    datosGeneralesOT,
    resumenFinanciero,
    metricas: {
      estadoGeneral: getCell(financialRecord, ["ESTATUS DE LA OT", "ESTADO", "Estado Actual de la SP*"]) || "NO ESPECIFICADO",
      tiempoEjecucion: getCell(financialRecord, ["TIEMPO DE EJECUCION"]) || "NO ESPECIFICADO",
      manoObra: getCell(financialRecord, ["MANO OBRA"]) || "NO ESPECIFICADO",
      detalleManoObra: getCell(financialRecord, ["DETALLE_MANO_OBRA"]) || "NO ESPECIFICADO",
      totalSPRegistrado: getCell(financialRecord, ["#SP"]) || "NO ESPECIFICADO",
      tiempoCompra: getCell(financialRecord, ["TIEMPO DE COMPRA"]) || "NO ESPECIFICADO",
      tiempoAprobacion: getCell(financialRecord, ["TIEMPO APROBACION"]) || "NO ESPECIFICADO",
      valorCompraSP: getCell(financialRecord, ["VALOR DE LA COMPRA DE LA SP"]) || "NO ESPECIFICADO",
      detalleCruceSP: getCell(financialRecord, ["DETALLE_CRUCE_SP"]) || "NO ESPECIFICADO",
    },
    totalSP: solicitudesPedido.length,
    totalOrdenesCompra: ordenesCompra.length,
    ordenesCompra,
    solicitudesPedido,
    informeExistente: getCell(otRecord, ["INFORME"], ["informe"]) || "NO ESPECIFICADO",
  };
}

function buildSpReportItem(spRecord, index) {
  return {
    indice: index + 1,
    numeroSP: getMatrixField(spRecord, ["NUMERO DE LA SP (solo el numero sin letras)*", "NUMERO DE LA SP", "NÚMERO DE LA SP", "SP"]),
    estado: getMatrixField(spRecord, ["Estado Actual de la SP*", "Estado Actual de la SP", "Estado Actual", "Estado"]),
    claseSolicitud: getMatrixField(spRecord, ["Clase de Solicitud", "Clase de solicitud", "Clase"]),
    procesoSolicitante: getMatrixField(spRecord, ["Proceso que solicita la SP*", "Proceso que solicita la SP", "Proceso"]),
    nombreSolicitaAutoriza: getMatrixField(spRecord, ["Nombre de quien solicita/autoriza la SP", "Nombre de quien solicita", "Solicitante"]),
    ordenCompra: getMatrixField(spRecord, ["ORDENES DE COMPRA", "ORDEN DE COMPRA", "ORDEN_DE_COMPRA", "OC"]),
    plazoEntrega: getMatrixField(spRecord, ["PLAZO DE ENTREGA", "Plazo de Entrega", "Plazo de entrega", "Plazo"]),
    observacionDescripcionGeneral: compactValue(
      getMatrixField(spRecord, [
        "Observación (Descripción General SP)",
        "Observación",
        "Descripción General SP",
        "Observacion (Descripcion General SP)",
        "Observacion",
        "Descripcion General SP",
        "DESCRIPCIÓN GENERAL DEL FALLO O DE LA SOLICTUD",
      ]),
      900,
    ),
    fechas: {
      marcaTemporal: getMatrixField(spRecord, ["Marca temporal"]),
      recepcionSP: getMatrixField(spRecord, ["Fecha de Recepción de la SP  Nota: si no tiene fecha coloque la de la SP *", "Fecha de Recepcion de la SP", "Fecha de Recepción de la SP"]),
      aprobacion: getMatrixField(spRecord, ["FECHA APROBACION", "FECHA APROBACIÓN", "Fecha Aprobacion"]),
      ordenCompra: getMatrixField(spRecord, ["FECHA ORDEN DE COMPRA", "Fecha Orden de Compra", "Fecha OC"]),
      entrega: getMatrixField(spRecord, ["FECHA ENTREGA", "Fecha Entrega", "Fecha de entrega"]),
    },
    datosRelacionados: recordToObject(spRecord),
  };
}

function recordToObject(record) {
  return (record?.headers || []).reduce((result, header) => {
    const value = compactValue(record.cells?.[header]);
    result[header] = value || "NO ESPECIFICADO";
    return result;
  }, {});
}

function compactValue(value, maxLength = 1200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function getRelatedMatrixRecords(sourceRecords, ot) {
  const targetOt = normalizeText(ot);
  return (sourceRecords || []).filter((rec) => {
    const isMatrix = normalizeText(rec.sourceName).includes(normalizeText("Matriz de Seguimiento"));
    if (!isMatrix) return false;
    const matrixOt = getRecordOt(rec);
    return matrixOt && normalizeText(matrixOt) === targetOt;
  });
}

function getRelatedBillingRecords(sourceRecords, ot) {
  const targetOt = normalizeOtKey(ot);
  return (sourceRecords || []).filter((rec) => {
    const isActivitiesSource = normalizeText(rec.sourceName).includes(normalizeText("Reporte de Actividades Mantenimiento"));
    const isBillingSheet = normalizeText(rec.sheetName) === normalizeText("FACTURACION") || hasBillingTableHeaders(rec);
    if (!isActivitiesSource || !isBillingSheet) return false;
    const billingOt = getBillingField(rec, ["OT"]);
    return billingOt && normalizeOtKey(billingOt) === targetOt;
  });
}

function hasBillingTableHeaders(record) {
  const headers = record?.headers || [];
  const hasCollaborator = headers.some((header) => normalizeText(header) === normalizeText("COLABORADOR"));
  const hasBillingOt = headers.some((header) => normalizeText(header) === normalizeText("OT"));
  const hasActivity = headers.some((header) => normalizeText(header) === normalizeText("ACTIVIDAD REALIZADA"));
  return hasCollaborator && hasBillingOt && hasActivity;
}

function normalizeOtKey(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:OT\s*[-:]?\s*)?(\d+)/i);
  return match ? String(Number(match[1])) : normalizeText(text);
}

function getBillingField(record, columnKeys) {
  if (!record) return "NO ESPECIFICADO";
  const value = getCell(record, columnKeys);
  const text = String(value || "").trim();
  return text || "NO ESPECIFICADO";
}

function findFinancialReportTarget(record, sourceRecords) {
  const currentOt = getRecordOt(record);
  const isCurrentFinancialRow =
    record?.sourceId === FINANCIAL_SUMMARY_SPREADSHEET_ID &&
    normalizeText(record?.sheetName) === normalizeText(FINANCIAL_SUMMARY_SHEET);
  if (isCurrentFinancialRow) {
    return {
      record,
      spreadsheetId: FINANCIAL_SUMMARY_SPREADSHEET_ID,
      rowNumber: record.rowNumber,
    };
  }
  const matchingFinancialRecord = (sourceRecords || []).find((item) => (
    item.sourceId === FINANCIAL_SUMMARY_SPREADSHEET_ID &&
    normalizeText(item.sheetName) === normalizeText(FINANCIAL_SUMMARY_SHEET) &&
    normalizeText(getRecordOt(item)) === normalizeText(currentOt)
  ));
  return matchingFinancialRecord
    ? { record: matchingFinancialRecord, spreadsheetId: FINANCIAL_SUMMARY_SPREADSHEET_ID, rowNumber: matchingFinancialRecord.rowNumber }
    : null;
}

function getMatrixField(matrixRecord, columnKeys) {
  if (!matrixRecord) return "NO ESPECIFICADO";
  const cellVal = getCell(matrixRecord, columnKeys);
  const strVal = String(cellVal || "").trim();
  if (!strVal) return "NO ESPECIFICADO";
  return strVal;
}

function getCell(record, names, containsNames = []) {
  if (!record) return "";
  const normHeader = (val) => normalizeText(val).replace(/\s+/g, "");
  for (const name of names) {
    const header = record.headers?.find((item) => normHeader(item) === normHeader(name));
    if (header && record.cells?.[header] !== undefined) return record.cells[header];
  }
  for (const name of containsNames) {
    const target = normHeader(name);
    const header = record.headers?.find((item) => normHeader(item).includes(target));
    if (header && record.cells?.[header] !== undefined) return record.cells[header];
  }
  return "";
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

function getCellValue(record, header, sourceRecords) {
  if (normalizeText(header) === normalizeText("ORDENES DE COMPRA")) {
    const currentOt = getRecordOt(record);
    if (!currentOt) return record.cells[header] ?? "";
    const matrixRecordsForOt = (sourceRecords || []).filter((rec) => {
      const isMatrix = normalizeText(rec.sourceName).includes(normalizeText("Matriz de Seguimiento"));
      if (!isMatrix) return false;
      const matrixOt = getRecordOt(rec);
      return matrixOt && normalizeText(matrixOt) === normalizeText(currentOt);
    });
    const purchaseOrders = matrixRecordsForOt
      .map((rec) => {
        const ocHeader = rec.headers?.find((h) => {
          const norm = normalizeText(h);
          return norm === normalizeText("ORDEN DE COMPRA") || norm === normalizeText("ORDENES DE COMPRA");
        });
        return ocHeader ? String(rec.cells[ocHeader] || "").trim() : "";
      })
      .filter(Boolean);
    const uniqueOrders = [...new Set(purchaseOrders)].sort();
    return uniqueOrders.length ? uniqueOrders.join(", ") : (record.cells[header] ?? "");
  }
  return record.cells[header] ?? "";
}

function parseFinancialMoney(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  let text = String(value).trim().replace(/\$/g, "").replace(/\s+/g, "");
  if (!text) return 0;

  if (text.includes(",") && text.includes(".")) {
    const firstComma = text.indexOf(",");
    const firstDot = text.indexOf(".");
    if (firstComma < firstDot) {
      text = text.replace(/,/g, "");
    } else {
      text = text.replace(/\./g, "").replace(",", ".");
    }
  } else if (text.includes(",")) {
    const parts = text.split(",");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      text = text.replace(/,/g, "");
    } else {
      text = text.replace(",", ".");
    }
  } else if (text.includes(".")) {
    const parts = text.split(".");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      text = text.replace(/\./g, "");
    }
  }
  return Number(text) || 0;
}

function countListElements(val) {
  let str = String(val || "").trim();
  if (!str) return 0;
  if (str.startsWith("[") && str.endsWith("]")) {
    str = str.slice(1, -1);
  }
  const parts = str.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length;
}

function calculateHeaderTooltip(header, records, sourceRecords) {
  const norm = normalizeText(header);
  const isList = norm === "detalle cruce sp" || norm === "ordenes de compra" || norm === "detalle_cruce_sp" || norm === "ordenes_de_compra";
  if (isList) {
    let totalElements = 0;
    records.forEach((rec) => {
      const val = getCellValue(rec, header, sourceRecords);
      totalElements += countListElements(val);
    });
    return `Cantidad total de items: ${totalElements}`;
  }

  const isNumeric = norm === "mano obra" || norm === "valor de la compra de la sp" || norm === "valor de la compra" || norm === "costo total" || norm === "mano_obra";
  if (isNumeric) {
    let totalSum = 0;
    let count = 0;
    records.forEach((rec) => {
      const val = getCellValue(rec, header, sourceRecords);
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        const num = parseFinancialMoney(val);
        if (!isNaN(num)) {
          totalSum += num;
        }
        count += 1;
      }
    });
    const formattedSum = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(totalSum);
    return `Total: ${formattedSum}\nCantidad de items: ${count}`;
  }

  let count = 0;
  records.forEach((rec) => {
    const val = getCellValue(rec, header, sourceRecords);
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      count += 1;
    }
  });
  return `Cantidad de items: ${count}`;
}

function ResizableHeader({ header, onResizeStart, width, tooltip }) {
  return (
    <th 
      className={isOtHeader(header) ? "ot-column" : ""} 
      style={{ width, minWidth: width, maxWidth: width }}
      title={tooltip}
    >
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

function RecordReadOnlyRow({ headers, isSelected, record, widths, onSelect, onDetailClick, sourceRecords }) {
  return (
    <tr className={isSelected ? "selected-row" : ""}>
      <td className="action-column" style={{ width: "170px", minWidth: "170px", maxWidth: "170px", display: "flex", gap: "6px", alignItems: "center", justifyContent: "center" }}>
        <button className="edit-record-button" type="button" onClick={onSelect} style={{ minHeight: "30px", height: "30px", padding: "0 10px", display: "flex", alignItems: "center", justifyContent: "center" }}>Editar</button>
        <button className="detail-record-button" type="button" onClick={onDetailClick} style={{ minHeight: "30px", height: "30px", padding: "0 10px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--accent)", color: "#fff", borderColor: "var(--accent)", fontWeight: "600" }}>Detalle</button>
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
          {getCellValue(record, header, sourceRecords)}
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

function getRecordStatusForReminder(record) {
  const statusHeader = record?.headers?.find((header) => normalizeText(header) === "estado");
  return String(record?.cells?.[statusHeader] || record?.normalized?.status || "").trim();
}

function getDefaultEmailRecipients(config) {
  return getReceiverEmails(config).join(", ");
}

function getReceiverEmails(config) {
  const accounts = Array.isArray(config?.emailAccounts) ? config.emailAccounts : [];
  const receivers = accounts
    .filter((account) => account?.role === "receiver" && account.email)
    .map((account) => account.email.trim())
    .filter(Boolean);
  if (receivers.length) return [...new Set(receivers)];
  return String(config?.recipients || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function RecordSidePanel({ record, records, notes, notificationConfig, otOptions, setNotes, tokenRef, onClose, onSaved }) {
  const headers = record?.headers || [];
  const currentOt = getRecordOt(record);
  const receiverEmails = getReceiverEmails(notificationConfig);
  const defaultRecipients = getDefaultEmailRecipients(notificationConfig);
  const [draft, setDraft] = useState(record?.cells || {});
  const [status, setStatus] = useState("");
  const [extraRecipient, setExtraRecipient] = useState("");
  const [noteDraft, setNoteDraft] = useState({
    title: "",
    detail: "",
    associatedOt: currentOt,
    startDate: "",
    endDate: "",
    frequency: "Fecha especifica",
    channel: "Plataforma",
    trigger: "Manual",
    recipients: defaultRecipients,
  });
  const dirty = record && JSON.stringify(draft) !== JSON.stringify(record.cells);

  useEffect(() => {
    setDraft(record?.cells || {});
    setNoteDraft((current) => ({
      ...current,
      associatedOt: getRecordOt(record),
      recipients: defaultRecipients,
    }));
    setStatus("");
  }, [defaultRecipients, record]);

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
        initialStatus: getRecordStatusForReminder(associatedRecord),
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
      recipients: defaultRecipients,
    });
  };

  const recordNotes = notes.filter((n) => n.recordId === record.uid || n.associatedOt === currentOt);
  const selectedRecipients = recipientsToList(noteDraft.recipients);
  const toggleRecipient = (email) => {
    setNoteDraft((current) => {
      const currentRecipients = recipientsToList(current.recipients);
      const exists = currentRecipients.some((item) => item.toLowerCase() === email.toLowerCase());
      const nextRecipients = exists
        ? currentRecipients.filter((item) => item.toLowerCase() !== email.toLowerCase())
        : [...currentRecipients, email];
      return { ...current, recipients: listToRecipients(nextRecipients) };
    });
  };
  const addExtraRecipient = () => {
    const email = extraRecipient.trim();
    if (!email) return;
    setNoteDraft((current) => ({
      ...current,
      recipients: listToRecipients([...recipientsToList(current.recipients), email]),
    }));
    setExtraRecipient("");
  };

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
          <div className="wide-field">
            <span>Destinatarios</span>
            <div style={{ display: "grid", gap: "8px", marginTop: "6px" }}>
              {!receiverEmails.length ? (
                <p className="note" style={{ margin: 0 }}>
                  No hay receptores configurados en Email y Telegram.
                </p>
              ) : (
                receiverEmails.map((email) => (
                  <label key={`record-recipient-${email}`} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                    <input
                      checked={selectedRecipients.some((item) => item.toLowerCase() === email.toLowerCase())}
                      type="checkbox"
                      onChange={() => toggleRecipient(email)}
                    />
                    {email}
                  </label>
                ))
              )}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <input
                  placeholder="Agregar otro correo"
                  type="email"
                  value={extraRecipient}
                  onChange={(event) => setExtraRecipient(event.target.value)}
                />
                <button type="button" onClick={addExtraRecipient}>
                  Agregar
                </button>
              </div>
              <p className="note" style={{ margin: 0 }}>
                Seleccionados: {noteDraft.recipients || "ninguno"}
              </p>
            </div>
          </div>
          <button type="submit">Asociar OT</button>
        </form>
        <div className="list compact-list">
          {recordNotes.map((note, index) => (
            <article className="item" key={`record-note-${note.id}-${index}`}>
              <strong>{note.title}</strong>
              <small>
                {note.associatedOt || currentOt} / {note.startDate || "sin inicio"} - {note.endDate || "sin fin"} / {note.frequency} / {note.trigger} / {note.channel} / {note.recipients || "sin destinatarios"}
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
