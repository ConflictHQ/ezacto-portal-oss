// A fake ezacto instance behind global fetch, plus an in-memory KV. Two
// clients, one project each, one contact each, one staff user, one member.

import { vi } from "vitest";
import type { Bindings } from "../src/index";

export const BASE_URL = "https://ezacto.test";

export const CLIENT_A = { id: 1, name: "Alpha Co", is_active: true, currency: "USD" };
export const CLIENT_B = { id: 2, name: "Beta Ltd", is_active: true, currency: "USD" };
export const CLIENT_OLD = { id: 3, name: "Gone Inc", is_active: false, currency: "USD" };

export const PROJECT_A = {
  id: 10,
  client_id: 1,
  name: "Alpha Build",
  code: "alpha",
  billing_method: "time_materials",
  budget_by: "project",
  budget_seconds: 360000,
  budget_is_monthly: false,
  starts_on: "2026-01-01",
  ends_on: null,
  is_active: true,
};
export const PROJECT_B = { ...PROJECT_A, id: 20, client_id: 2, name: "Beta Build", code: "beta" };

export const CONTACTS = [
  { id: 100, client_id: 1, first_name: "Ann", last_name: "Alpha", email: "ann@alpha.example" },
  { id: 101, client_id: 2, first_name: "Bob", last_name: "Beta", email: "bob@beta.example" },
  { id: 102, client_id: 3, first_name: "Old", last_name: "Contact", email: "old@gone.example" },
  { id: 103, client_id: 1, first_name: "No", last_name: "Mail", email: null },
];

export const USERS = [
  { id: 1, first_name: "Sam", last_name: "Staff", email: "sam@firm.example", profile: "administrator", is_active: true },
  { id: 2, first_name: "Mia", last_name: "Member", email: "mia@firm.example", profile: "member", is_active: true },
  { id: 3, first_name: "Nul", last_name: "Mail", email: null, profile: "administrator", is_active: true },
];

// Detailed-time rows: two entries on Alpha (one invoiced, one not), one on Beta.
export const DETAILED_ROWS = [
  {
    time_entry_id: 1001,
    notes: "kickoff and scoping",
    spent_date: "2026-03-01",
    client_id: 1, client_name: "Alpha Co",
    project_id: 10, project_name: "Alpha Build", project_code: "alpha",
    task_id: 5, task_name: "Dev", user_id: 2, user_name: "Mia Member", roles: [],
    currency: "USD", seconds: 7200, rounded_seconds: 7200, billable_seconds: 7200,
    uninvoiced_billable_seconds: 0, time_entry_count: 1,
    billable_amount_cents: 30000, entries_without_billable_rate: 0,
  },
  {
    time_entry_id: 1002,
    notes: null,
    spent_date: "2026-03-02",
    client_id: 1, client_name: "Alpha Co",
    project_id: 10, project_name: "Alpha Build", project_code: "alpha",
    task_id: 5, task_name: "Dev", user_id: 2, user_name: "Mia Member", roles: [],
    currency: "USD", seconds: 3600, rounded_seconds: 3600, billable_seconds: 3600,
    uninvoiced_billable_seconds: 3600, time_entry_count: 1,
    billable_amount_cents: 15000, entries_without_billable_rate: 0,
  },
  {
    time_entry_id: 1003,
    notes: "beta review",
    spent_date: "2026-03-03",
    client_id: 2, client_name: "Beta Ltd",
    project_id: 20, project_name: "Beta Build", project_code: "beta",
    task_id: 5, task_name: "Dev", user_id: 2, user_name: "Mia Member", roles: [],
    currency: "USD", seconds: 1800, rounded_seconds: 1800, billable_seconds: 1800,
    uninvoiced_billable_seconds: 1800, time_entry_count: 1,
    billable_amount_cents: null, entries_without_billable_rate: 1,
  },
];

function page<T>(data: T[], self: string) {
  return { data, links: { self, next: null }, page: { per_page: 200, next_cursor: null } };
}

export interface FakeEzacto {
  calls: URL[];
  down: boolean;
  // Tokens the fake accepts as Bearer; minted ones are appended. Empty the
  // set to simulate the nightly rebuild deleting every token.
  validTokens: Set<string>;
  minted: number;
  signIns: Array<{ email: string; password: string }>;
  mailgun: Array<Record<string, string>>;
  brandDown: boolean;
  brand: { organization_name: string; assets: Array<{ slot: string; url: string; content_type: string; updated_at: string }> };
}

// Routes every fetch: ezacto by path, Turnstile always OK, mail send recorded.
export function installFakeFetch(): FakeEzacto & { mail: unknown[] } {
  const state = {
    calls: [] as URL[],
    down: false,
    validTokens: new Set(["ezacto_test", "t"]),
    minted: 0,
    signIns: [] as Array<{ email: string; password: string }>,
    mailgun: [] as Array<Record<string, string>>,
    brandDown: false,
    brand: {
      organization_name: "Northwind Partners",
      assets: [
        { slot: "wordmark_light", url: "/brand/wordmark-light/aa11", content_type: "image/png", updated_at: "2026-03-01T00:00:00Z" },
        { slot: "wordmark_dark", url: "/brand/wordmark-dark/bb22", content_type: "image/png", updated_at: "2026-03-01T00:00:00Z" },
      ],
    },
    mail: [] as unknown[],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "challenges.cloudflare.com") {
        return Response.json({ success: true });
      }
      if (url.hostname === "api.cloudflare.com") {
        state.mail.push(JSON.parse(String(init?.body)));
        return Response.json({ success: true });
      }
      if (url.hostname === "api.mailgun.net") {
        const form = init?.body as FormData;
        state.mailgun.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
        return Response.json({ id: "<msg>", message: "Queued." });
      }
      if (url.origin !== BASE_URL) throw new Error(`unexpected fetch ${url}`);
      state.calls.push(url);
      const p = url.pathname;
      const q = url.searchParams;
      const headers = new Headers(init?.headers);
      if (p === "/auth/sign-in") {
        const body = JSON.parse(String(init?.body)) as { email: string; password: string };
        state.signIns.push(body);
        if (body.email !== "admin@demo.example" || body.password !== "demo-pass") {
          return Response.json({ error: { code: "invalid_credentials" } }, { status: 401 });
        }
        return Response.json({ data: {} }, { headers: { "set-cookie": "__Host-ezacto_session=abc; Path=/; Secure" } });
      }
      if (p === "/api/v1/api-tokens" && init?.method === "POST") {
        if (headers.get("cookie") !== "__Host-ezacto_session=abc") return Response.json({}, { status: 401 });
        state.minted += 1;
        const token = `ezacto_minted_${state.minted}`;
        state.validTokens.add(token);
        return Response.json({ data: { id: state.minted, token, scopes: JSON.parse(String(init?.body)).scopes } }, { status: 201 });
      }
      const bearer = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (!state.validTokens.has(bearer)) {
        return Response.json({ error: { code: "authentication_required" } }, { status: 401 });
      }
      if (p === "/api/v1/brand") {
        if (state.brandDown) return new Response("nope", { status: 503 });
        return Response.json({ data: state.brand, links: { self: p } });
      }
      if (state.down) return new Response("nope", { status: 503 });
      if (p === "/api/v1/clients") {
        const all = [CLIENT_A, CLIENT_B, CLIENT_OLD];
        return Response.json(page(q.get("is_active") === "true" ? all.filter((c) => c.is_active) : all, p));
      }
      if (p === "/api/v1/clients/1") return Response.json({ data: CLIENT_A, links: { self: p } });
      if (p === "/api/v1/clients/2") return Response.json({ data: CLIENT_B, links: { self: p } });
      if (p === "/api/v1/contacts") return Response.json(page(CONTACTS, p));
      if (p === "/api/v1/users") return Response.json(page(USERS, p));
      if (p === "/api/v1/projects") {
        const cid = Number(q.get("client_id"));
        return Response.json(page([PROJECT_A, PROJECT_B].filter((pr) => pr.client_id === cid), p));
      }
      if (p === "/api/v1/projects/10") return Response.json({ data: PROJECT_A, links: { self: p } });
      if (p === "/api/v1/projects/20") return Response.json({ data: PROJECT_B, links: { self: p } });
      if (p === "/api/v1/reports/detailed-time") {
        let rows = DETAILED_ROWS;
        if (q.get("hours") === "uninvoiced") rows = rows.filter((r) => r.uninvoiced_billable_seconds > 0);
        if (q.get("project_id")) rows = rows.filter((r) => r.project_id === Number(q.get("project_id")));
        if (q.get("grain") !== "entry") {
          rows = rows.map(({ time_entry_id: _id, notes: _notes, ...rest }) => rest) as typeof rows;
        }
        return Response.json({ data: { rows, grain: q.get("grain") ?? "day" }, links: { self: p } });
      }
      if (p === "/api/v1/reports/uninvoiced") {
        // Alpha: one uninvoiced hour at 150.00 plus a 20.00 expense; Beta: half an hour, unpriced.
        let projects = [
          { client_id: 1, client_name: "Alpha Co", project_id: 10, project_name: "Alpha Build", project_code: "alpha",
            totals: [{ currency: "USD", rounded_seconds: 3600, time_entry_count: 1, unpriced_time_entry_count: 0, expense_count: 1, time_cents: 15000, expense_cents: 2000, total_cents: 17000 }] },
          { client_id: 2, client_name: "Beta Ltd", project_id: 20, project_name: "Beta Build", project_code: "beta",
            totals: [{ currency: "USD", rounded_seconds: 1800, time_entry_count: 1, unpriced_time_entry_count: 1, expense_count: 0, time_cents: 0, expense_cents: 0, total_cents: 0 }] },
        ];
        if (q.get("project_id")) projects = projects.filter((pr) => pr.project_id === Number(q.get("project_id")));
        return Response.json({ data: { from: q.get("from"), to: q.get("to"), client_id: null, project_id: null, totals: [], projects }, links: { self: p } });
      }
      if (p === "/api/v1/reports/time") {
        return Response.json({
          data: {
            projects: [
              { project_id: 10, project_name: "Alpha Build", client_id: 1, client_name: "Alpha Co", rounded_seconds: 10800, billable_seconds: 10800, amounts: [{ currency: "USD", billable_cents: 45000, uninvoiced_cents: 15000 }] },
              { project_id: 20, project_name: "Beta Build", client_id: 2, client_name: "Beta Ltd", rounded_seconds: 1800, billable_seconds: 1800, amounts: [] },
            ],
          },
          links: { self: p },
        });
      }
      return Response.json({ error: { code: "not_found", message: "no", fields: [] } }, { status: 404 });
    })
  );
  return state;
}

export function fakeKV(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

export function testEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    SESSIONS: fakeKV(),
    MAGIC_TOKENS: fakeKV(),
    RATE_LIMITS: fakeKV(),
    EZACTO_BASE_URL: BASE_URL,
    EZACTO_API_TOKEN: "ezacto_test",
    TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret",
    MAIL_FROM_ADDRESS: "portal@firm.example",
    CLOUDFLARE_API_TOKEN: "cf",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    ...overrides,
  };
}

// Mint a signed-in session directly in KV; returns the cookie header.
export async function signIn(
  env: Bindings,
  session: { email: string; contactName: string; clients: Array<{ id: number; name: string }>; isAdmin: boolean; v?: number }
): Promise<string> {
  const token = "sess-" + Math.random().toString(16).slice(2);
  await env.SESSIONS.put(`session:${token}`, JSON.stringify({ v: 2, ...session }));
  return `session=${token}`;
}

// ExecutionContext whose waitUntil work can be awaited by the test.
export function execCtx(): ExecutionContext & { settle(): Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    async settle() {
      await Promise.all(pending);
    },
  } as unknown as ExecutionContext & { settle(): Promise<void> };
}
