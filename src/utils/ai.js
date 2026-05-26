import { CONFIG } from "../constants/config.js";
import {
  normalizeText,
  formatMoney,
  sum,
  cleanKey,
  groupBy,
} from "./helpers.js";

export function answerLocally(question, records, relations, alerts, documents) {
  const q = normalizeText(question);
  if (q.includes("costo")) {
    const top = topGroup(records, "equipment", "cost");
    return top ? `El mayor costo detectado esta en ${top.key}: ${formatMoney(top.cost)} en ${top.count} registros.` : "No hay costos reconocidos todavia.";
  }
  if (q.includes("tecnico") || q.includes("horas")) {
    const top = topGroup(records, "technician", "hours");
    return top ? `${top.key} acumula ${top.hours.toFixed(1)} horas en ${top.count} registros.` : "No hay horas o tecnicos reconocidos todavia.";
  }
  if (q.includes("proveedor")) {
    const top = topGroup(records, "provider", "cost");
    return top ? `${top.key} tiene ${formatMoney(top.cost)} en compras/costos detectados.` : "No hay proveedores reconocidos todavia.";
  }
  return `Tengo ${records.length} registros, ${relations.length} relaciones, ${alerts.length} alertas y ${documents.length} documentos. Puedes preguntar por costos, tecnicos, proveedores, equipos u OT con retrasos.`;
}

export async function askOpenAI(question, records, relations, alerts, documents) {
  const context = {
    totals: {
      records: records.length,
      documents: documents.length,
      alerts: alerts.slice(0, 10),
      topRelations: relations.slice(0, 12).map(({ kind, key, count, costs, hours, types }) => ({
        kind,
        key,
        count,
        costs,
        hours,
        types,
      })),
    },
  };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONFIG.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.openai.model,
      messages: [
        {
          role: "system",
          content:
            "Eres un analista operacional y financiero. Responde en espanol, con recomendaciones concretas y basadas solo en el contexto entregado.",
        },
        { role: "user", content: `Contexto: ${JSON.stringify(context)}\nPregunta: ${question}` },
      ],
      temperature: 0.2,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "Sin respuesta de IA.";
}

export async function generateAiReport(instruction, records, relations, alerts, documents) {
  const context = buildOperationalContext(records, relations, alerts, documents);
  if (!CONFIG.openai.apiKey) return localReport(instruction, context);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.openai.model,
        messages: [
          {
            role: "system",
            content:
              "Eres un jefe de planeacion de mantenimiento. Redacta informes ejecutivos profesionales, concretos, con hallazgos, riesgos, costos, acciones recomendadas y proximos pasos.",
          },
          { role: "user", content: `Instruccion: ${instruction}\nContexto operacional: ${JSON.stringify(context)}` },
        ],
        temperature: 0.25,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI API ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || localReport(instruction, context);
  } catch (error) {
    return `${localReport(instruction, context)}\n\nNota: no se pudo consultar OpenAI desde el navegador (${error.message}).`;
  }
}

export async function generateOtReport(consolidatedData) {
  const apiKey = CONFIG.reportAgent?.apiKey || CONFIG.openai.apiKey;
  const model = CONFIG.reportAgent?.model || CONFIG.openai.model;
  if (!apiKey) return buildLocalOtReport(consolidatedData);

  const systemPrompt = [
    "Eres un agente especializado en informes operativos de Órdenes de Trabajo (OT) para mantenimiento industrial.",
    "REGLAS ESTRICTAS:",
    "- NO inventes datos. Dato faltante = \"NO ESPECIFICADO\".",
    "- NO repitas info entre secciones.",
    "- Bullets cortos, sin relleno ni introducciones.",
    "- Resume observaciones largas conservando contexto técnico.",
    "- Consolida SP similares cuando sea posible.",
    "",
    "FORMATO OBLIGATORIO:",
    "## 1. RESUMEN GENERAL OT",
    "1 párrafo corto: OT, estado, tiempo ejecución, total SP, total OC, mano obra, resumen operativo.",
    "",
    "## 2. RESUMEN FINANCIERO",
    "Bullets cortos: mano obra, detalle, tiempos, métricas, costos relevantes.",
    "",
    "## 3. CONSOLIDADO DE SP",
    "Por cada SP: número, estado, clase, proceso, OC, plazo, observación resumida.",
    "",
    "## 4. HALLAZGOS OPERATIVOS",
    "Máx 5 bullets: volumen SP, tipos solicitud, tiempos, áreas, retrasos.",
    "",
    "## 5. CONCLUSIÓN GENERAL",
    "1 párrafo ejecutivo corto.",
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Genera informe para:\n${JSON.stringify(consolidatedData)}` },
        ],
        temperature: 0.15,
        max_tokens: 1500,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 200)}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || buildLocalOtReport(consolidatedData);
  } catch (error) {
    return `${buildLocalOtReport(consolidatedData)}\n\n⚠️ ${error.message}`;
  }
}

function buildLocalOtReport(data) {
  const sps = data.solicitudesPedido || [];
  return [
    `## 1. RESUMEN GENERAL OT`,
    `OT ${data.ot} | ${data.totalSP} SP | ${data.totalOrdenesCompra} OC`,
    ``,
    `## 2. RESUMEN FINANCIERO`,
    `- Mano de Obra: ${data.resumenFinanciero?.["MANO OBRA"] || data.datosGeneralesOT?.["MANO OBRA"] || "NO ESPECIFICADO"}`,
    `- Detalle: ${data.resumenFinanciero?.["DETALLE_MANO_OBRA"] || data.datosGeneralesOT?.["DETALLE_MANO_OBRA"] || "NO ESPECIFICADO"}`,
    ``,
    `## 3. CONSOLIDADO DE SP`,
    ...sps.map((sp) => `- SP ${sp.numeroSP}: ${sp.estado} | ${sp.claseSolicitud} | OC: ${sp.ordenCompra} | Plazo: ${sp.plazoEntrega}`),
    ``,
    `## 4. HALLAZGOS OPERATIVOS`,
    `- ${sps.length} solicitudes de pedido vinculadas`,
    `- ${data.totalOrdenesCompra} órdenes de compra generadas`,
    ``,
    `## 5. CONCLUSIÓN GENERAL`,
    `Informe generado localmente. Para análisis con IA, verifique la configuración de API.`,
  ].join("\n");
}

export function buildOperationalContext(records, relations, alerts, documents) {
  const totalCost = sum(records.map((record) => record.normalized.costNumber));
  const totalHours = sum(records.map((record) => record.normalized.hoursNumber));
  const topEquipments = topGroups(records, "equipment", "cost", 8);
  const topTechnicians = topGroups(records, "technician", "hours", 8);
  const topProviders = topGroups(records, "provider", "cost", 8);
  return {
    documents: documents.map((document) => ({
      title: document.title,
      sheets: document.sheets.map((sheet) => ({ title: sheet.title, rows: sheet.rowCount, headers: sheet.headers })),
    })),
    totals: { records: records.length, totalCost, totalHours, relations: relations.length, alerts: alerts.length },
    topEquipments,
    topTechnicians,
    topProviders,
    alerts: alerts.slice(0, 20),
    relations: relations.slice(0, 20).map(({ kind, key, count, costs, hours, types }) => ({ kind, key, count, costs, hours, types })),
  };
}

export function localReport(instruction, context) {
  return [
    `Informe operacional generado`,
    ``,
    `Instruccion: ${instruction}`,
    `Registros analizados: ${context.totals.records}`,
    `Costo total detectado: ${formatMoney(context.totals.totalCost)}`,
    `Horas registradas: ${context.totals.totalHours.toFixed(1)}`,
    `Relaciones detectadas: ${context.totals.relations}`,
    `Alertas activas: ${context.totals.alerts}`,
    ``,
    `Equipos con mayor impacto:`,
    ...context.topEquipments.map((item) => `- ${item.key}: ${formatMoney(item.cost)} en ${item.count} registros`),
    ``,
    `Recomendaciones:`,
    `- Revisar los registros marcados como sobrecosto o sin estado.`,
    `- Validar equipos con actividad repetitiva y cruzarlos con historial de fallas.`,
    `- Programar seguimiento semanal de costos, horas y proveedores recurrentes.`,
    ].join("\n");
}

export async function sendTelegramMessage(token, chats, message) {
  const chatIds = String(chats || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!token.trim()) throw new Error("Falta token del bot");
  if (!chatIds.length) throw new Error("Falta al menos un chat_id");
  try {
    const backendResponse = await fetch("/.netlify/functions/send-telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, chats: chatIds, message }),
    });
    if (backendResponse.ok) return;
  } catch {
    // Fallback directo para pruebas locales sin Netlify Functions.
  }
  for (const chatId of chatIds) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message.slice(0, 3900),
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Telegram ${response.status}: ${detail.slice(0, 160)}`);
    }
  }
}

export async function sendEmailMessage(config, message) {
  const recipients = String(config.recipients || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!recipients.length) throw new Error("Faltan correos destinatarios");
  const response = await fetch("/.netlify/functions/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.senderEmail,
      to: recipients,
      subject: config.subject,
      message: `${config.emailMessage || ""}\n\n${message}`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.slice(0, 180));
  }
}

export function topGroup(records, field, metric) {
  const grouped = groupBy(records, (record) => cleanKey(record.normalized[field]));
  return Object.entries(grouped)
    .filter(([key]) => key)
    .map(([key, items]) => ({
      key,
      count: items.length,
      cost: sum(items.map((item) => item.normalized.costNumber)),
      hours: sum(items.map((item) => item.normalized.hoursNumber)),
    }))
    .sort((a, b) => b[metric] - a[metric])[0];
}

export function topGroups(records, field, metric, limit) {
  const grouped = groupBy(records, (record) => cleanKey(record.normalized[field]));
  return Object.entries(grouped)
    .filter(([key]) => key)
    .map(([key, items]) => ({
      key,
      count: items.length,
      cost: sum(items.map((item) => item.normalized.costNumber)),
      hours: sum(items.map((item) => item.normalized.hoursNumber)),
    }))
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, limit);
}
