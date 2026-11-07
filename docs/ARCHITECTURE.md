# Architecture — Mécanique Mobile H.I.S (V2)

The app of a **mobile garage** in Montréal: the owner (Hassan) and the office book appointments by phone into time
**blocks** (matin 8–12, après-midi 12–16, soir 16–20); the server places each job on a truck and orders the stops
from « Départ des camions » (`settings.booking.home`, Réglages → Réservations; also reached from Horaires and the map
legend): cheapest insertion, then each truck's route improved (`route_improve`: a piece turned around, a stop moved).
Moving the start or a number of the route estimate re-plans every coming booked block (trigger `settings_replan`,
Part 17). Each truck may leave from its own address (`trucks.start`, Horaires → « Départ de ce camion », Part 18); the afternoon and evening leave from the truck's last stop of the block before, and each block tries to end near the next one's first stop (only with an order that still fits in the truck's hours); the mechanics (Saleh: Camion Complet, Adam: Voiture) do the work at the customer's place, get the waiver signed, invoice
and get paid before leaving; a treasurer keeps the books. People are beginners with apps: **simple words, one obvious
action per screen, help bubbles « ? »**. Read `docs/DESIGN.md` first (the look and the writing rules).

Languages: French (Québec) first, English second. Phones first (mechanics with gloves, in the sun), computer second.

## Stack

Vite 7 · Preact 10 + `@preact/signals` · TypeScript strict · no CSS framework (our own tokens) · `lucide-preact` icons ·
Supabase (Postgres with row-level security, RPC functions, Edge Functions) · IndexedDB copy of the data (works offline) ·
PWA (installable, offline shell). Allowed libraries (already installed): `leaflet`, `jspdf`, `jspdf-autotable`, `fflate`,
`idb`. **Do not add packages.** Heavy tools loaded only when used come from `https://cdn.jsdelivr.net/npm/<pkg>@<exact version>`
(cached by the service worker), e.g. `tesseract.js@5.1.1` for reading receipts.

## Folders

```
src/
  main.tsx              boot (theme, language, auth, PWA)
  app/                  frame: router, routes table, Shell (bars, menu, banners), theme, pwa, media (wide/touch)
  data/                 types, store (in-memory tables), select (lookups), api (every change), sync (offline outbox), auth (who/rights)
  lib/                  dates, money, text (phone, postal code, VIN, search), i18n, config
  ui/                   the design kit (import from '../../ui')
  i18n/fr|en/<section>.ts   one dictionary file per section
  features/<section>/   the screens and components of a section
  client/               the customer's public page (client.html: #t= appointment/invoice, #suivi= tracking, #reserver online booking)
  dev/                  demo mode (dev only): fake server + demo data
supabase/migrations     the database: tables, rights, planner, money rules (the truth — read it)
supabase/functions      server functions: notify, enroute, client, book, stripe, vin, team
```

## Reading data

Every synced table is in memory (a signal per table). Screens read through **selectors** in `src/data/select.ts`
(`settings`, `blocks`, `trucks`, `truckLabel`, `truckColor`, `truckRanges`, `weekOf`, `blockLoad`, `customer`,
`customerName`, `customersList`, `vehicle`, `vehiclesOf`, `vehicleLabel`, `job`, `jobsOn`, `jobsBetween`,
`jobsOfCustomer`, `itemsOf`, `jobTotals`, `invoiceOf`, `paymentsOf`, `invoiceNumber`, `invoicesList`, `activeTrip`,
`messagesOf`, `servicesList`, `activeServices`, `service`, `serviceName`, `partsOfService`, `inventoryList`, `lowStock`,
`movesOf`, `quotesList`, `expensesList`, `openShift`, `positionOf`, `staffList`, `staff`, `staffName`, `specByKey`,
`notesOf`, `garageName`) or directly with `rowsOf('table')`, `getRow('table', id)`, `tableSignal('table')` from
`src/data/store.ts`. A component that calls them re-renders when the data changes. Add your own small selectors inside
your section (e.g. `features/agenda/select.ts`); do not edit `src/data/*`.

Row shapes: `src/data/types.ts` (money in **cents**, times in **minutes after midnight**, days `'YYYY-MM-DD'`, week
**Sunday → Saturday**, `dow` 0 = Sunday). Who sees which rows is decided by the database (a mechanic only has the jobs
of his truck): never assume the device holds everything.

Some answers need the server (not offline): `suggestBlocks()`, `rpcNow(name, args)` (any read-only RPC, e.g.
`team_map`, `dashboard`, `treasury_report`, `blocks_overview`, `day_path`), `callFn(name, body)` (server functions).
When there is no signal, say so in the screen (`net.value.online` from `src/data/sync.ts`) and show what the device has.

## Changing data

Only through `src/data/api.ts` (or, for something it lacks, the same primitives it uses — `insertRow`, `updateRow`,
`deleteRow`, `callRpc` from `src/data/sync.ts` — inside your own section file). Rules:
- A table write (`saveCustomer`, `saveVehicle`, `saveExpense`…) shows on screen at once and is sent when possible.
  It never throws for a refusal: a refused change appears in the « refusé » banner of the frame with the server's reason.
- An operation (`bookJob`, `jobStep`, `invoiceForJob`, `finishInvoice`, `addPayment`, `moveJob`, `applyHours`…) waits
  up to 8 s for the server: it **throws** on refusal (show the reason), or returns `{ queued: true }` when there is no
  signal (it will be sent later, in order). Results come back as rows and update the screen by themselves.
- Wrap actions with `run(fn, { ok: 'Message' })` / `attempt(fn, { ok })` from `src/ui`: they show the success toast,
  « Gardé sur le téléphone… » when queued, or the refusal in plain words (`errorMessage(e)`). Never `alert()`.
- « Voir l'app comme… » (owner preview): every change is refused with a clear message; screens stay readable.

## Rights

`can('agenda' | 'book' | 'clients' | 'invoices' | 'edit_invoices' | 'money' | 'treasury' | 'inventory' | 'map' | 'hours' | 'settings')`,
`hasRole('owner'|'office'|'mechanic'|'treasurer')`, `isOwner()`, `myTrucks()`, `me.value` (the person on screen, or the
one previewed) from `src/data/auth.ts`; `may.*` in `src/app/routes.ts`. Hide or disable what a person can't do (the
server refuses anyway). Rules of the server worth knowing: a mechanic sees his truck's jobs, can invoice and get paid
for them, and must get paid before finishing (`pay_first`), unless the office allows « payer plus tard ».

## Screens and navigation

`src/app/routes.ts` lists every address. A screen is `export default function X({ params, query }: ScreenProps)` and
starts with `<Page title=… sub=… back="/fallback" actions=…>`. Links are `<a href="#/job/ID">` or
`href('/job/ID', { tab: 'x' })`; code uses `navigate('/…')`, `goBack('/fallback')`, `setQuery({ day: '2026-11-05' })`
(changes the query without a history step). Phone vs computer: `wide.value` from `src/app/media.ts` (≥ 960 px) only when
the content itself changes (week vs day); otherwise CSS.

Query conventions used across sections: `#/book?customer=ID`, `#/book?walkin=1`, `#/book?quote=ID`,
`#/book?day=YYYY-MM-DD&block=am`, `#/customer/new`, `#/quote/new`, `#/treasury?add=1`, `#/agenda/YYYY-MM-DD?view=week`,
`#/hours/TRUCK_ID`, `#/settings/<section>`.

## The design kit (`src/ui`)

| Need | Use |
|---|---|
| A screen | `Page` (title, sub, back, actions, help) |
| A section | `Panel` (title, sub, action, help, `flush` for rows edge to edge, `plain` inside a sheet) |
| A list | `Rows` + `RowItem` (title, sub, start, end, href/onClick, chevron) — lines with separators, not cards |
| A job | `JobTicket` (from `features/jobs`) — built on `Ticket` (stub = stop number + block) |
| The one next step | `BigStep` (icon, label, sub) — red engine-start button; **at most one per screen** |
| Buttons | `Button` (variant primary/secondary/ghost/danger, `confirm="Toucher encore pour…"` for a 2-tap destructive action, async `onClick` shows a spinner), `IconButton` (always a `label`) |
| A question | `ask({ title, text, ok, danger })` → boolean; `askText({ title, label })` → string or null (a reason) |
| A form | `Form`, `Field` (label, hint, error, optional, help; `group` for Seg/Chips), `Input`, `Textarea`, `Select`, `MoneyInput` (cents), `PhoneInput`, `SearchInput`, `Check`, `Switch`, `Seg`, `Chips`, `Stepper`, `DateInput` |
| A panel that rises | `Sheet` (open, onClose, title, footer, wide) — phone back button closes it |
| Status | `StatusPill` (job), `InvoicePill`, `Pill` (tone), `Stamp` (PAYÉ / Annulé / Absent; `animate` when it just happened) |
| Money | `Money` (cents), `Totals` (subtotal/TPS/TVQ/total/paid/balance); `money()`, `parseMoney()` in `lib/money` |
| Info | `Banner` (info/warn/bad/ok), `Empty` (title, text, action), `Help` (the « ? » bubble), `Skeleton`, `Spinner`, `Kv`, `Tabs`, `Avatar` |
| Feedback | `toast(text, { kind })`, `run()`, `attempt()` |

CSS: use the tokens (`var(--ink)`, `--ink-2`, `--line`, `--accent`, `--sp-*`, `--t-*`, `--r-*`, status `--st-*`) and the
classes in `src/ui/styles/*.css` (`stack`, `stack-lg`, `row`, `row-wrap`, `between`, `grow`, `grid-2`, `muted`, `faint`,
`num`, `small`, `ellipsis`, `glass`, `glass-strong`). Put a section's own CSS in `features/<section>/<section>.css`,
imported by its screen, with class names prefixed by the section (`.agenda-…`). Glass only on large surfaces. Every
colour must work in the 6 themes (H.I.S light/dark, Platine, Noir et or, Émeraude, Saphir, Bordeaux): use tokens, never
hard-coded colours (truck/person colours are data and are fine).

## Words (i18n)

`t('section.key', { n, name })` from `src/lib/i18n`. Each section owns `src/i18n/fr/<section>.ts` and
`src/i18n/en/<section>.ts` (the English file is typed `typeof fr` — same keys). Plurals: `{ one: '{n} job', other: '{n} jobs' }`
used with `{ n }`. Customer-facing text (invoice, estimate, texts) follows the **customer's language**
(`customer.lang`): `tl(lang, 'key')`. Writing: Québec French, tutoiement inside the team (« Choisis le bloc »),
vouvoiement for customers; plain verbs; the same word through a flow (button « Encaisser » → toast « Paiement
enregistré »); errors say what to do; no ALL-CAPS labels, no « A · B · C » strings, no arrows in buttons, no
exclamation marks except customer thanks. Dates and money via `lib/dates` (`longDay`, `tinyDay`, `clock`,
`clockRange`, `duration`, `stamp`) and `lib/money` (`money`), with `lang.value`.

## Shared components (one owner each; others only import them)

| Component | Owner | Contract (props are fixed — see the stub file) |
|---|---|---|
| `features/customers/CustomerPicker` | customers | `{ value, onPick(id), allowCreate?, autoFocus? }` |
| `features/customers/VehiclePicker` | customers | `{ customerId, value, onPick(id) }` |
| `features/customers/CarPicker` | customers | `{ value: { year, make, model }, onValue, errors?, testid? }` — Année → Marque → Modèle, no typing (models: NHTSA vPIC, kept on the phone) |
| `features/customers/vinScan` | customers | `barcodeReader()` (the phone's BarcodeDetector, else ZXing WebAssembly), `readVinPhoto(file)` (OCR + check digit) |
| `features/map/roads` | map | `routeThrough(points)` (OSRM, by the streets), `knownLeg(a, b)` |
| `app/UpdatePanel` | frame | `()` — the version on this device, « Vérifier les mises à jour » |
| `app/backdrop` | frame | `myPhoto`, `setMyPhoto(dataUrl)`, `shrinkPhoto(file)`, `fitSize(w, h)`, `HIS_NIGHT`, `HIS_DAY` — what is behind the glass (the H.I.S pictures, or my photo on this device) |
| `app/moved` | frame | `MovedBanner` — on the old address (GitHub Pages) only: the app's new address, a button to open it (sign-in screen and above every screen) |
| `app/more` | frame | pure: `filtersFor`, `tilesFor`, `dayCounts`, `dueCents`, `unpaidCount`, `TILE_HUE` — what « Plus » shows (tested in more.test.ts) |
| `features/customers/AddressField` + `geocode(q)` | customers | `{ value: PlaceValue, onValue, label? }` — leaving the field without choosing a suggestion takes the position when one place fits (`locate`) |
| `features/customers/locate` + `places` | customers | `locate(address, { postal?, city?, fresh? })` → found / choose / none / offline: the same door, street and town (or postal code) as typed, else nothing; `searchPlaces(q)` asks Photon (empty answers not kept) |
| `app/locator` | frame | `locateMissing({ only?, force? })`, `startLocator()`, `spreadToJobs(customerId, lat, lng)` — the positions still missing (customers, coming appointments) found in the background on the phones of the people who book; « Chercher » / « Trouver » ask at once. A job or customer position found later re-plans its block (server trigger, Part 15) |
| `features/inventory/needs` + `needsView` | inventory | pure `weekNeeds(input)`: what the week's appointments take (oil by grade in litres, filters, new tires by size and season, fixed parts), against the stock; `needsOf(service)` (said in Réglages, or guessed from the name); `NeedsCard` (« La journée », Thursday to Sunday); screen `#/needs?week=` |
| `features/booking/BlockPicker` | booking | `{ lat, lng, duration, excludeJob?, value, onPick({ day, block, truck_id? }) }` |
| `features/booking/ServicePicker` + `itemsDuration` | booking | `{ value: ItemDraft[], onValue, lang?, allowCustom? }` |
| `features/jobs/JobTicket` | jobs | `{ job, showDay?, showTruck? }` |
| `features/map/MapView` | map | `{ markers: MapMarker[], lines?: MapLine[], height? }` |
| `features/invoices/InvoicePanel` | invoices | `{ jobId }` |
| `features/invoices/PaySheet` | invoices | `{ open, onClose, invoiceId, onPaid? }` |
| `features/guide/GuideCard` | guide | `()` → the next first step, or null |

Keep the exported names and props exactly; you may add optional props.

## Guided tour anchors (`data-tour="…"`)

The calm tour (section guide) highlights elements by these ids; put them on the matching element in your screens:
`nav-today`, `nav-agenda`, `nav-customers`, `nav-…` and `quick-add`, `sync-state` (frame, done) · `agenda-day`,
`agenda-block`, `agenda-week` · `book-customer`, `book-vehicle`, `book-services`, `book-block`, `book-confirm` ·
`hours-truck`, `hours-grid`, `hours-apply` · `customers-search`, `customer-book` · `today-shift`, `today-next` ·
`job-bigstep`, `job-waiver`, `job-work`, `job-extra`, `job-invoice`, `job-pay` · `invoice-send`, `invoice-pay` ·
`quote-items`, `quote-send` · `team-invite`, `team-rights` · `map-legend` · `settings-company`, `settings-services`,
`settings-texts`, `settings-look`, `settings-connect` · `treasury-add`, `treasury-report` · `inventory-low` · `dashboard-kpis`.

## Server reference (read the migrations for the exact rules)

RPCs (`callRpc` through `api.ts`): `book_job(p_job, p_items)` · `walk_in(p_job, p_items)` · `move_job(p_job, p_day, p_block, p_truck)` ·
`set_job_duration` · `job_step(p_job, p_action: leave|arrive|waiver|finish|cancel|no_show|reopen|back, p_data)` (finish:
`{ pay_later?, reason? }`, cancel/no_show: `{ reason }`, waiver: `{ signer, version, attachment_id }`) · `extra_answer(p_item, p_accept, p_via)` ·
`invoice_for_job(p_job, p_refresh)` (draft from the work) · `invoice_finish(p_invoice)` (number) · `payment_add` · `payment_remove` ·
`invoice_void(p_invoice, p_reason)` · `apply_hours(p_truck, p_mode: day|weeks|always, p_week {dow: [[start,end]]}, p_from, p_weeks)` ·
`set_truck_start(p_truck, p_start {label, address, lat, lng} | null)` · `set_role_rights(p_role, p_right, p_on)` · `member_update(p_staff, p_patch)` · `shift_start()` · `shift_end()` · `report_position(…)`.
Read-only: `suggest_blocks(p_lat, p_lng, p_duration, p_from, p_days, p_exclude, p_limit)` → `[{ day, block, drive_min, near, truck, left }]` ·
`blocks_overview(p_from, p_to)` · `team_map(p_day)` → `{ home, trucks, jobs, people, trips }` · `day_path(p_staff, p_day)` ·
`dashboard(p_month)` · `treasury_report(p_from, p_to)` · `my_access()` · `access_of(p_staff)`.
Server functions (`callFn` / helpers in api.ts): `notify { kind: booking|moved|arrived|extras|invoice|payment_reminder, job_id, resend? }` →
`{ status: sent|off|no_phone|error|already, message, link, phone }` (texts go through GoHighLevel; when it is not connected the
answer gives the message and the link so the person can send it from their own phone) · `enroute { action: start|refresh|end, job_id, pos?, notify? }` ·
`vin { vin }` · `team { action: list|invite|reset-link|invite-cancel|remove|secrets|secrets-set|sms-test|leave|forgot|invite-info|invite-accept }` ·
`book { action: info|slots|book }` (public, no token: « Réserver en ligne », client.html#reserver, Part 23; calls the service-role-only
`web_services`, `web_suggest`, `web_book`; on/off = `settings.booking.web.on`, Réglages → Réservations) · `client { action: view|sign|answer|pay|check, token }` (public page: `sign { signer, png, confirm }` = the estimate signed with the
finger, which also signs the authorization of work, `waiver_via = 'online'`) · `public_track(p_token)` (RPC open to the public: tracking page).
« arrived » (sent by « Je suis arrivé ») makes the invoice draft and texts it with « Payer » (prepayment on the job; a card payment
that arrives after the invoice was finished goes on it).

## Demo mode (try and photograph your screens without the server)

`npx vite --port <your port> --strictPort` then open `http://localhost:<port>/?demo#/your/screen`
(`?demo` owner Hassan, `?demo=mechanic` Saleh, `?demo=adam`, `?demo=office`, `?demo=treasurer`). The language follows
the browser (the shot tool is French by default, `LOCALE=en-CA` for English). The whole data layer runs against a pretend
server (`src/dev/fake-server.ts`, data in `src/dev/demo-data.ts`, operations in `src/dev/demo-rpc.ts`). If your screens
need more demo rows or a pretend operation, add `src/dev/demo-extra/<section>.ts` (see its README); do not edit the
other dev files. Screenshots: `node tests/tools/shot.cjs "<url>" <out.png> phone|desktop light|dark [full]` (prints
page errors). Save them under the scratchpad folder you are given. Look at them: a screen is done when it looks right
on a phone and a computer, light and dark, in French.

## Where the app lives

**https://mecanique-mobile-his.vercel.app/** — Vercel (team NextLine, project « mecanique-mobile-his »). GitHub builds
and tests every change of `main`, then pushes the built app to the branch `vercel` (with `ops/vercel/vercel.json`:
headers, nothing built on Vercel); Vercel publishes that branch. The same build also goes to `gh-pages`, the old address
https://hostnextline.github.io/garage2.0/, kept for links already sent: it shows `MovedBanner` (`movedTo()` in
`lib/config.ts`). Links made by the server always point to `HOME_URL` (`DEFAULT_BASES` in
`supabase/functions/_shared/links.ts`; a test checks both are the same).

## Updates of the app

A new version downloads quietly and is used the next time the app opens: nothing shows at the top of the screen.
« Vérifier les mises à jour » (Réglages → Mise à jour de l'app, and Mon compte) installs it at once. The build writes
`version.json` (version, when it was made, notes); a commit with `[important]` in its message makes every phone with an
older version show a notification once (`src/app/pwa.ts`).

## Checks before you say a section is done

1. `npx tsc --noEmit -p . 2>&1 | grep -E "src/(features/<yours>|i18n/(fr|en)/<yours>|dev/demo-extra/<yours>)"` → nothing
   (other sections are being written at the same time: ignore their errors).
2. Unit tests for your pure logic: `src/features/<section>/*.test.ts` (vitest, jsdom) → `npx vitest run src/features/<section>`.
3. Screens in demo mode: phone and desktop, French and English, light and dark, no page errors; the main flows tried
   by clicking (your own Playwright script in your scratchpad: `require('playwright')` works from any folder).
   The map tiles (openstreetmap.org) and other outside sites can't be reached from this machine: that is expected.
4. Every string in both dictionaries; no hard-coded French in components (except customer data).
