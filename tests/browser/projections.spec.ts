import { expect, test } from "@playwright/test";
import {
  annualProjectionFixture,
  projectionFixture,
} from "../projection-fixtures";

const usd = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );

test("historical annual income growth compounds cash and stock and has its own uncertainty graph", async ({
  page,
}) => {
  const fixture = annualProjectionFixture(),
    original = JSON.stringify(fixture);
  const requests: string[] = [],
    writes: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
    if (!["GET", "HEAD"].includes(request.method()))
      writes.push(request.method());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/report*", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  await page.locator("#projections-tab").click();
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toBeVisible();
  await expect(page.getByLabel("History window")).toHaveValue("max");
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("1452");
  await expect(page.getByLabel("Monthly stock income")).toHaveValue("726");
  await expect(page.getByLabel("Monthly stock outflows")).toHaveValue("133.1");
  await expect(page.getByLabel("Annual income growth")).toHaveValue("13.24");
  await expect(page.getByLabel("Annual income uncertainty")).not.toHaveValue(
    "0",
  );
  await expect(
    page.getByText(
      /Income history provides 3 complete year-over-year comparisons/,
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Cash income scale")).toHaveCount(0);
  const requestCount = requests.length;
  await page
    .getByRole("button", { name: "Monthly income", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /Projected monthly income/ }),
  ).toBeVisible();
  await expect(page.locator(".projection-summary dd").first()).toHaveText(
    "$2,178.00",
  );
  const before = await page.locator(".projection-band").getAttribute("d");
  await page.getByLabel("Annual income uncertainty").fill("20");
  await expect(page.locator(".projection-band")).not.toHaveAttribute(
    "d",
    before!,
  );
  await page.getByLabel("Monthly cash income").fill("1000");
  await page.getByLabel("Monthly stock income").fill("500");
  await page.getByLabel("Annual income growth").fill("10");
  await page.getByLabel("Annual income uncertainty").fill("0");
  await page.getByLabel("Project ahead").selectOption("5");
  await expect(page.getByTestId("projection-year-income")).toHaveText(
    "$1,650.00",
  );
  await expect(page.getByTestId("projection-end")).toHaveText(
    usd(1500 * 1.1 ** 5),
  );
  await page.getByText("Annual projection values", { exact: true }).click();
  const rows = page.locator(".projection-table-wrap tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(1).locator("td").nth(1)).toHaveText("$1,650.00");
  await expect(rows.nth(2).locator("td").nth(1)).toHaveText("$1,815.00");
  // Investment assumptions are independent of the income-only forecast.
  await page.getByLabel("Annual investment growth").fill("-100");
  await expect(
    page.getByRole("img", { name: /Projected monthly income/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Account value", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toHaveCount(0);
  await page.getByLabel("Annual investment growth").fill("0");
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Monthly income", exact: true })
    .click();
  await page.getByLabel("Annual income uncertainty").fill("20");
  await page
    .getByRole("combobox", { name: /Outcome range/ })
    .selectOption("95");
  await expect(
    page.getByRole("img", { name: /Projected monthly income with a 95%/ }),
  ).toBeVisible();
  await page.getByRole("slider", { name: "Inspect forecast month" }).focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".projection-readout")).toContainText("$1,500.00");
  await page.keyboard.press("End");
  expect(requests).toHaveLength(requestCount);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `test-results/projections-annual-income-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.locator("#overview-tab").click();
  await page.locator("#projections-tab").click();
  await expect(page.getByLabel("Annual income growth")).toHaveValue("10");
  await page.getByRole("button", { name: "Use history estimates" }).click();
  await expect(page.getByLabel("Annual income growth")).toHaveValue("13.24");
  await page.getByRole("button", { name: "Refresh view" }).click();
  await expect(page.getByLabel("Annual income growth")).toHaveValue("13.24");
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect(JSON.stringify(fixture)).toBe(original);
});

test("history window changes annual evidence and Max restores it without resetting manual growth", async ({
  page,
}) => {
  const fixture = annualProjectionFixture(),
    requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
  });
  await page.route("**/api/report*", (route) => {
    const params = new URL(route.request().url()).searchParams,
      start = params.get("start") ?? "0001-01-01",
      end = params.get("end") ?? "9999-12-31";
    return route.fulfill({
      json: {
        ...fixture,
        records: fixture.records.filter(
          (record) => record.date >= start && record.date <= end,
        ),
        balances: {
          ...fixture.balances,
          history: fixture.balances.history.filter(
            (point) => point.date >= start && point.date <= end,
          ),
        },
      },
    });
  });
  await page.goto("/");
  await page.locator("#projections-tab").click();
  await expect(page.getByLabel("Annual income growth")).toHaveValue("13.24");
  const count = requests.length;
  expect(
    requests.some(
      (url) => new URL(url).searchParams.get("start") === "0001-01-01",
    ),
  ).toBe(true);
  await page.getByLabel("History window").selectOption("36");
  await expect(page.getByLabel("Annual income growth")).toHaveValue("14.89");
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("1452");
  await page.getByLabel("History window").selectOption("12");
  await expect(page.getByLabel("Annual income growth")).toHaveValue("");
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toHaveCount(0);
  await page.getByLabel("History window").selectOption("max");
  await expect(page.getByLabel("Annual income growth")).toHaveValue("13.24");
  await page.getByLabel("Annual income growth").fill("8");
  await page.getByLabel("History window").selectOption("36");
  await expect(page.getByLabel("Annual income growth")).toHaveValue("8");
  expect(requests).toHaveLength(count);
});

test("short history requires explicit growth and uncertainty while income does not need investment history", async ({
  page,
}) => {
  const fixture = projectionFixture();
  fixture.balances.history = [];
  await page.route("**/api/report*", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  await page.locator("#projections-tab").click();
  await expect(
    page.getByRole("heading", { name: "Set assumptions to see the forecast" }),
  ).toBeVisible();
  await expect(page.getByLabel("Annual income growth")).toHaveValue("");
  await expect(page.getByLabel("Annual income uncertainty")).toHaveValue("");
  await page
    .getByRole("button", { name: "Monthly income", exact: true })
    .click();
  await page.getByLabel("Annual income growth").fill("10");
  await page.getByLabel("Annual income uncertainty").fill("0");
  await page.getByLabel("Project ahead").selectOption("1");
  await expect(
    page.getByRole("img", { name: /Projected monthly income/ }),
  ).toBeVisible();
  await expect(page.getByTestId("projection-end")).toHaveText("$1,650.00");
  await expect(page.getByLabel("Annual investment growth")).toHaveValue("");
  await expect(page.getByLabel("Annual payment growth")).toHaveValue("");
  await page.reload();
  await page.locator("#projections-tab").click();
  await expect(page.getByLabel("Annual income growth")).toHaveValue("");
  fixture.balances.latest!.netWorthCents = null;
  await page.reload();
  await page.locator("#projections-tab").click();
  await expect(
    page.getByRole("heading", {
      name: "Projection needs a known net account value",
    }),
  ).toBeVisible();
});

test("projection history failures can be retried", async ({ page }) => {
  const fixture = annualProjectionFixture();
  let fail = true;
  await page.route("**/api/report*", (route) => {
    if (
      new URL(route.request().url()).searchParams.get("end") === "9999-12-31" &&
      fail
    )
      return route.fulfill({
        status: 503,
        json: { error: "Saved history is temporarily unavailable" },
      });
    return route.fulfill({ json: fixture });
  });
  await page.goto("/");
  await page.locator("#projections-tab").click();
  await expect(
    page.getByRole("heading", { name: "Unable to load projection history" }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toBeVisible();
});
