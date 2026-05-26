import React from "react";
import { EmptyState } from "../components/EmptyState.jsx";

export function Assistant({ messages, question, setQuestion, onSubmit }) {
  return (
    <section className="view active">
      <section className="assistant-panel">
        <div className="assistant-output">
          {!messages.length ? (
            <EmptyState />
          ) : (
            messages.map((message, index) => (
              <article className="item" key={`assistant-${message.role}-${index}`}>
                <strong>{message.role === "user" ? "Usuario" : "Asistente"}</strong>
                <small>{message.text}</small>
              </article>
            ))
          )}
        </div>
        <form className="assistant-form" onSubmit={onSubmit}>
          <input
            placeholder="Pregunta: ¿que equipo tiene mas costos?"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button type="submit">Consultar</button>
        </form>
      </section>
    </section>
  );
}
