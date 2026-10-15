# Website hosting, domains, DNS

Domain, DNS and caching for `iliad-intensive.org`. The gh-pages branch model is
in [`PR-PREVIEWS.md`](PR-PREVIEWS.md).

## Accounts

| Thing | Where |
|---|---|
| Cloudflare (both zones) | `iliad-admin@proton.me` |
| GitHub Pages settings | repo admin on `iliad-team/iliad-intensive` |

Nameservers for both zones: `jose.ns.cloudflare.com`, `adelaide.ns.cloudflare.com`.

## Topology

```
iliad-intensive.org   → GitHub Pages (apex, DNS-only)   ← canonical, the site
www.iliad-intensive.org → CNAME iliad-team.github.io    → 301 to apex by Pages
iliad-intensive.com   → Cloudflare proxy, 302 → .org    ← redirect only
iliad-team.github.io/iliad-intensive/ → 301 → .org      ← automatic, by Pages
```

Pages allows one custom domain per repo, so the `.com` is a redirect.

## Cloudflare — `iliad-intensive.org` (DNS only)

All records grey cloud ("DNS only"):

| Type | Name | Value |
|---|---|---|
| A | `@` | `185.199.108.153`, `.109.153`, `.110.153`, `.111.153` |
| CNAME | `www` | `iliad-team.github.io` |

No AAAA (optional; GitHub's are `2606:50c0:800{0,1,2,3}::153`). No MX, no CAA.
Check both before touching the apex; any CAA must permit Let's Encrypt.

**Keep it grey.** Proxying breaks things:

- Pages gets its cert by ACME HTTP-01, which GitHub must answer. Proxied,
  Cloudflare answers and the cert never issues or renews (next renewal
  **2026-12-07**).
- Proxied with SSL mode Flexible gives an infinite redirect loop. If ever
  re-proxied, use Full or Full (strict), and only after the cert is issued.

## Cloudflare — `iliad-intensive.com` (proxied)

Orange cloud (Redirect Rules need it). Apex and `www` (Cloudflare IPs `104.21.55.200`, `172.67.172.164`).

One Redirect Rule:

- **If:** `All incoming requests`. Covers apex and `www`, but would also catch
  any new subdomain; switch to a custom filter then.
- **Then:** URL redirect, type Dynamic, expression
  `concat("https://iliad-intensive.org", http.request.uri.path)`,
  preserve query string on, status 302.

Target the apex; `www` adds a hop. Static redirects drop the path, so it must be
Dynamic. Equivalent wildcard form: `https://*iliad-intensive.com/*` →
`https://iliad-intensive.org/${2}`.

### Why 302 and not 301

With no `Cache-Control` on the redirect, browsers cache a 301 indefinitely and
it cannot be revoked remotely. Keep 302 unless the rebrand is permanent; then
use 301 with a short `max-age` if Cloudflare allows one.

## GitHub Pages side

Source: `gh-pages` / `(root)`, legacy branch build. Config via API:

```sh
gh api repos/iliad-team/iliad-intensive/pages --jq \
  '{cname, status, https_enforced, cert: .https_certificate.state}'
gh api -X PUT repos/iliad-team/iliad-intensive/pages -f cname=iliad-intensive.org
gh api -X PUT repos/iliad-team/iliad-intensive/pages -F https_enforced=true
```

Setting `cname`:

- routes the `Host:` to this repo (null gives "There isn't a GitHub Pages site here");
- starts ACME issuance;
- 301s `github.io/iliad-intensive/*` to the domain;
- writes a `CNAME` file to `gh-pages`.

**`https_enforced` resets to `false` on every domain change.** Re-set it once
`.https_certificate.state == "approved"`.

### `public/CNAME` is not optional

`public/CNAME` (one line, `iliad-intensive.org`) is copied to `out/CNAME` by the
static export, then to `gh-pages:/CNAME`. `.github/publish-gh-pages.sh`
force-pushes an orphan commit that replaces the whole branch, so a `CNAME` set
only in Settings → Pages is lost on the next deploy, which un-claims the domain.
**Do not delete it.** (It is unrelated to a DNS CNAME record.)

## Base paths

Production has no prefix; previews do.

| Event | `NEXT_PUBLIC_BASE_PATH` |
|---|---|
| push to `main` | *(empty)* |
| PR #N | `/pr-preview/pr-N` |

**Trap:** `package.json`'s `ci` script must keep an empty default.
`${VAR:-default}` substitutes on empty as well as unset, so a non-empty default
re-prefixes production while CI logs look correct.

Author MDX cross-links root-relative (`/agency/reinforcement-learning/`);
the `a` override in `src/lib/mdx.tsx` applies the basePath. Never hardcode an
absolute site URL in `tex/`.

## Caching

Pages sends `max-age=600` on everything, including `_next/static/*`. Fastly edge
(`X-Cache`, `Age`) and browser both cache, so the old build can show for 10 min
after a deploy.

Don't debug a build from an HTTP fetch. Read the deployed tree:

```sh
git fetch origin gh-pages
git show origin/gh-pages:index.html | grep -o '\(src\|href\)="/[^"]*_next[^"]*"' | head -3
git show origin/gh-pages:CNAME
git log --oneline -1 origin/gh-pages     # "Deploy <main sha>"
```

A `?cb=$RANDOM` query bypasses the edge cache.

## Verify

```sh
dig +short @jose.ns.cloudflare.com A iliad-intensive.org        # 185.199.10x.153
curl -sI https://iliad-intensive.org/ | head -1                 # 200, server: GitHub.com
curl -sI http://iliad-intensive.org/agency/aixi/ | head -2      # 301 → https
curl -so /dev/null -L -w '%{url_effective} %{num_redirects}\n' \
  https://iliad-intensive.com/agency/aixi/                      # …org/agency/aixi/ 1
```

`server: cloudflare` on the `.org` means a record went orange and the cert will
fail to renew. Grey it.

## Failure modes

| Symptom | Cause |
|---|---|
| "There isn't a GitHub Pages site here" | `cname` null, or `public/CNAME` lost to a force-push |
| Cert never issues / `state != approved` | `.org` record proxied (orange), or CAA blocking Let's Encrypt |
| Infinite redirect loop | `.org` proxied with SSL mode Flexible |
| Redirects land on `http://` | `https_enforced` false after a domain change |
| Site unstyled, assets 404 | prefixed build at the domain root — base path default non-empty |
| `.com` lands on homepage, not the path | redirect rule is Static type (query preserved, path not) |
| Stale build after deploy | `max-age=600`; check `origin/gh-pages`, not HTTP |
