import React from "react";

export function Chips({ values }) {
  if (!values.length) return null;
  return (
    <div className="chips">
      {values.map((value, index) => (
        <span className="chip" key={`chip-${String(value)}-${index}`}>
          {value}
        </span>
      ))}
    </div>
  );
}
