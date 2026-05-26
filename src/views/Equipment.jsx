import React from "react";
import { normalizeText, formatMoney, cleanKey } from "../utils/helpers.js";
import { relationKey } from "../utils/analysis.js";
import { EmptyState } from "../components/EmptyState.jsx";
import { Chips } from "../components/Chips.jsx";

export function Equipment({ relations, equipmentSearch, setEquipmentSearch }) {
  const query = normalizeText(equipmentSearch);
  const equipmentRelations = relations
    .filter((relation) => relation.kind === "equipment")
    .filter((relation) => !query || normalizeText(relation.key).includes(query))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  return (
    <section className="view active">
      <div className="filters">
        <input
          type="search"
          placeholder="Buscar equipo"
          value={equipmentSearch}
          onChange={(event) => setEquipmentSearch(event.target.value)}
        />
      </div>
      <div className="equipment-grid">
        {!equipmentRelations.length ? (
          <EmptyState />
        ) : (
          equipmentRelations.map((relation, relationIndex) => {
            const technicians = [...new Set(relation.items.map((item) => cleanKey(item.normalized.technician)).filter(Boolean))].slice(0, 6);
            const workOrders = [...new Set(relation.items.map((item) => cleanKey(item.normalized.work_order)).filter(Boolean))].slice(0, 8);
            return (
              <article className="panel" key={relationKey(relation, relationIndex, "equipment")}>
                <h2>{relation.key}</h2>
                <p className="muted">
                  {relation.count} registros · {formatMoney(relation.costs)} · {relation.hours.toFixed(1)} horas
                </p>
                <Chips values={workOrders.map((ot) => `OT ${ot}`)} />
                <Chips values={technicians} />
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
