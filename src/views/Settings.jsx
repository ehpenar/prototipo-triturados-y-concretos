import React from "react";
import { extractSpreadsheetId } from "../utils/helpers.js";
import { Chips } from "../components/Chips.jsx";

export function Settings({ sources, newSource, setNewSource, addSource, removeSource }) {
  return (
    <section className="view active">
      <div className="split">
        <section className="panel">
          <h2>Documentos conectados</h2>
          <div className="list">
            {sources.map((source, index) => (
              <article className="item" key={`source-${extractSpreadsheetId(source.url) || source.url}-${index}`}>
                <strong>{source.name}</strong>
                <small>{extractSpreadsheetId(source.url) || source.url}</small>
                <Chips values={[source.roleHint || "dinamico"]} />
                <button type="button" onClick={() => removeSource(index)}>
                  Quitar
                </button>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Agregar documento</h2>
          <form className="source-form" onSubmit={addSource}>
            <label>
              Nombre visible
              <input
                required
                placeholder="Nuevo documento"
                value={newSource.name}
                onChange={(event) => setNewSource((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label>
              URL de Google Sheets
              <input
                required
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={newSource.url}
                onChange={(event) => setNewSource((current) => ({ ...current, url: event.target.value }))}
              />
            </label>
            <button type="submit">Agregar y analizar</button>
          </form>
          <p className="note">
            Para leer hojas privadas con OAuth se requiere iniciar sesion y autorizar Google Sheets. Para produccion usa
            Netlify Functions y variables de entorno.
          </p>
        </section>
      </div>
    </section>
  );
}
