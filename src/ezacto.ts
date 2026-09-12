// Native ezacto /api/v1 client. Exposes the same shapes the templates were
// written against under Harvest, so the pages did not have to change.

export interface Client {
  id: number;
  name: string;
  is_active: boolean;
  currency: string;
}

export interface Project {
  id: number;
  name: string;
  code: string;
  client: { id: number; name: string };
  is_billable: boolean;
  budget: number | null;
  budget_by: string;
  budget_is_monthly: boolean;
  starts_on: string | null;
  ends_on: string | null;
}

export interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  client: { id: number; name: string };
}

export interface ProjectReport {
  project_id: number;
  project_name: string;
  client_id: number;
  client_name: string;
  total_hours: number;
  billable_hours: number;
  billable_amount: number;
  currency: string;
}

export interface UninvoicedReport {
  client_id: number;
  client_name: string;
  project_id: number;
  project_name: string;
  currency: string;
  total_hours: number;
  uninvoiced_hours: number;
  uninvoiced_expenses: number;
  uninvoiced_amount: number;
}

export interface TimeEntry {
  id: number;
  spent_date: string;
  hours: number;
  rounded_hours: number;
  notes: string | null;
  user: { id: number; name: string };
  task: { id: number; name: string };
  project: { id: number; name: string };
  client: { id: number; name: string };
  is_billed: boolean;
  billable: boolean;
  billable_rate: number | null;
}

export interface EzactoConfig {
  baseUrl: string;
  token: string;
  // Present when the token was self-minted (demo): a 401 means the instance
  // was rebuilt underneath us, so mint again and retry the call once.
  refresh?: () => Promise<string>;
}

// The read-only scopes this portal needs; also what a self-minted token asks for.
export const PORTAL_SCOPES = [
  "clients:read",
  "projects:read",
  "reports:read",
  "team:read",
  "invoices:read",
  "time_entries:read",
] as const;

// Raw /api/v1 records, only the fields this portal reads.

interface ApiClient {
  id: number;
  name: string;
  is_active: boolean;
  currency: string;
}

interface ApiContact {
  id: number;
  client_id: number;
  first_name: string;
  last_name: string | null;
  email: string | null;
}

interface ApiProject {
  id: number;
  client_id: number;
  name: string;
  code: string;
  billing_method: string;
  budget_by: string;
  budget_seconds: number | null;
  budget_is_monthly: boolean;
  starts_on: string | null;
  ends_on: string | null;
}

interface ApiUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  profile: string;
}

interface ApiPage<T> {
  data: T[];
  links: { self: string; next: string | null };
}

interface ApiTimeReportProjectRow {
  project_id: number;
  project_name: string;
  client_id: number;
  client_name: string;
  rounded_seconds: number;
  billable_seconds: number;
  amounts?: Array<{ currency: string; billable_cents: number; uninvoiced_cents: number }>;
}

interface ApiDetailedTimeRow {
  // Present at grain=entry, which is the only grain this portal asks for.
  time_entry_id: number;
  notes: string | null;
  spent_date: string;
  client_id: number;
  client_name: string;
  project_id: number;
  project_name: string;
  task_id: number;
  task_name: string;
  user_id: number;
  user_name: string;
  currency: string;
  rounded_seconds: number;
  billable_seconds: number;
  uninvoiced_billable_seconds: number;
  // Omitted by the API unless the token may see money.
  billable_amount_cents?: number | null;
}

const hours = (seconds: number): number => seconds / 3600;
const dollars = (cents: number): number => cents / 100;

async function apiGet<T>(
  config: EzactoConfig,
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(path, config.baseUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const get = (token: string) =>
    fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "ezacto-portal",
      },
    });
  let response = await get(config.token);
  if (response.status === 401 && config.refresh) {
    config.token = await config.refresh();
    response = await get(config.token);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ezacto API error ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

// Sign in with a password account and mint a read-only token. The demo
// instance publishes its sign-in and rebuilds nightly, which deletes every
// token; this is how the demo portal gets one back without a redeploy.
export async function mintToken(
  baseUrl: string,
  email: string,
  password: string,
  name: string
): Promise<string> {
  const origin = new URL(baseUrl).origin;
  const signIn = await fetch(new URL("/auth/sign-in", baseUrl).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "User-Agent": "ezacto-portal" },
    body: JSON.stringify({ email, password }),
  });
  if (!signIn.ok) throw new Error(`ezacto sign-in failed: ${signIn.status}`);
  const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("ezacto sign-in set no session cookie");

  const minted = await fetch(new URL("/api/v1/api-tokens", baseUrl).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
      "User-Agent": "ezacto-portal",
    },
    body: JSON.stringify({ name, scopes: PORTAL_SCOPES }),
  });
  if (!minted.ok) throw new Error(`ezacto token mint failed: ${minted.status}`);
  const body = (await minted.json()) as { data: { token: string } };
  return body.data.token;
}

async function apiGetAll<T>(
  config: EzactoConfig,
  path: string,
  params?: Record<string, string>
): Promise<T[]> {
  const all: T[] = [];
  let page = await apiGet<ApiPage<T>>(config, path, { ...params, per_page: "200" });
  all.push(...page.data);
  while (page.links.next) {
    page = await apiGet<ApiPage<T>>(config, page.links.next);
    all.push(...page.data);
  }
  return all;
}

export async function getClientById(config: EzactoConfig, clientId: number): Promise<ApiClient> {
  return (await apiGet<{ data: ApiClient }>(config, `/api/v1/clients/${clientId}`)).data;
}

function toProject(p: ApiProject, client: { id: number; name: string }): Project {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    client,
    is_billable: p.billing_method !== "non_billable",
    budget: p.budget_by === "project" && p.budget_seconds !== null ? hours(p.budget_seconds) : null,
    budget_by: p.budget_by,
    budget_is_monthly: p.budget_is_monthly,
    starts_on: p.starts_on,
    ends_on: p.ends_on,
  };
}

async function detailedTime(
  config: EzactoConfig,
  params: Record<string, string>
): Promise<ApiDetailedTimeRow[]> {
  const report = await apiGet<{ data: { rows: ApiDetailedTimeRow[] } }>(
    config,
    "/api/v1/reports/detailed-time",
    params
  );
  return report.data.rows;
}

// The v1 time-entries list only ever returns the acting user's own rows, so
// per-project entries come from the detailed time report at entry grain.
async function timeEntriesFor(
  config: EzactoConfig,
  projectId: number,
  params: Record<string, string>
): Promise<TimeEntry[]> {
  const rows = await detailedTime(config, {
    ...params,
    project_id: String(projectId),
    grain: "entry",
  });
  return rows.map((row) => {
    const billable = row.billable_seconds > 0;
    const rowHours = hours(row.rounded_seconds);
    const amount = row.billable_amount_cents;
    return {
      id: row.time_entry_id,
      spent_date: row.spent_date,
      hours: rowHours,
      rounded_hours: rowHours,
      notes: row.notes,
      user: { id: row.user_id, name: row.user_name },
      task: { id: row.task_id, name: row.task_name },
      project: { id: row.project_id, name: row.project_name },
      client: { id: row.client_id, name: row.client_name },
      is_billed: billable && row.uninvoiced_billable_seconds === 0,
      billable,
      billable_rate: billable && amount != null && rowHours > 0 ? dollars(amount) / rowHours : null,
    };
  });
}

export async function getContacts(config: EzactoConfig): Promise<Contact[]> {
  const [contacts, clients] = await Promise.all([
    apiGetAll<ApiContact>(config, "/api/v1/contacts"),
    apiGetAll<ApiClient>(config, "/api/v1/clients"),
  ]);
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));
  return contacts
    .filter((c) => c.email)
    .map((c) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name ?? "",
      email: c.email as string,
      client: { id: c.client_id, name: clientNames.get(c.client_id) ?? "" },
    }));
}

// Firm staff sign in with their ezacto user email. Only profiles that can
// already see every client's money in ezacto get the all-clients view here.
const STAFF_PROFILES = new Set(["administrator", "executive_manager"]);

export async function getStaffUserByEmail(
  config: EzactoConfig,
  email: string
): Promise<{ id: number; name: string } | null> {
  const users = await apiGetAll<ApiUser>(config, "/api/v1/users", { is_active: "true" });
  const user = users.find(
    (u) => u.email?.toLowerCase() === email && STAFF_PROFILES.has(u.profile)
  );
  return user ? { id: user.id, name: `${user.first_name} ${user.last_name}`.trim() } : null;
}

export async function getProjectTimeReport(
  config: EzactoConfig,
  from: string,
  to: string
): Promise<ProjectReport[]> {
  const report = await apiGet<{ data: { projects: ApiTimeReportProjectRow[] } }>(
    config,
    "/api/v1/reports/time",
    { from, to }
  );
  return report.data.projects.map((row) => {
    const amounts = row.amounts ?? [];
    return {
      project_id: row.project_id,
      project_name: row.project_name,
      client_id: row.client_id,
      client_name: row.client_name,
      total_hours: hours(row.rounded_seconds),
      billable_hours: hours(row.billable_seconds),
      billable_amount: dollars(amounts.reduce((sum, a) => sum + a.billable_cents, 0)),
      currency: amounts[0]?.currency ?? "USD",
    };
  });
}

export async function getClientProjects(
  config: EzactoConfig,
  clientId: number
): Promise<Project[]> {
  const [projects, client] = await Promise.all([
    apiGetAll<ApiProject>(config, "/api/v1/projects", {
      client_id: String(clientId),
      is_active: "true",
    }),
    getClientById(config, clientId),
  ]);
  return projects.map((p) => toProject(p, { id: client.id, name: client.name }));
}

interface ApiUninvoicedTotal {
  currency: string;
  rounded_seconds: number;
  // Omitted by the API unless the token may see money.
  time_cents?: number;
  expense_cents?: number;
  total_cents?: number;
}

interface ApiUninvoicedProject {
  client_id: number;
  client_name: string;
  project_id: number;
  project_name: string;
  project_code: string;
  totals: ApiUninvoicedTotal[];
}

// Per-project uninvoiced work as ezacto prices it for invoice generation,
// plus the period's total hours per project from the time report.
export async function getUninvoicedReport(
  config: EzactoConfig,
  from: string,
  to: string
): Promise<UninvoicedReport[]> {
  const [uninvoiced, worked] = await Promise.all([
    apiGet<{ data: { projects: ApiUninvoicedProject[] } }>(config, "/api/v1/reports/uninvoiced", {
      from,
      to,
    }),
    getProjectTimeReport(config, from, to),
  ]);
  const totalHours = new Map(worked.map((row) => [row.project_id, row.total_hours]));
  const sum = (totals: ApiUninvoicedTotal[], pick: (t: ApiUninvoicedTotal) => number) =>
    totals.reduce((acc, t) => acc + pick(t), 0);
  return uninvoiced.data.projects.map((project) => ({
    client_id: project.client_id,
    client_name: project.client_name,
    project_id: project.project_id,
    project_name: project.project_name,
    currency: project.totals[0]?.currency ?? "USD",
    total_hours: totalHours.get(project.project_id) ?? hours(sum(project.totals, (t) => t.rounded_seconds)),
    uninvoiced_hours: hours(sum(project.totals, (t) => t.rounded_seconds)),
    uninvoiced_expenses: dollars(sum(project.totals, (t) => t.expense_cents ?? 0)),
    uninvoiced_amount: dollars(sum(project.totals, (t) => t.total_cents ?? 0)),
  }));
}

export async function getProjectById(
  config: EzactoConfig,
  projectId: number
): Promise<Project | null> {
  let project: ApiProject;
  try {
    project = (await apiGet<{ data: ApiProject }>(config, `/api/v1/projects/${projectId}`)).data;
  } catch {
    return null;
  }
  const client = await getClientById(config, project.client_id);
  return toProject(project, { id: client.id, name: client.name });
}

export async function getUninvoicedTimeEntries(
  config: EzactoConfig,
  projectId: number,
  before: string
): Promise<TimeEntry[]> {
  return timeEntriesFor(config, projectId, {
    from: "2000-01-01",
    to: before,
    hours: "uninvoiced",
  });
}

export async function getActiveClients(config: EzactoConfig): Promise<Client[]> {
  return apiGetAll<ApiClient>(config, "/api/v1/clients", { is_active: "true" });
}

export async function getTimeEntries(
  config: EzactoConfig,
  projectId: number,
  from: string,
  to: string
): Promise<TimeEntry[]> {
  return timeEntriesFor(config, projectId, { from, to, hours: "all" });
}

export interface ApiBrand {
  organization_name: string;
  assets: Array<{
    slot: "wordmark_light" | "wordmark_dark" | "favicon";
    url: string;
    content_type: string;
    updated_at: string;
  }>;
}

// The tenant's name and marks. Mark URLs are paths on the ezacto host.
export async function getBrand(config: EzactoConfig): Promise<ApiBrand> {
  const brand = (await apiGet<{ data: ApiBrand }>(config, "/api/v1/brand")).data;
  return {
    organization_name: brand.organization_name,
    assets: brand.assets.map((asset) => ({
      ...asset,
      url: new URL(asset.url, config.baseUrl).toString(),
    })),
  };
}
