import { expect, test } from "@playwright/test";
import {
  longProjectionFixture,
  projectionFixture,
} from "../projection-fixtures";

test("cash income and payments have independent percentage scales and update forecast locally", async ({
  page,
}) => {
  const fixture = projectionFixture();
  const writes: string[] = [],
    requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
    if (!["GET", "HEAD"].includes(request.method()))
      writes.push(request.method());
  });
  await page.route("**/api/report*", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  await page.locator("#projections-tab").click();
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("1000");
  await expect(page.getByLabel("Monthly cash payments")).toHaveValue("400");
  await expect(page.getByLabel("Cash income scale")).toHaveValue("100");
  await expect(page.getByLabel("Cash payments scale")).toHaveValue("100");
  await expect(page.getByTestId("projection-net-cash")).toHaveText("$600.00");
  await page.getByLabel("Annual investment growth").fill("0");
  await page.getByLabel("Annual return volatility").fill("0");
  await page.getByLabel("Monthly contribution variability").fill("0");
  await page.getByLabel("Project ahead").selectOption("1");
  const requestCount = requests.length;
  const start = fixture.balances.latest!.netWorthCents! / 100;
  const currency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  await page.getByLabel("Cash income scale").fill("120");
  await page.getByLabel("Cash payments scale").fill("80");
  await expect(page.getByTestId("projection-net-cash")).toHaveText("$880.00");
  await expect(page.getByTestId("projection-end")).toHaveText(
    currency(start + (880 + 400) * 12),
  );
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("1000");
  await expect(page.getByLabel("Monthly cash payments")).toHaveValue("400");
  await page.getByLabel("Cash income scale").fill("0");
  await expect(page.getByTestId("projection-net-cash")).toHaveText("-$320.00");
  await expect(page.getByTestId("projection-end")).toHaveText(
    currency(start + 80 * 12),
  );
  await page.getByLabel("Cash income scale").fill("120");
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `test-results/projections-cash-scales-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(requests).toHaveLength(requestCount);
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.locator("#overview-tab").click();
  await page.locator("#projections-tab").click();
  await expect(page.getByLabel("Cash income scale")).toHaveValue("120");
  await expect(page.getByLabel("Cash payments scale")).toHaveValue("80");
  await page.getByRole("button", { name: "Use history estimates" }).click();
  await expect(page.getByLabel("Cash income scale")).toHaveValue("100");
  await expect(page.getByLabel("Cash payments scale")).toHaveValue("100");
  await expect(page.getByTestId("projection-net-cash")).toHaveText("$600.00");
  await page.getByLabel("Cash payments scale").fill("1001");
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toHaveCount(0);
});

test("Max uses all saved history beyond five years and keeps assumptions local", async ({
  page,
}) => {
  const fixture = longProjectionFixture();
  const requests: string[] = [],
    writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
    if (!["GET", "HEAD"].includes(request.method()))
      writes.push(request.method());
  });
  await page.route("**/api/report*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const start = params.get("start") ?? "0001-01-01";
    const end = params.get("end") ?? "9999-12-31";
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
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toBeVisible();
  const requestCount = requests.length;
  expect(
    requests.some(
      (url) => new URL(url).searchParams.get("start") === "0001-01-01",
    ),
  ).toBe(true);
  await page.getByLabel("History window").selectOption("max");
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("125");
  await expect(page.getByLabel("Monthly cash payments")).toHaveValue("50");
  await expect(page.getByLabel("Monthly contribution variability")).toHaveValue(
    "333.33",
  );
  await page.getByLabel("Cash income scale").fill("200");
  await expect(page.getByLabel("Monthly contribution variability")).toHaveValue(
    "666.67",
  );
  await page.getByLabel("Cash payments scale").fill("200");
  await expect(page.getByLabel("Monthly contribution variability")).toHaveValue(
    "533.33",
  );
  await page.getByLabel("Monthly contribution variability").fill("250");
  await page.getByLabel("Cash income scale").fill("100");
  await expect(page.getByLabel("Monthly contribution variability")).toHaveValue(
    "250",
  );
  await page.getByRole("button", { name: "Use history estimates" }).click();
  await expect(page.getByLabel("Monthly net share transfers")).toHaveValue(
    "50",
  );
  await expect(
    page.getByText(
      /Based on 64 usable contribution months and 8 usable return months out of the 64 available months/,
    ),
  ).toBeVisible();
  await expect(page.locator(".projection-months")).toContainText("2021-01");
  await expect(page.locator(".projection-summary dd").first()).toHaveText(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(fixture.balances.latest!.netWorthCents! / 100),
  );
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `test-results/projections-max-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel("History window").selectOption("60");
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("66.67");
  await page.getByLabel("Monthly cash income").fill("1234");
  await page.getByLabel("History window").selectOption("max");
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("1234");
  expect(requests).toHaveLength(requestCount);
  expect(writes).toEqual([]);
  await page.locator("#overview-tab").click();
  await page.locator("#projections-tab").click();
  await expect(page.getByLabel("History window")).toHaveValue("max");
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("1234");
});

test("projection assumptions update the graph locally, survive tab changes, and never write", async ({
  page,
}) => {
  const fixture = projectionFixture();
  const original = JSON.stringify(fixture);
  const requests: { method: string; url: string }[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/"))
      requests.push({ method: request.method(), url: request.url() });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/report*", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  await page.locator("#projections-tab").click();
  await expect(
    page.getByRole("heading", { name: "Future projections", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("1000");
  await expect(page.getByLabel("Monthly net share transfers")).toHaveValue(
    "400",
  );
  await expect(
    page.getByText(
      /Based on 4 usable contribution months and 4 usable return months/,
    ),
  ).toBeVisible();
  const startingValue = page.locator(".projection-summary dd").first();
  await expect(startingValue).toHaveText(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(fixture.balances.latest!.netWorthCents! / 100),
  );
  const before = await page.getByTestId("projection-end").textContent();
  const requestCount = requests.length;
  await page.getByLabel("Monthly cash income").fill("3000");
  await expect(page.getByTestId("projection-end")).not.toHaveText(before!);
  await page.getByLabel("Annual return volatility").fill("20");
  await page
    .getByRole("combobox", { name: /Outcome range/ })
    .selectOption("95");
  await expect(
    page.getByRole("img", { name: /95% modeled outcome range/ }),
  ).toBeVisible();
  await page.getByLabel("Project ahead").selectOption("5");
  await page.getByRole("slider", { name: "Inspect forecast month" }).focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".projection-readout")).toContainText(
    "May 15, 2026",
  );
  await page.keyboard.press("End");
  await expect(page.locator(".projection-readout")).toContainText(
    "May 15, 2031",
  );
  await page
    .locator(".projection-method summary")
    .filter({ hasText: "Annual projection values" })
    .click();
  await expect(page.locator(".projection-table-wrap tbody tr")).toHaveCount(6);
  expect(requests).toHaveLength(requestCount);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `test-results/projections-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(
    await page
      .locator(".projection-chart")
      .evaluate((chart) => chart.scrollWidth > chart.clientWidth),
  ).toBe(false);
  await page.locator("#overview-tab").click();
  await page.locator("#projections-tab").click();
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("3000");
  await page.getByRole("button", { name: "Use history estimates" }).click();
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("1000");
  await page.getByLabel("Annual investment growth").fill("-100");
  await expect(
    page.getByRole("heading", { name: "Set assumptions to see the forecast" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toHaveCount(0);
  await page.getByLabel("Annual investment growth").fill("0");
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh view" }).click();
  await expect(page.getByLabel("Annual investment growth")).toHaveValue("0");
  await page.reload();
  await page.locator("#projections-tab").click();
  await expect(page.getByLabel("Annual investment growth")).not.toHaveValue(
    "0",
  );
  expect(requests.every((request) => request.method === "GET")).toBe(true);
  expect(JSON.stringify(fixture)).toBe(original);
  expect(errors).toEqual([]);
});

test("insufficient history requires explicit assumptions and unknown net value blocks a forecast", async ({
  page,
}) => {
  const fixture = projectionFixture();
  fixture.coverage.forEach((coverage) => {
    coverage.history = undefined;
  });
  fixture.balances.history = [];
  await page.route("**/api/report*", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  await page.locator("#projections-tab").click();
  await expect(
    page.getByRole("heading", { name: "Set assumptions to see the forecast" }),
  ).toBeVisible();
  await expect(page.getByLabel("Monthly cash income")).toHaveValue("");
  await expect(page.getByLabel("Annual investment growth")).toHaveValue("");
  for (const label of [
    "Monthly cash income",
    "Monthly cash payments",
    "Monthly net share transfers",
    "Annual investment growth",
    "Annual return volatility",
    "Monthly contribution variability",
  ])
    await page.getByLabel(label).fill("0");
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toBeVisible();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `test-results/projections-manual-${test.info().project.name}.png`,
    fullPage: true,
  });
  fixture.balances.latest!.netWorthCents = null;
  await page.reload();
  await page.locator("#projections-tab").click();
  await expect(
    page.getByRole("heading", {
      name: "Projection needs a known net account value",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Projected account value/ }),
  ).toHaveCount(0);
});

test("projection history failures can be retried", async ({ page }) => {
  const fixture = projectionFixture();
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
