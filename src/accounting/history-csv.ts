import { validDate } from "./dates";
import { cents } from "./money";
import type { HistoricalValue } from "./history";
import type { Account } from "./types";

/** RFC 4180 fields, including quoted commas and newlines. No spreadsheet evaluation. */
function rows(text: string): string[][] {
  if (text.length > 10000000) throw new Error("History file exceeds limit");
  const result: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n" || c === undefined)) {
      row.push(field.replace(/\r$/, "").trim());
      field = "";
      if (c !== ",") {
        if (row.some((f) => f)) result.push(row);
        row = [];
      }
    } else if (c !== undefined) field += c;
  }
  if (quoted) throw new Error("Unclosed CSV field");
  return result;
}
const header = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function date(value: string): string {
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const result = us
    ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
    : value;
  if (!validDate(result)) throw new Error("Invalid history date");
  return result;
}
function dollars(value: string): number {
  const negative = /^\(.*\)$/.test(value);
  const grouped = value.replace(/[$()\s]/g, "");
  if (
    !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(grouped) ||
    (negative && grouped.startsWith("-"))
  )
    throw new Error("Invalid USD account value");
  return cents((negative ? "-" : "") + grouped.replaceAll(",", ""));
}

/** The selected account is supplied privately by the operator, never inferred from a filename. */
export function accountValueCsv(
  text: string,
  account: Account,
  calculatedAt: string,
  valueColumnName?: string,
): HistoricalValue[] {
  if (!account.id || !Number.isFinite(Date.parse(calculatedAt)))
    throw new Error("Selected account and import time are required");
  const data = rows(text.replace(/^\uFEFF/, ""));
  const names = valueColumnName
    ? [header(valueColumnName)]
    : [
        "netliquidationvalue",
        "netaccountvalue",
        "totalaccountvalue",
        "totalaccountvalueusd",
        "accountvalueusd",
        "accountvalue",
        "totalvalue",
      ];
  const index = data.findIndex(
    (row) =>
      row.some((c) => ["date", "asofdate"].includes(header(c))) &&
      row.some((c) => names.includes(header(c))),
  );
  if (index < 0)
    throw new Error("A Date and net Account Value column are required");
  const columns = data[index].map(header);
  const dateColumn = columns.findIndex((c) => ["date", "asofdate"].includes(c));
  const valueColumn = names
    .map((name) => columns.indexOf(name))
    .find((i) => i >= 0)!;
  const currencyColumn = columns.indexOf("currency");
  const seen = new Set<string>();
  const values = data.slice(index + 1).map((row) => {
    if (row.slice(columns.length).some((field) => field !== ""))
      throw new Error("Unexpected CSV fields; check quoted amounts");
    if (currencyColumn >= 0 && row[currencyColumn] !== "USD")
      throw new Error("Only USD history is supported");
    const day = date(row[dateColumn] ?? "");
    if (seen.has(day)) throw new Error("Duplicate history date");
    seen.add(day);
    return {
      accountId: account.id,
      date: day,
      calculatedAt,
      method: "institution_export" as const,
      netValueCents: dollars(row[valueColumn] ?? ""),
      assetsCents:
        account.role === "joint_checking"
          ? dollars(row[valueColumn] ?? "")
          : null,
      borrowingCents: account.role === "joint_checking" ? 0 : null,
      source: "Institution daily account-value export",
    };
  });
  if (!values.length || values.length > 4000)
    throw new Error("Invalid history length");
  return values.sort((a, b) => a.date.localeCompare(b.date));
}
