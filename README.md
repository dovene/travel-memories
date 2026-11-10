# Travel Memories

A personal travel publishing platform: destinations told through photographs and videos.
One Cloudflare Worker serves the static frontend (`public/`) and the API (`/api/*`). Content (JSON) and original media live in Cloudflare R2.

| Phase | Status |
| --- | --- |
| 0 — Design prototype | ✅ Approved 2026-11-10 |
| 1 — Project foundation | ✅ Done 2026-11-10: staging and production deploy from `develop` and `main` |
| 2 — Content storage and API | 🔧 Built: JSON schemas, R2 storage with conflict protection, public API, admin places API (sign-in arrives in Phase 3) |
| 3–5 | Not started |

## Local development

Requirements: Node 20+ (CI uses 22) and Python 3 (only needed for the prototype server).

```bash
npm install
npm run dev          # Worker + static assets on http://localhost:8787, R2 simulated locally
npm run seed:local   # load the starter journal (@dovene, 10 destinations) into local R2
npm run validate     # static checks + tests (what CI runs)
npm run build        # Wrangler dry-run bundle for staging and production
```

`npm run serve:prototype` still serves `public/` without the Worker, on http://localhost:4173.

Static Assets serves clean URLs. For example, `/place.html?slug=rome` redirects to `/place?slug=rome`, and `/admin/index.html` redirects to `/admin/`.

### Health check

`GET /api/health` reports the environment name and whether the R2 binding responds:

```json
{ "status": "ok", "environment": "staging", "version": "0.2.0", "storage": "ok" }
```

### Local admin sign-in (until Phase 3)

Real login arrives in Phase 3, so deployed admin endpoints currently answer `401`. To try them locally, create a `.dev.vars` file (git-ignored) containing:

```text
DEV_OWNER_ID=dovene
```

`npm run dev` then treats requests to `localhost` as that owner. This only works when `ENVIRONMENT` is `development` **and** the host is localhost. Staging and production set their own `ENVIRONMENT`, and `npm run check` fails if `DEV_OWNER_ID` ever appears in `wrangler.toml`.

## Content model

All content is plain JSON in the bucket, readable without the application:

```text
content/usernames/<username>.json          { "ownerId": "dovene" }   public handle → owner
content/users/<ownerId>/profile.json        profile        (schemas/profile.schema.json)
content/users/<ownerId>/places.json         all places     (schemas/places.schema.json)
media/users/<ownerId>/<placeId>/<filename>  original photos and videos
```

- **Schemas:** [schemas/](schemas/) holds the documented JSON Schemas. The Worker validates every document against them before saving. It also enforces the rules a schema can't express: unique place ids, slugs and media ids, a cover that references an existing media item, media positions numbered 0 to n-1, and an owner on every place.
- **Owners:** every place carries `ownerId`. The admin API takes the owner from the session, never from the request body; a body containing `ownerId` is rejected.
- **Media folders:** each place's media folder is named after the place's stable `id`, not its slug, so renaming a place never moves files.
- **Media URLs:** they are generated at read time (`/api/public/<username>/media/<mediaId>`, configurable with the `MEDIA_BASE_URL` variable) and never stored in content.
- **Versions:** each place has a `version` that increases with every change.

### Conflict protection

- **Storage level:** every save is conditional on the ETag that was read. If another request saved first, the change is re-applied to the fresh document, up to three attempts, and then reported as `409 storage_conflict`. Nothing is silently overwritten.
- **Editor level:** `PUT` and `DELETE` need `If-Match: "<version>"`. A missing header returns `428`. An out-of-date version returns `412 version_conflict` with the current version, so the editor can reload instead of overwriting someone's newer change.

## API

Errors always look like `{ "error": { "code", "message", "details?" } }`. Validation errors (`422`) list `{ path, message }` per field.

**Public (read-only, no sign-in):**

| Endpoint | Returns |
| --- | --- |
| `GET /api/public/:username/profile` | Profile |
| `GET /api/public/:username/places` | `{ places: [...] }` with media `url`s, ordered by position |
| `GET /api/public/:username/places/:slug` | One place |
| `GET /api/public/:username/media/:mediaId` | The original file. Supports `Range` (video seeking) and `If-None-Match`, and is cached long-term |

JSON responses carry an `ETag` and answer `304` when unchanged.

**Admin (session required, same-origin only):**

| Endpoint | Notes |
| --- | --- |
| `GET /api/admin/session` | `{ authenticated, ownerId? }` |
| `GET /api/admin/places` / `GET /api/admin/places/:id` | The owner's places (`ETag` = version) |
| `POST /api/admin/places` | Body: `name`, `city`, `country`, `countryCode`; optional `description`, `visitedAt`, `slug`. Returns `201` |
| `PUT /api/admin/places/:id` | Any subset of the fields above. Needs `If-Match` |
| `DELETE /api/admin/places/:id` | Needs `If-Match`. Also deletes the place's media files |
| `login`, `logout`, `…/media`, `…/media/order`, `…/media/cover` | `501` until Phase 3 |

### Seeding a bucket

```bash
npm run seed:local                                        # local R2
node scripts/seed-content.js --target staging             # after `npx wrangler login`
node scripts/seed-content.js --target production --yes
```

Seeding writes the username index, the profile and the 10 starter destinations (without media). Remote targets refuse to overwrite existing content unless you pass `--force`.

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
schemas/                JSON Schemas for profile.json and places.json
src/
  index.js              Worker entry. Only a default export is allowed (enforced by npm run check)
  routes/api.js         API router: /api/health, /api/public/*, /api/admin/*
  routes/public.js      Public read endpoints + media streaming
  routes/admin.js       Admin endpoints (session, places)
  services/storage.js   R2 layout, conditional writes, retries
  services/places.js    Create/update/delete rules, slugs, versions
  services/auth.js      Session lookup (local dev sign-in until Phase 3)
  utils/schema.js       Dependency-free JSON Schema validator (subset)
  utils/validation.js   Schema + cross-field content rules
  utils/responses.js    JSON/error responses + security headers
scripts/
  check.js              Static checks: syntax, EN/FR key parity, env isolation, secret scan, entry exports, schemas
  seed-content.js       Loads the starter journal into a bucket
  smoke-test.js         Post-deploy health check
  serve.py              No-cache server for the Phase 0 prototype
tests/                  node:test suites: API, conflicts, owner isolation, validation, search, i18n (in-memory R2 in tests/helpers)
.github/workflows/      validate · deploy-staging · deploy-production
wrangler.toml           Worker, assets, environments, R2 bindings
```

## Prototype notes

- The frontend still uses the Phase 0 mock data (`public/assets/js/data/mock-content.js`). Sample photos are hot-linked from Unsplash, and the sample video is MDN's CC0 `flower.mp4`. In Phase 4 it switches to the `/api/public/:username/*` endpoints, once real photos exist (uploads arrive in Phase 3).
- The admin pages are visual mockups with no authentication. They are publicly reachable until Phase 3, but they cannot change anything.
