import { expect, test } from "@playwright/test";
import { report } from "../../src/accounting/report";
import { accountValueChange } from "../../src/accounting/value-change";
import { balancePoint } from "../../src/accounting/balances";

test("historical ranges change rendered totals and distinguish missing history from zero", async ({
  page,
}) => {
  const fixture = await (await page.request.get("/api/report")).json();
  expect(fixture.illustrative).toBe(true);
  await page.clock.install({ time: new Date("2026-11-12T20:00:00Z") });
  const cash = fixture.records.find(
    (event: { kind: string }) => event.kind === "cash_income",
  );
  const spending = fixture.records.find(
    (event: { kind: string }) => event.kind === "spending",
  );
  const events = (
    [
      ["2026-10-15", 10000],
      ["2026-08-14", 20000],
      ["2026-05-15", 25000],
      ["2026-02-15", 30000],
      ["2025-06-15", 40000],
      ["2024-11-20", 50000],
    ] as [string, number][]
  ).flatMap(([date, amount], index) => [
    {
      ...cash,
      id: `invented-income-${index}`,
      date,
      amountCents: amount,
      status: "confirmed",
    },
    {
      ...spending,
      id: `invented-expense-${index}`,
      date,
      amountCents: amount / 2,
      status: "confirmed",
    },
  ]);
  fixture.coverage = fixture.coverage.map((value: object) => ({
    ...value,
    history: {
      start: "2024-11-13",
      end: "2026-11-13",
      source: "Invented provider history",
      retrievedAt: "2026-11-13T20:00:00Z",
    },
  }));
  fixture.availablePeriod = { start: "2023-01-01", end: "2026-11-13" };
  await page.route("**/api/report*", (route) => {
    const url = new URL(route.request().url()),
      period = {
        start: url.searchParams.get("start")!,
        end: url.searchParams.get("end")!,
      };
    const result = report(events, period),
      data = { ...structuredClone(fixture), ...result, trend: result.months };
    data.balances.history = data.balances.history.filter(
      (point: { date: string }) =>
        point.date >= period.start && point.date <= period.end,
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method()))
      writes.push(request.method());
  });
  await page.goto("/");
  const income = page
    .getByRole("button", { name: "View total recorded income records" })
    .locator("strong");
  await expect(income).toHaveText("$100.00");
  for (const [name, amount] of [
    ["Last 3 months", "$300.00"],
    ["Last 6 months", "$550.00"],
    ["Year to date", "$850.00"],
    ["Last year", "$400.00"],
    ["Max", "$1,750.00"],
  ]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(income).toHaveText(amount);
  }
  await expect(page.getByText("Partial period", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Last year", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Year", exact: true })
    .selectOption("2023");
  await expect(
    page.getByRole("heading", {
      name: "No transaction history for this period",
    }),
  ).toBeVisible();
  await expect(income).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Income & expenses", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".balance-total")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Year", exact: true })
    .selectOption("2024");
  await expect(income).toHaveText("$500.00");
  await expect(page.getByText("Partial period", { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test("rolling ranges, calendar period dropdowns, Max and keyboard tabs", async ({
  page,
}) => {
  const fixture = await (await page.request.get("/api/report")).json();
  expect(fixture.illustrative).toBe(true);
  await page.clock.install({ time: new Date("2026-11-12T20:00:00Z") });
  fixture.availablePeriod = { start: "2024-11-13", end: "2026-11-13" };
  let failRead = false;
  await page.route("**/api/report*", (route) => {
    if (failRead)
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Illustrative read failed" }),
      });
    const url = new URL(route.request().url()),
      data = structuredClone(fixture);
    data.period = {
      start: url.searchParams.get("start"),
      end: url.searchParams.get("end"),
    };
    data.balances.history = data.balances.history.filter(
      (point: { date: string }) =>
        point.date >= data.period.start && point.date <= data.period.end,
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  const queries: string[] = [],
    writes: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/report?"))
      queries.push(new URL(request.url()).search);
    if (!["GET", "HEAD"].includes(request.method()))
      writes.push(request.method());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "Reporting range" });
  await expect(tabs.getByRole("tab")).toHaveText([
    "Last 1 month",
    "Last 3 months",
    "Last 6 months",
    "Year to date",
    "Last year",
    "Max",
  ]);
  await expect(
    tabs.getByRole("tab", { name: "Last 1 month", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() => queries.at(-1))
    .toBe("?start=2026-10-12&end=2026-11-12");
  const latest = await page.locator(".balance-total").innerText();
  await page
    .getByRole("combobox", { name: "Month", exact: true })
    .selectOption("2025-02");
  await expect
    .poll(() => queries.at(-1))
    .toBe("?start=2025-02-01&end=2025-02-28");
  await tabs.getByRole("tab", { name: "Last 3 months", exact: true }).click();
  await expect
    .poll(() => queries.at(-1))
    .toBe("?start=2026-08-12&end=2026-11-12");
  await page
    .getByRole("combobox", { name: "Quarter", exact: true })
    .selectOption("2025-Q1");
  await expect
    .poll(() => queries.at(-1))
    .toBe("?start=2025-01-01&end=2025-03-31");
  failRead = true;
  await page
    .getByRole("combobox", { name: "Quarter", exact: true })
    .selectOption("2025-Q2");
  await expect(
    page.getByRole("heading", { name: "Unable to open the ledger" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Quarter", exact: true }),
  ).toHaveValue("2025-Q2");
  await expect
    .poll(() => queries.at(-1))
    .toBe("?start=2025-04-01&end=2025-06-30");
  failRead = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".balance-total")).toHaveText(latest);
  await tabs.getByRole("tab", { name: "Last 6 months", exact: true }).click();
  await expect
    .poll(() => queries.at(-1))
    .toBe("?start=2026-05-12&end=2026-11-12");
  await page
    .getByRole("combobox", { name: "Half-year", exact: true })
    .selectOption("2025-H2");
  await expect
    .poll(() => queries.at(-1))
    .toBe("?start=2025-07-01&end=2025-12-31");
  await tabs.getByRole("tab", { name: "Year to date", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Year", exact: true })
    .selectOption("2025");
  await expect
    .poll(() => queries.at(-1))
    .toBe("?start=2025-01-01&end=2025-11-12");
  await tabs.getByRole("tab", { name: "Last year", exact: true }).click();
  await expect
    .poll(() => queries.at(-1))
    .toBe("?start=2025-01-01&end=2025-12-31");
  await tabs.getByRole("tab", { name: "Max", exact: true }).click();
  await expect
    .poll(() => queries.at(-1))
    .toBe("?start=2024-11-13&end=2026-11-13");
  await expect(
    page.getByRole("combobox", { name: "History", exact: true }),
  ).toHaveValue("all");
  await expect(page.locator(".balance-total")).toHaveText(latest);
  await page.keyboard.press("Home");
  await expect(
    tabs.getByRole("tab", { name: "Last 1 month", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    tabs.getByRole("tab", { name: "Last 3 months", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("combobox", { name: "Quarter", exact: true }),
  ).toHaveValue("rolling");
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("read-only dashboard: totals, charts, filters and record evidence without writes", async ({
  page,
}) => {
  const errors: string[] = [],
    writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method()))
      writes.push(`${request.method()} ${request.url()}`);
  });
  await page.goto("/");
  await expect(
    page.getByText("Illustrative data", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
  const before = await (await page.request.get("/api/report")).json();
  const balances = page.getByRole("region", {
    name: "Tracked net worth",
    exact: true,
  });
  const total = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(before.balances.latest.netWorthCents / 100);
  await expect(balances.locator(".balance-total")).toHaveText(total);
  expect(before.balances.latest.marginLoanCents).toBeGreaterThan(0);
  expect(before.balances.latest.netWorthCents).toBe(
    before.balances.latest.assetsCents - before.balances.latest.marginLoanCents,
  );
  await expect(
    balances.locator(".balance-breakdown").getByText("Brokerage borrowing"),
  ).toBeVisible();
  await expect(
    balances.locator(".balance-breakdown").getByText(
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(-before.balances.latest.marginLoanCents / 100),
      { exact: true },
    ),
  ).toBeVisible();
  expect(before.totals.netCashFlow).toBe(
    before.totals.cashIncome - before.totals.cashSpending,
  );
  expect(before.totals.netRecordedFlow).toBe(
    before.totals.cashIncome +
      before.totals.stockIncome -
      before.totals.spending,
  );
  await page.getByRole("tab", { name: "Year to date", exact: true }).click();
  const slider = balances.getByRole("slider", { name: "History date" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
  await balances.getByText("History & freshness", { exact: true }).click();
  await expect(balances.getByRole("table")).toBeVisible();
  await expect(
    balances.getByRole("cell", { name: "Institution export", exact: true }),
  ).toBeVisible();
  await expect(balances.getByText(/owner|confirm|conflict/i)).toHaveCount(0);
  await expect(page.getByText(/so net worth is not shown/)).toHaveCount(0);
  await page.getByRole("tab", { name: "Last 3 months", exact: true }).click();
  await expect(balances.locator(".balance-total")).toHaveText(total);
  await page.getByRole("tab", { name: "Last 1 month", exact: true }).click();
  await page
    .getByRole("button", { name: "View total expense records" })
    .click();
  await expect(page.getByLabel("Filter activity")).toHaveValue("expenses");
  await page.locator("#overview-tab").click();
  await page.getByRole("button", { name: "View entries", exact: true }).click();
  await expect(page.getByLabel("Filter activity")).toHaveValue("unclassified");
  await expect(
    page.getByRole("heading", { name: /Incomplete entries/ }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "EXM · Share transfer",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/excluded from income and spending/),
  ).toBeVisible();
  await expect(dialog.locator("form, input, textarea, select")).toHaveCount(0);
  await dialog
    .getByText("Source & classification history", { exact: true })
    .click();
  await expect(dialog.locator("pre")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /Save decision|Preview change|Record stock receipt|Needs review/,
    }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const after = await (await page.request.get("/api/report")).json();
  expect(after.totals).toEqual(before.totals);
  expect(after.review).toEqual(before.review);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});

test("date controls, pending facts, historical valuation and data-health refresh are read-only", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Year to date", exact: true }).click();
  await expect(
    page.getByRole("group", { name: /Monthly income/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Last 3 months", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Quarter", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Last 1 month", exact: true }).click();
  await page.locator("#activity-tab").click();
  await page.getByLabel("Filter activity").selectOption("pending");
  await expect(
    page.getByText("Not in totals", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Card payment · Pending", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Pending transactions are excluded from confirmed totals."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByLabel("Filter activity").selectOption("stock_income");
  await page
    .getByRole("button", { name: "EXM · External share receipt", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Historical valuation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").locator("form, input, textarea, select"),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "EXM · Recorded share transfer", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText(/Recorded transfer price/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByLabel("Filter activity").selectOption("stock_spending");
  await page
    .getByRole("button", {
      name: "EXM · External share withdrawal",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Outgoing stock transfers", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").locator("form, input, textarea, select"),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator("#health-tab").click();
  await expect(
    page.getByRole("heading", { name: "Checking transactions", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Not established").first()).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Request sync|Connect selected accounts|Repair Plaid connection/,
    }),
  ).toHaveCount(0);
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes("/api/report?") &&
      response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Refresh view", exact: true }).click();
  await refreshed;
  await expect(
    page.getByRole("heading", { name: "Account balances", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});

test("institution-dated net history includes borrowing once and stays read-only", async ({
  page,
}) => {
  const fixture = await (await page.request.get("/api/report")).json();
  expect(fixture.illustrative).toBe(true);
  const latest = structuredClone(fixture.balances.latest);
  const date = new Date(latest.date + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + 1);
  latest.date = date.toISOString().slice(0, 10);
  latest.asOfDate = latest.date;
  latest.historyMethods = ["institution_export"];
  latest.provider = "Illustrative institution export";
  latest.assetsCents = null;
  latest.marginLoanCents = null;
  latest.netWorthCents = 1000000;
  latest.accounts[0].currentCents = 100000;
  latest.accounts[0].netValueCents = 100000;
  latest.accounts[1].currentCents = null;
  latest.accounts[1].marginLoanCents = null;
  latest.accounts[1].netValueCents = 900000;
  const previous = structuredClone(latest);
  date.setUTCDate(date.getUTCDate() - 1);
  previous.date = date.toISOString().slice(0, 10);
  previous.asOfDate = previous.date;
  previous.historyMethods = ["institution_export", "reconstructed"];
  previous.provider = "Illustrative activity and historical prices";
  fixture.balances = {
    ...fixture.balances,
    latest,
    history: [previous, latest],
    stale: false,
  };
  await page.route("**/api/report*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  const errors: string[] = [],
    writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method()))
      writes.push(request.method());
  });
  await page.goto("/");
  const balances = page.getByRole("region", {
    name: "Tracked net worth",
    exact: true,
  });
  await expect(balances.locator(".balance-total")).toHaveText("$10,000.00");
  await expect(
    balances.getByText("Brokerage · net value", { exact: true }),
  ).toBeVisible();
  await expect(
    balances
      .locator(".balance-breakdown")
      .getByText("$9,000.00", { exact: true }),
  ).toBeVisible();
  await expect(balances.getByText(/borrowing is unavailable/)).toHaveCount(0);
  await balances.getByText("History & freshness", { exact: true }).click();
  await expect(
    balances.getByRole("cell", { name: "Institution export", exact: true }),
  ).toHaveCount(1);
  await expect(
    balances.getByRole("cell", {
      name: "Institution export + Reconstructed estimate",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    balances.getByText(
      /Reconstructed daily estimates assume same-day settlement/,
    ),
  ).toBeVisible();
  await expect(balances.getByText(/Imported dates follow/)).toBeVisible();
  await balances.getByRole("slider", { name: "History date" }).focus();
  await page.keyboard.press("Home");
  await expect(
    balances.getByRole("slider", { name: "History date" }),
  ).toHaveValue("0");
  await expect(balances.locator(".balance-selection")).toContainText(
    "Estimated",
  );
  await page.screenshot({
    path: `test-results/reconstructed-history-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("value change separates net income from estimated investment loss and explains unavailable history", async ({
  page,
}) => {
  const fixture = await (await page.request.get("/api/report")).json();
  expect(fixture.illustrative).toBe(true);
  await page.clock.install({ time: new Date("2026-11-12T20:00:00Z") });
  const points = Array.from({ length: 33 }, (_, i) => {
    const date = new Date(Date.parse("2026-10-11") + i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return balancePoint(
      {
        capturedAt: date + "T20:00:00Z",
        asOfDate: date,
        provider: "Invented account values",
        historyMethods: ["institution_export"],
        accounts: fixture.accounts.map((a: { id: string }, index: number) => ({
          accountId: a.id,
          currentCents: null,
          netValueCents:
            index === 0 ? 100000 : 900000 + Math.round((i * 50000) / 32),
          marginLoanCents: null,
          currency: "USD",
          institutionUpdatedAt: null,
        })),
      },
      fixture.accounts,
    );
  });
  const sample = fixture.records.find(
    (e: { kind: string }) => e.kind === "cash_income",
  );
  const events = [
    {
      ...sample,
      id: "invented-cash",
      date: "2026-10-12",
      kind: "cash_income",
      status: "confirmed",
      amountCents: 100000,
    },
    {
      ...sample,
      id: "invented-shares",
      date: "2026-10-20",
      kind: "stock_income",
      status: "confirmed",
      amountCents: 20000,
    },
    {
      ...sample,
      id: "invented-spending",
      date: "2026-11-01",
      kind: "spending",
      status: "confirmed",
      amountCents: 30000,
    },
  ];
  let missingHistory = false;
  let missingBorrowing = false;
  let missingDailyValue = false;
  await page.route("**/api/report*", (route) => {
    const url = new URL(route.request().url()),
      period = {
        start: url.searchParams.get("start")!,
        end: url.searchParams.get("end")!,
      };
    const coverage = fixture.coverage.map((c: object) => ({
      ...c,
      history: missingHistory
        ? undefined
        : {
            start: "2026-01-01",
            end: "2026-11-12",
            source: "Invented activity",
            retrievedAt: "2026-11-12T20:00:00Z",
          },
    }));
    const result = report(events, period);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...fixture,
        ...result,
        trend: result.months,
        coverage,
        availablePeriod: { start: "2026-01-01", end: "2026-11-12" },
        balances: {
          ...fixture.balances,
          latest: missingBorrowing
            ? {
                ...fixture.balances.latest,
                netWorthCents: null,
                marginLoanCents: null,
              }
            : points.at(-1),
          stale: false,
          history: points
            .filter((p) => !missingDailyValue || p.date !== "2026-10-21")
            .map((p) =>
              missingBorrowing
                ? { ...p, assetsCents: p.netWorthCents! + 20000 }
                : p,
            )
            .filter((p) => p.date >= period.start && p.date <= period.end),
          change: accountValueChange(
            points.filter((p) => !missingDailyValue || p.date !== "2026-10-21"),
            events,
            fixture.accounts,
            coverage,
            period,
          ),
        },
      }),
    });
  });
  const writes: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.method());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const group = page.getByRole("group", {
    name: "Account value change breakdown",
  });
  const amounts = group.locator(".value-change-amounts > div");
  await expect(amounts.nth(0).locator("dd")).toHaveText("+$500.00");
  await expect(amounts.nth(1).locator("dd")).toContainText("+$900.00");
  await expect(amounts.nth(1)).toContainText(
    "$1,200.00 income − $300.00 expenses",
  );
  await expect(amounts.nth(2).locator("dd")).toContainText("-$400.00");
  await expect(amounts.nth(3).locator("dt")).toHaveText("Time-weighted return");
  await expect(amounts.nth(3).locator("dd")).toContainText("-3.68%");
  await group.getByText("How this is calculated", { exact: true }).click();
  await expect(
    group.getByText(/not a rate of return or taxable gain/),
  ).toBeVisible();
  await expect(group.getByText(/Oct 11, 2026 to/)).toBeVisible();
  await expect(page.locator(".balance-total")).toHaveText("$10,500.00");
  await page.locator(".account-value").screenshot({
    path: `test-results/value-change-${test.info().project.name}.png`,
  });
  await page.getByRole("tab", { name: "Year to date", exact: true }).click();
  await expect(
    group.getByText(/covers part of the selected period/),
  ).toBeVisible();
  await expect(amounts.nth(0).locator("dd")).toHaveText("+$500.00");
  await page.getByRole("tab", { name: "Last year", exact: true }).click();
  await expect(group.getByText(/Two dated net account values/)).toBeVisible();
  await expect(page.locator(".balance-total")).toHaveText("$10,500.00");
  await page.getByRole("tab", { name: "Last 1 month", exact: true }).click();
  missingHistory = true;
  await page.reload();
  await expect(amounts.nth(0).locator("dd")).toHaveText("+$500.00");
  await expect(amounts.nth(1).locator("dd")).toHaveText("Unavailable");
  await expect(amounts.nth(2).locator("dd")).toContainText("Unavailable");
  await expect(
    group.getByText(/Transaction history for both accounts is needed/),
  ).toBeVisible();
  missingHistory = false;
  missingDailyValue = true;
  await page.reload();
  await expect(amounts.nth(2).locator("dd")).toContainText("-$400.00");
  await expect(amounts.nth(3).locator("dd")).toContainText("Unavailable");
  await expect(
    group.getByText(/needs a net value for every day/),
  ).toBeVisible();
  missingDailyValue = false;
  missingBorrowing = true;
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Tracked account value", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Showing account value before borrowing/),
  ).toBeVisible();
  await expect(group).toHaveCount(0);
  await expect(page.locator(".balance-history-heading")).not.toContainText(
    "change over compared dates",
  );
  await expect(page.locator(".balance-history-heading")).toContainText(
    "+$484.37",
  );
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});
