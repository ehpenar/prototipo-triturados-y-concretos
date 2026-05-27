function envValue(name) {
  return import.meta.env?.[name] || "";
}

function storedValue(name) {
  try {
    return globalThis.localStorage?.getItem(name) || "";
  } catch {
    return "";
  }
}

export const CONFIG = {
  google: {
    clientId: envValue("VITE_GOOGLE_CLIENT_ID") || "430755535599-ft2t4udj42rh87d5opg61embb475dmqp.apps.googleusercontent.com",
    clientSecret: envValue("VITE_GOOGLE_CLIENT_SECRET"),
    projectId: envValue("VITE_GOOGLE_PROJECT_ID") || "travel-463105",
    apiKey: envValue("VITE_GOOGLE_API_KEY"),
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  },
  openai: {
    apiKey: envValue("VITE_OPENAI_API_KEY") || storedValue("operation_ai_openai_api_key"),
    model: envValue("VITE_OPENAI_MODEL") || "gpt-4o-mini",
  },
  reportAgent: {
    apiKey: envValue("VITE_REPORT_AGENT_API_KEY") || storedValue("operation_ai_report_agent_api_key"),
    model: envValue("VITE_REPORT_AGENT_MODEL") || envValue("VITE_OPENAI_MODEL") || "gpt-4o-mini",
  },
  initialSources: [
    {
      name: "Copia de Matriz de Seguimiento (respuestas)",
      url: "https://docs.google.com/spreadsheets/d/1Hh4p4ydxmfT1BHC3E8YLoluXVUOBZvOfUKT-yR3tjrI/edit?gid=1301505875#gid=1301505875",
      roleHint: "compras solicitudes repuestos proveedores costos estados fechas",
    },
    {
      name: "Copia de ORDENES DE TRABAJO TYC",
      url: "https://docs.google.com/spreadsheets/d/1wWFSW2M3CdxHlr3q-L4eeMhmGMvmCaeUA0tGptWOqME/edit?gid=1862269386#gid=1862269386",
      roleHint: "ordenes trabajo equipos areas fallas prioridades responsables estados",
    },
    {
      name: "Copia de REPORTE DE ACTIVIDADES MANTENIMIENTO (respuestas)",
      url: "https://docs.google.com/spreadsheets/d/1PZCi-L47ltwrJXGdwF1gjWj7fZHdeFeS_MDwS8cpS3A/edit?gid=1575504867#gid=1575504867",
      roleHint: "actividades tecnicos horas equipos observaciones ot",
    },
    {
      name: "HOJA RESUMEN FINANCIERO OTS",
      url: "https://docs.google.com/spreadsheets/d/1Aaaj5rxLEl6KakxsXGV9BlIDkCyrqSZad6eayyAX4TQ/edit?usp=sharing&utm_source=chatgpt.com&urp=gmail_link",
      roleHint: "costos finales mano obra repuestos equipo totales financiero",
    },
  ],
};

export const SEMANTIC_FIELDS = {
  work_order: ["ot", "orden", "orden trabajo", "orden_trabajo", "orden de trabajo", "ordentrabajo", "wo"],
  purchase_request: ["sp", "solicitud", "pedido", "requisicion", "solicitud pedido", "solped"],
  equipment: ["equipo", "maquina", "activo", "placa", "codigo equipo", "tag", "unidad"],
  cost: ["costo", "valor", "precio", "total", "subtotal", "importe", "monto", "cop", "usd"],
  provider: ["proveedor", "vendor", "empresa", "tercero", "suministrador"],
  technician: ["tecnico", "responsable", "ejecutor", "mecanico", "electricista", "operario"],
  status: ["estado", "estatus", "situacion", "avance"],
  date: ["fecha", "dia", "creado", "emision", "cierre", "entrega"],
  priority: ["prioridad", "criticidad", "urgencia", "nivel"],
  activity: ["actividad", "descripcion", "falla", "observacion", "trabajo", "detalle"],
  hours: ["hora", "horas", "tiempo", "duracion", "h/h", "hh"],
  area: ["area", "ubicacion", "proceso", "planta", "zona"],
};

export const DOCUMENT_TYPES = {
  maintenance: ["mantenimiento", "actividad", "tecnico", "equipo", "falla", "horas"],
  purchases: ["compra", "pedido", "proveedor", "repuesto", "solicitud", "cotizacion"],
  work_orders: ["orden", "ot", "prioridad", "responsable", "estado", "falla"],
  finance: ["financiero", "costo", "valor", "total", "mano obra", "repuesto"],
};

export const VIEWS = {
  dashboard: ["Dashboard inteligente", "KPIs, alertas, rankings y tendencias generados desde las hojas conectadas."],
  records: ["Registros operacionales", "Explora tablas completas sin depender de columnas fijas."],
  relations: ["Relaciones inteligentes", "Conexiones detectadas entre OT, compras, actividades, costos, equipos y personas."],
  equipment: ["Historial por equipo", "Historial operacional construido automaticamente desde registros relacionados."],
  automation: ["Automatizacion continua", "Sincronizacion periodica, clasificacion y validacion operacional."],
  reminders: ["Notas y recordatorios", "Crea notas, alertas recurrentes y hojas operativas desde la plataforma."],
  reports: ["Informes IA", "Genera informes profesionales y programa su envio por email o Telegram."],
  integrations: ["Email y Telegram", "Configura destinatarios y canales de notificacion automatica."],
  assistant: ["Asistente IA operacional", "Preguntas, analisis y reportes sobre el contexto consolidado."],
  settings: ["Fuentes Google Sheets", "Administra documentos y agrega nuevas hojas al motor dinamico."],
};

export const viewLabels = {
  dashboard: "Dashboard",
  records: "Registros",
  relations: "Relaciones",
  equipment: "Historial equipos",
  automation: "Automatizacion",
  reminders: "Notas y recordatorios",
  reports: "Informes IA",
  integrations: "Email y Telegram",
  assistant: "Asistente IA",
  settings: "Fuentes",
};
