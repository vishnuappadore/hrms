# Git Workflow

Trunk-based / GitHub Flow. `main` is always green and releasable; all work happens on
short-lived branches merged via pull request. No `develop`, no GitFlow — deploys roll
forward from `main` (which is why DB migrations must follow expand → migrate → contract).

## The rules

1. **Never commit directly to `main`.** Branch first, even for one-line fixes.
2. **One branch = one focused change**, alive for hours-to-days, not weeks. If a module
   takes longer, land it in slices behind the module's nav link (pages can 404 until ready).
3. **PR into `main`** with CI green. Squash-merge → linear history, one commit per change.
4. **Rebase on `main`** (`git pull --rebase origin main`) before opening/updating a PR;
   never merge `main` into your branch.

## Branch naming

```
<type>/<module>-<short-description>
```

| type | use |
|---|---|
| `feat` | new functionality (`feat/customers-list`, `feat/pos-checkout-tx`) |
| `fix` | bug fixes (`fix/branches-staff-count`) |
| `chore` | deps, tooling, CI, infra (`chore/upgrade-next`) |
| `refactor` | behavior-preserving restructuring |
| `docs` | documentation only |
| `test` | test-only additions |

Module names follow `docs/MODULES/` (branches, customers, appointments, pos, staff,
inventory, procurement, finance, loyalty, settings, notifications, auth, dashboard).

## Commit messages

`<module>: <imperative summary>` — e.g. `customers: two-step add flow with mobile dedupe`.
The squash commit title becomes the PR title, so name PRs the same way. Body: what + why,
plus any migration/rollout notes.

## PR checklist (reviewer + author)

- [ ] CI green — lint (incl. `check-rtl`), typecheck, unit, integration (incl. RLS suite)
- [ ] New/changed screens verified under `/ar/…` (RTL + Arabic strings in BOTH message files)
- [ ] New tenant tables have RLS in the same migration; migrations are expand-only
      (no rename/drop while old code may still run)
- [ ] API shape changes started in `packages/shared` and both apps compile
- [ ] Money paths use `packages/shared/src/money.ts` (no floats, no ad-hoc rounding)
- [ ] Tenant-scoped code has a cross-tenant test + permission-denied test

Review: 1 approval for normal changes. Anything touching **tenant isolation (RLS),
money math, or auth** gets a second pair of eyes.

## Hotfixes & releases

- Hotfix = same flow, just prioritized: `fix/...` → PR → squash → deploy `main`.
- When a phase milestone demos/deploys, tag it: `git tag -a v0.<phase>.<n> -m "..."` and push tags.

## One-time GitHub setup (when the remote is created)

```bash
gh repo create <org>/hayryou --private --source . --push

# Protect main: require the CI check + 1 review, block direct pushes & force pushes
gh api -X PUT "repos/{owner}/{repo}/branches/main/protection" \
  -F required_status_checks[strict]=true \
  -F "required_status_checks[contexts][]=checks" \
  -F required_pull_request_reviews[required_approving_review_count]=1 \
  -F enforce_admins=false \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

Repo settings: enable **squash merge only** (disable merge commits + rebase merge),
default to PR title for the squash commit, and auto-delete head branches after merge.
