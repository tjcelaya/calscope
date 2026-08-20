# Pending workflow

`ci.yml` runs lint → typecheck → test → build on every push and pull request.

It lives here rather than in `.github/workflows/` because the token this session
pushes with lacks GitHub's `workflow` scope, and the GitHub App has no write
access to this repository — so neither path could create the file. Nothing is
wrong with the workflow itself.

To activate it:

```sh
git mv .github/workflows-pending/ci.yml .github/workflows/ci.yml
rmdir .github/workflows-pending 2>/dev/null || true
git commit -m "Enable CI workflow"
git push
```

Pushed from your own machine this succeeds, since your credentials carry the
`workflow` scope.
