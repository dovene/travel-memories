# Travel Memories

A personal travel publishing platform: destinations told through photographs and videos.
One Cloudflare Worker serves the static frontend (`public/`) and the API (`/api/*`). Content (JSON) and original media live in Cloudflare R2.

| Phase | Status |
| --- | --- |
| 0 — Design prototype | ✅ Approved 2026-11-10 |
| 1 — Project foundation | ✅ Done 2026-11-10: staging and production deploy from `develop` and `main` |
| 2 — Content storage and API | ✅ Done 2026-11-10 |
| 3 — Authentication and administration | ✅ Done 2026-11-10 |
| 4 — Public experience | ✅ Done 2026-11-10 (plus the continuous place journey) |
| 5 — Quality and production readiness | ✅ Done 2026-11-10: export/restore, security headers, accessibility fixes, device and security checks |

**Current release: [v1.0.0](https://github.com/dovene/travel-memories/releases/tag/v1.0.0)** (2026-11-10). It is the first production release, and every phase of the specification is live.

### Possible next steps

- Editable photo descriptions (alt text) in the admin. They currently come from file names.
- A regular backup routine with `npm run export`, keeping copies outside Cloudflare.
- Replacing the throwaway admin passwords with `npm run setup:admin -- --env <env>`.

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

## Administration

Sign in at `/admin/login` (username `dovene`). Until you're signed in, every `/admin` page redirects to the login page, and every admin API call answers `401`.

### Setting the admin password

Each environment needs two secrets: `ADMIN_PASSWORD_HASH` and `SESSION_SECRET`. One command sets both. It asks for the password twice without showing it, hashes it on your machine, and stores only the hash:

```bash
npm run setup:admin -- --env local         # writes the git-ignored .dev.vars for npm run dev
npm run setup:admin -- --env staging       # needs `npx wrangler login` first
npm run setup:admin -- --env production
```

Running it again changes the password and signs out every open session. Until the secrets are set, sign-in on that environment answers `503`.

### How sign-in is protected

- **Password hash:** PBKDF2-SHA256 with a random salt and 100,000 iterations. Comparisons take the same time whether or not they match, and a wrong username takes as long as a wrong password.
- **Session cookie:** `__Host-tm_session`, set `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, valid for 7 days. It is signed with HMAC-SHA256, so it can't be forged or altered.
- **Cross-site requests:** every `POST`/`PUT`/`DELETE`, login included, must carry an `Origin` header matching the site.
- **Rate limiting:** 5 login attempts per minute per IP (`LOGIN_LIMITER`). Further attempts answer `429`.
- **Admin pages:** served with `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- **Logout:** clears the cookie. Sessions are stateless, so to sign out other devices, re-run `setup:admin`; the new `SESSION_SECRET` invalidates every session.

### Uploads

Files go through the Worker straight into R2 and are kept as original, unmodified files. The server checks four things:
- the upload belongs to the signed-in owner's destination;
- the extension and declared type are allowed;
- the file's actual signature ("magic bytes") matches its type;
- the size is within the limit: 25 MB per photo, 95 MB per video.

Allowed types are JPG, PNG, WEBP, HEIC, AVIF, MP4, MOV and WEBM.

### Previews

Originals can be several megabytes, so the public site never shows them in grids. After each upload, the admin page creates smaller JPEG copies in your browser:

| Preview | Size | Used for |
| --- | --- | --- |
| `thumb` | up to 640 px | Cards, gallery tiles, viewer thumbnails |
| `display` | up to 2048 px | Hero, place cover, fullscreen viewer |
| `poster` | up to 1600 px | Still frame shown before a video plays |

The server checks previews exactly like originals (type, signature, size, pixel dimensions). It stores them next to the original as `<mediaId>.<preview>-<token>.jpg`, and lists them under `variants` in `places.json`. The original is never modified. Previews can always be regenerated from it, and opening a destination in the admin fills in any that are missing.

A photo without previews falls back to its original. HEIC photos only get previews when uploaded from Safari, because other browsers can't decode HEIC. The size limits come from Cloudflare's 100 MB request limit on the free plan. Larger videos would need direct uploads to R2 with presigned URLs, which the spec lists as a later option. The first upload becomes the cover. Removing an item deletes its file, and deleting a destination deletes its folder.

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
| `GET /api/public/:username/media/:mediaId[?variant=thumb\|display\|poster]` | The original file, or a preview. Supports `Range` (video seeking) and `If-None-Match`, and is cached long-term |
| `POST /api/public/:username/visits` | Page-view beacon `{ page: "home"\|"place", slug?, lang?, ref? }`. Same-origin only, answers `204` |

JSON responses carry an `ETag` and answer `304` when unchanged.

**Admin (session cookie required, same-origin only):**

| Endpoint | Notes |
| --- | --- |
| `GET /api/admin/session` | `{ authenticated, ownerId? }` |
| `GET /api/admin/places` / `GET /api/admin/places/:id` | The owner's places (`ETag` = version) |
| `POST /api/admin/places` | Body: `name`, `city`, `country`, `countryCode`; optional `description`, `visitedAt`, `slug`. Returns `201` |
| `PUT /api/admin/places/:id` | Any subset of the fields above. Needs `If-Match` |
| `DELETE /api/admin/places/:id` | Needs `If-Match`. Also deletes the place's media files |
| `POST /api/admin/login` / `POST /api/admin/logout` | `{ username, password }`. Sets or clears the session cookie |
| `POST /api/admin/places/:id/media` | Raw file body with `Content-Type`, `Content-Length` and `X-Filename` (URI-encoded); optional `X-Media-Width`/`X-Media-Height`. Returns the updated place (`201`) |
| `DELETE /api/admin/places/:id/media/:mediaId` | Removes the item and its file |
| `PUT /api/admin/places/:id/media/order` | `{ order: [ids] }`. It must list exactly the current media, otherwise `409` with `currentOrder` |
| `PUT /api/admin/places/:id/media/cover` | `{ mediaId }` |
| `PUT /api/admin/places/:id/media/:mediaId/variants/:name` | A preview (`thumb`, `display` or `poster`): raw JPEG/WEBP/PNG body with `X-Media-Width` and `X-Media-Height` |
| `GET` / `PUT /api/admin/profile` | The author's name (`{ displayName }`, 1–80 characters), shown on the home page as "A personal travel journal by …" |
| `GET /api/admin/visits?from=yyyy-mm-dd&to=yyyy-mm-dd` | Raw visits of at most 31 days per call |
| `GET /api/admin/backup/content` | The username, profile and places documents, byte for byte |
| `POST /api/admin/backup/existing` | `{ paths }` → `{ existing: { path: size } }` for media already stored |
| `PUT /api/admin/backup/files?path=…` | One restored file (raw body). Only the signed-in owner's paths; documents must pass the schemas, media must match their type |

### Seeding a bucket

```bash
npm run seed:local                                        # local R2
node scripts/seed-content.js --target staging             # after `npx wrangler login`
node scripts/seed-content.js --target production --yes
```

Seeding writes the username index, the profile and the 10 starter destinations (without media). Remote targets refuse to overwrite existing content unless you pass `--force`.

## Backups: export and restore

Everything can leave Cloudflare as plain files at any time. Staging and production need `npx wrangler login`.

```bash
npm run export -- --env production                 # → exports/production-<timestamp>/
npm run export -- --env staging --out ~/Backups
npm run restore -- --from exports/<folder> --target local
npm run restore -- --from exports/<folder> --target production --yes --force
```

- **Export folder:** it mirrors the bucket, with `content/…` JSON documents and `media/…` originals and previews. It also contains a `manifest.json` with every file's size, type and SHA-256 checksum, and a `README.md` explaining the layout. It is readable and restorable without this application: any S3 tool can upload it (`rclone copy`, `aws s3 sync`). `exports/` is git-ignored.
- **How the export works:** the JSON documents are read directly from the bucket. Media files are downloaded from the public media URLs, which serve the exact stored bytes, and checked against the sizes recorded in `places.json`. Files that `places.json` doesn't reference (for example from an interrupted upload) aren't exported.
- **Restore safety:**
  - it checks every checksum and validates the content before uploading anything;
  - it refuses a bucket that already has content unless you pass `--force`, and production also needs `--yes`;
  - it uploads media first and `places.json` last, so the site never points to a missing file.
- **Tested:** a full staging export (16 files) was restored into local storage, and the local site then served all 13 media files byte-identical to the export.
- **Routine:** run an export regularly, for example monthly or after a trip, and keep copies somewhere other than Cloudflare. The spec's long-term preservation goal depends on this.

### From the admin panel

**Studio › Backups** does the same without a terminal:

- **Download backup:** one `.tar` file (opens with a double-click on macOS and Windows) holding exactly the folder `npm run export` produces: `content/…`, `media/…`, `manifest.json` with SHA-256 checksums and a `README.md`. The browser builds it: it reads the content documents from the API and downloads every file from its public URL. Chrome and Edge write it straight to disk; other browsers assemble it in memory first (fine at today's size of about 0.5 GB).
- **Restore a backup:** choose a downloaded `.tar`, or a folder made by `npm run export`. Every file is checked against the manifest (size and SHA-256) before anything is uploaded. Media already stored are skipped, the rest is uploaded one file per request, and `places.json` goes last, so the site only switches over once every file is there. The confirmation says how many destinations the backup has and what will disappear.
- **Why the browser does the work:** on the Workers free plan a request may make about 50 storage operations and use 10 ms of CPU, far too little to pack or unpack hundreds of files in one request.
- **Tested locally:** downloaded the local journal (27 files), deleted a video and renamed a destination, restored the `.tar`: one file uploaded, the name and the video came back.

## Visitors

**Studio › Visitors** shows page views of the public site for the last 7, 30 or 90 days: visits, visitors, countries and cities, a daily chart, the cities, countries and destinations, the sites visitors came from, and the latest visits.

- Each page load sends one small beacon (`POST /api/public/:username/visits`). The Worker adds the city, region and country Cloudflare knows for the request, and the device type, and appends it to `visits/users/<ownerId>/<yyyy-mm-dd>.json` in R2.
- **Not stored:** IP addresses. A visitor is counted with an anonymous code (a keyed hash of IP + browser) that changes every day, so the same person on two days counts twice.
- **Not counted:** your own visits while signed in, and obvious bots.
- At most 20,000 visits are kept per day; visit files are not part of backups.

## Security headers and accessibility

- **Security headers:** `public/_headers` gives every page:
  - a Content-Security-Policy: scripts only from this site, no inline scripts or handlers, fonts only from Google Fonts, images, video and API calls only from this site;
  - HSTS, `X-Frame-Options: DENY`, `nosniff`, a Referrer-Policy and a Permissions-Policy.

  `npm run check` fails if an inline script or handler appears in the HTML, or if the policy is loosened.
- **Accessibility:** every page passes axe-core 4.10 with no violations: homepage in English and French, place journey, fullscreen viewer, login and editor. Specific fixes:
  - secondary text darkened to at least 4.5:1 contrast;
  - heading levels kept in order across the journey;
  - each gallery labelled with its destination's name;
  - the editor's save bar is a labelled region, and its "saved / unsaved" text is announced to screen readers.

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

8. **Set the admin password** for each environment with `npm run setup:admin -- --env staging` and `npm run setup:admin -- --env production` (see [Administration](#administration)). Secrets are never committed and never reach frontend code.

## Repository layout

```text
public/                 Static frontend (served by Workers Static Assets)
  index.html, place.html, admin/
  assets/css/           main · components · gallery · admin
  assets/js/            i18n/, api (public API client), filters, gallery, lightbox, app, admin
schemas/                JSON Schemas for profile.json and places.json
src/
  index.js              Worker entry. Only a default export is allowed (enforced by npm run check)
  routes/api.js         API router: /api/health, /api/public/*, /api/admin/*
  routes/public.js      Public read endpoints + media streaming
  routes/admin.js       Admin endpoints (session, places)
  services/storage.js   R2 layout, conditional writes, retries
  services/places.js    Create/update/delete rules, slugs, versions
  services/auth.js      Password hashing, signed session cookies, account lookup
  services/uploads.js   Upload checks (type, signature, size) and streaming to R2
  utils/schema.js       Dependency-free JSON Schema validator (subset)
  utils/validation.js   Schema + cross-field content rules
  utils/responses.js    JSON/error responses + security headers
scripts/
  check.js              Static checks: syntax, EN/FR key parity, env isolation, secret scan, entry exports, schemas
  seed-content.js       Loads the starter journal into a bucket
  fixtures/             Starter destinations used by the seed script and tests
  setup-admin.js        Sets the admin password hash and session key per environment
  smoke-test.js         Post-deploy health check
  serve.py              No-cache server for the Phase 0 prototype
tests/                  node:test suites: API, conflicts, owner isolation, validation, search, i18n (in-memory R2 in tests/helpers)
.github/workflows/      validate · deploy-staging · deploy-production
wrangler.toml           Worker, assets, environments, R2 bindings
```

## Notes

- The public site reads `/api/public/dovene/*`. To show another journal, set `<html data-username="…">` (the future `/@username` URLs build on this).
- **Order and featured destinations:** destinations are listed with **featured** ones first (the ★ Feature button in the admin), then by most recent trip (`visitedAt`), then newest created. The same order applies to the homepage, the admin list and the journey. Featured destinations get a crown on their card (with a brief shimmer, static if reduced motion is on), a "Featured" label on their page, and their photos lead the homepage hero.
- **Continuous journey:** a place page opens on the chosen destination and keeps adding the next ones as you scroll, then loops back to the first. The order is the homepage list you came from: card links carry the search (`q`) and country filter (`country`). The address bar and title follow the destination in view, and Back returns to the homepage.
- Destinations without photos show a gradient placeholder, and the place page says "Photos coming soon". If the API can't be reached, the homepage and place pages show an error with a retry button.
