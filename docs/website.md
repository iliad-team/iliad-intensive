# Website hosting, domains, DNS

How `iliad-intensive.org` is served. The gh-pages branch model itself (single
branch, orphan force-push, previews) is [`PR-PREVIEWS.md`](PR-PREVIEWS.md); this
file is the domain/DNS/caching layer on top of it.

Cut over 2026-09-08 (PR #131). Before that the domain was a Cloudflare 302 to
`iliad-team.github.io/iliad-intensive/`.

## Accounts

| Thing | Where |
|---|---|
| Cloudflare (both zones) | **`iliad-admin@proton.me`** |
| GitHub Pages settings | repo admin on `iliad-team/iliad-intensive` |

Nameservers for both zones: `jose.ns.cloudflare.com`, `adelaide.ns.cloudflare.com`.

## Topology

```
iliad-intensive.org   → GitHub Pages (apex, DNS-only)   ← canonical, the site
www.iliad-intensive.org → CNAME iliad-team.github.io    → 301 to apex by Pages
iliad-intensive.com   → Cloudflare proxy, 302 → .org    ← redirect only
iliad-team.github.io/iliad-intensive/ → 301 → .org      ← automatic, by Pages
```

**Pages holds exactly one custom domain per repo** (`cname` is scalar). That is
why the `.com` is a redirect and not a second `CNAME`.

## Cloudflare — `iliad-intensive.org` (DNS only)

Records, all **grey cloud / "DNS only"**:

| Type | Name | Value |
|---|---|---|
| A | `@` | `185.199.108.153`, `.109.153`, `.110.153`, `.111.153` |
| CNAME | `www` | `iliad-team.github.io` |

No AAAA (optional; GitHub's are `2606:50c0:800{0,1,2,3}::153`). No MX, no CAA —
check both before touching the apex, and a CAA would have to permit Let's Encrypt.

**Grey cloud is load-bearing, not a preference:**

- Pages gets its cert by ACME **HTTP-01** — Let's Encrypt fetches
  `http://<domain>/.well-known/acme-challenge/<token>` and *GitHub* must answer.
  Proxied, Cloudflare answers instead and the cert silently never issues.
- Proxied + SSL mode **Flexible** = infinite redirect loop (Cloudflare speaks
  HTTP to origin, Pages redirects to HTTPS, repeat). If ever re-proxied, SSL mode
  must be Full or Full (strict), and only after the cert is issued.

Recommendation: leave it grey. Pages is already CDN-fronted; the proxy mainly adds
a way to break renewal (next: **2026-12-07**).

## Cloudflare — `iliad-intensive.com` (proxied)

Stays **orange cloud** — Redirect Rules only fire on proxied traffic. Apex and
`www` both proxied (Cloudflare IPs `104.21.55.200`, `172.67.172.164`).

One Redirect Rule:

- **If:** `All incoming requests` — the rule is zone-scoped, so this covers apex
  and `www` with no condition to maintain. (Caveat: it would also catch any new
  subdomain added to the zone; switch to a custom filter expression then.)
- **Then:** URL redirect, Type **Dynamic**, expression
  `concat("https://iliad-intensive.org", http.request.uri.path)`,
  **preserve query string** on, status **302**.

Target is the apex, not `www.` — pointing at `www` costs an extra hop.
Static-type redirects cannot preserve the path (they preserve query only), hence
Dynamic. Wildcard-pattern form is equivalent: `https://*iliad-intensive.com/*`
→ `https://iliad-intensive.org/${2}`.

### Why 302 and not 301

301 is cacheable by default (RFC 9110 heuristic set); 302 is not, absent explicit
headers. Neither Cloudflare's rule nor GitHub's own 301 sends `Cache-Control`, so
a 301 here lands in the browser's persistent redirect cache — and **a cached 301
short-circuits before any network request**, so there is no way to revoke it
remotely. It survives until the user clears cached files.

Keep 302 while the `.com` might ever serve something of its own. Switch to 301
only for permanent-rebrand SEO consolidation, ideally with an explicit short
`max-age` (verify Cloudflare exposes one on redirect responses first).

## GitHub Pages side

Source: `gh-pages` / `(root)`, legacy branch build. Config via API:

```sh
gh api repos/iliad-team/iliad-intensive/pages --jq \
  '{cname, status, https_enforced, cert: .https_certificate.state}'
gh api -X PUT repos/iliad-team/iliad-intensive/pages -f cname=iliad-intensive.org
gh api -X PUT repos/iliad-team/iliad-intensive/pages -F https_enforced=true
```

Setting `cname` does four things: routes `Host:` → this repo (with it null, Pages
serves "There isn't a GitHub Pages site here"); starts ACME issuance; makes
`github.io/iliad-intensive/*` 301 to the domain; writes a `CNAME` file to
`gh-pages`.

**`https_enforced` resets to `false` on every domain change** — re-set it once
`.https_certificate.state == "approved"`, or the redirects stay plain HTTP.

### `public/CNAME` is not optional

`public/CNAME` (one line, `iliad-intensive.org`) → copied verbatim to `out/CNAME`
by the static export → `gh-pages:/CNAME`.

It must live in the repo because `.github/publish-gh-pages.sh` force-pushes
`.deploy/` as a fresh **orphan** commit that *is* the whole branch: a `CNAME`
written only by Settings → Pages is gone on the next deploy, un-claiming the
domain and dead-ending the `.com` redirect. **Do not delete it.**

(Unrelated to a DNS CNAME record despite the name.)

## Base paths

Custom domain serves the `gh-pages` root at the domain root, so production has
**no** prefix; previews keep one.

| Event | `NEXT_PUBLIC_BASE_PATH` |
|---|---|
| push to `main` | *(empty)* |
| PR #N | `/pr-preview/pr-N` |

**Trap:** `package.json`'s `ci` script must keep an **empty** default.
`${VAR:-default}` substitutes on an empty value as well as an unset one, so a
non-empty default silently re-prefixes production even when the workflow asks for
none — CI logs look correct while the deployed HTML is wrong.

MDX cross-links are authored root-relative (`/agency/reinforcement-learning/`);
`src/lib/mdx.tsx`'s `a` override applies the basePath so they follow previews.
Never hardcode an absolute site URL in `tex/`.

## Caching

Pages serves **`Cache-Control: max-age=600` on everything** — HTML *and*
content-hashed `_next/static/*` assets (no long immutable TTL). Two layers, both
10 min: Fastly edge (`X-Cache`, `Age`) and the browser.

So after a deploy the live site can serve the previous build for up to 10
minutes. Observed post-merge: `X-Cache: HIT`, prefixed assets, old commit stamp,
while `gh-pages` was already correct.

**Do not debug a build from an HTTP fetch.** Read the deployed tree:

```sh
git fetch origin gh-pages
git show origin/gh-pages:index.html | grep -o '\(src\|href\)="/[^"]*_next[^"]*"' | head -3
git show origin/gh-pages:CNAME
git log --oneline -1 origin/gh-pages     # "Deploy <main sha>"
```

A `?cb=$RANDOM` query also misses the edge cache.

## Verify

```sh
dig +short @jose.ns.cloudflare.com A iliad-intensive.org        # 185.199.10x.153
curl -sI https://iliad-intensive.org/ | head -1                 # 200, server: GitHub.com
curl -sI http://iliad-intensive.org/agency/aixi/ | head -2      # 301 → https
curl -so /dev/null -L -w '%{url_effective} %{num_redirects}\n' \
  https://iliad-intensive.com/agency/aixi/                      # …org/agency/aixi/ 1
```

`server: cloudflare` on the `.org` means a record went orange — the cert will
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
