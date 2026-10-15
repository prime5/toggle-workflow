# toggle-workflow: implementation plan

For: an AI coding agent working in this repo with no other context. Read `README.md` (design) and both `AGENTS.md` files (the installed Next.js and Turborepo are newer than your training data, so check the installed docs instead of assuming APIs).

Do **one step per session**. The person will tell you which step.

## Ground rules (every step)

- Stack is fixed: pnpm 12 workspaces, Turborepo 2.11, TypeScript 7, Node 26, Fastify 5 (`apps/server`), Next.js 16 + React 19 (`apps/admin`), shared types in `packages/sdk`.
- Keep the existing API error shape: `{ error: { code, message, details? } }`, with codes in our own namespace (never leak `FST_ERR_*`).
- Server tests: `node:test` + `app.inject`, built via `tsconfig.test.json` into `dist-test/`. Front-end tests: vitest (added in step 1.2).
- Dependencies: the ones listed in a step are pre-approved. Ask before adding anything else.
- Done means: from the repo root, `pnpm build`, `pnpm typecheck` and `pnpm test` pass; README updated for anything user-visible; one or more commits on `main` authored as `Pramathesh Malshe <pramathesh.malshe@gmail.com>`. **Do not push.**
- Report back: what you built, test count and results, real command output demonstrating it, and every decision this plan did not cover.
- Don't build ahead. If a later step needs a hook, leave a short comment, not code.

## Status

- [x] **1.1 Flag server**: CRUD, evaluation, validation, archive, stale, shutdown. Done (commits 4898502, 2d95c2c).
- [x] **1.2 SDK**: client, last-known values, circuit breaker, shared client, React hook.
- [ ] 1.3 Admin console + demo app
- [ ] 2 PR linking
- [ ] 3 Preview links
- [ ] 3b Microfrontends
- [ ] 4 Merge gate
- [ ] 5 Commit trace

Tick a box in the same commit that finishes the step.

---

## Phase 1: flag service

### 1.2 SDK (`packages/sdk`)

First, three leftovers from review of 1.1, in `apps/server`:
1. POST and PATCH responses include `stale` (use `withStale`), same as GET.
2. Map common Fastify client errors to our codes (`FST_ERR_CTP_INVALID_JSON` → `INVALID_JSON`, unsupported media type → `UNSUPPORTED_MEDIA_TYPE`, anything else 4xx → `BAD_REQUEST`).
3. README: document the error shape and the codes.

Then the SDK:
- `createFlagClient({ baseUrl, context, fetch?, pollIntervalMs = 30000, timeoutMs = 2000 })` with `isEnabled(key): boolean`, `subscribe(listener)`, `close()`.
- **Never throws to the app and never blocks rendering.** Unknown flags return `false`.
- **Last-known values:** keep the last good snapshot in memory and in `localStorage` when it's available (wrap in try/catch). On startup, serve the stored snapshot immediately, then refresh.
- **Circuit breaker** (write it, ~60 lines, no library): closed → open after 3 consecutive failures/timeouts; open serves last-known values and skips requests for a cooldown (start 5s, double up to 60s); half-open sends one probe; success → closed. Expose `client.status(): "live" | "cached" | "degraded"` for debugging.
- Polling for now. (Server-sent events are a later improvement: leave a comment, don't build.)
- **One client per page, even across microfrontends** (needed by step 3b). Two separately bundled apps on one page must not each poll, cache and run a breaker: mid-rollout or with one breaker open, parts of the page would disagree. `createFlagClient` registers the client on `globalThis` under a versioned key (`Symbol.for("toggle-workflow.sdk.v1")`, keyed by `baseUrl` + `userKey`) and returns the existing one if present; `close()` removes it. React `useFlag` reads that shared client.
- React entry (`@toggle-workflow/sdk/react`): `<FlagProvider client>` and `useFlag(key): boolean`, built on `useSyncExternalStore`.
- Package exports: `.` (core, no React) and `./react`. React is a peer dependency.
- Tests (vitest; jsdom where needed): fallback to cached values when fetch fails, breaker transitions with fake timers (closed → open → half-open → closed), timeout counts as failure, `useFlag` re-renders on change, localStorage unavailable doesn't crash, two independently imported copies of the SDK share one client (one fetch per poll).
- Pre-approved deps: `react` and `react-dom` (peer + dev), `vitest`, `jsdom`, `@testing-library/react`.

### 1.3 Admin console (`apps/admin`) + demo app (`apps/demo`)

Admin, talking to the server over HTTP (base URL from env `FLAG_SERVER_URL`):
- Flag list: key, owner, on/off, rollout %, expiry, **stale badge**, filter to show archived.
- Create form, edit page (rollout slider, target customers, owner, expiry), archive with confirmation.
- **Kill switch** on the list and the edit page: one click, confirmation, visible state.
- Show server validation `details` next to the right field. Errors must say what to fix.
- Placeholder sections on the flag page for "Pull requests" and "Preview", labelled "coming in phase 2/3".

Demo app (`apps/demo`, small Next.js app): a fake shop page whose checkout panel is behind `useFlag("new-checkout")`. It's the test subject for phases 3–5, so give it tests for **both** states: old checkout with the flag off, new checkout with it on, with the flag state injected through the SDK (no server needed in tests).

- Tests: component tests for the kill switch and form error display; demo tests in both flag states.
- `pnpm dev` starts server (4000), admin (3000), demo (3001).

---

## Phase 2: PR linking

Goal: a flag's page lists every PR that touches it, found automatically.

- **Auth first**, because the server gets external traffic from here on: admin API requires `Authorization: Bearer <ADMIN_TOKEN>` (env). `/v1/evaluate` stays open. Admin console sends the token server-side only.
- **GitHub App** (`apps/github`, or a Fastify plugin in the server: pick one and say why). Receives `pull_request` (opened, synchronize, closed, labeled) webhooks; **verify the webhook signature**.
- **Linking sources:**
  1. *Scan:* fetch the PR diff and match flag calls on added/changed lines: `useFlag("key")`, `isEnabled("key")`, single or double quotes. Only keys that exist in the store.
  2. *Label:* `flag:<key>` for what the scan can't see.
- Storage: `pr_links` (repo, pr_number, head_sha, title, state open/merged/closed, flag_key, source scan|label, updated_at). Re-scan on every `synchronize`; remove links the new diff no longer has (unless labelled).
- API: `GET /v1/admin/flags/:key/prs`. Admin flag page shows them with state and source.
- Local dev: document webhook forwarding with smee.io; include a fixture-driven test using recorded webhook payloads (no live GitHub in tests).
- Pre-approved deps: `@octokit/webhooks`, `@octokit/rest`, `@octokit/auth-app`.

## Phase 3: preview links

Goal: "preview this feature" is a link. No per-PR environments: `main` is deployed once and the viewer gets a flag override.

- **Security rule: overrides only via a signed token.** A plain `?flags=x:on` must do nothing, otherwise anyone can switch on unreleased features in production.
- Admin "Create preview link" → server issues a token: HMAC-SHA256 over `{ flags: {key: bool}, exp }` with `PREVIEW_SECRET`, max 24h.
- Demo app reads `?preview=<token>`, stores it in a session cookie, and the SDK sends it with `/v1/evaluate`. Server verifies signature and expiry, applies overrides on top of normal evaluation, and the response marks overridden keys.
- Visible banner in the demo while a preview is active, with "exit preview".
- Tests: valid token applies; expired, tampered, or unknown-flag tokens are ignored (normal evaluation, no error to the end user); plain query param does nothing.

## Phase 3b: microfrontends

Goal: the platform works for an app split into independently deployed parts, and a flag can decide which part serves a page. This is the case where flags matter most: parts ship at different times, so the flag, not the deploy, has to decide what users see.

**Approach: Next.js Multi-Zones**, not Module Federation. Zones are page/path-level, officially documented for Next.js 16 (read `docs/01-app/02-guides/multi-zones.md` in the installed `next`), and served from one domain, so the preview cookie and the shared SDK client work unchanged. Module Federation's App Router support could not be confirmed (10/14); don't use it. The admin console stays one app: one owner, no team-autonomy problem to solve.

- **Split `apps/demo`** into a shell zone (`apps/demo`, `/`) and a checkout zone (`apps/demo-checkout`, `/checkout`, own `assetPrefix`). Cross-zone links are plain `<a>` (hard navigation); say so in the README.
- **Flag-driven routing:** the shell's `proxy` evaluates `new-checkout` for the request and sends `/checkout` to the new checkout zone when on, the old checkout page when off. Default to rewrites where no flag decision is needed.
- **Version skew guard:** a flag may declare `requiresZones: [{ zone, minBuild }]`. Each zone sends its zone name and build id with `/v1/evaluate` (SDK option). The server evaluates a flag as **off** for a request when a required zone has not reported a qualifying build, and the response says why (`reason: "ZONE_NOT_READY"`). So a flag can't be switched on ahead of the code that implements it.
- **Consistency:** the proxy's routing decision and the SDK inside the zone must agree for the same user, including when the SDK is serving cached values. Decide and document which wins on disagreement.
- Admin flag page: show required zones and each zone's last reported build.
- Tests: proxy routes by flag state; proxy and in-zone SDK agree for the same `userKey`; a flag with an unready zone evaluates off with `ZONE_NOT_READY`; a preview token works across both zones; two zones on one page share one SDK client.
- `pnpm dev` adds the checkout zone on 3002.
- Leave a comment, don't build: phase 4's matrix gains a per-zone dimension, and phase 5 must distinguish "merged" from "deployed in its zone".

## Phase 4: merge gate

Goal: every PR linked to a flag must pass **flag off: existing regression** and **flag on: that feature's tests** before it merges.

- **A reusable GitHub Action** (`actions/flag-matrix`): asks the server which flags the PR links to and outputs a job matrix: one `off` baseline + one `on` job per linked flag (each flag on alone, all others at default; never combinations).
- The SDK honours `TW_FLAG_OVERRIDES` (e.g. `new-checkout=on`) **only when `NODE_ENV=test`**, so tests can force a state without a server.
- Tests opt in to a flag's suite by tag/name convention (e.g. `@flag:new-checkout`); document the convention.
- Server collects results (`POST /v1/gates/results`, authenticated) and posts one **required GitHub check**, `toggle-workflow/flag-gates`, with a per-flag summary.
- Merge queue: support GitHub's native merge queue (`merge_group` event) so the gate also runs on the queued merge commit. **Building our own queue is out of scope.**
- Wire it on this repo using `apps/demo` as the subject; show a PR passing and a PR failing the flag-on suite.

## Phase 5: commit trace

Goal: each feature has a health history, and when it breaks you find the commit quickly.

- On every push to `main`, run the flag-on suite for each flag with linked commits; store `(flag_key, sha, result, run_url, at)`.
- Flag page: timeline of linked commits with green/red, "green through PR #4, red since PR #5".
- **Flag-scoped bisect:** given the last green and first red, binary-search **only that flag's linked commits** by dispatching the Action at each candidate SHA (`workflow_dispatch`), and report the first bad commit with its PR.
- **Cleanup checklist:** when a flag is archived or stale, scan the default branch for its code references and open a GitHub issue listing each file:line to remove, assigned to the owner.

---

## Known limitation (keep it in README)

Code outside a flag check (shared refactors, utilities) runs even when the flag is off. The platform can't isolate it, which is why the flag-off regression run is mandatory on every PR.
