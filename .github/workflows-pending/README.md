# Pending workflow

`ci.yml` here supersedes `.github/workflows/ci.yml`. It runs lint → typecheck → test →
build, then deploys to **GitHub Pages** from the default branch.

It sits here because the token this session pushes with lacks GitHub's `workflow` scope,
so it cannot write into `.github/workflows/`. Nothing is wrong with the file.

GitHub Pages on the Free plan only publishes from **public** repositories — fine now that
the repo is public. (An earlier version of this file targeted Cloudflare Pages instead,
while the repo was still private; reverted along with the rest of the rename.)

## One-time repo setting

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Without it the deploy job fails with a permissions error. This uses the Actions-based
Pages flow (`upload-pages-artifact` + `deploy-pages`) rather than a `gh-pages` branch —
no branch to force-push, no Jekyll to disable, and the artifact is built once by the job
that already ran the tests.

The site publishes at `https://<user>.github.io/<repo>/`. `BASE_PATH` is derived from
`github.event.repository.name` at build time, so it tracks a repo rename automatically.

## Activate

```sh
git mv -f .github/workflows-pending/ci.yml .github/workflows/ci.yml
rm -rf .github/workflows-pending
git add -A && git commit -m "Deploy to GitHub Pages from CI" && git push
```
