# Pending workflow

`ci.yml` here supersedes `.github/workflows/ci.yml`. It runs lint → typecheck → test →
build, then deploys to **Cloudflare Pages** on the default branch.

It sits here because the token this session pushes with lacks GitHub's `workflow` scope,
so it cannot write into `.github/workflows/`. Nothing is wrong with the file.

## Why Cloudflare Pages and not GitHub Pages

GitHub Pages on the Free plan only publishes from **public** repositories. Cloudflare Pages
is free, works with private repos, and serves from the root of its own subdomain — so the
`/timeslife/` base-path handling GitHub Pages needed is not required here.

It also lines up with where the project is heading: `docs/PLAN.md` specs the eventual sync
relay as a Cloudflare Worker + Durable Object, and the optional OAuth token broker is the
same shape.

## Setup (one time)

1. **Create the Pages project.** Cloudflare dashboard → Workers & Pages → Create →
   Pages → *Direct Upload*, name it `timeslife`. (Direct Upload, not Git — this workflow
   pushes the build itself, so Cloudflare never needs repo access.)
2. **Create an API token.** My Profile → API Tokens → Create Token → template
   *Edit Cloudflare Workers*, or a custom token with `Account → Cloudflare Pages → Edit`.
3. **Add repo secrets** under Settings → Secrets and variables → Actions:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID` (dashboard URL, or Workers & Pages → right sidebar)

Site lands at `https://timeslife.pages.dev`.

## Activate

```sh
git mv -f .github/workflows-pending/ci.yml .github/workflows/ci.yml
rm -rf .github/workflows-pending
git add -A && git commit -m "Deploy to Cloudflare Pages from CI" && git push
```

## Alternative: skip the workflow entirely

Cloudflare Pages can build from the repo directly (Workers & Pages → Create → Pages →
Connect to Git; build command `pnpm build`, output `apps/web/dist`). Zero workflow code —
but the build config then lives in the dashboard instead of in git, and deploys are no
longer gated on tests passing.
