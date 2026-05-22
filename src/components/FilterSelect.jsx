import React from "react";

export function FilterSelect({ allowAll = true, label, value, values, onChange }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {allowAll && <option value="">{label}</option>}
      {[...values].sort().map((item, index) => (
        <option value={item} key={`filter-${label}-${item}-${index}`}>
          {item}
        </option>
      ))}
    </select>
  );
}
