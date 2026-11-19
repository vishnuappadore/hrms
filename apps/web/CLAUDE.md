# apps/web — Next.js 15 (App Router)

## Structure
- `src/app/[locale]/(auth)/…` — public pages (login, forgot-password)
- `src/app/[locale]/(dashboard)/…` — authenticated shell (sidebar/topbar in `layout.tsx`)
- `src/app/api/…` — BFF only: auth cookie routes + `/api/proxy/[...path]` (attaches Bearer from httpOnly cookie, one refresh-retry on 401). Pages never call the NestJS API directly from the browser — always `api()` from `src/lib/api-client.ts`.

## RTL — enforced, not optional
- Tailwind **logical properties only**: `ms- me- ps- pe- text-start text-end start- end- border-s border-e rounded-s rounded-e`. `pnpm lint` runs `scripts/check-rtl.mjs` and fails on physical classes.
- `<html dir>` is set per-locale in `[locale]/layout.tsx`. Test every screen in `/ar/…` before calling it done.
- Financial numbers keep Western digits (`formatOMR` from `@hayryou/shared` handles this).

## Theming
- Light/dark via `next-themes` (`.dark` class on `<html>`, system default). Provider lives in `[locale]/providers.tsx`; `<html>` needs `suppressHydrationWarning`.
- **Brand axis**: second palette (`gold`, champagne `#c8a45a` on charcoal — from the approved claude.ai login/console design) via `data-brand` on `<html>` — `brand-switcher.tsx` toggles it, a head inline script in `[locale]/layout.tsx` re-applies it pre-paint (localStorage `hr-brand`). Brand override blocks live in globals.css (`:root[data-brand=…]` / `.dark[data-brand=…]`); any NEW brand block must have every text/bg pair contrast-validated (AA) before shipping. Per-tenant branding can later drive this attribute from tenant settings. Raw `#c8a45a` never goes on light surfaces as text — light mode uses the bronze `--primary` derivative; the gold brand's sidebar stays charcoal in both modes.
- **Use semantic token utilities, never raw palette colors on surfaces**: `bg-background bg-card bg-muted text-foreground text-muted-foreground border-border border-input bg-primary text-primary-foreground hover:bg-primary-hover bg-primary-muted text-destructive ring-ring`, plus the deep-green shell tokens `bg-sidebar text-sidebar-foreground text-sidebar-muted-foreground bg-sidebar-accent bg-sidebar-active border-sidebar-border`. Tokens are defined in `src/app/globals.css` (`:root` / `.dark`, mapped via `@theme inline` — keep it `inline` or dark mode silently breaks). `brand-*` stays for the logo/accents only. All token text/bg pairs are WCAG-AA validated — re-check contrast when changing values.
- **Fonts**: self-hosted via `next/font/local` (`src/fonts/*.woff2` — Lexend latin + Cairo arabic, the claude.ai design faces; NEVER `next/font/google`, build-time fetch breaks on some machines). `--font-lexend`/`--font-cairo` feed `--font-sans`, which switches per `dir` in globals.css (Cairo forced for RTL).
- **Icons**: `lucide-react`, `strokeWidth={1.75}`, `h-4 w-4` default; directional icons get `rtl:rotate-180`.
- Shared UI lives in `src/components/` (`theme-toggle.tsx`, `locale-switcher.tsx`, `kpi-card.tsx`, `back-link.tsx`).

## i18n workflow
1. Add the key to BOTH `src/i18n/messages/en.json` and `ar.json` (build breaks visibly on missing keys).
2. `useTranslations("scope")` in components. Never hardcode user-facing strings.
3. Navigation: import `Link/useRouter/usePathname/redirect` from `@/i18n/navigation` (locale-aware) — not from `next/link`/`next/navigation`.

## Patterns
- Server components for shells/static first paint; `"use client"` + TanStack Query for interactive data (dashboards poll with `refetchInterval: 60_000`).
- Forms: zod schema from `@hayryou/shared` (same one the API validates with). Map `ApiError.code` to localized `errors.*` messages — never display `error.message` from the API.
- Auth state: httpOnly cookies managed by BFF routes; `middleware.ts` only checks cookie presence — real authz is the API's job.
- Pages under `[locale]` that use `useTranslations` in a server component must call `setRequestLocale(locale)` first (static rendering requirement).

## Shared components (src/components/)
- `data-table.tsx` — server-driven DataTable (TanStack Table v8): controlled `page/sort` mapping 1:1 to API params, consumes the `{ data, meta }` envelope; export-button slot lands with the export endpoints. Reference consumers: `(dashboard)/branches/branches-content.tsx`, `(dashboard)/staff/staff-content.tsx`.
- `ui/` — Button, Input, Select, Switch, Checkbox, Field (label+error), Badge (variants incl. `platinum`/`bronze` tier colors, both backed by dedicated CSS tokens), Dialog (native `<dialog>`, centered), Drawer (slide-in from the trailing edge, `size="md"|"lg"|"xl"` — the counterpart to Dialog for flows that want to stay anchored to a list, e.g. Customers' Add/Edit/View, Walk-in Queue's Add/Edit/View, Appointments' Add/View/Edit), IconActionButton/IconActionLink (`view`/`edit`/`delete`/`sell`/`neutral`/`complete` variants — a table Actions-column icon well), DateRangePicker (two native `<input type="date">` fields, no date-picker library in this app — see Appointments' List/Kanban filter row), Avatar (initials placeholder), Stepper (supports `onStepClick` for jumping between steps), SegmentedControl/BoxedToggle (two toggle styles — check existing consumers before adding a third), DropdownMenu/DropdownMenuItem (hand-rolled "more actions" menu — stays in-flow, not portaled, since a modal `<dialog>`'s top layer would hide a `document.body`-portaled panel behind it), ToastProvider/`useToast` (mounted once in `dashboard-shell.tsx` so a toast survives a redirect). RTL-safe (logical props), semantic theme tokens only.
- `@dnd-kit/core` — the only drag-and-drop dependency in the app, used by Appointments' Kanban board for drag-to-change-status; check there first before adding a second DnD library.
- `recharts` — the only charting library in the app, used by Dashboard's Revenue Overview trend chart (`(dashboard)/dashboard/revenue-overview-chart.tsx`); check there first before adding a second charting library. Series colors come from the dataviz skill's validated default categorical palette (not a design-system token — none exists for charts yet), selected per light/dark via `next-themes`' `useTheme()`.
- Permission-based UI hiding: `usePermissions()` (`src/lib/permissions.ts`), called once per component, `.includes(key)` ANDed into each action's render condition — hide, don't disable. See `docs/RBAC.md`'s client-side enforcement section for the established conventions before adding gating to a new screen.
- Forms: react-hook-form + `zodResolver` on the SAME shared schema the API validates (see `branches/branch-form.tsx`, `staff/user-form.tsx`); map `ApiError.code` → `setError`/banner, never raw messages.
- Query hooks live in `src/lib/queries/<domain>.ts`; keys mirror API params (`['branches', params]`); mutations invalidate list keys.

## Not yet built
Export buttons (no export endpoints yet), shadcn/ui setup, forgot-password page, Playwright smoke tests. Nav links for Loyalty, Inventory, and Reports 404 until those modules land — every other nav item (Dashboard — now with real data, Appointments, POS, Walk-in Queue, Customers, Staff, Attendance, Leave, Payroll, Branches, Settings incl. Services/Roles & Permissions) is live.
