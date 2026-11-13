import { describe, expect, it } from "vitest";
import { classify } from "../src/accounting/classify";
import { report } from "../src/accounting/report";
import { D1Ledger } from "../src/data/d1";
import { MemoryLedger } from "../src/data/memory";
import { reclassify } from "../src/data/repository";
import {
  normalizeInvestment,
  transferPricing,
} from "../src/providers/plaid/normalize";
import { accounts, bank, investment, rawInvestment } from "./fixtures";
import { sqliteD1 } from "./sqlite-d1";

const period = { start: "2026-08-01", end: "2026-08-31" };
const share = (quantity = "1.005") =>
  investment({
    quantity,
    unitPrice: "2.005",
    origin: "unknown",
    direction: "unknown",
    evidence: undefined,
  });
const cash = (amount: number) =>
  investment({
    activity: "transfer",
    ticker: "CUR:USD",
    securityType: "cash",
    quantity: "0",
    cashAmountCents: amount,
    origin: "unknown",
    direction: "unknown",
    evidence: undefined,
  });

describe("external flows across the tracked account pair", () => {
  it.each(accounts)(
    "counts recorded share receipts in $role without per-event approval",
    (account) => {
      expect(
        classify({ ...share(), accountId: account.id }, accounts),
      ).toMatchObject({
        kind: "stock_income",
        status: "confirmed",
        amountCents: 202,
        valuation: {
          convention: "provider_transfer_price",
          close: "2.005",
          quantity: "1.005",
        },
      });
    },
  );
  it("values outgoing shares symmetrically without treating them as cash", () => {
    const outgoing = classify(share("-1.005"), accounts);
    expect(outgoing).toMatchObject({
      kind: "stock_spending",
      status: "confirmed",
      amountCents: 202,
    });
    const totals = report(
      [classify(bank({ amountCents: 10000 }), accounts), outgoing],
      period,
    ).totals;
    expect(totals).toMatchObject({
      cashIncome: 10000,
      cashSpending: 0,
      stockSpending: 202,
      spending: 202,
      netCashFlow: 10000,
      netRecordedFlow: 9798,
    });
  });
  it.each([
    ["transfer_out", "stock_spending"],
    ["transfer_in", "stock_income"],
  ])("uses structured direction from %s", (subtype, kind) => {
    expect(classify({ ...share(), subtype }, accounts)).toMatchObject({
      kind,
      status: "confirmed",
      amountCents: 202,
    });
  });
  it.each([25000, -25000])(
    "counts brokerage cash transfers using the cash sign (%s)",
    (amount) => {
      expect(classify(cash(amount), accounts)).toMatchObject({
        kind: amount > 0 ? "cash_income" : "spending",
        status: "confirmed",
        amountCents: 25000,
      });
    },
  );
  it("matches both reciprocal legs once without shared provider IDs", () => {
    const events = reclassify(
      [
        bank({
          id: "cash-out",
          description: "ACH transfer",
          amountCents: -25000,
        }),
        cash(25000),
      ],
      accounts,
      [],
      {},
    );
    expect(events.map((e) => e.kind)).toEqual([
      "internal_transfer",
      "internal_transfer",
    ]);
    expect(events[0].transferGroup).toBe(events[1].transferGroup);
    expect(report(events, period).totals).toMatchObject({
      cashIncome: 0,
      spending: 0,
      internalTransfers: 25000,
    });
  });
  it("does not match ordinary same-amount activity or a different named account", () => {
    expect(
      reclassify(
        [bank({ amountCents: -25000, description: "Groceries" }), cash(25000)],
        accounts,
        [],
        {},
      ).map((e) => e.kind),
    ).toEqual(["spending", "cash_income"]);
    expect(
      reclassify(
        [
          bank({
            amountCents: -25000,
            description: "Transfer to Brokerage -9999",
          }),
          cash(25000),
        ],
        accounts,
        [],
        {},
      ).map((e) => e.kind),
    ).toEqual(["spending", "cash_income"]);
  });
  it("keeps ambiguous matches external rather than arbitrarily picking a leg", () => {
    const events = reclassify(
      [
        bank({ id: "one", amountCents: -25000, description: "ACH transfer" }),
        bank({ id: "two", amountCents: -25000, description: "ACH transfer" }),
        cash(25000),
      ],
      accounts,
      [],
      {},
    );
    expect(events.map((e) => e.kind)).toEqual([
      "spending",
      "spending",
      "cash_income",
    ]);
  });
  it.each([
    "dividend",
    "interest",
    "fee",
    "buy",
    "sell",
    "reinvestment",
    "split",
    "corporate_action",
  ])("keeps brokerage %s outside external flows", (activity) => {
    expect(
      classify(
        investment({ activity, unitPrice: "25", cashAmountCents: 10000 }),
        accounts,
      ),
    ).toMatchObject({ kind: "ignored", amountCents: 0 });
  });
  it.each(["dividend", "interest", "capital_gain", "account_fee"])(
    "excludes cash subtype %s even when it has a distribution description",
    (subtype) => {
      expect(
        classify(
          investment({
            activity: "cash",
            subtype,
            description: "Distribution",
            cashAmountCents: 10000,
          }),
          accounts,
        ).kind,
      ).toBe("ignored");
    },
  );
  it("supports cash deposit/withdrawal subtypes and rejects unvalued or malformed share values", () => {
    expect(
      classify(
        investment({
          activity: "cash",
          subtype: "deposit",
          cashAmountCents: 10000,
        }),
        accounts,
      ).kind,
    ).toBe("cash_income");
    expect(
      classify(
        investment({
          activity: "cash",
          subtype: "withdrawal",
          cashAmountCents: -10000,
        }),
        accounts,
      ).kind,
    ).toBe("spending");
    for (const unitPrice of [undefined, "0", "-1", "invalid"])
      expect(classify({ ...share(), unitPrice }, accounts)).toMatchObject({
        kind: "stock_income",
        status: "needs_review",
        amountCents: null,
      });
  });
  it("does not promote pending, removed or unselected records into totals", () => {
    expect(classify({ ...share(), removed: true }, accounts).status).toBe(
      "removed",
    );
    expect(classify({ ...share(), accountId: "outside" }, accounts).kind).toBe(
      "ignored",
    );
    expect(classify(bank({ pending: true }), accounts).status).toBe("pending");
  });
});

describe("stored provider price evidence", () => {
  it("keeps a malformed legacy price unvalued without breaking other records", () => {
    const source = investment({ id: "legacy" });
    const result = transferPricing(
      source,
      JSON.stringify({
        transaction: rawInvestment({
          investment_transaction_id: "legacy",
          price: true,
        }),
        security: { type: "equity" },
      }),
    );
    expect(classify(result, accounts).status).toBe("needs_review");
    expect(transferPricing(source, "invalid JSON")).toEqual(source);
  });
  it("reclassifies an old cached event using its lossless original transfer price without writing", async () => {
    const { db, sqlite } = sqliteD1();
    try {
      for (const a of accounts)
        sqlite
          .prepare("INSERT INTO accounts(id,role,label,mask) VALUES(?,?,?,?)")
          .run(a.id, a.role, a.label, a.mask);
      const source = investment({
        id: "legacy-receipt",
        origin: "unknown",
        direction: "unknown",
        evidence: undefined,
      });
      const raw = JSON.stringify({
        transaction: rawInvestment({
          investment_transaction_id: source.id,
          price: "placeholder",
        }),
        security: { type: "equity" },
      }).replace('"placeholder"', "200.123456789012345678");
      sqlite
        .prepare(
          "INSERT INTO source_records(id,source_kind,provider_id,account_id,event_date,revision,record_json,raw_json) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          "investment:" + source.id,
          "investment",
          source.id,
          source.accountId,
          source.date,
          source.revision,
          JSON.stringify(source),
          raw,
        );
      const old = {
        ...classify(source, accounts),
        kind: "unknown",
        status: "needs_review",
        ruleVersion: "boundary-1",
      };
      sqlite
        .prepare("INSERT INTO financial_events VALUES(?,?,?,?,?,?)")
        .run(
          old.id,
          old.date,
          old.kind,
          old.status,
          old.amountCents,
          JSON.stringify(old),
        );
      const changes = () =>
        sqlite.prepare("SELECT total_changes() AS n").get()!.n;
      const before = changes(),
        repo = new D1Ledger(db);
      expect((await repo.sources())[0]).toMatchObject({
        revision: "v1",
        unitPrice: "200.123456789012345678",
      });
      expect((await repo.events())[0]).toMatchObject({
        kind: "stock_income",
        status: "confirmed",
        ruleVersion: "boundary-2",
      });
      expect(changes()).toBe(before);
      expect(
        JSON.parse(
          String(
            sqlite.prepare("SELECT event_json FROM financial_events").get()!
              .event_json,
          ),
        ).ruleVersion,
      ).toBe("boundary-1");
    } finally {
      sqlite.close();
    }
  });
  it("preserves the first recorded valuation when a later provider correction changes the price", async () => {
    const repo = new MemoryLedger(accounts);
    const at = new Date().toISOString();
    const commit = async (unitPrice: string) => {
      const leaseId = (await repo.acquire("investments"))!;
      await repo.commitSync({
        product: "investments",
        leaseId,
        writes: [{ record: { ...share(), unitPrice }, raw: "{}" }],
        removed: [],
        cursor: null,
        coverage: {
          ...(await repo.coverage())[1],
          lastSuccess: at,
          lastAttempt: at,
        },
      });
    };
    await commit("2.005");
    expect((await repo.events())[0].amountCents).toBe(202);
    await commit("2.0050");
    expect((await repo.events())[0].status).toBe("confirmed");
    await commit("9.99");
    expect((await repo.valuations())["investment:stock-1"].close).toBe("2.005");
    expect((await repo.events())[0].status).toBe("needs_review");
  });
  it("normalizes the price and asset type directly from the transfer record", async () => {
    const result = await normalizeInvestment(
      rawInvestment({ price: "2.005" }),
      [{ security_id: "test-xyz", type: "equity" }],
    );
    expect(result.record).toMatchObject({
      unitPrice: "2.005",
      securityType: "equity",
      origin: "unknown",
    });
    expect(classify(result.record, accounts).kind).toBe("stock_income");
  });
});
