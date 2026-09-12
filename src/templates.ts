import type { Project, ProjectReport, TimeEntry, UninvoicedReport } from "./ezacto";
import type { Brand, Palette } from "./brand";

type SessionData = {
  v: number;
  email: string;
  contactName: string;
  clients: Array<{ id: number; name: string }>;
  isAdmin: boolean;
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatHours(hours: number): string {
  return hours.toFixed(2);
}



// One token per role; the values are CSS variables so the theme toggle only
// swaps the variable set. Palette, fonts and radius come from the brand.
function tailwindConfig(brand: Brand): string {
  const t = brand.theme;
  const vars = (p: Palette) =>
    `--ground:${p.ground};--surface:${p.surface};--surface2:${p.surface2};--line:${p.line};--ink:${p.ink};--muted:${p.muted}`;
  return `<style>:root{${vars(t.light)}} .dark{${vars(t.dark)}}</style>
<script>
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          ground: 'var(--ground)', surface: 'var(--surface)', surface2: 'var(--surface2)',
          line: 'var(--line)', ink: 'var(--ink)', muted: 'var(--muted)',
          accent: { DEFAULT: '${brand.accent}', dark: '${brand.accentDark}', light: '${brand.accentLight}' },
          data: '${t.data}'
        },
        fontFamily: { sans: [${JSON.stringify(t.fontBody)}], mono: [${JSON.stringify(t.fontMono)}] },
        borderRadius: { md: '${t.radius}px', lg: '${t.radius + 2}px' }
      }
    }
  };
</script>`;
}

function fontLinkHtml(brand: Brand): string {
  const sheet = brand.theme.fontStylesheet;
  return sheet ? `<link rel="stylesheet" href="${escapeHtml(sheet)}">` : "";
}

function themeInitScript(brand: Brand): string {
  return `<script>
  var stored = localStorage.getItem('theme');
  var dark = stored ? stored === 'dark' : ${brand.theme.scheme === "dark" ? "true" : "false"};
  document.documentElement.classList.toggle('dark', dark);
</script>`;
}

// Logo image with a dark-mode variant, or the brand name as a text wordmark.
function logoHtml(brand: Brand, width: number): string {
  if (!brand.logoUrl) {
    return `<span class="text-xl font-bold tracking-tight text-ink">${escapeHtml(brand.name)}</span>`;
  }
  const alt = escapeHtml(brand.name);
  const light = escapeHtml(brand.logoUrl);
  const dark = escapeHtml(brand.logoDarkUrl ?? brand.logoUrl);
  return `<img src="${light}" alt="${alt}" style="width: ${width}px;" class="h-auto dark:hidden">` +
    `<img src="${dark}" alt="${alt}" style="width: ${width}px;" class="h-auto hidden dark:block">`;
}

const THEME_TOGGLE_BUTTON = `<button type="button" id="theme-toggle" aria-label="Toggle dark mode"
  class="p-1.5 rounded-md text-muted hover:text-ink transition-colors no-print">
  <svg class="w-4 h-4 hidden dark:block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
  <svg class="w-4 h-4 block dark:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
</button>
<script>
  document.getElementById('theme-toggle').addEventListener('click', function() {
    var html = document.documentElement;
    if (html.classList.contains('dark')) {
      html.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      html.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  });
</script>`;

function layout(brand: Brand, title: string, body: string, session?: SessionData, activePage?: string, dateRange?: { from: string; to: string }): string {
  const headerRight = session
    ? `<div class="flex items-center gap-4">
        <span class="text-sm text-muted">${escapeHtml(session.contactName)}</span>
        <a href="/auth/logout" class="text-sm text-muted hover:text-ink transition-colors">Log out</a>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - ${escapeHtml(brand.name)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  ${tailwindConfig(brand)}
  ${fontLinkHtml(brand)}
  ${themeInitScript(brand)}
  <style>
    .dark input[type="date"] { color-scheme: dark; }
    @media print {
      body { background: #fff !important; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      header, .no-print, form, #status-filter { display: none !important; }
      main { max-width: 100% !important; padding: 0 !important; }
      .bg-surface, .bg-surface2, .bg-ground { background: #fff !important; border-color: #ccc !important; }
      table { width: 100% !important; border-collapse: collapse !important; }
      th, td { color: #000 !important; border-bottom: 1px solid #ccc !important; padding: 4px 8px !important; }
      th { background: #eee !important; }
      tr { display: table-row !important; }
      .text-ink, .text-muted, [class*="text-accent"], [class*="text-data"], [class*="text-muted"] {brand.accentLight}"], [style*="color: #4ade80"], [style*="color: #8bb8d0"], [style*="color: #6fa0bb"] { color: #000 !important; }
      div[style*="background: rgba(255, 255, 255, 0.05)"] { background: #f5f5f5 !important; }
      div[style*="background: rgba(54, 70, 81"] { background: #f0f0f0 !important; }
      .rounded-full { border: 1px solid #999 !important; }
    }
  </style>
</head>
<body class="bg-ground text-ink min-h-screen">
  <header class="bg-surface border-b border-line">
    <div class="max-w-6xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-2">
      <a href="/" class="flex items-center hover:opacity-80 transition-opacity">
        ${logoHtml(brand, 110)}
      </a>
      ${session && activePage && dateRange ? navTabs(activePage, dateRange.from, dateRange.to, session.isAdmin) : ""}
      <div class="flex items-center gap-3">
        ${THEME_TOGGLE_BUTTON}
        ${headerRight}
      </div>
    </div>
  </header>
  <main class="max-w-6xl mx-auto px-4 py-8">
    ${body}
  </main>
  <footer class="max-w-6xl mx-auto px-4 py-6 text-center text-xs text-muted/60">
    ${escapeHtml(brand.name)}
  </footer>
  <script>
    function exportCSV(filename) {
      var table = document.querySelector('table');
      if (!table) return;
      var rows = Array.from(table.querySelectorAll('tr'));
      var csv = rows.filter(function(row) { return row.style.display !== 'none'; }).map(function(row) {
        var cells = Array.from(row.querySelectorAll('th, td'));
        return cells.filter(function(cell) { return cell.style.display !== 'none'; }).map(function(cell) { return '"' + cell.textContent.trim().replace(/"/g, '""') + '"'; }).join(',');
      }).join('\\n');
      var blob = new Blob([csv], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }
    function applyAmountsVisibility() {
      var cb = document.getElementById('show-amounts');
      if (!cb) return;
      var show = cb.checked;
      localStorage.setItem('showAmounts', show ? '1' : '0');
      document.querySelectorAll('[data-amount]').forEach(function(el) {
        el.style.display = show ? '' : 'none';
      });
    }
    document.addEventListener('DOMContentLoaded', function() {
      var cb = document.getElementById('show-amounts');
      if (cb) {
        var stored = localStorage.getItem('showAmounts');
        if (stored === '1') { cb.checked = true; }
        applyAmountsVisibility();
        cb.addEventListener('change', applyAmountsVisibility);
      }
    });
  </script>
</body>
</html>`;
}

function dateRangeForm(from: string, to: string, action: string): string {
  return `
    <form method="GET" action="${escapeHtml(action)}" class="flex flex-wrap items-end gap-4 mb-8 bg-surface p-4 rounded-lg border border-line">
      <div>
        <label for="from" class="block text-sm font-medium text-muted mb-1">From</label>
        <input type="date" id="from" name="from" value="${escapeHtml(from)}"
          class="bg-ground text-ink rounded-md px-3 py-1.5 text-sm border border-line focus:outline-none focus:ring-2 focus:ring-accent">
      </div>
      <div>
        <label for="to" class="block text-sm font-medium text-muted mb-1">To</label>
        <input type="date" id="to" name="to" value="${escapeHtml(to)}"
          class="bg-ground text-ink rounded-md px-3 py-1.5 text-sm border border-line focus:outline-none focus:ring-2 focus:ring-accent">
      </div>
      <button type="submit"
        class="bg-accent text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-accent-dark transition-colors">
        Update
      </button>
    </form>`;
}

export function loginPage(
  brand: Brand,
  turnstileSiteKey: string,
  error?: string,
  message?: string,
  demo = false
): string {
  const demoHtml = demo
    ? `
          <form method="POST" action="/demo" class="mt-6 pt-6 border-t border-line">
            <p class="text-sm text-muted mb-3">This is a demo. Every client and hour in it is invented, and it is rebuilt nightly.</p>
            <button type="submit"
              class="w-full bg-ground text-ink px-4 py-2 rounded-md text-sm font-medium border border-line hover:border-accent transition-colors">
              View the demo
            </button>
          </form>`
    : "";
  let alertHtml = "";
  if (error) {
    alertHtml = `<div class="mb-4 p-3 rounded-md text-sm bg-red-50 border border-red-200 text-red-700">${escapeHtml(error)}</div>`;
  }
  if (message) {
    alertHtml = `<div class="mb-4 p-3 rounded-md text-sm bg-surface2 border border-line text-ink">${escapeHtml(message)}</div>`;
  }

  const body = `
    <div class="min-h-[70vh] flex items-center justify-center">
      <div class="w-full max-w-md">
        <div class="flex justify-center mb-8">
          ${logoHtml(brand, 220)}
        </div>
        <div class="bg-surface rounded-lg p-8 text-center border border-line">
          <div class="mb-8">
            <p class="text-xs font-bold uppercase tracking-[0.3em] text-muted">Client Portal</p>
          </div>
          ${alertHtml}
          <form method="POST" action="/login" class="space-y-4 text-left">
            <div>
              <label for="email" class="block text-sm font-medium text-muted mb-1">Email address</label>
              <input type="email" id="email" name="email" required
                placeholder="you@company.com"
                class="w-full bg-ground text-ink rounded-md px-3 py-2 text-sm border border-line focus:outline-none focus:ring-2 focus:ring-accent placeholder-muted/70">
            </div>
            <div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}"></div>
            <button type="submit"
              class="w-full bg-accent text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-accent-dark transition-colors">
              Send Login Link
            </button>
          </form>${demoHtml}
        </div>
      </div>
    </div>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - ${escapeHtml(brand.name)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  ${tailwindConfig(brand)}
  ${fontLinkHtml(brand)}
  ${themeInitScript(brand)}
  <style>
    .dark input[type="date"] { color-scheme: dark; }
  </style>
</head>
<body class="bg-ground text-ink min-h-screen">
  <main>
    ${body}
  </main>
</body>
</html>`;
}

export function checkEmailPage(brand: Brand): string {
  const body = `
    <div class="min-h-[70vh] flex items-center justify-center">
      <div class="w-full max-w-md">
        <div class="flex justify-center mb-8">
          ${logoHtml(brand, 220)}
        </div>
        <div class="bg-surface rounded-lg p-8 text-center border border-line">
          <div class="mb-6">
            <svg class="w-16 h-16 mx-auto text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
            </svg>
          </div>
          <h1 class="text-xl font-bold text-ink mb-2">Check your email</h1>
          <p class="text-muted text-sm mb-6">If your email is registered, you'll receive a login link shortly. The link expires in 15 minutes.</p>
          <a href="/login" class="text-sm text-data hover:underline">Back to login</a>
        </div>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Check Your Email - ${escapeHtml(brand.name)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  ${tailwindConfig(brand)}
  ${fontLinkHtml(brand)}
  ${themeInitScript(brand)}
</head>
<body class="bg-ground text-ink min-h-screen">
  <main>
    ${body}
  </main>
</body>
</html>`;
}

interface ClientGroup {
  clientId: number;
  clientName: string;
  totalHours: number;
  billableHours: number;
  billableAmount: number;
  currency: string;
  projects: ProjectReport[];
}

function navTabs(active: string, from: string, to: string, isAdmin: boolean): string {
  const dateParams = new URLSearchParams({ from, to }).toString();
  const tabs = isAdmin
    ? [
        { id: "uninvoiced", label: "Uninvoiced", href: `/uninvoiced?${dateParams}` },
        { id: "clients", label: "Clients", href: `/clients?${dateParams}` },
      ]
    : [
        { id: "uninvoiced", label: "Uninvoiced", href: `/uninvoiced?${dateParams}` },
        { id: "projects", label: "Projects", href: `/clients?${dateParams}` },
        { id: "detailed", label: "Detailed", href: `/detailed?${dateParams}` },
      ];
  return `
    <nav class="flex gap-4">
      ${tabs.map((t) => `
        <a href="${escapeHtml(t.href)}" class="text-sm font-medium transition-colors ${
          t.id === active
            ? "text-ink"
            : "text-muted hover:text-ink"
        }">${escapeHtml(t.label)}</a>
      `).join("")}
    </nav>`;
}

export function uninvoicedPage(
  brand: Brand,
  session: SessionData,
  results: UninvoicedReport[],
  from: string,
  to: string
): string {
  const dateParams = new URLSearchParams({ from, to }).toString();

  const withHours = results.filter((r) => r.uninvoiced_hours > 0);
  const totalUninvoicedHours = withHours.reduce((s, r) => s + r.uninvoiced_hours, 0);
  const totalUninvoicedAmount = withHours.reduce((s, r) => s + r.uninvoiced_amount, 0);

  const clientMap = new Map<number, { name: string; projects: UninvoicedReport[] }>();
  for (const r of withHours) {
    let group = clientMap.get(r.client_id);
    if (!group) {
      group = { name: r.client_name, projects: [] };
      clientMap.set(r.client_id, group);
    }
    group.projects.push(r);
  }
  const clientGroups = Array.from(clientMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  let tableHtml: string;
  if (clientGroups.length === 0) {
    tableHtml = `
      <div class="bg-surface rounded-lg p-8 text-center text-muted border border-line">
        No uninvoiced time found for this period.
      </div>`;
  } else {
    let rows = "";
    for (const group of clientGroups) {
      rows += `
        <tr class="bg-surface2">
          <td colspan="4" class="py-2 px-4 font-semibold text-ink">${escapeHtml(group.name)}</td>
        </tr>`;
      for (const p of group.projects.sort((a, b) => a.project_name.localeCompare(b.project_name))) {
        rows += `
        <tr class="border-t border-line hover:bg-surface2">
          <td class="py-2 px-4 pl-8">
            <a href="/projects/${p.project_id}?${escapeHtml(dateParams)}" class="text-data hover:underline">${escapeHtml(p.project_name)}</a>
          </td>
          <td class="py-2 px-4 text-right tabular-nums">${formatHours(p.total_hours)}</td>
          <td class="py-2 px-4 text-right tabular-nums font-medium">${formatHours(p.uninvoiced_hours)}</td>
          <td class="py-2 px-4 text-right tabular-nums" data-amount>${formatCurrency(p.uninvoiced_amount)}</td>
        </tr>`;
      }
    }

    tableHtml = `
      <div class="overflow-x-auto">
        <div class="bg-surface rounded-lg border border-line">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-muted text-xs uppercase tracking-wider bg-surface2">
                <th class="py-2 px-4 font-medium">Project</th>
                <th class="py-2 px-4 text-right font-medium">Total Hours</th>
                <th class="py-2 px-4 text-right font-medium">Uninvoiced Hours</th>
                <th class="py-2 px-4 text-right font-medium" data-amount>Uninvoiced Amount</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr class="border-t-2 border-line font-semibold">
                <td class="py-2 px-4">Total</td>
                <td class="py-2 px-4"></td>
                <td class="py-2 px-4 text-right tabular-nums">${formatHours(totalUninvoicedHours)}</td>
                <td class="py-2 px-4 text-right tabular-nums" data-amount>${formatCurrency(totalUninvoicedAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>`;
  }

  const body = `
    <h1 class="text-2xl font-bold text-ink mb-2">Uninvoiced Report</h1>
    ${""/* nav is in header */}
    ${dateRangeForm(from, to, "/uninvoiced")}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
      <div class="bg-surface rounded-lg p-4 border border-line">
        <div class="text-sm text-muted mb-1">Uninvoiced Hours</div>
        <div class="text-2xl font-bold text-ink tabular-nums">${formatHours(totalUninvoicedHours)}</div>
      </div>
      <div class="bg-surface rounded-lg p-4 border border-line" data-amount>
        <div class="text-sm text-muted mb-1">Uninvoiced Amount</div>
        <div class="text-2xl font-bold text-ink tabular-nums">${formatCurrency(totalUninvoicedAmount)}</div>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-3 mb-4 no-print">
      <div class="flex items-center gap-2">
        <input type="checkbox" id="show-amounts" class="rounded accent-accent">
        <label for="show-amounts" class="text-sm text-muted cursor-pointer">Show amounts</label>
      </div>
      <div class="ml-auto flex flex-wrap gap-2">
        <button onclick="exportCSV('uninvoiced-report.csv')" class="px-3 py-1 text-xs font-medium rounded-md text-muted hover:text-ink transition-colors border border-line">Export CSV</button>
        <button onclick="window.print()" class="px-3 py-1 text-xs font-medium rounded-md text-muted hover:text-ink transition-colors border border-line">Print / PDF</button>
      </div>
    </div>
    ${tableHtml}
  `;

  return layout(brand, "Uninvoiced Report", body, session, "uninvoiced", { from, to });
}

export function dashboardPage(
  brand: Brand,
  session: SessionData,
  clientGroups: ClientGroup[],
  projectCodeMap: Map<number, string>,
  from: string,
  to: string
): string {
  const dateParams = new URLSearchParams({ from, to }).toString();

  let clientsHtml = "";
  if (clientGroups.length === 0) {
    clientsHtml = `
      <div class="bg-surface rounded-lg p-8 text-center text-muted border border-line">
        No time entries found for this period.
      </div>`;
  } else {
    for (const group of clientGroups) {
      const projectRows = group.projects
        .sort((a, b) => a.project_name.localeCompare(b.project_name))
        .map((p) => {
          const displayName = escapeHtml(p.project_name);
          return `
          <tr class="hover:bg-surface2 border-t border-line">
            <td class="py-2 px-4">
              <a href="/projects/${p.project_id}?${escapeHtml(dateParams)}" class="text-data hover:underline">
                ${displayName}
              </a>
            </td>
            <td class="py-2 px-4 text-right tabular-nums text-ink">${formatHours(p.total_hours)}</td>
            <td class="py-2 px-4 text-right tabular-nums text-ink">${formatHours(p.billable_hours)}</td>
            <td class="py-2 px-4 text-right tabular-nums text-ink" data-amount>${formatCurrency(p.billable_amount)}</td>
          </tr>`;
        })
        .join("");

      clientsHtml += `
      <div class="bg-surface rounded-lg mb-4 border border-line">
        <div class="px-4 py-3 rounded-t-lg border-b border-line bg-surface2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-semibold text-ink">${escapeHtml(group.clientName)}</h2>
            <div class="flex gap-6 text-sm text-muted">
              <span><span class="font-medium text-ink">${formatHours(group.totalHours)}</span> hrs</span>
              <span><span class="font-medium text-ink">${formatHours(group.billableHours)}</span> billable hrs</span>
              <span class="font-medium text-ink" data-amount>${formatCurrency(group.billableAmount)}</span>
            </div>
          </div>
        </div>
        ${
          group.projects.length > 0
            ? `<div class="overflow-x-auto"><table class="w-full text-sm">
          <thead>
            <tr class="text-left text-muted text-xs uppercase tracking-wider bg-surface2">
              <th class="py-2 px-4 font-medium">Project</th>
              <th class="py-2 px-4 text-right font-medium">Hours</th>
              <th class="py-2 px-4 text-right font-medium">Billable Hrs</th>
              <th class="py-2 px-4 text-right font-medium" data-amount>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${projectRows}
          </tbody>
        </table></div>`
            : `<div class="px-4 py-3 text-sm text-muted">No project-level data for this period.</div>`
        }
      </div>`;
    }
  }

  const disclaimer = `
    <div class="mb-6 p-4 rounded-lg text-sm bg-surface2 border border-line">
      <p class="font-medium text-muted">Live estimates</p>
      <p class="mt-1 text-muted">Amounts shown reflect current tracked time and rates. Hours and totals are not final until the end of the billing period.</p>
    </div>`;

  const body = `
    <h1 class="text-2xl font-bold text-ink mb-6">${session.isAdmin ? "Client Report" : "Projects"}</h1>
    ${""/* nav is in header */}
    ${disclaimer}
    ${dateRangeForm(from, to, "/clients")}
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <label class="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
        <input type="checkbox" id="show-amounts" class="rounded accent-accent">
        Show amounts
      </label>
      <div class="flex flex-wrap gap-2 no-print">
        <button type="button" onclick="exportCSV('dashboard-export.csv')" class="px-3 py-1.5 rounded-md text-sm text-muted hover:text-ink transition-colors border border-line">Export CSV</button>
        <button type="button" onclick="window.print()" class="px-3 py-1.5 rounded-md text-sm text-muted hover:text-ink transition-colors border border-line">Print / PDF</button>
      </div>
    </div>
    ${clientsHtml}
  `;

  return layout(brand, session.isAdmin ? "Clients" : "Projects", body, session, session.isAdmin ? "clients" : "projects", { from, to });
}

interface ProjectSummary {
  totalHours: number;
  billableHours: number;
  billableAmount: number;
}

export function projectPage(
  brand: Brand,
  session: SessionData,
  project: Project,
  timeEntries: TimeEntry[],
  summary: ProjectSummary,
  uninvoiced: { hours: number; amount: number },
  from: string,
  to: string
): string {
  const dateParams = new URLSearchParams({ from, to }).toString();
  const displayName = project.code
    ? `[${escapeHtml(project.code)}] ${escapeHtml(project.name)}`
    : escapeHtml(project.name);

  // Build cumulative hours chart data
  const hoursByDate = new Map<string, number>();
  for (const e of timeEntries) {
    hoursByDate.set(e.spent_date, (hoursByDate.get(e.spent_date) || 0) + e.hours);
  }
  const sortedDates = Array.from(hoursByDate.keys()).sort();
  let cumulative = 0;
  const chartData = sortedDates.map(d => {
    cumulative += hoursByDate.get(d)!;
    return { date: d, hours: cumulative };
  });

  const sorted = [...timeEntries].sort((a, b) =>
    b.spent_date.localeCompare(a.spent_date)
  );

  let tableHtml: string;
  if (sorted.length === 0) {
    tableHtml = `
      <div class="bg-surface rounded-lg p-8 text-center text-muted border border-line">
        No time entries found for this period.
      </div>`;
  } else {
    const rows = sorted
      .map(
        (e) => `
        <tr class="hover:bg-surface2 border-t border-line" data-status="${e.is_billed ? 'invoiced' : 'uninvoiced'}">
          <td class="py-2 px-4 whitespace-nowrap text-ink">${escapeHtml(e.spent_date)}</td>
          <td class="py-2 px-4 text-ink">${escapeHtml(e.user.name)}</td>
          <td class="py-2 px-4 text-ink">${escapeHtml(e.task.name)}</td>
          <td class="py-2 px-4 text-right tabular-nums text-ink">${formatHours(e.hours)}</td>
          <td class="py-2 px-4 text-right tabular-nums text-ink" data-amount>${e.billable_rate ? formatCurrency(e.billable_rate) + '/hr' : '<span class="text-muted/50">--</span>'}</td>
          <td class="py-2 px-4">${e.is_billed
            ? '<span class="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-accent/10 text-accent">Invoiced</span>'
            : '<span class="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800">Uninvoiced</span>'}</td>
          <td class="py-2 px-4 text-muted">${e.notes ? escapeHtml(e.notes) : '<span class="text-muted/50">--</span>'}</td>
        </tr>`
      )
      .join("");

    tableHtml = `
      <div class="bg-surface rounded-lg overflow-x-auto border border-line">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-muted text-xs uppercase tracking-wider bg-surface2">
              <th class="py-2 px-4 font-medium">Date</th>
              <th class="py-2 px-4 font-medium">User</th>
              <th class="py-2 px-4 font-medium">Task</th>
              <th class="py-2 px-4 text-right font-medium">Hours</th>
              <th class="py-2 px-4 text-right font-medium" data-amount>Rate</th>
              <th class="py-2 px-4 font-medium">Status</th>
              <th class="py-2 px-4 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>`;
  }

  const body = `
    <a href="/uninvoiced?${escapeHtml(dateParams)}" class="inline-flex items-center text-sm text-data hover:underline mb-6">
      <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
      </svg>
      Back to dashboard
    </a>

    <div class="mb-6">
      <h1 class="text-2xl font-bold text-ink">${displayName}</h1>
      <p class="text-muted mt-1">${escapeHtml(project.client.name)}</p>
      ${project.starts_on && project.ends_on ? `<p class="text-muted mt-1">${escapeHtml(project.starts_on)} &ndash; ${escapeHtml(project.ends_on)}</p>` : ''}
    </div>

    ${dateRangeForm(from, to, `/projects/${project.id}`)}

    <div class="mb-6 p-4 rounded-lg text-sm bg-surface2 border border-line">
      <p class="font-medium text-muted">Live estimates</p>
      <p class="mt-1 text-muted">Amounts shown reflect current tracked time and rates. Hours and totals are not final until the end of the billing period.</p>
    </div>

    ${uninvoiced.hours > 0 ? `
    <div class="mb-6 p-4 rounded-lg text-sm bg-surface2 border border-line">
      <p class="font-medium text-ink">Uninvoiced from prior periods</p>
      <p class="mt-1 text-muted">${formatHours(uninvoiced.hours)} billable hours (${formatCurrency(uninvoiced.amount)}) from before ${escapeHtml(from)} have not been invoiced.</p>
    </div>` : ""}

    ${chartData.length > 0 ? `
    <div class="bg-surface rounded-lg border border-line p-4 mb-8">
      <canvas id="progress-chart" height="100"></canvas>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
    <script>
      new Chart(document.getElementById('progress-chart'), {
        type: 'line',
        data: {
          labels: ${JSON.stringify(chartData.map(d => d.date))},
          datasets: [{
            label: 'Cumulative Hours',
            data: ${JSON.stringify(chartData.map(d => d.hours))},
            borderColor: '${brand.theme.data}',
            backgroundColor: '${brand.theme.data}1a',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          }${project.budget ? `, {
            label: 'Budget',
            data: ${JSON.stringify(chartData.map(() => project.budget))},
            borderColor: '#A8A8A7',
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
          }` : ''}]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: document.documentElement.classList.contains('dark') ? '#A8A8A7' : '#666' } } },
          scales: {
            x: { ticks: { color: document.documentElement.classList.contains('dark') ? '#A8A8A7' : '#666' }, grid: { color: document.documentElement.classList.contains('dark') ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } },
            y: { beginAtZero: true, ticks: { color: document.documentElement.classList.contains('dark') ? '#A8A8A7' : '#666' }, grid: { color: document.documentElement.classList.contains('dark') ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } }
          }
        }
      });
    </script>` : ''}

    <div class="grid grid-cols-1 sm:grid-cols-${project.budget ? '3' : '3'} gap-4 mb-8">
      <div class="bg-surface rounded-lg p-4 border border-line">
        <div class="text-sm text-muted mb-1">Total Hours</div>
        <div class="text-2xl font-bold text-ink tabular-nums">${formatHours(summary.totalHours)}</div>
        <div class="text-xs text-muted mt-1">${formatHours(summary.billableHours)} billable / ${formatHours(summary.totalHours - summary.billableHours)} non-billable</div>
      </div>
      ${project.budget ? `
      <div class="bg-surface rounded-lg p-4 border border-line">
        <div class="text-sm text-muted mb-1">Budget Remaining (${Math.round(Math.max(0, (project.budget - summary.totalHours) / project.budget * 100))}%)</div>
        <div class="text-2xl font-bold text-ink tabular-nums">${formatHours(Math.max(0, project.budget - summary.totalHours))}</div>
        <div class="mt-2 w-full bg-surface2 rounded-full h-2">
          <div class="bg-accent rounded-full h-2" style="width: ${Math.min(100, summary.totalHours / project.budget * 100)}%"></div>
        </div>
        <div class="text-xs text-muted mt-1">Total budget: ${formatHours(project.budget)}</div>
      </div>` : ''}
      <div class="bg-surface rounded-lg p-4 border border-line" data-amount>
        <div class="text-sm text-muted mb-1">Uninvoiced Amount</div>
        <div class="text-2xl font-bold text-ink tabular-nums">${formatCurrency(uninvoiced.amount)}</div>
        <div class="text-xs text-muted mt-1">${formatHours(uninvoiced.hours)} uninvoiced hours</div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <label class="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
        <input type="checkbox" id="show-amounts" class="rounded accent-accent">
        Show amounts
      </label>
      <div class="flex flex-wrap gap-2 no-print">
        <button type="button" onclick="exportCSV('project-time-entries.csv')" class="px-3 py-1.5 rounded-md text-sm text-muted hover:text-ink transition-colors border border-line">Export CSV</button>
        <button type="button" onclick="window.print()" class="px-3 py-1.5 rounded-md text-sm text-muted hover:text-ink transition-colors border border-line">Print / PDF</button>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h2 class="text-lg font-semibold text-ink">Time Entries</h2>
      <div class="flex flex-wrap gap-1 rounded-lg p-1 bg-surface2" id="status-filter">
        <button type="button" data-filter="all" class="px-3 py-1 text-xs font-medium rounded-md bg-surface text-ink border border-line">All</button>
        <button type="button" data-filter="uninvoiced" class="px-3 py-1 text-xs font-medium rounded-md text-muted hover:text-ink">Uninvoiced</button>
        <button type="button" data-filter="invoiced" class="px-3 py-1 text-xs font-medium rounded-md text-muted hover:text-ink">Invoiced</button>
      </div>
    </div>
    ${tableHtml}
    <script>
      document.getElementById('status-filter')?.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        const filter = btn.dataset.filter;
        this.querySelectorAll('[data-filter]').forEach(b => {
          if (b.dataset.filter === filter) {
            b.className = 'px-3 py-1 text-xs font-medium rounded-md bg-surface text-ink border border-line';
          } else {
            b.className = 'px-3 py-1 text-xs font-medium rounded-md text-muted hover:text-ink';
          }
        });
        document.querySelectorAll('tbody tr[data-status]').forEach(row => {
          row.style.display = (filter === 'all' || row.dataset.status === filter) ? '' : 'none';
        });
      });
    </script>
  `;

  return layout(brand, project.name, body, session, undefined, { from, to });
}

export function detailedPage(
  brand: Brand,
  session: SessionData,
  timeEntries: TimeEntry[],
  from: string,
  to: string
): string {
  const totalHours = timeEntries.reduce((sum, e) => sum + e.hours, 0);
  const totalEntries = timeEntries.length;
  const uniqueUsers = Array.from(new Set(timeEntries.map((e) => e.user.name))).sort();
  const uniqueProjects = Array.from(new Set(timeEntries.map((e) => e.project.name))).sort();

  let tableHtml: string;
  if (timeEntries.length === 0) {
    tableHtml = `
      <div class="bg-surface rounded-lg p-8 text-center text-muted border border-line">
        No time entries found for this period.
      </div>`;
  } else {
    const rows = timeEntries
      .map(
        (e) => `
        <tr class="hover:bg-surface2 border-t border-line" data-status="${e.is_billed ? "invoiced" : "uninvoiced"}" data-user="${escapeHtml(e.user.name)}" data-project="${escapeHtml(e.project.name)}">
          <td class="py-2 px-4 whitespace-nowrap text-ink">${escapeHtml(e.spent_date)}</td>
          <td class="py-2 px-4 text-ink">${escapeHtml(e.client.name)}</td>
          <td class="py-2 px-4 text-ink">${escapeHtml(e.project.name)}</td>
          <td class="py-2 px-4 text-ink">${escapeHtml(e.user.name)}</td>
          <td class="py-2 px-4 text-ink">${escapeHtml(e.task.name)}</td>
          <td class="py-2 px-4 text-right tabular-nums text-ink">${formatHours(e.hours)}</td>
          <td class="py-2 px-4 text-right tabular-nums text-ink" data-amount>${e.billable_rate ? formatCurrency(e.billable_rate) + "/hr" : '<span class="text-muted/50">--</span>'}</td>
          <td class="py-2 px-4">${
            e.is_billed
              ? '<span class="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-accent/10 text-accent">Invoiced</span>'
              : '<span class="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800">Uninvoiced</span>'
          }</td>
          <td class="py-2 px-4 text-muted">${e.notes ? escapeHtml(e.notes) : '<span class="text-muted/50">--</span>'}</td>
        </tr>`
      )
      .join("");

    tableHtml = `
      <div class="bg-surface rounded-lg overflow-x-auto border border-line">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-muted text-xs uppercase tracking-wider bg-surface2">
              <th class="py-2 px-4 font-medium">Date</th>
              <th class="py-2 px-4 font-medium">Client</th>
              <th class="py-2 px-4 font-medium">Project</th>
              <th class="py-2 px-4 font-medium">User</th>
              <th class="py-2 px-4 font-medium">Task</th>
              <th class="py-2 px-4 text-right font-medium">Hours</th>
              <th class="py-2 px-4 text-right font-medium" data-amount>Rate</th>
              <th class="py-2 px-4 font-medium">Status</th>
              <th class="py-2 px-4 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>`;
  }

  const body = `
    <h1 class="text-2xl font-bold text-ink mb-6">Detailed Time Report</h1>
    ${dateRangeForm(from, to, "/detailed")}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
      <div class="bg-surface rounded-lg p-4 border border-line">
        <div class="text-sm text-muted mb-1">Total Hours</div>
        <div id="counter-hours" class="text-2xl font-bold text-ink tabular-nums">${formatHours(totalHours)}</div>
      </div>
      <div class="bg-surface rounded-lg p-4 border border-line">
        <div class="text-sm text-muted mb-1">Total Entries</div>
        <div id="counter-entries" class="text-2xl font-bold text-ink tabular-nums">${totalEntries}</div>
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="flex flex-wrap items-center gap-3">
        <select id="filter-user" class="bg-surface text-sm rounded-md px-2 py-1.5 border border-line text-ink">
          <option value="">All People</option>
          ${uniqueUsers.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("")}
        </select>
        <select id="filter-project" class="bg-surface text-sm rounded-md px-2 py-1.5 border border-line text-ink">
          <option value="">All Projects</option>
          ${uniqueProjects.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
        </select>
        <div class="flex gap-1 rounded-lg p-1 bg-surface2" id="status-filter">
        <button type="button" data-filter="all" class="px-3 py-1 text-xs font-medium rounded-md bg-surface text-ink border border-line">All</button>
        <button type="button" data-filter="uninvoiced" class="px-3 py-1 text-xs font-medium rounded-md text-muted hover:text-ink">Uninvoiced</button>
        <button type="button" data-filter="invoiced" class="px-3 py-1 text-xs font-medium rounded-md text-muted hover:text-ink">Invoiced</button>
      </div>
      </div>
      <div class="flex flex-wrap gap-2 no-print">
        <label class="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
          <input type="checkbox" id="show-amounts" class="rounded accent-accent"> Show amounts
        </label>
        <button type="button" onclick="exportCSV('detailed-time-report.csv')" class="px-3 py-1 rounded-md text-xs text-muted hover:text-ink transition-colors border border-line">Export CSV</button>
        <button type="button" onclick="window.print()" class="px-3 py-1 rounded-md text-xs text-muted hover:text-ink transition-colors border border-line">Print / PDF</button>
      </div>
    </div>
    ${tableHtml}
    <script>
      function applyFilters() {
        var user = document.getElementById('filter-user').value;
        var project = document.getElementById('filter-project').value;
        var status = 'all';
        document.querySelectorAll('#status-filter [data-filter]').forEach(function(b) {
          if (b.className.indexOf('bg-surface') > -1) status = b.dataset.filter;
        });
        var totalHours = 0, totalEntries = 0;
        document.querySelectorAll('tbody tr[data-status]').forEach(function(row) {
          var show = true;
          if (user && row.dataset.user !== user) show = false;
          if (project && row.dataset.project !== project) show = false;
          if (status !== 'all' && row.dataset.status !== status) show = false;
          row.style.display = show ? '' : 'none';
          if (show) {
            totalEntries++;
            totalHours += parseFloat(row.children[5]?.textContent.trim() || '0');
          }
        });
        document.getElementById('counter-hours').textContent = totalHours.toFixed(2);
        document.getElementById('counter-entries').textContent = totalEntries;
      }
      document.getElementById('filter-user')?.addEventListener('change', applyFilters);
      document.getElementById('filter-project')?.addEventListener('change', applyFilters);
      document.getElementById('status-filter')?.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-filter]');
        if (!btn) return;
        this.querySelectorAll('[data-filter]').forEach(function(b) {
          if (b.dataset.filter === btn.dataset.filter) {
            b.className = 'px-3 py-1 text-xs font-medium rounded-md bg-surface text-ink border border-line';
          } else {
            b.className = 'px-3 py-1 text-xs font-medium rounded-md text-muted hover:text-ink';
          }
        });
        applyFilters();
      });
      document.querySelectorAll('thead th').forEach(function(th, i) {
        th.style.cursor = 'pointer';
        th.addEventListener('click', function() {
          var tbody = document.querySelector('tbody');
          var rows = Array.from(tbody.querySelectorAll('tr'));
          var asc = th.dataset.sortDir !== 'asc';
          document.querySelectorAll('thead th').forEach(function(h) { delete h.dataset.sortDir; });
          th.dataset.sortDir = asc ? 'asc' : 'desc';
          rows.sort(function(a, b) {
            var ac = a.children[i]?.textContent.trim() || '';
            var bc = b.children[i]?.textContent.trim() || '';
            var an = parseFloat(ac), bn = parseFloat(bc);
            if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
            return asc ? ac.localeCompare(bc) : bc.localeCompare(ac);
          });
          rows.forEach(function(r) { tbody.appendChild(r); });
        });
      });
    </script>
  `;

  return layout(brand, "Detailed Time Report", body, session, "detailed", { from, to });
}

export function verifyPage(brand: Brand, token: string): string {
  const body = `
    <div class="min-h-[70vh] flex items-center justify-center">
      <div class="w-full max-w-md">
        <div class="flex justify-center mb-8">
          ${logoHtml(brand, 220)}
        </div>
        <div class="bg-surface rounded-lg p-8 text-center border border-line">
          <div class="mb-6">
            <svg class="w-16 h-16 mx-auto text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
            </svg>
          </div>
          <h1 class="text-xl font-bold text-ink mb-2">Confirm Login</h1>
          <p class="text-muted text-sm mb-6">Click the button below to log in to your dashboard.</p>
          <form method="POST" action="/auth/verify">
            <input type="hidden" name="token" value="${escapeHtml(token)}">
            <button type="submit"
              class="w-full bg-accent text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-accent-dark transition-colors">
              Continue to Dashboard
            </button>
          </form>
        </div>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Login - ${escapeHtml(brand.name)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  ${tailwindConfig(brand)}
  ${fontLinkHtml(brand)}
  ${themeInitScript(brand)}
</head>
<body class="bg-ground text-ink min-h-screen">
  <main>
    ${body}
  </main>
</body>
</html>`;
}

export function errorPage(brand: Brand, title: string, message: string): string {
  const body = `
    <div class="min-h-[50vh] flex items-center justify-center">
      <div class="bg-surface rounded-lg p-8 text-center max-w-md border border-line">
        <h1 class="text-xl font-bold text-ink mb-2">${escapeHtml(title)}</h1>
        <p class="text-muted mb-4">${escapeHtml(message)}</p>
        <a href="/uninvoiced" class="text-sm text-data hover:underline">Back to dashboard</a>
      </div>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - ${escapeHtml(brand.name)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  ${tailwindConfig(brand)}
  ${fontLinkHtml(brand)}
  ${themeInitScript(brand)}
</head>
<body class="bg-ground text-ink min-h-screen">
  <main class="max-w-6xl mx-auto px-4 py-8">
    ${body}
  </main>
</body>
</html>`;
}
