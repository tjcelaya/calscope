# Pending workflow

`ci.yml` here supersedes `.github/workflows/ci.yml`. It adds a GitHub Pages deploy job on
top of lint → typecheck → test → build.

It sits here because the token this session pushes with lacks GitHub's `workflow` scope,
so it cannot write into `.github/workflows/`. Nothing is wrong with the file.

## Activate

```sh
git mv -f .github/workflows-pending/ci.yml .github/workflows/ci.yml
git rm -r --cached .github/workflows-pending 2>/dev/null || true
rm -rf .github/workflows-pending
git add -A && git commit -m "Deploy to GitHub Pages from CI" && git push
```

## One-time repo setting

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Without this the deploy job fails with a permissions error. This uses the Actions-based
Pages flow rather than a `gh-pages` branch — no branch to force-push, no Jekyll to disable,
and the artifact is built once by the job that already ran the tests.

The site publishes at `https://<user>.github.io/<repo>/`. Only the default branch deploys.
