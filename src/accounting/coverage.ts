import { validDate, type Period } from "./dates";
import type { Coverage } from "./types";

/** Loaded provider windows describe available records, never independent completeness. */
export function transactionCoverage(coverage: Coverage[], period: Period) {
  const windows = (["checking", "investments"] as const).map((product) => {
    const history = coverage.find(
      (value) => value.product === product,
    )?.history;
    return history &&
      validDate(history.start) &&
      validDate(history.end) &&
      history.start <= history.end
      ? history
      : null;
  });
  if (windows.some((value) => !value))
    return { status: "unknown" as const, start: null, end: null };
  const known = windows.filter((value) => value !== null);
  const start = known
    .map((value) => value.start)
    .sort()
    .at(-1)!;
  const end = known.map((value) => value.end).sort()[0];
  const full = known.every(
    (value) => value.start <= period.start && value.end >= period.end,
  );
  const overlaps = known.some(
    (value) => value.start <= period.end && value.end >= period.start,
  );
  return {
    status: full
      ? ("available" as const)
      : overlaps
        ? ("partial" as const)
        : ("unavailable" as const),
    start,
    end,
  };
}
