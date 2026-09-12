import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  getContacts,
  getActiveClients,
  getProjectTimeReport,
  getClientProjects,
  getProjectById,
  getTimeEntries,
  getUninvoicedTimeEntries,
  getUninvoicedReport,
  getStaffUserByEmail,
  getClientById,
  mintToken,
} from "./ezacto";
import type { EzactoConfig, ProjectReport } from "./ezacto";
import { sendMail } from "./mail";
import type { MailEnv } from "./mail";
import { brandFontOrigins, brandImageOrigins, resolveBrand } from "./brand";
import type { Brand, BrandEnv } from "./brand";
import {
  loginPage,
  checkEmailPage,
  verifyPage,
  dashboardPage,
  projectPage,
  uninvoicedPage,
  detailedPage,
  errorPage,
} from "./templates";

export type Bindings = BrandEnv &
  MailEnv & {
    SESSIONS: KVNamespace;
    MAGIC_TOKENS: KVNamespace;
    RATE_LIMITS: KVNamespace;
    EZACTO_BASE_URL: string;
    // A read-only token for the instance, or absent on a demo deployment that
    // mints its own from the published demo account (DEMO_SIGN_IN_*).
    EZACTO_API_TOKEN?: string;
    DEMO_SIGN_IN_EMAIL?: string;
    DEMO_SIGN_IN_PASSWORD?: string;
    // Set on a demo deployment: the one client "View the demo" signs into.
    DEMO_CLIENT_ID?: string;
    TURNSTILE_SITE_KEY: string;
    TURNSTILE_SECRET_KEY: string;
  };

// Client ids changed when the book moved from Harvest to ezacto; sessions
// minted before that carry the old ids and are treated as signed out.
const SESSION_VERSION = 2;

type SessionData = {
  v: number;
  email: string;
  contactName: string;
  clients: Array<{ id: number; name: string }>;
  isAdmin: boolean;
};

type Variables = {
  session: SessionData;
  brand: Brand;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const DEMO_TOKEN_KEY = "demo:api-token";

async function ezacto(env: Bindings): Promise<EzactoConfig> {
  if (env.EZACTO_API_TOKEN) {
    return { baseUrl: env.EZACTO_BASE_URL, token: env.EZACTO_API_TOKEN };
  }
  const email = env.DEMO_SIGN_IN_EMAIL;
  const password = env.DEMO_SIGN_IN_PASSWORD;
  if (!email || !password) {
    throw new Error("EZACTO_API_TOKEN or DEMO_SIGN_IN_EMAIL/PASSWORD must be set");
  }
  const refresh = async () => {
    const token = await mintToken(env.EZACTO_BASE_URL, email, password, "ezacto-portal demo");
    await env.SESSIONS.put(DEMO_TOKEN_KEY, token);
    return token;
  };
  const token = (await env.SESSIONS.get(DEMO_TOKEN_KEY)) ?? (await refresh());
  return { baseUrl: env.EZACTO_BASE_URL, token, refresh };
}

function demoClientId(env: Bindings): number | null {
  const id = Number(env.DEMO_CLIENT_ID);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return {
    from: `${year}-01-01`,
    to: `${year}-${month}-${day}`,
  };
}

// Brand + security headers middleware — all routes
app.use("*", async (c, next) => {
  const brand = await resolveBrand(c.env, await ezacto(c.env));
  c.set("brand", brand);
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains"
  );
  c.res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src https://challenges.cloudflare.com https://cdn.tailwindcss.com https://cdn.jsdelivr.net 'unsafe-inline'",
      "frame-src https://challenges.cloudflare.com",
      `style-src 'unsafe-inline' ${brandFontOrigins(brand).style.join(" ")}`.trimEnd(),
      `font-src 'self' ${brandFontOrigins(brand).font.join(" ")}`.trimEnd(),
      "connect-src 'self'",
      `img-src 'self' data: ${brandImageOrigins(brand).join(" ")}`.trimEnd(),
    ].join("; ")
  );
});

// CSRF middleware — POST routes only
app.use("*", async (c, next) => {
  if (c.req.method === "POST") {
    const origin = c.req.header("Origin");
    const requestUrl = new URL(c.req.url);
    const expectedOrigin = `${requestUrl.protocol}//${requestUrl.host}`;
    if (!origin || origin !== expectedOrigin) {
      return c.text("Forbidden", 403);
    }
  }
  await next();
});

// Auth middleware — skip login, auth/verify, auth/logout
const PUBLIC_PATHS = ["/login", "/auth/verify", "/auth/logout", "/demo"];

app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (PUBLIC_PATHS.includes(path)) {
    return next();
  }

  const sessionToken = getCookie(c, "session");
  if (!sessionToken) {
    return c.redirect("/login");
  }

  const sessionRaw = await c.env.SESSIONS.get(`session:${sessionToken}`);
  if (!sessionRaw) {
    return c.redirect("/login");
  }

  const sessionData = JSON.parse(sessionRaw) as SessionData;
  if (sessionData.v !== SESSION_VERSION) {
    return c.redirect("/login");
  }
  c.set("session", sessionData);
  return next();
});

// GET /login
app.get("/login", async (c) => {
  const sessionToken = getCookie(c, "session");
  if (sessionToken) {
    const existing = await c.env.SESSIONS.get(`session:${sessionToken}`);
    if (existing) {
      return c.redirect("/uninvoiced");
    }
  }
  return c.html(loginPage(c.get("brand"), c.env.TURNSTILE_SITE_KEY, undefined, undefined, demoClientId(c.env) !== null));
});

// POST /demo — a read-only visitor session on the demo client. Only where a
// deployment names one; elsewhere the route does not exist.
app.post("/demo", async (c) => {
  const clientId = demoClientId(c.env);
  if (clientId === null) return c.notFound();
  const client = await getClientById(await ezacto(c.env), clientId);
  const sessionToken = generateToken();
  const session: SessionData = {
    v: SESSION_VERSION,
    email: "demo@example.invalid",
    contactName: "Demo visitor",
    clients: [{ id: client.id, name: client.name }],
    isAdmin: false,
  };
  await c.env.SESSIONS.put(`session:${sessionToken}`, JSON.stringify(session), {
    expirationTtl: 3600,
  });
  setCookie(c, "session", sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 3600,
  });
  return c.redirect("/");
});

// POST /login
app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const email = (body["email"] as string || "").trim().toLowerCase();
  const turnstileToken = body["cf-turnstile-response"] as string || "";

  // Verify Turnstile
  const turnstileResp = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: c.env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
      }),
    }
  );
  const turnstileResult = (await turnstileResp.json()) as { success: boolean; "error-codes"?: string[] };
  if (!turnstileResult.success) {
    console.error("[/login] Turnstile failed:", JSON.stringify(turnstileResult));
    return c.html(
      loginPage(c.get("brand"), c.env.TURNSTILE_SITE_KEY, "Verification failed. Please try again.")
    );
  }

  // Rate limiting
  const rateLimitKey = `rate:${email}`;
  const rateLimitRaw = await c.env.RATE_LIMITS.get(rateLimitKey);
  const currentCount = rateLimitRaw ? parseInt(rateLimitRaw, 10) : 0;
  if (currentCount >= 5) {
    console.warn(`[/login] rate-limited: ${email} (count=${currentCount})`);
    return c.html(
      loginPage(
        c.get("brand"),
        c.env.TURNSTILE_SITE_KEY,
        "Too many requests. Try again later."
      )
    );
  }
  await c.env.RATE_LIMITS.put(rateLimitKey, String(currentCount + 1), {
    expirationTtl: 3600,
  });

  let isAdmin = false;
  let contactName = "";
  let clients: Array<{ id: number; name: string }> = [];
  let found = false;

  try {
    const api = await ezacto(c.env);
    const [activeClients, staff] = await Promise.all([
      getActiveClients(api),
      getStaffUserByEmail(api, email),
    ]);

    if (staff) {
      // Firm staff (ezacto administrators and executive managers) see every active client
      isAdmin = true;
      contactName = staff.name;
      clients = activeClients.map((cl) => ({ id: cl.id, name: cl.name }));
      found = true;
    } else {
      // External contacts only see their own client
      const contacts = await getContacts(api);
      const activeClientIds = new Set(activeClients.map((cl) => cl.id));
      const matched = contacts.filter(
        (contact) =>
          contact.email.toLowerCase() === email &&
          activeClientIds.has(contact.client.id)
      );
      if (matched.length > 0) {
        contactName = `${matched[0].first_name} ${matched[0].last_name}`.trim();
        const clientMap = new Map<number, { id: number; name: string }>();
        for (const contact of matched) {
          if (!clientMap.has(contact.client.id)) {
            clientMap.set(contact.client.id, {
              id: contact.client.id,
              name: contact.client.name,
            });
          }
        }
        clients = Array.from(clientMap.values());
        found = true;
      }
    }
  } catch (err) {
    console.error("[/login] lookup failed:", err);
    return c.html(
      errorPage(c.get("brand"), "Login Unavailable", "The portal could not reach its data source. Please try again later."),
      502
    );
  }

  if (!found) {
    console.warn(`[/login] email not found in ezacto contacts: ${email}`);
  }

  if (found) {
    const token = generateToken();
    const tokenData = JSON.stringify({ v: SESSION_VERSION, email, contactName, clients, isAdmin });
    const origin = new URL(c.req.url).origin;
    const magicLink = `${origin}/auth/verify?token=${token}`;
    const escapedName = contactName
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    c.executionCtx.waitUntil(
      (async () => {
        await c.env.MAGIC_TOKENS.put(token, tokenData, { expirationTtl: 900 });
        try {
          await sendMail(c.env, `${c.get("brand").name} Client Portal`, {
            to: email,
            subject: "Your login link",
            html: `<p>Hi ${escapedName},</p><p>Click the link below to access your project dashboard:</p><p><a href="${magicLink}">${magicLink}</a></p><p>This link expires in 15 minutes.</p><p>If you didn't request this, you can safely ignore this email.</p>`,
          });
          console.log(`[/login] email sent OK to ${email}`);
        } catch (err) {
          console.error(`[/login] email send failed for ${email}:`, err);
        }
      })()
    );
  }

  return c.html(checkEmailPage(c.get("brand")));
});

// GET /auth/verify — show confirmation page (email scanners hit this but can't POST)
app.get("/auth/verify", async (c) => {
  const token = c.req.query("token");
  if (!token) {
    return c.html(errorPage(c.get("brand"), "Invalid Link", "This link is invalid or has expired."), 400);
  }

  const tokenDataRaw = await c.env.MAGIC_TOKENS.get(token);
  if (!tokenDataRaw) {
    return c.html(errorPage(c.get("brand"), "Invalid Link", "This link is invalid or has expired."), 400);
  }

  return c.html(verifyPage(c.get("brand"), token));
});

// POST /auth/verify — actually consume the token and create a session
app.post("/auth/verify", async (c) => {
  const body = await c.req.parseBody();
  const token = body["token"] as string || "";
  if (!token) {
    return c.html(errorPage(c.get("brand"), "Invalid Link", "This link is invalid or has expired."), 400);
  }

  const tokenDataRaw = await c.env.MAGIC_TOKENS.get(token);
  if (!tokenDataRaw) {
    return c.html(errorPage(c.get("brand"), "Invalid Link", "This link is invalid or has expired."), 400);
  }

  await c.env.MAGIC_TOKENS.delete(token);

  const tokenData = JSON.parse(tokenDataRaw) as SessionData;
  const sessionToken = generateToken();

  await c.env.SESSIONS.put(
    `session:${sessionToken}`,
    JSON.stringify(tokenData),
    { expirationTtl: 604800 }
  );

  setCookie(c, "session", sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 604800,
  });

  return c.redirect("/");
});

// GET /auth/logout
app.get("/auth/logout", async (c) => {
  const sessionToken = getCookie(c, "session");
  if (sessionToken) {
    await c.env.SESSIONS.delete(`session:${sessionToken}`);
  }

  setCookie(c, "session", "", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });

  return c.redirect("/login");
});

// GET / → redirect to uninvoiced
app.get("/", (c) => {
  return c.redirect("/uninvoiced");
});

// GET /clients (dashboard, requires auth)
app.get("/clients", async (c) => {
  const session = c.get("session");
  const defaults = defaultDateRange();
  const from = c.req.query("from") || defaults.from;
  const to = c.req.query("to") || defaults.to;

  try {
    const api = await ezacto(c.env);
    const sessionClientIds = new Set(session.clients.map((cl) => cl.id));

    // Fetch project time reports and active projects for each client in parallel
    const projectReportsPromise = getProjectTimeReport(api, from, to);
    const clientProjectsPromises = session.clients.map((cl) =>
      getClientProjects(api, cl.id)
    );

    const [allProjectReports, ...clientProjectLists] = await Promise.all([
      projectReportsPromise,
      ...clientProjectsPromises,
    ]);

    // Filter reports to only this session's clients
    const projectReports = allProjectReports.filter((pr) =>
      sessionClientIds.has(pr.client_id)
    );

    // Build project code map from fetched projects
    const projectCodeMap = new Map<number, string>();
    for (const projects of clientProjectLists) {
      for (const p of projects) {
        if (p.code) {
          projectCodeMap.set(p.id, p.code);
        }
      }
    }

    // Build client groups from the session's clients
    const clientGroupMap = new Map<
      number,
      {
        clientId: number;
        clientName: string;
        totalHours: number;
        billableHours: number;
        billableAmount: number;
        currency: string;
        projects: ProjectReport[];
      }
    >();

    for (const cl of session.clients) {
      clientGroupMap.set(cl.id, {
        clientId: cl.id,
        clientName: cl.name,
        totalHours: 0,
        billableHours: 0,
        billableAmount: 0,
        currency: "USD",
        projects: [],
      });
    }

    for (const pr of projectReports) {
      const group = clientGroupMap.get(pr.client_id);
      if (group) {
        group.projects.push(pr);
        group.totalHours += pr.total_hours;
        group.billableHours += pr.billable_hours;
        group.billableAmount += pr.billable_amount;
        if (pr.currency) {
          group.currency = pr.currency;
        }
      }
    }

    const clientGroups = Array.from(clientGroupMap.values()).sort((a, b) =>
      a.clientName.localeCompare(b.clientName)
    );

    return c.html(dashboardPage(c.get("brand"), session, clientGroups, projectCodeMap, from, to));
  } catch (err) {
    console.error("[/clients]", err);
    const message = "An unexpected error occurred. Please try again later.";
    return c.html(errorPage(c.get("brand"), "Failed to load dashboard", message), 500);
  }
});

// GET /uninvoiced (requires auth)
app.get("/uninvoiced", async (c) => {
  const session = c.get("session");
  const defaults = defaultDateRange();
  const from = c.req.query("from") || defaults.from;
  const to = c.req.query("to") || defaults.to;

  try {
    const sessionClientIds = new Set(session.clients.map((cl) => cl.id));

    const allResults = await getUninvoicedReport(await ezacto(c.env), from, to);
    const results = allResults.filter((r) => sessionClientIds.has(r.client_id));

    return c.html(uninvoicedPage(c.get("brand"), session, results, from, to));
  } catch (err) {
    console.error("[/uninvoiced]", err);
    const message = "An unexpected error occurred. Please try again later.";
    return c.html(errorPage(c.get("brand"), "Failed to load uninvoiced report", message), 500);
  }
});

// GET /detailed (requires auth)
app.get("/detailed", async (c) => {
  const session = c.get("session");
  const defaults = defaultDateRange();
  const from = c.req.query("from") || defaults.from;
  const to = c.req.query("to") || defaults.to;
  const api = await ezacto(c.env);

  try {
    // Fetch time entries for all of session's clients' projects
    const clientProjectPromises = session.clients.map((cl) =>
      getClientProjects(api, cl.id)
    );
    const clientProjectLists = await Promise.all(clientProjectPromises);
    const allProjects = clientProjectLists.flat();

    // Fetch time entries for all projects in parallel
    const entryPromises = allProjects.map((p) =>
      getTimeEntries(api, p.id, from, to)
    );
    const entryLists = await Promise.all(entryPromises);
    const allEntries = entryLists
      .flat()
      .sort((a, b) => b.spent_date.localeCompare(a.spent_date));

    return c.html(detailedPage(c.get("brand"), session, allEntries, from, to));
  } catch (err) {
    console.error("[/detailed]", err);
    const message = "An unexpected error occurred. Please try again later.";
    return c.html(errorPage(c.get("brand"), "Failed to load detailed report", message), 500);
  }
});

// GET /projects/:id (requires auth)
app.get("/projects/:id", async (c) => {
  const session = c.get("session");
  const projectId = Number(c.req.param("id"));
  if (isNaN(projectId)) {
    return c.html(
      errorPage(c.get("brand"), "Invalid Project", "Project ID must be a number."),
      400
    );
  }

  const defaults = defaultDateRange();
  const from = c.req.query("from") || defaults.from;
  const to = c.req.query("to") || defaults.to;
  const api = await ezacto(c.env);

  try {
    const project = await getProjectById(api, projectId);
    if (!project) {
      return c.html(
        errorPage(c.get("brand"), "Not Found", "The requested project could not be found."),
        404
      );
    }

    const sessionClientIds = new Set(session.clients.map((cl) => cl.id));
    if (!sessionClientIds.has(project.client.id)) {
      return c.html(
        errorPage(c.get("brand"), "Not Found", "The requested project could not be found."),
        404
      );
    }

    const [timeEntries, uninvoicedPrior] = await Promise.all([
      getTimeEntries(api, projectId, from, to),
      getUninvoicedTimeEntries(api, projectId, from),
    ]);

    const totalHours = timeEntries.reduce((sum, e) => sum + e.hours, 0);
    const billableHours = timeEntries
      .filter((e) => e.billable)
      .reduce((sum, e) => sum + e.hours, 0);
    const billableAmount = timeEntries
      .filter((e) => e.billable && e.billable_rate)
      .reduce((sum, e) => sum + e.hours * (e.billable_rate ?? 0), 0);

    const uninvoicedHours = uninvoicedPrior
      .filter((e) => e.billable)
      .reduce((sum, e) => sum + e.hours, 0);
    const uninvoicedAmount = uninvoicedPrior
      .filter((e) => e.billable && e.billable_rate)
      .reduce((sum, e) => sum + e.hours * (e.billable_rate ?? 0), 0);

    return c.html(
      projectPage(
        c.get("brand"),
        session,
        project,
        timeEntries,
        { totalHours, billableHours, billableAmount },
        { hours: uninvoicedHours, amount: uninvoicedAmount },
        from,
        to
      )
    );
  } catch (err) {
    console.error("[/projects/:id]", err);
    const message = "An unexpected error occurred. Please try again later.";
    return c.html(errorPage(c.get("brand"), "Failed to load project", message), 500);
  }
});

export default app;
