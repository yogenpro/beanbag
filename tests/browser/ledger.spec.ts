import { expect, test } from "@playwright/test";

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
  await page.getByRole("button", { name: "Year", exact: true }).click();
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
  await page.getByRole("button", { name: "Last month", exact: true }).click();
  await expect(balances.locator(".balance-total")).toHaveText(total);
  await page.getByRole("button", { name: "This month", exact: true }).click();
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
  await page.getByRole("button", { name: "Year", exact: true }).click();
  await expect(
    page.getByRole("group", { name: /Monthly income/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await expect(page.getByLabel("Start date", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "This month", exact: true }).click();
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
  ).toHaveCount(2);
  await expect(balances.getByText(/Imported dates follow/)).toBeVisible();
  await balances.getByRole("slider", { name: "History date" }).focus();
  await page.keyboard.press("Home");
  await expect(
    balances.getByRole("slider", { name: "History date" }),
  ).toHaveValue("0");
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});
