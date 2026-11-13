import { useId, useRef, type KeyboardEvent } from "react";
import { CalendarDays } from "lucide-react";
import { displayDate } from "./api";
import { rangeTabs, type PeriodOption, type RangeSelection } from "./periods";

export function PeriodPicker({
  selection,
  options,
  selected,
  onChange,
}: {
  selection: RangeSelection;
  options: PeriodOption[];
  selected: PeriodOption;
  onChange: (selection: RangeSelection) => void;
}) {
  const id = useId(),
    buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const label =
    selection.tab === "month"
      ? "Month"
      : selection.tab === "quarter"
        ? "Quarter"
        : selection.tab === "half"
          ? "Half-year"
          : selection.tab === "max"
            ? "History"
            : "Year";
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % rangeTabs.length
        : event.key === "ArrowLeft"
          ? (index + rangeTabs.length - 1) % rangeTabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? rangeTabs.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    onChange({ tab: rangeTabs[next][0], value: "default" });
  }
  return (
    <div className="period-bar">
      <div
        className="period-presets"
        role="tablist"
        aria-label="Reporting range"
      >
        {rangeTabs.map(([tab, text], index) => (
          <button
            key={tab}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            id={`${id}-${tab}`}
            role="tab"
            aria-selected={selection.tab === tab}
            aria-controls={`${id}-period`}
            tabIndex={selection.tab === tab ? 0 : -1}
            className={selection.tab === tab ? "selected" : ""}
            onKeyDown={(event) => navigate(event, index)}
            onClick={() => onChange({ tab, value: "default" })}
          >
            {text}
          </button>
        ))}
      </div>
      <div
        id={`${id}-period`}
        role="tabpanel"
        aria-labelledby={`${id}-${selection.tab}`}
        className="period-selection"
      >
        <label className="period-picker">
          <span>{label}</span>
          <select
            value={selected.value}
            onChange={(event) =>
              onChange({ ...selection, value: event.target.value })
            }
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <span className="period-label">
          <CalendarDays size={15} aria-hidden="true" />
          {displayDate(selected.period.start)} —{" "}
          {displayDate(selected.period.end)}
        </span>
      </div>
    </div>
  );
}
