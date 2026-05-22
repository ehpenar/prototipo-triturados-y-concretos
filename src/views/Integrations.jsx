import React, { useState } from "react";
import { sendTelegramMessage } from "../utils/ai.js";

export function Integrations({ config, setConfig }) {
  const update = (field, value) => setConfig((current) => ({ ...current, [field]: value }));
  const [emailDraft, setEmailDraft] = useState({ email: "", role: "receiver" });
  const [testStatus, setTestStatus] = useState("");
  const emailAccounts = normalizeEmailAccounts(config);
  const senderAccount = emailAccounts.find((account) => account.role === "sender") || null;
  const receiverAccounts = emailAccounts.filter((account) => account.role === "receiver");

  const saveEmailAccounts = (accounts) => {
    const sender = accounts.find((account) => account.role === "sender")?.email || "";
    const recipients = accounts
      .filter((account) => account.role === "receiver")
      .map((account) => account.email)
      .join(", ");
    setConfig((current) => ({
      ...current,
      emailAccounts: accounts,
      senderEmail: sender,
      recipients,
    }));
  };

  const addEmailAccount = (event) => {
    event.preventDefault();
    const email = emailDraft.email.trim();
    if (!email) return;
    const account = { email, role: emailDraft.role };
    const withoutSameEmail = emailAccounts.filter((item) => item.email.toLowerCase() !== email.toLowerCase());
    const nextAccounts = emailDraft.role === "sender"
      ? [account, ...withoutSameEmail.filter((item) => item.role !== "sender")]
      : [...withoutSameEmail, account];
    saveEmailAccounts(nextAccounts);
    setEmailDraft({ email: "", role: "receiver" });
  };

  const removeEmailAccount = (email) => {
    saveEmailAccounts(emailAccounts.filter((account) => account.email !== email));
  };

  const testTelegram = async () => {
    setTestStatus("Enviando prueba...");
    try {
      await sendTelegramMessage(config.telegramToken, config.telegramChats, "Prueba de notificacion desde la plataforma operacional.");
      setTestStatus("Prueba de Telegram enviada");
    } catch (error) {
      setTestStatus(`Error Telegram: ${error.message}`);
    }
  };

  return (
    <section className="view active">
      <div className="split">
        <section className="panel">
          <h2>Configuracion de correo</h2>
          <form className="email-account-form" onSubmit={addEmailAccount}>
            <label>
              Correo
              <input
                placeholder="correo@empresa.com"
                type="email"
                value={emailDraft.email}
                onChange={(event) => setEmailDraft((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label>
              Categoria
              <select value={emailDraft.role} onChange={(event) => setEmailDraft((current) => ({ ...current, role: event.target.value }))}>
                <option value="receiver">Receptor</option>
                <option value="sender">Emisor</option>
              </select>
            </label>
            <button type="submit">Agregar correo</button>
          </form>
          <div className="email-account-list">
            <h2>Correo emisor</h2>
            {!senderAccount ? (
              <p className="note">No hay emisor configurado.</p>
            ) : (
              <article className="item email-account-item" key={`sender-${senderAccount.email}`}>
                <div>
                  <strong>{senderAccount.email}</strong>
                  <small>Emisor</small>
                </div>
                <button type="button" onClick={() => removeEmailAccount(senderAccount.email)}>
                  Borrar
                </button>
              </article>
            )}

            <h2>Correos receptores</h2>
            {!receiverAccounts.length ? (
              <p className="note">No hay receptores configurados.</p>
            ) : (
              receiverAccounts.map((account) => (
                <article className="item email-account-item" key={`receiver-${account.email}`}>
                  <div>
                    <strong>{account.email}</strong>
                    <small>Receptor</small>
                  </div>
                  <button type="button" onClick={() => removeEmailAccount(account.email)}>
                    Borrar
                  </button>
                </article>
              ))
            )}
          </div>
          <div className="dynamic-form">
            <label>
              Asunto
              <input value={config.subject} onChange={(event) => update("subject", event.target.value)} />
            </label>
            <label>
              Mensaje base
              <textarea value={config.emailMessage} onChange={(event) => update("emailMessage", event.target.value)} />
            </label>
          </div>
          <p className="note">El envio real de correo necesita una Netlify Function o backend SMTP. La configuracion queda lista para ese paso.</p>
        </section>
        <section className="panel">
          <h2>Telegram</h2>
          <div className="dynamic-form">
            <label>
              Bot token
              <input value={config.telegramToken} onChange={(event) => update("telegramToken", event.target.value)} />
            </label>
            <label>
              Chat IDs separados por coma
              <input value={config.telegramChats} onChange={(event) => update("telegramChats", event.target.value)} placeholder="123456789, -100..." />
            </label>
            <button type="button" onClick={testTelegram}>Enviar prueba</button>
          </div>
          {testStatus && <p className="note">{testStatus}</p>}
          <p className="note">Telegram requiere `chat_id`; el usuario debe iniciar conversacion con el bot o agregarlo al grupo antes del envio.</p>
        </section>
      </div>
    </section>
  );
}

function normalizeEmailAccounts(config) {
  if (Array.isArray(config.emailAccounts) && config.emailAccounts.length) return config.emailAccounts;
  const accounts = [];
  if (config.senderEmail) accounts.push({ email: config.senderEmail, role: "sender" });
  String(config.recipients || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((email) => accounts.push({ email, role: "receiver" }));
  return accounts;
}
