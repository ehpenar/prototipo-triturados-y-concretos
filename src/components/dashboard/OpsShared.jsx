import React from "react";

export function OpsHelpTrigger({ text }) {
  if (!text) return null;
  return (
    <span className="ops-help-trigger" tabIndex={0} aria-label={text}>
      ?
      <span className="ops-help-tooltip" role="tooltip">{text}</span>
    </span>
  );
}

export function OpsIndicators({ indicators, activeFilterId, onFilterClick }) {
  if (!indicators?.length) return null;
  return (
    <div className="dashboard-ops-metrics dashboard-ops-metrics-wide">
      {indicators.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`dashboard-ops-metric dashboard-ops-metric-button ${activeFilterId === item.id ? "active" : ""} ${item.critical ? "dashboard-ops-metric-critical" : ""}`}
          onClick={() => onFilterClick?.(item.id)}
        >
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </button>
      ))}
    </div>
  );
}

export function OpsRecordList({ items, emptyLabel = "Sin registros para mostrar." }) {
  if (!items?.length) {
    return <p className="note">{emptyLabel}</p>;
  }
  return (
    <div className="list dashboard-scroll-list dashboard-ops-record-list">
      {items.map((item) => (
        <article className={`item severity-${item.severity || "medium"}`} key={item.id}>
          <strong>{item.title}</strong>
          {item.subtitle && <small className="ops-record-subtitle">{item.subtitle}</small>}
          {item.reasons?.length > 0 && (
            <small className="ops-record-reasons">
              {item.reasons.map((reason) => (
                <span key={`${item.id}-${reason}`}>{reason}</span>
              ))}
            </small>
          )}
          {item.fields?.length > 0 && (
            <div className="ops-record-fields">
              {item.fields.map((field) => (
                <div className="ops-record-field" key={`${item.id}-${field.label}`}>
                  <span>{field.label}</span>
                  <strong>{field.value || "—"}</strong>
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export function OpsSectionTabs({ tabs, activeTab, onChange }) {
  return (
    <div className="dashboard-ops-subnav">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={activeTab === tab.id ? "active" : ""}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {typeof tab.count === "number" ? ` (${tab.count})` : ""}
        </button>
      ))}
    </div>
  );
}

export function OpsBitacoraSection({ title, children }) {
  if (!children) return null;
  return (
    <section className="dashboard-ops-bitacora-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
