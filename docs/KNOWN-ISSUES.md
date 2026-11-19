# Known Issues

Cross-cutting bugs/gaps that don't belong to one module doc, or where a fix has been deliberately deferred pending a decision. Each entry: title, status, root cause, options considered, and what's actually decided so far (vs. still open).

---

## Newly created Branch is invisible to its own creator (non-all-branches users)

**Status:** Open — decision deferred, documented 2026-08-12. No code changes made.

**Reported as:** in the Branches module, when a user adds/updates a branch, if that branch wasn't already assigned to them (via the Staff module's branch access), it doesn't show up for them in the Branches list after a successful save.

### Root cause (confirmed by reading the code, not assumed)

- `GET /branches` filters by `getEffectiveBranchIds()` (`apps/api/src/common/request-context.ts:39-42`): returns `undefined` (no filter) for a user with `allBranches: true`, else their own JWT-snapshotted `branchIds`. Applied in `branches.service.ts:25-28`'s `list()`.
- `POST /branches` (`branches.service.ts`'s `create()`) never grants the creator access to the branch they just made — it only stamps `createdBy` for audit; it never writes a `user_branch_assignments` row.
- **All-branches users are already unaffected** — confirmed: `getEffectiveBranchIds()` returns `undefined` for them, so a branch they create appears on their very next list fetch with zero extra work. No fix needed for this case.
- **This is create-only, never update** — confirmed: `PATCH /branches/:branchId` is gated by `@BranchScoped("branchId")` (`apps/api/src/common/guards/branch-scope.guard.ts:23-49`), which requires the actor to already have effective access to that exact branch *before* the update can run; the update itself never touches the actor's own access. So a successful update can never make a previously-visible branch disappear.
- Also relevant: `GET/PATCH /branches/:branchId` (single-resource routes) carry the same `@BranchScoped` guard — an affected creator can't view or edit the branch they just made either, not just "missing from the list."
- In practice this can only happen via a **custom tenant role** that grants `branches.create`/`branches.update` without `allBranches: true`. No seeded system role has that combination today — Super Admin is the only seeded role with `branches.create`, and it's always `allBranches: true`.

### Options considered (none implemented)

1. **Broaden Branches-list visibility for management permissions** — anyone holding `branches.create`/`branches.update` sees all branches in the tenant (bypass the effective-branch-id filter for that permission). No session/token changes needed. Tradeoff: widens what these users can already see, not just what they created.
2. **Auto-assign the new branch to the creator's own `branchIds` + force a session refresh** — matches "assign it from the Staff module" literally. Branch access is JWT-snapshotted at login (`docs/RBAC.md`), so a plain DB grant wouldn't take effect until the next token refresh — this option needs to also solve that. Bigger change (touches auth token issuance), and it's a side effect on an unrelated action (creating a branch permanently grants the creator access to it).
3. **UX-only: explain the gap, don't change access** — after a create where the actor isn't all-branches, show a clear message that the branch won't appear in their list (or be directly viewable/editable by them) until an administrator assigns them, instead of silently vanishing. Lowest risk; doesn't solve the underlying workflow gap.
4. **Prevent the configuration via role policy** — block granting `branches.create`/`branches.update` to a non-all-branches role in the first place, matching how the seeded roles already work.

### Decided so far

- All-branches users: no fix needed (verified correct as-is).
- Individually branch-scoped users: leaning toward **option 3 (UX-only)** — not yet implemented.

### Follow-up needed

Pick one of the above (or a combination) and implement. Option 3's concrete shape (if chosen): in `apps/web/src/app/[locale]/(dashboard)/branches/branch-form.tsx`, after a successful **create** (never update) where `useMe().data?.allBranches` is falsy, redirect to the branches list with a flash flag (e.g. `/branches?justCreatedUnassigned=1`) instead of a bare redirect, and have the list page show a one-time info banner explaining the gap (reusing the existing inline `<p role="alert">` shape used elsewhere in this codebase, with neutral/info styling instead of destructive — there's no toast/notification system in this app to reuse instead).
