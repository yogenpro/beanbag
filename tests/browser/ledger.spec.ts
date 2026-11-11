import { expect, test } from "@playwright/test";

test("responsive ledger, exact totals, drilldown and durable review through reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const reset = await page.request.post("/api/overrides", {
    headers: { Origin: "http://127.0.0.1:8787", "X-Beanbag-Request": "1" },
    data: {
      eventId: "bank:demo-review-bank",
      baseRevision: "synthetic-v1",
      kind: "unknown",
      rationale: "Reset this synthetic example for a fresh browser review.",
    },
  });
  expect(reset.status()).toBe(201);
  await page.goto("/");
  await expect(
    page.getByText("Illustrative data", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your household, in view." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View total recorded income records" }),
  ).toBeVisible();
  const report = await (await page.request.get("/api/report")).json();
  expect(report.totals.netCashFlow).toBe(
    report.totals.cashIncome - report.totals.spending,
  );
  expect(report.totals.netRecordedFlow).toBe(
    report.totals.cashIncome +
      report.totals.stockIncome -
      report.totals.spending,
  );
  await page
    .getByRole("button", { name: "View checking spending records" })
    .click();
  await expect(page.getByLabel("Filter activity")).toHaveValue("spending");
  await expect(
    page.getByRole("heading", { name: "Follow every dollar." }),
  ).toBeVisible();
  await page.locator("#review-tab").click();
  const target = page.getByRole("button", {
    name: "Brokerage cash movement · verify destination",
    exact: true,
  });
  await target.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("spending");
  await page
    .getByLabel("Decision rationale")
    .fill("Synthetic statement confirms an external checking payment.");
  await page.getByRole("button", { name: "Preview change" }).click();
  await expect(page.getByText("Effect on this record")).toBeVisible();
  await page.getByRole("button", { name: "Save decision" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your household, in view." }),
  ).toBeVisible();
  const detail = await (
    await page.request.get("/api/events/bank:demo-review-bank")
  ).json();
  expect(detail.event.kind).toBe("spending");
  expect(detail.history.length).toBeGreaterThan(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test("date controls, pending preview, receipt validation and data health", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "Record stock receipt" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Historical price source")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#health-tab").click();
  await expect(
    page.getByRole("heading", { name: "Checking transactions", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Not established").first()).toBeVisible();
  await page.getByRole("button", { name: "Request sync" }).click();
  await expect(page.getByRole("status")).toContainText("no financial provider");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});
