# ezacto-portal

A client-facing portal for an [ezacto](https://ezacto.com) instance: contacts
sign in with a magic link and see their own projects, hours, uninvoiced work
and a detailed time log. Firm staff see every active client. One Cloudflare
Worker, three KV namespaces, no database of its own; everything is read from
ezacto's `/api/v1` with a read-only token.

## Pages

| Route | What |
| --- | --- |
| `/uninvoiced` | per-project total, uninvoiced hours and amount for a date range |
| `/clients` | hours and billable amount per project, grouped by client |
| `/projects/:id` | one project: cumulative-hours chart, budget burn, time log |
| `/detailed` | every folded time row across the session's clients, filterable |

Amounts are hidden by default and revealed per page with a checkbox; CSV export
and print styles are built in.

## Who gets in

- A **contact** (ezacto `contacts`, matched by email) sees the clients they are
  a contact of, provided the client is active.
- A **staff member** (an active ezacto `user` with the `administrator` or
  `executive_manager` profile, matched by email) sees every active client.
- Anyone else gets the same "check your email" page and no link.

Scoping is enforced in the Worker on every route; a project URL for another
client returns 404.

## Deploy

1. Create the three KV namespaces and put their ids in `wrangler.toml`:

   ```sh
   wrangler kv namespace create SESSIONS
   wrangler kv namespace create MAGIC_TOKENS
   wrangler kv namespace create RATE_LIMITS
   ```

2. In ezacto, create an API token with exactly these scopes and keep it:
   `clients:read projects:read reports:read team:read invoices:read time_entries:read`.

3. Create a [Turnstile](https://developers.cloudflare.com/turnstile/) widget for
   the portal hostname.

4. Set up [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/)
   for the sender domain and create an API token with the send permission.

5. Fill in `[vars]` in `wrangler.toml` and the route pattern, then the secrets.
   `wrangler.toml` deliberately carries no `account_id`; export
   `CLOUDFLARE_ACCOUNT_ID` (or add the key) so wrangler knows where to deploy:

   ```sh
   export CLOUDFLARE_ACCOUNT_ID=...
   wrangler secret put EZACTO_API_TOKEN
   wrangler secret put TURNSTILE_SECRET_KEY
   wrangler secret put CLOUDFLARE_API_TOKEN
   wrangler deploy
   ```

### Configuration

| Name | Where | Meaning |
| --- | --- | --- |
| `EZACTO_BASE_URL` | var | the ezacto instance, e.g. `https://time.example.com` |
| `EZACTO_API_TOKEN` | secret | read-only ezacto token (scopes above) |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | var / secret | Turnstile widget pair |
| `MAIL_FROM_ADDRESS` | var | sender for magic-link mail; must be on a verified Email Sending domain |
| `MAIL_FROM_NAME` | var | optional; defaults to `<BRAND_NAME> Client Portal` |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | var / secret | the account and token used for Email Sending |
| `MAILGUN_DOMAIN` / `MAILGUN_REGION` / `MAILGUN_API_KEY` | var / var / secret | when set, magic-link mail goes through Mailgun instead |
| `DEMO_SIGN_IN_EMAIL` / `DEMO_SIGN_IN_PASSWORD` | var / secret | demo only: the account the Worker mints its token from when `EZACTO_API_TOKEN` is absent |
| `DEMO_CLIENT_ID` | var | demo only: enables "View the demo" onto this client |
| `BRAND_NAME` | var | overrides the organisation name ezacto reports; ezacto's own name is the fallback |
| `BRAND_ACCENT` | var | `#rrggbb` accent colour; defaults to ezacto blue |
| `BRAND_LOGO_URL` | var | overrides the `wordmark_light` mark from ezacto; `data:` URI or an `https://` URL (its origin is added to the CSP). With neither, `BRAND_NAME` renders as text |
| `BRAND_LOGO_DARK_URL` | var | overrides the `wordmark_dark` mark; falls back to the light logo |
| `BRAND_SCHEME` | var | `light` (default) or `dark`: which scheme the page opens in before the viewer toggles |
| `BRAND_GROUND` / `BRAND_SURFACE` / `BRAND_LINE` / `BRAND_INK` / `BRAND_MUTED` | var | `#rrggbb` palette for the default scheme; the other scheme keeps ezacto's |
| `BRAND_DATA` | var | colour for links and the chart; defaults to ezacto blue |
| `BRAND_FONT_BODY` | var | CSS font stack; defaults to IBM Plex Sans |
| `BRAND_FONT_STYLESHEET` | var | stylesheet URL for the fonts; defaults to Google Fonts for Plex, set empty to load none |

Name and marks come from `GET /api/v1/brand` (cached five minutes per isolate;
a failed lookup falls back to the vars and defaults). Vars win per field. With
no palette vars the portal wears ezacto's default app theme ("Precision"), so
it reads as the same product as the instance it fronts.


`.dev.vars.example` lists the secrets for `wrangler dev`.

## Demo deployment

`[env.demo]` in `wrangler.toml` runs the portal at portal.ezacto.io against the
Folding Forks demo instance on ezacto.io. Two things differ from a normal
deployment:

- **No `EZACTO_API_TOKEN`.** The demo instance is rebuilt nightly, which
  deletes every token, so the Worker mints its own: it signs in with the
  published demo account (`DEMO_SIGN_IN_EMAIL` var, `DEMO_SIGN_IN_PASSWORD`
  secret), creates a read-only token with the six portal scopes, caches it in
  the `SESSIONS` namespace, and re-mints once when the instance answers 401.
- **A demo door.** With `DEMO_CLIENT_ID` set, the login page offers "View the
  demo": `POST /demo` seats a visitor on that one client for an hour with the
  same scoping every contact gets. The demo instance has no contacts, so the
  email path never sends there.

Mail on the demo matches the ezacto instances: `MAILGUN_DOMAIN`,
`MAILGUN_REGION` and the `MAILGUN_API_KEY` secret select Mailgun over
Cloudflare Email Sending wherever they are set.

## Develop

```sh
npm ci
npm run typecheck
npm test          # vitest: brand, data mapping, login, sessions, client isolation
npm run dev       # wrangler dev, reads .dev.vars
```

## Requirements

An ezacto instance released on or after 2026-09-11: the portal reads
`reports/detailed-time?grain=entry`, `reports/uninvoiced` `projects[]` and
`GET /api/v1/brand`. Older instances answer 422 on `grain` and the pages fail.

## Licence

AGPL-3.0, the same as ezacto.
