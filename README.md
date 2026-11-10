# Travel Memories

A personal travel publishing platform: destinations told through photographs and videos.
One Cloudflare Worker serves the static frontend (`public/`) and the API (`/api/*`). Content (JSON) and original media live in Cloudflare R2.

| Phase | Status |
| --- | --- |
| 0 — Design prototype | ✅ Approved 2026-11-10 |
| 1 — Project foundation | 🔧 In progress: repo, Worker, environments and CI are in place; Cloudflare/GitHub accounts still need connecting (see [First-time setup](#first-time-setup)) |
| 2–5 | Not started |

## Local development

Requirements: Node 20+ (CI uses 22) and Python 3 (only needed for the prototype server).

```bash
npm install
npm run dev          # Worker + static assets on http://localhost:8787, R2 simulated locally
npm run validate     # static checks + tests (what CI runs)
npm run build        # Wrangler dry-run bundle for staging and production
```

`npm run serve:prototype` still serves `public/` without the Worker, on http://localhost:4173.

Static Assets serves clean URLs. For example, `/place.html?slug=rome` redirects to `/place?slug=rome`, and `/admin/index.html` redirects to `/admin/`.

### Health check

`GET /api/health` reports the environment name and whether the R2 binding responds:

```json
{ "status": "ok", "environment": "staging", "version": "0.1.0", "storage": "ok" }
```

## Environments

| | Local | Staging | Production |
| --- | --- | --- | --- |
| Branch | — | `develop` | `main` |
| Worker | `travel-memories-dev` (local only, never deployed) | `travel-memories-staging` | `travel-memories` |
| R2 bucket (`STORAGE` binding) | `travel-memories-dev` (simulated) | `travel-memories-staging` | `travel-memories-production` |
| `ENVIRONMENT` var | `development` | `staging` | `production` |
| URL | localhost:8787 | https://travel-memories-staging.adovene.workers.dev | https://travel-memories.adovene.workers.dev |

Each R2 bucket holds both `content/` (JSON) and `media/` (originals), using the layout in the specification. All configuration lives in [wrangler.toml](wrangler.toml). In Wrangler, bindings and vars are **not inherited** by environments, so each environment declares its own. `npm run check` fails if staging and production ever share a Worker name or a bucket, or if the local config uses a deployed Worker's name. That last check matters because a plain `wrangler deploy` with no `--env` uses the local config, so it can never overwrite production.

## Deployment (GitHub Actions)

| Trigger | Workflow | What happens |
| --- | --- | --- |
| Pull request | [validate.yml](.github/workflows/validate.yml) | `npm ci` → static checks → tests → Wrangler dry-run build |
| Push to `develop` | [deploy-staging.yml](.github/workflows/deploy-staging.yml) | Validation → `wrangler deploy --env staging` → smoke test |
| Push to `main` | [deploy-production.yml](.github/workflows/deploy-production.yml) | Validation → `wrangler deploy --env production` → smoke test |

- If validation fails, nothing is deployed, because the deploy job `needs` the validation job.
- Production deploys only from `main`. The deploy job also checks `github.ref`.
- The smoke test ([scripts/smoke-test.js](scripts/smoke-test.js)) checks that the homepage loads and that `/api/health` reports the **expected environment** and a working bucket. This catches crossed staging and production configuration.
- Each workflow also has a manual "Run workflow" button (`workflow_dispatch`). It still deploys only from its own branch.

## First-time setup

Do these once. They need your own Cloudflare and GitHub accounts.

1. **Cloudflare account and workers.dev subdomain.** Sign in to the Cloudflare dashboard → *Workers & Pages* and choose your free `*.workers.dev` subdomain.
2. **Create the R2 buckets.** R2 must be enabled on the account. It has a free tier, but the dashboard asks you to add a payment method.
   ```bash
   npx wrangler login
   npx wrangler r2 bucket create travel-memories-staging
   npx wrangler r2 bucket create travel-memories-production
   ```
3. **Create a deploy API token.** In *My Profile → API Tokens → Create Token*, create a custom token scoped to your account only. Give it:
   - *Account → Workers Scripts → Edit*
   - *Account → Account Settings → Read*

   If a deploy reports a missing permission, add *Workers R2 Storage → Read*.
4. **Create the GitHub repository** (private is recommended) and push both branches:
   ```bash
   git remote add origin git@github.com:<you>/travel-memories.git
   git push -u origin main develop
   ```
5. **Add the GitHub secrets.** In *Settings → Secrets and variables → Actions*, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. You'll find the account ID in the dashboard sidebar.
   Optionally, in *Settings → Environments*, create `staging` and `production` and add required reviewers to `production`.
6. **Protect the branches** (recommended). Require the "Validate" check and pull requests for `main` and `develop`.
7. **Verify.** Push to `develop` and watch *Actions → Deploy staging*. Then merge `develop` into `main` for production.

Runtime secrets will arrive in Phase 3 (admin password hash, session key). Set them per environment with `npx wrangler secret put <NAME> --env staging|production`. They are never committed and never reach frontend code.

## Repository layout

```text
public/                 Static frontend (served by Workers Static Assets)
  index.html, place.html, admin/
  assets/css/           main · components · gallery · admin
  assets/js/            i18n/, data/ (mock content), api, filters, gallery, lightbox, app, admin
src/
  index.js              Worker entry. Only a default export is allowed (enforced by npm run check)
  routes/api.js         API router (/api/health today)
  utils/responses.js    JSON/error responses + security headers
scripts/
  check.js              Static checks: syntax, EN/FR key parity, env isolation, secret scan, entry exports
  smoke-test.js         Post-deploy health check
  serve.py              No-cache server for the Phase 0 prototype
tests/                  node:test suites (Worker routing, search, i18n, content invariants)
.github/workflows/      validate · deploy-staging · deploy-production
wrangler.toml           Worker, assets, environments, R2 bindings
```

## Prototype notes

- The frontend still uses the Phase 0 mock data (`public/assets/js/data/mock-content.js`). Sample photos are hot-linked from Unsplash, and the sample video is MDN's CC0 `flower.mp4`. In Phase 2, `api.js` will call the real `/api/public/:username/*` endpoints instead.
- The admin pages are visual mockups with no authentication. They are publicly reachable until Phase 3, but they cannot change anything.
