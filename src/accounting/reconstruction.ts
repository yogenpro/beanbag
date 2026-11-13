import { validDate } from "./dates";
import {
  decimalIdentity,
  positiveDecimal,
  sumCents,
  valueShares,
} from "./money";

// All activity belongs here, including trading, dividends, interest and fees.
// Income/expense classifications deliberately do not enter a balance replay.
export type BalanceActivity = {
  id: string;
  date: string;
  cashChangeCents: number;
  securityId: string | null;
  quantityChange: string;
};
export type DailyClose = {
  securityId: string;
  date: string;
  close: string;
  source: string;
};
export type ShareSplit = {
  securityId: string;
  date: string;
  numerator: number;
  denominator: number;
};
export type StableTransactionNav = {
  securityId: string;
  nav: string;
  source: string;
  evidenceSha256: string;
};
const scale = 10n ** 24n;
const quantity = (value: string) => {
  decimalIdentity(value);
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return BigInt(whole + fraction.padEnd(24, "0")) * (negative ? -1n : 1n);
};
const decimal = (value: bigint) => {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return decimalIdentity(
    `${sign}${absolute / scale}.${String(absolute % scale).padStart(24, "0")}`,
  );
};
const nextDay = (day: string) =>
  new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10);
const requiredDate = (day: string) => {
  if (!validDate(day)) throw new Error("Invalid reconstruction date");
};

/** Exact-cent estimates under an explicit same-day settlement convention.
 * Prices MUST be as-traded closes: undo later splits, never use adjusted close.
 * Net cash already contains borrowing; it must not be subtracted a second time.
 */
export function reconstructDailyValues(input: {
  start: string;
  end: string;
  settlement: "same_day";
  openingCashCents: number;
  openingPositions: { securityId: string; quantity: string }[];
  activity: BalanceActivity[];
  closes: DailyClose[];
  splits?: ShareSplit[];
  stableNavs?: StableTransactionNav[];
}) {
  requiredDate(input.start);
  requiredDate(input.end);
  if (
    input.start > input.end ||
    Date.parse(input.end) - Date.parse(input.start) > 10 * 366 * 86_400_000 ||
    input.settlement !== "same_day"
  )
    throw new Error("Unsupported reconstruction window or settlement");
  let cash = sumCents([input.openingCashCents]);
  const holdings = new Map<string, bigint>();
  for (const position of input.openingPositions) {
    if (!position.securityId || holdings.has(position.securityId))
      throw new Error("Invalid opening position");
    holdings.set(position.securityId, quantity(position.quantity));
  }
  const activity = new Map<string, BalanceActivity[]>();
  const ids = new Set<string>();
  for (const event of input.activity) {
    requiredDate(event.date);
    if (
      !event.id ||
      ids.has(event.id) ||
      event.date < input.start ||
      event.date > input.end ||
      (!event.securityId && quantity(event.quantityChange) !== 0n)
    )
      throw new Error("Invalid or duplicate balance activity");
    sumCents([event.cashChangeCents]);
    quantity(event.quantityChange);
    ids.add(event.id);
    activity.set(event.date, [...(activity.get(event.date) ?? []), event]);
  }
  const quotes = new Map<string, DailyClose[]>();
  const priceKeys = new Set<string>();
  for (const price of input.closes) {
    requiredDate(price.date);
    const key = `${price.securityId}\n${price.date}`;
    if (
      !price.securityId ||
      !price.source ||
      !positiveDecimal(price.close) ||
      priceKeys.has(key)
    )
      throw new Error("Invalid or duplicate historical close");
    priceKeys.add(key);
    quotes.set(price.securityId, [
      ...(quotes.get(price.securityId) ?? []),
      price,
    ]);
  }
  for (const prices of quotes.values())
    prices.sort((a, b) => a.date.localeCompare(b.date));
  const navs = new Map<string, StableTransactionNav>();
  for (const nav of input.stableNavs ?? []) {
    if (
      !nav.securityId ||
      navs.has(nav.securityId) ||
      !positiveDecimal(nav.nav) ||
      !nav.source ||
      !/^[a-f0-9]{64}$/.test(nav.evidenceSha256) ||
      !quotes.has(nav.securityId) ||
      quotes
        .get(nav.securityId)!
        .some((p) => decimalIdentity(p.close) !== decimalIdentity(nav.nav))
    )
      throw new Error("Unsupported stable transaction NAV");
    navs.set(nav.securityId, nav);
  }
  const splits = new Map<string, ShareSplit[]>();
  const splitKeys = new Set<string>();
  for (const split of input.splits ?? []) {
    requiredDate(split.date);
    const key = `${split.securityId}\n${split.date}`;
    if (
      !split.securityId ||
      splitKeys.has(key) ||
      ![split.numerator, split.denominator].every(
        (n) => Number.isSafeInteger(n) && n > 0 && n <= 1000000,
      )
    )
      throw new Error("Invalid share split");
    splitKeys.add(key);
    splits.set(split.date, [...(splits.get(split.date) ?? []), split]);
  }
  const daily = [];
  for (let date = input.start; date <= input.end; date = nextDay(date)) {
    for (const split of splits.get(date) ?? []) {
      const units =
        (holdings.get(split.securityId) ?? 0n) * BigInt(split.numerator);
      if (units % BigInt(split.denominator))
        throw new Error("Split exceeds quantity precision");
      holdings.set(split.securityId, units / BigInt(split.denominator));
    }
    for (const event of activity.get(date) ?? []) {
      cash = sumCents([cash, event.cashChangeCents]);
      if (event.securityId)
        holdings.set(
          event.securityId,
          (holdings.get(event.securityId) ?? 0n) +
            quantity(event.quantityChange),
        );
    }
    const positions = [...holdings]
      .filter(([, q]) => q !== 0n)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([securityId, q]) => {
        if (q < 0n)
          throw new Error(
            "Short positions require a separate reconstruction model",
          );
        const prices = quotes.get(securityId) ?? [];
        // Binary search excludes future quotes, including on weekends and holidays.
        let lo = 0,
          hi = prices.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (prices[mid].date <= date) lo = mid + 1;
          else hi = mid;
        }
        const price = prices[lo - 1],
          nav = navs.get(securityId);
        if (
          !price ||
          (!nav && Date.parse(date) - Date.parse(price.date) > 7 * 86_400_000)
        )
          throw new Error("Missing historical close");
        const shares = decimal(q);
        return {
          securityId,
          quantity: shares,
          close: price.close,
          priceDate: price.date,
          priceBasis: nav
            ? ("stable_transaction_nav" as const)
            : ("unadjusted_close" as const),
          source: nav?.source ?? price.source,
          valueCents: valueShares(shares, price.close),
        };
      });
    daily.push({
      date,
      netCashCents: cash,
      netValueCents: sumCents([cash, ...positions.map((p) => p.valueCents)]),
      positions,
    });
  }
  return daily;
}
