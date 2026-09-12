# Contributing

## Licence, in one paragraph

ezacto-portal is licensed under the [GNU AGPL v3](LICENSE). If you run a
modified ezacto-portal as a network service, you have to offer your users the source of your
modifications. Running it unmodified, self-hosting it, or using it inside your
own company costs you nothing and obliges you to nothing.

## Why there is a CLA

CONFLICT LLC holds the copyright and also offers ezacto under commercial terms
to people who do not want the AGPL's obligations. That is only possible while
one party can license the whole work. A contribution merged without a
contributor agreement stays yours, licensed to the project under the AGPL like
anyone else's — and from that moment the project cannot be offered commercially
without your individual permission.

So we ask for the agreement in [`CLA.md`](CLA.md) before merging. It does not
take your copyright away; it grants a licence alongside the rights you keep.
Sign it by adding one line to [`contributors.md`](contributors.md) in the same
pull request as your first contribution.

## Before you open a pull request

Read [`README.md`](README.md): what the portal is, how it is deployed, and every
configuration value.

The gates are typecheck and test. Run them the way CI does:

```
npm ci
npm run typecheck
npm test
```

Tests run the Worker through `app.request()` with an in-memory KV and a fake
ezacto behind `fetch`; a change to what the portal reads or renders comes with
a test that fails without it.

## What the runtime is

A single Cloudflare Worker (Hono) with three KV namespaces and nothing else:
no database of its own. Everything it shows is read from an ezacto instance's
`/api/v1` with a read-only token, scoped per session in the Worker. Proposals
that add storage or a framework need to earn it in the issue first.

## Reporting a security issue

Do not open a public issue. Email <security@ezacto.com> with what you found and
how to reproduce it.
