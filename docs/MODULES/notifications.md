# Notifications

```
status: planned
```

## Purpose

Outbound customer/staff messaging across SMS, Email, and WhatsApp: appointment lifecycle messages, marketing, and transactional receipts. Every send is asynchronous (BullMQ job); the `notifications` table is the delivery log. Bilingual: templates in English and Arabic, selected by the customer's Preferred Language.

## Primary users / permissions

System-triggered sends (appointment events, POS receipts); staff-triggered sends (Send SMS from customer profile); admins configure channels/templates in Settings → Notifications and Integrations.

## Channels

- **SMS**
- **Email**
- **WhatsApp** — *channel deferred from MVP per design-app.md §9, but template approval must start early (see below).*

Customer's **Preferred Communication** (multi-select on customer profile: SMS, Email, WhatsApp, Phone Call) governs channel choice; **Preferred Language** (English/Arabic) selects template language. Phone Call is a manual action (Call Customer button), not an automated channel.

## Known use cases (from the PDF)

From customer profile "Send SMS" action and appointment/POS flows:
1. **Appointment reminders** — also a scheduled job (hourly scan)
2. **Appointment confirmations** — sent on booking confirm ("Sends appointment notifications (if enabled)" — post-confirm action #6)
3. **Promotions** — marketing campaigns
4. **Birthday wishes** — driven by customer DOB / Special Occasions (automated greetings)
5. **Service follow-ups** — post-visit follow-up communication
6. **Receipts / invoices** — email used for appointment confirmations, invoices, account notifications; POS `pos.sale.completed` event triggers receipt notification

## Provider strategy (per design-app.md §8)

- **Adapter pattern**: a provider interface per channel; concrete adapters behind it. Email = AWS SES. SMS/WhatsApp = **Unifonic or Twilio** — decision at vendor evaluation; all code targets the interface so the vendor is swappable.
- Every send is enqueued to the BullMQ `notifications` queue; workers (separate `worker.ts` entrypoint, same image) perform delivery. Slow/flaky sends (WhatsApp) never run inside request/transaction paths — POS/appointments emit domain events (`pos.sale.completed`) and the notifications module enqueues jobs.
- Delivery log: `notifications` table (channel `sms|email|whatsapp`, `template_key`, payload JSONB, status).

## Template approval lead times

- **WhatsApp business templates take weeks to approve — start template submission early**, well before the channel ships (explicit design risk note). Applies to both Unifonic and Twilio WhatsApp Business API paths.
- SMS sender-ID registration in Oman may also carry lead time — verify during vendor evaluation.

## Scheduled/automated jobs (BullMQ repeatables)

- Appointment reminders — hourly scan for upcoming appointments
- Low-stock digest (internal/staff notification)
- (Loyalty expiry job runs daily 03:00 Asia/Muscat — could pair with "points expiring soon" customer notices later)

## Business rules

- Notifications are fire-and-forget from the caller's perspective; failures retry via BullMQ and are visible in the delivery log — never block or roll back a business transaction.
- "If enabled" gating: per-event toggles in Settings → Notifications; channel enablement also depends on Integrations configuration and customer Preferred Communication.
- Templates keyed by `template_key` with per-locale content (EN/AR); Arabic templates render RTL.

## Data-model touchpoints

`notifications` (channel, template_key, payload, status), `customers` (preferred language/communication, DOB, special occasions), `appointments` (reminders/confirmations), `invoices` (receipts), `tenant_settings` (event toggles, provider config).

## Open questions

- Final SMS/WhatsApp vendor (Unifonic vs Twilio) — pending vendor evaluation; adapter interface shields the decision.
- Reminder timing defaults (24h before? 2h before?) — Appointment Settings.
- Opt-out/consent handling for marketing (promotions, birthday) vs transactional messages — regulatory requirement in Oman to confirm.
- Template catalog: full list of template_keys and their EN/AR copy needs authoring.
- Staff-facing notifications (low-stock digest recipients, approval alerts) — delivery channel (email? in-app?) unspecified.

## Reconciliation vs 2026 client requirement doc

- ✅ **Notifications is IN SCOPE and remains a firm requirement** (confirmed with the product owner). The 2026 client requirement document simply does not cover it — that document is a **partial excerpt**, not a de-scope list, so its silence here is not a removal.
- Consequence for the rest of this refresh: absence of a feature from the 2026 req doc should **not** be read as "cut." Other omissions (see [[loyalty]], [[procurement]], and the Settings sections below) are excerpt gaps pending confirmation, not deletions.
- The 2026 req's reduced **Settings** tree omits the Notifications settings section and **Integrations** (SMS/WhatsApp credentials) — these remain required to support this module; keep them (see [[settings]]).
- Appointment confirmation/reminder sends remain expected on booking even though the 2026 wizard text does not restate them (see [[appointments]]).
