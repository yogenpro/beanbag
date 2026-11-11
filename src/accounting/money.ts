/** Decimal strings enter; integer cents leave. Never multiply JS money floats. */
function decimal(value: string): { units: bigint; scale: bigint } {
  if (!/^-?\d+(?:\.\d{1,24})?$/.test(value) || value.length > 90)
    throw new Error("Invalid decimal");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return {
    units: BigInt(whole + fraction) * (negative ? -1n : 1n),
    scale: 10n ** BigInt(fraction.length),
  };
}

function roundedCents(numerator: bigint, denominator: bigint): number {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator * sign;
  const value =
    sign * ((absolute * 100n * 2n + denominator) / (denominator * 2n));
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new Error("Money exceeds safe integer range");
  return result;
}

export function cents(value: string): number {
  const parsed = decimal(value);
  return roundedCents(parsed.units, parsed.scale);
}

export function valueShares(quantity: string, close: string): number {
  const q = decimal(quantity),
    p = decimal(close);
  if (q.units <= 0n || p.units <= 0n)
    throw new Error("Quantity and close must be positive");
  return roundedCents(q.units * p.units, q.scale * p.scale);
}

export function positiveDecimal(value: string): boolean {
  try {
    return decimal(value).units > 0n;
  } catch {
    return false;
  }
}

export function sumCents(values: number[]): number {
  const value = values.reduce((sum, item) => {
    if (!Number.isSafeInteger(item)) throw new Error("Invalid cents");
    return sum + BigInt(item);
  }, 0n);
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new Error("Aggregate exceeds safe integer range");
  return result;
}

/** Comparable identity for quantities such as 100 and 100.0000. */
export function decimalIdentity(value: string): string {
  decimal(value);
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const integer = whole.replace(/^0+(?=\d)/, "");
  const tail = fraction.replace(/0+$/, "");
  return `${negative && (integer !== "0" || tail) ? "-" : ""}${integer}${tail ? "." + tail : ""}`;
}
