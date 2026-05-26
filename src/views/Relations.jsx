import React from "react";
import { EmptyState } from "../components/EmptyState.jsx";
import { Chips } from "../components/Chips.jsx";
import { formatMoney } from "../utils/helpers.js";
import { relationKey } from "../utils/analysis.js";

export function Relations({ relations }) {
  if (!relations.length) {
    return (
      <section className="view active">
        <EmptyState />
      </section>
    );
  }
  return (
    <section className="view active">
      <div className="split">
        <section className="panel">
          <h2>Relaciones detectadas</h2>
          <div className="list">
            {relations.slice(0, 50).map((relation, index) => (
              <article className="item" key={relationKey(relation, index, "list")}>
                <strong>
                  {relation.kind}: {relation.key}
                </strong>
                <small>
                  {relation.count} registros · {formatMoney(relation.costs)} · {relation.hours.toFixed(1)} horas
                </small>
                <Chips values={relation.types} />
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Mapa operacional</h2>
          <div className="relationship-map">
            {relations.slice(0, 12).map((relation, index) => (
              <article className="relation-node" key={relationKey(relation, index, "map")}>
                <strong>{relation.key}</strong>
                <Chips values={relation.sources.slice(0, 6)} />
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
