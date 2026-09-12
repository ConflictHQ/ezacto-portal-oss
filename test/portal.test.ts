import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { brandFromSources, brandImageOrigins, resetBrandCache } from "../src/brand";
import { getUninvoicedReport, getTimeEntries } from "../src/ezacto";
import { execCtx, installFakeFetch, signIn, testEnv, BASE_URL } from "./fixtures";
import type { Bindings } from "../src/index";

const ORIGIN = "https://portal.test";

function post(path: string, form: Record<string, string>): Request {
  return new Request(ORIGIN + path, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

// POST /login and wait for the background token + mail work to finish.
async function login(e: Bindings, email: string): Promise<Response> {
  const ctx = execCtx();
  const res = await app.request(post("/login", { email, "cf-turnstile-response": "ok" }), undefined, e, ctx);
  await ctx.settle();
  return res;
}

function get(path: string, cookie?: string): Request {
  return new Request(ORIGIN + path, { headers: cookie ? { Cookie: cookie } : {} });
}

let fake: ReturnType<typeof installFakeFetch>;
let env: Bindings;

beforeEach(() => {
  resetBrandCache();
  fake = installFakeFetch();
  env = testEnv();
});

afterEach(() => {
  fake.calls.length = 0;
});

describe("brand", () => {
  it("defaults to ezacto's Precision theme", () => {
    const b = brandFromSources({});
    expect(b.name).toBe("ezacto");
    expect(b.accent).toBe("#16794A");
    expect(b.theme.data).toBe("#2F5AE0");
    expect(b.theme.scheme).toBe("light");
    expect(b.theme.light).toMatchObject({ ground: "#FFFFFF", surface: "#F5F6F7", line: "#E3E5E8", ink: "#14161A", muted: "#676C74" });
    expect(b.theme.fontBody).toContain("IBM Plex Sans");
    expect(b.theme.fontStylesheet).toContain("fonts.googleapis.com");
    expect(b.logoUrl).toBeNull();
    expect(b.accentDark).not.toBe(b.accent);
    expect(b.accentLight).not.toBe(b.accent);
  });

  it("takes a dark palette and system font from vars, leaving the other scheme at the defaults", () => {
    const b = brandFromSources({ BRAND_SCHEME: "dark", BRAND_GROUND: "#1D1D1D", BRAND_SURFACE: "#282828", BRAND_INK: "#FFFFFF", BRAND_MUTED: "#A8A8A7", BRAND_LINE: "#3A3A3A", BRAND_FONT_BODY: "system-ui", BRAND_FONT_STYLESHEET: "", BRAND_DATA: "#DB394C" });
    expect(b.theme.scheme).toBe("dark");
    expect(b.theme.dark).toMatchObject({ ground: "#1D1D1D", surface: "#282828", ink: "#FFFFFF", muted: "#A8A8A7", line: "#3A3A3A" });
    expect(b.theme.dark.surface2).not.toBe("#282828");
    expect(b.theme.light.ground).toBe("#FFFFFF");
    expect(b.theme.fontBody).toBe("system-ui");
    expect(b.theme.fontStylesheet).toBeNull();
    expect(b.theme.data).toBe("#DB394C");
  });

  it("emits the palette as CSS variables, loads the font, and opens the CSP for it", async () => {
    const res = await app.request(get("/login"), undefined, env);
    const html = await res.text();
    expect(html).toContain(":root{--ground:#FFFFFF;--surface:#F5F6F7;");
    expect(html).toContain(".dark{--ground:#14161A;");
    expect(html).toContain('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans');
    expect(html).toContain("stored === 'dark' : false");
    expect(html).not.toMatch(/dark:(bg|text|border)-/);
    const csp = res.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("style-src 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");

    const dark = await app.request(get("/login"), undefined, testEnv({ BRAND_SCHEME: "dark", BRAND_FONT_STYLESHEET: "" }));
    const darkHtml = await dark.text();
    expect(darkHtml).toContain("stored === 'dark' : true");
    expect(darkHtml).not.toContain("fonts.googleapis.com");
    expect(dark.headers.get("Content-Security-Policy")).toContain("style-src 'unsafe-inline';");
  });

  it("takes BRAND_* overrides and rejects a malformed accent", () => {
    const b = brandFromSources({ BRAND_NAME: "Firm", BRAND_ACCENT: "red", BRAND_LOGO_URL: "https://cdn.firm.example/logo.svg" });
    expect(b.name).toBe("Firm");
    expect(b.accent).toBe("#16794A");
    expect(b.logoDarkUrl).toBe("https://cdn.firm.example/logo.svg");
    expect(brandImageOrigins(b)).toEqual(["https://cdn.firm.example"]);
    expect(brandImageOrigins(brandFromSources({ BRAND_LOGO_URL: "data:image/svg+xml,x" }))).toEqual([]);
  });

  it("takes the tenant's name and marks from ezacto, with vars overriding per field", async () => {
    const res = await app.request(get("/login"), undefined, env);
    const html = await res.text();
    expect(html).toContain("<title>Login - Northwind Partners</title>");
    expect(html).toContain(`src="${BASE_URL}/brand/wordmark-light/aa11"`);
    expect(html).toContain(`src="${BASE_URL}/brand/wordmark-dark/bb22"`);
    expect(res.headers.get("Content-Security-Policy")).toContain(`img-src 'self' data: ${BASE_URL}`);

    resetBrandCache();
    const overridden = await (await app.request(get("/login"), undefined, testEnv({ BRAND_NAME: "Firm", BRAND_LOGO_DARK_URL: "data:image/svg+xml,dark" }))).text();
    expect(overridden).toContain("<title>Login - Firm</title>");
    expect(overridden).toContain(`src="${BASE_URL}/brand/wordmark-light/aa11"`);
    expect(overridden).toContain('src="data:image/svg+xml,dark"');
  });

  it("caches the brand lookup and falls back to vars when ezacto cannot answer it", async () => {
    await app.request(get("/login"), undefined, env);
    await app.request(get("/login"), undefined, env);
    expect(fake.calls.filter((u) => u.pathname === "/api/v1/brand")).toHaveLength(1);

    resetBrandCache();
    fake.brandDown = true;
    const res = await app.request(get("/login"), undefined, testEnv({ BRAND_NAME: "Firm" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>Login - Firm</title>");
  });

  it("renders the brand name, logo and accent into the page and the CSP", async () => {
    const res = await app.request(get("/login"), undefined, testEnv({ BRAND_NAME: "Firm", BRAND_ACCENT: "#112233", BRAND_LOGO_URL: "https://cdn.firm.example/logo.svg" }));
    const html = await res.text();
    expect(html).toContain("<title>Login - Firm</title>");
    expect(html).toContain("'#112233'");
    expect(html).toContain('src="https://cdn.firm.example/logo.svg"');
    expect(res.headers.get("Content-Security-Policy")).toContain("img-src 'self' data: https://cdn.firm.example");
  });
});

describe("ezacto data layer", () => {
  const config = { baseUrl: BASE_URL, token: "t" };

  it("reads the per-project uninvoiced rollup ezacto prices, with total hours from the time report", async () => {
    const rows = await getUninvoicedReport(config, "2026-03-01", "2026-03-31");
    const alpha = rows.find((r) => r.project_id === 10)!;
    expect(alpha).toMatchObject({ client_name: "Alpha Co", project_name: "Alpha Build", currency: "USD" });
    expect(alpha.total_hours).toBe(3);
    expect(alpha.uninvoiced_hours).toBe(1);
    expect(alpha.uninvoiced_expenses).toBe(20);
    expect(alpha.uninvoiced_amount).toBe(170);
    const beta = rows.find((r) => r.project_id === 20)!;
    expect(beta.uninvoiced_hours).toBe(0.5);
    expect(beta.uninvoiced_amount).toBe(0);
    expect(fake.calls.map((u) => u.pathname).sort()).toEqual(["/api/v1/reports/time", "/api/v1/reports/uninvoiced"]);
  });

  it("reads entries at entry grain with ids and notes, and sends the bearer token", async () => {
    const entries = await getTimeEntries(config, 10, "2026-03-01", "2026-03-31");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: 1001, notes: "kickoff and scoping", hours: 2, is_billed: true, billable_rate: 150, user: { name: "Mia Member" }, task: { name: "Dev" } });
    expect(entries[1]).toMatchObject({ id: 1002, notes: null, hours: 1, is_billed: false, billable_rate: 150 });
    expect(fake.calls[0]!.searchParams.get("grain")).toBe("entry");
    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer t" });
  });
});

describe("login", () => {
  it("scopes a contact to their own active client and emails a link", async () => {
    const res = await login(env, "Ann@Alpha.example");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Check your email");
    const tokens = Array.from(env.MAGIC_TOKENS.store.values()).map((v) => JSON.parse(v));
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ v: 2, email: "ann@alpha.example", isAdmin: false, clients: [{ id: 1, name: "Alpha Co" }] });
    expect(fake.mail).toHaveLength(1);
    expect(fake.mail[0]).toMatchObject({ from: { address: "portal@firm.example", name: "Northwind Partners Client Portal" }, to: ["ann@alpha.example"] });
  });

  it("gives firm staff every active client, but not a plain member", async () => {
    await login(env, "sam@firm.example");
    const staff = Array.from(env.MAGIC_TOKENS.store.values()).map((v) => JSON.parse(v));
    expect(staff[0]).toMatchObject({ isAdmin: true, contactName: "Sam Staff" });
    expect(staff[0].clients.map((c: { id: number }) => c.id)).toEqual([1, 2]);

    const member = testEnv();
    await login(member, "mia@firm.example");
    expect(member.MAGIC_TOKENS.store.size).toBe(0);
  });

  it("issues nothing for an inactive client's contact or an unknown email, without revealing which", async () => {
    for (const email of ["old@gone.example", "nobody@example.com"]) {
      const e = testEnv();
      const res = await login(e, email);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Check your email");
      expect(e.MAGIC_TOKENS.store.size).toBe(0);
    }
  });

  it("returns an error page, not a crash, when ezacto is unreachable", async () => {
    fake.down = true;
    const res = await login(env, "ann@alpha.example");
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("Login Unavailable");
  });

  it("rejects a cross-origin POST", async () => {
    const req = new Request(ORIGIN + "/login", { method: "POST", headers: { Origin: "https://evil.test" }, body: "email=x" });
    expect((await app.request(req, undefined, env)).status).toBe(403);
  });
});

describe("sessions", () => {
  it("redirects without a session and treats a pre-ezacto session as signed out", async () => {
    expect((await app.request(get("/uninvoiced"), undefined, env)).status).toBe(302);
    const old = await signIn(env, { v: 1, email: "ann@alpha.example", contactName: "Ann", clients: [{ id: 1, name: "Alpha Co" }], isAdmin: false });
    const res = await app.request(get("/uninvoiced", old), undefined, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("logs out by deleting the session", async () => {
    const cookie = await signIn(env, { email: "ann@alpha.example", contactName: "Ann", clients: [{ id: 1, name: "Alpha Co" }], isAdmin: false });
    await app.request(get("/auth/logout", cookie), undefined, env);
    expect(env.SESSIONS.store.size).toBe(0);
  });
});

describe("client isolation", () => {
  let ann: string;
  beforeEach(async () => {
    ann = await signIn(env, { email: "ann@alpha.example", contactName: "Ann", clients: [{ id: 1, name: "Alpha Co" }], isAdmin: false });
  });

  it("shows only the session client's projects on the uninvoiced and dashboard pages", async () => {
    const uninvoiced = await (await app.request(get("/uninvoiced?from=2026-03-01&to=2026-03-31", ann), undefined, env)).text();
    expect(uninvoiced).toContain("Alpha Build");
    expect(uninvoiced).not.toContain("Beta");

    const dashboard = await (await app.request(get("/clients?from=2026-03-01&to=2026-03-31", ann), undefined, env)).text();
    expect(dashboard).toContain("Alpha Co");
    expect(dashboard).not.toContain("Beta");
  });

  it("404s another client's project even with a valid session", async () => {
    const mine = await app.request(get("/projects/10?from=2026-03-01&to=2026-03-31", ann), undefined, env);
    expect(mine.status).toBe(200);
    const mineHtml = await mine.text();
    expect(mineHtml).toContain("Alpha Build");
    expect(mineHtml).toContain("kickoff and scoping");

    const theirs = await app.request(get("/projects/20?from=2026-03-01&to=2026-03-31", ann), undefined, env);
    expect(theirs.status).toBe(404);
    expect(await theirs.text()).not.toContain("Beta Build");
  });

  it("only fetches entries for the session client's projects on the detailed page", async () => {
    const detailed = await (await app.request(get("/detailed?from=2026-03-01&to=2026-03-31", ann), undefined, env)).text();
    expect(detailed).toContain("Mia Member");
    expect(detailed).not.toContain("Beta");
    const projectIds = fake.calls
      .filter((u) => u.pathname === "/api/v1/reports/detailed-time")
      .map((u) => u.searchParams.get("project_id"));
    expect(projectIds).toEqual(["10"]);
  });
});

describe("demo deployment", () => {
  const demoEnv = (over: Partial<Bindings> = {}) =>
    testEnv({ EZACTO_API_TOKEN: undefined, DEMO_SIGN_IN_EMAIL: "admin@demo.example", DEMO_SIGN_IN_PASSWORD: "demo-pass", DEMO_CLIENT_ID: "2", ...over });

  it("mints its own token from the demo account, caches it, and re-mints after the instance is rebuilt", async () => {
    const e = demoEnv();
    const first = await app.request(get("/login"), undefined, e);
    expect(first.status).toBe(200);
    expect(fake.minted).toBe(1);
    expect(fake.signIns).toEqual([{ email: "admin@demo.example", password: "demo-pass" }]);
    expect(e.SESSIONS.store.get("demo:api-token")).toBe("ezacto_minted_1");

    await app.request(get("/login"), undefined, e);
    expect(fake.minted).toBe(1);

    // Nightly rebuild: every token gone. The next data call re-mints once and succeeds.
    fake.validTokens.clear();
    resetBrandCache();
    const ann = await signIn(e, { email: "ann@alpha.example", contactName: "Ann", clients: [{ id: 1, name: "Alpha Co" }], isAdmin: false });
    const res = await app.request(get("/uninvoiced?from=2026-03-01&to=2026-03-31", ann), undefined, e);
    expect(res.status).toBe(200);
    expect(fake.minted).toBe(2);
    expect(e.SESSIONS.store.get("demo:api-token")).toBe("ezacto_minted_2");
  });

  it("offers a demo door that seats a visitor on the demo client only", async () => {
    const e = demoEnv();
    const login = await (await app.request(get("/login"), undefined, e)).text();
    expect(login).toContain("View the demo");
    expect(login).toContain('action="/demo"');

    const res = await app.request(post("/demo", {}), undefined, e);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
    const session = JSON.parse([...e.SESSIONS.store.entries()].find(([k]) => k.startsWith("session:"))![1]);
    expect(session).toMatchObject({ v: 2, isAdmin: false, clients: [{ id: 2, name: "Beta Ltd" }] });

    const page = await (await app.request(get("/clients?from=2026-03-01&to=2026-03-31", cookie), undefined, e)).text();
    expect(page).toContain("Beta Ltd");
    expect(page).not.toContain("Alpha");
    expect((await app.request(get("/projects/10?from=2026-03-01&to=2026-03-31", cookie), undefined, e)).status).toBe(404);
  });

  it("has no demo door and no self-minting on a normal deployment", async () => {
    const login = await (await app.request(get("/login"), undefined, env)).text();
    expect(login).not.toContain("View the demo");
    expect((await app.request(post("/demo", {}), undefined, env)).status).toBe(404);
    expect(fake.minted).toBe(0);
  });
});

describe("mail", () => {
  it("sends through Mailgun when a domain and key are configured, else Cloudflare", async () => {
    const mg = testEnv({ MAILGUN_DOMAIN: "go.example", MAILGUN_REGION: "us", MAILGUN_API_KEY: "key-1", MAIL_FROM_NAME: "Portal" });
    await login(mg, "ann@alpha.example");
    expect(fake.mailgun).toHaveLength(1);
    expect(fake.mailgun[0]).toMatchObject({ from: "Portal <portal@firm.example>", to: "ann@alpha.example", subject: "Your login link" });
    expect(fake.mailgun[0]!.html).toContain("/auth/verify?token=");
    expect(fake.mail).toHaveLength(0);

    await login(testEnv(), "ann@alpha.example");
    expect(fake.mail).toHaveLength(1);
    expect(fake.mailgun).toHaveLength(1);
  });
});
