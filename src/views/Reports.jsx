import React, { useState } from "react";
import { createId } from "../utils/helpers.js";
import { generateAiReport, sendTelegramMessage, sendEmailMessage } from "../utils/ai.js";
import { EmptyState } from "../components/EmptyState.jsx";

export function Reports({
  alerts,
  documents,
  notificationConfig,
  records,
  relations,
  reports,
  setReports,
}) {
  const [instruction, setInstruction] = useState("Genera un informe ejecutivo de mantenimiento con costos, alertas, equipos criticos y recomendaciones.");
  const [status, setStatus] = useState("");

  const generateReport = async () => {
    setStatus("Generando informe...");
    try {
      const text = await generateAiReport(instruction, records, relations, alerts, documents);
      setReports((current) => [{ id: createId(), instruction, text, createdAt: new Date().toISOString(), status: "Generado" }, ...current]);
      setStatus("Informe generado");
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const sendTelegram = async (report) => {
    setStatus("Enviando por Telegram...");
    try {
      await sendTelegramMessage(notificationConfig.telegramToken, notificationConfig.telegramChats, report.text);
      setStatus("Informe enviado por Telegram");
    } catch (error) {
      setStatus(`Error Telegram: ${error.message}`);
    }
  };

  const sendEmail = async (report) => {
    setStatus("Enviando email...");
    try {
      await sendEmailMessage(notificationConfig, report.text);
      setStatus("Informe enviado por email");
    } catch (error) {
      setStatus(`Email pendiente: ${error.message}`);
    }
  };

  return (
    <section className="view active">
      <section className="panel">
        <div className="panel-head">
          <h2>Generar informe con IA</h2>
          {status && <span className="muted">{status}</span>}
        </div>
        <div className="report-composer">
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} />
          <button type="button" onClick={generateReport}>Generar informe</button>
        </div>
      </section>
      <section className="panel">
        <h2>Informes generados</h2>
        {!reports.length ? (
          <EmptyState />
        ) : (
          <div className="list">
            {reports.map((report) => (
              <article className="item report-item" key={report.id}>
                <strong>{new Date(report.createdAt).toLocaleString("es-CO")}</strong>
                <small>{report.instruction}</small>
                <pre>{report.text}</pre>
                <div className="inline-actions">
                  <button type="button" onClick={() => sendTelegram(report)}>Enviar Telegram</button>
                  <button type="button" onClick={() => sendEmail(report)}>Enviar email</button>
                  <button type="button" onClick={() => setReports((current) => current.filter((item) => item.id !== report.id))}>Quitar</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
