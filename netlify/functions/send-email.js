export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metodo no permitido" });
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;

  if (!apiKey || !from) {
    return json(501, {
      error: "Configura SENDGRID_API_KEY y NOTIFICATION_FROM_EMAIL en Netlify para habilitar email automatico.",
    });
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const recipients = Array.isArray(payload.to) ? payload.to : String(payload.to || "").split(",");
    const cleanRecipients = recipients.map((email) => String(email).trim()).filter(Boolean);

    if (!cleanRecipients.length) return json(400, { error: "No hay destinatarios" });

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: cleanRecipients.map((email) => ({ email })) }],
        from: { email: from },
        subject: payload.subject || "Notificacion operacional",
        content: [{ type: "text/plain", value: payload.message || "" }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return json(response.status, { error: detail });
    }

    return json(200, { ok: true });
  } catch (error) {
    return json(500, { error: error.message });
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
