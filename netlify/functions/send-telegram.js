export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metodo no permitido" });
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const token = process.env.TELEGRAM_BOT_TOKEN || payload.token;
    const chats = Array.isArray(payload.chats) ? payload.chats : String(payload.chats || "").split(",");
    const cleanChats = chats.map((chat) => String(chat).trim()).filter(Boolean);

    if (!token) return json(400, { error: "Falta TELEGRAM_BOT_TOKEN o token en payload" });
    if (!cleanChats.length) return json(400, { error: "Falta al menos un chat_id" });

    for (const chatId of cleanChats) {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: String(payload.message || "").slice(0, 3900) }),
      });
      if (!response.ok) {
        const detail = await response.text();
        return json(response.status, { error: detail });
      }
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
