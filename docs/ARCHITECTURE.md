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

Every file of `src/` sits in a **layer**. A file imports only from its own layer and from the layers its row lists
(the ones below it); tests (`*.test.ts`, `*.test.tsx`) may import anything. `src/architecture.test.ts` checks every
import at each `npm test` (« The architecture test », below).

| Layer | Holds | May import |
|---|---|---|
| `src/lib` | pure helpers: dates, money, text, the i18n runtime, config, errors (`errorMessage`, `isNetworkError`, `Refused`) | lib (and `lib/i18n.ts` the dictionaries) |
| `src/platform` | the browser: hash router (`route`, `href`, `navigate`, `goBack`, `setQuery`, `ScreenProps`), history, media (`wide`, `touch`), focus | lib |
| `src/data` | types, schema, store, local copy (IndexedDB), sync, sign-in and rights, `api.ts` (every change), `select.ts` | lib, platform |
| `src/domain/<concept>` | the garage's rules, **no JSX**, no `preact` (`@preact/signals` is fine), no `lucide-preact` | lib, platform, data, domain |
| `src/ui` | the design kit (+ `ContextMenu`) | lib, platform, ui; data only as `import type` |
| `src/services` | background work with no screen: theme, backdrop, position, push, bubbles | lib, platform, data, domain, services |
| `src/shared/<concept>` | components and hooks used by several screens, with their CSS | lib, platform, data, domain, ui, services + a shared concept of **lower rank** |
| `src/features/<section>` | the screens and their private parts | lib … shared + its **own** section; never another feature, never `src/app` |
| `src/app` | the frame: App, Shell, routes table, menu, « Plus » | anything except dev |
| `src/client` | the customer's public page | lib, platform, domain, ui, shared; never data, features, app, not even through another file |
| `src/dev` | the demo (dev only) | anything; nothing imports it except `main.tsx` (with `import()`) |
| `src/i18n` | the dictionaries | each other only; read by `lib/i18n.ts` and `client/i18n.ts` |

Rank of the shared concepts (a shared module imports only lower ranks): sign 0, look 0, export 0, app 0, places 1,
map 2, charts 2, vehicles 3, customers 4, stock 4, moment 5, jobs 6, invoices 7, guide 8.

```
src/
  main.tsx              boot (theme, language, auth, PWA); the demo (src/dev) only through import(), with ?demo in dev
  lib/                  dates, money, text (phone, postal code, VIN, names; norm/squash for search), i18n, config, errors,
                        dict-check (a test helper: two dictionaries have the same keys)
  platform/             router (the # addresses), history (a sheet's own back step), media (wide, touch, roomy), focus
  data/                 types, schema (the tables kept), store (in-memory tables), local (IndexedDB copy), select (lookups),
                        api (every change), sync (offline outbox), auth (who/rights, callFn)
  domain/               rights.ts (may, isField: who may open what)
    moment/             days and blocks in words (words, dayWords), the booking rules (logic, choice), « Choisir sur la
                        carte » (days), the time grids of « Plages d'arrivée » (grid, units), the outbox helper (outbox)
    jobs/               the one next step (steps), who may do what on a job (rights), a job in words, a day's counts
    money/              invoices and estimates (invoice, quote), the report's periods (period), expenses, the Coffre's jobs
    stock/              quantities, value and moves (stock), what the week's work takes (needs)
    oil/                « Rappels d'huile » (due, select)
    vehicles/           the old app's engine list (engineRef), cars in words
    team/               the rights of each role (rights), the « team » server function (teamApi)
  ui/                   the design kit (import from '../../ui'); ContextMenu (right-click / long press), hooks, backdrops
                        (the H.I.S pictures); styles/ (tokens, base, components, menu)
  services/             theme (the look), backdrop (my photo behind the glass), position (shared during the day), push (the
                        alert while the app is closed), bubbles (what 🤖, « Appel entrant » and « Texto entrant » share)
  shared/               one folder per concept (rank):
    sign/ (0)           SignaturePad, signature
    look/ (0)           LookChoices (« Apparence »: Réglages and Mon compte), settings.css
    export/ (0)         the accountant's files (exports, xlsx), the receipt reader (ocr)
    app/ (0)            pwa (the installed app, its updates), UpdatePanel, moved (MovedBanner)
    places/ (1)         AddressField, locate, places, photon, address, TruckStartPanel, customers.css
    map/ (2)            MapView, roads, useRoads, assemble, device, ago
    charts/ (2)         charts, useReport
    vehicles/ (3)       CarPicker, VehiclePicker, VehicleBits, SpecPanel, VinHistory, carModels, vinScan, vehicleText
    customers/ (4)      CustomerPicker, CustomerFields, bits, facts, search, dupes, shortcuts, locator, ConversationSheet,
                        Attachments, texts, conversation.css
    stock/ (4)          needsView (NeedsCard), inventory.css
    moment/ (5)         BlockPicker, WindowPicker, PickGrid, PickList, MomentMap, DayRoute, RoutePreview, ServicePicker,
                        notify, preview, useDayWindows, booking.css
    jobs/ (6)           JobTicket, CarFirst, CarCheckSheet, CarHistory, PartsSheet, StepButton, TextOutcome, flow, parts,
                        select, bookedBy, carWords, vinStep, jobs.css
    invoices/ (7)       InvoicePanel, PaySheet, Lines, send, share, pdf, usePdf, useDraft, select, invoices.css; the Coffre
                        sheet (CoffreHost, CoffreSheet, coffre.css)
    guide/ (8)          GuideCard, TourOverlay, tour, tour-steps, checklist, guide-data, words, guide.css
  features/<section>/   the screens of a section and their private parts: account, agenda, auth, booking, coffre,
                        conversation, customers, dashboard, guide, hermes, hours, info, inventory, invoices, jobs, map, oil,
                        overview, quotes, settings, team, timesheet, today, treasury
  app/                  the frame: App, Shell (bars, menu, banners), routes (every address), nav (the menu), « Plus » (more,
                        MoreScreen)
  client/               the customer's public page (client.html: #t= appointment/invoice, #suivi= tracking, #reserver online booking)
  dev/                  demo mode (dev only): fake server + demo data
  i18n/fr|en/<section>.ts   one dictionary file per section
supabase/migrations     the database: tables, rights, planner, money rules (the truth — read it)
supabase/functions      server functions: notify, enroute (a job's trip; return / return_end: the way back to the start), client, book, stripe, vin, team, conversation, backup
```

Where new code goes:
- A rule or a calculation (no drawing) → `domain/<concept>/x.ts` + `x.test.ts`.
- A component used by one section → `features/<section>/`; by several → `shared/<concept>/`.
- A section's own CSS → its folder, classes prefixed by the section.
- Words → `src/i18n/fr/<section>.ts` and `src/i18n/en/<section>.ts` (same keys; en typed `typeof fr`).

### The architecture test

`src/architecture.test.ts` runs with `npm test` (about half a second; alone: `npx vitest run src/architecture.test.ts`).
It reads every `.ts` / `.tsx` file of `src` with the TypeScript parser, resolves each import of a file of `src`
(`import … from`, `export … from`, `import()`, relative or `@/`) and fails with one line per import that breaks a rule:
`file:line → what it imports — the rule`. Its rules are the tables at the top of the file (`MAY_IMPORT`, `TYPE_ONLY`,
`SHARED_RANK`, `DOMAIN_NEVER_IMPORTS`, `CLIENT_NEVER_REACHES`, `DEV_DOOR`, `DICTIONARY_READERS`): the table above. The
customer's page is followed from `client/main.tsx` through every import that is not `import type`. Tests may import
anything; CSS and pictures follow the layer of their folder. It also refuses a code file outside the layers, a shared
concept with no rank, an import that names no file and an `import()` of a computed name. A break that cannot be fixed
at once goes in its `ALLOWED` list, with the package that owns the file and why; an entry that matches no import any
more fails the test, so the list only shrinks (empty today: the tree breaks no rule).

## Reading data

Every synced table is in memory (a signal per table). Screens read through **selectors** in `src/data/select.ts`
(`settings`, `blocks`, `trucks`, `truckLabel`, `truckColor`, `truckRanges`, `weekOf`, `blockLoad`, `customer`,
`customerName`, `customersList`, `vehicle`, `vehiclesOf`, `vehicleLabel`, `job`, `jobsOn`, `jobsBetween`,
`jobsOfCustomer`, `itemsOf`, `jobTotals`, `invoiceOf`, `paymentsOf`, `invoiceNumber`, `invoicesList`, `activeTrip`,
`messagesOf`, `servicesList`, `activeServices`, `service`, `serviceName`, `partsOfService`, `inventoryList`, `lowStock`,
`movesOf`, `quotesList`, `expensesList`, `openShift`, `positionOf`, `staffList`, `staff`, `staffName`, `specByKey`,
`notesOf`, `garageName`) or directly with `rowsOf('table')`, `getRow('table', id)`, `tableSignal('table')` from
`src/data/store.ts`. A component that calls them re-renders when the data changes. Add your own small selectors inside
your section (e.g. `features/agenda/select.ts`, `features/today/select.ts`); the ones several sections share sit with
their concept (`shared/jobs/select.ts`, `shared/invoices/select.ts`, or `domain/oil/select.ts` when they draw nothing);
do not edit `src/data/*`.

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
  « Gardé sur le téléphone… » when queued, or the refusal in plain words (`errorMessage(e)`, from `src/lib/errors.ts`;
  `src/data/api.ts` still exports it). Never `alert()`.
- « Voir l'app comme… » (owner preview): every change is refused with a clear message; screens stay readable.

## Rights

`can('agenda' | 'book' | 'clients' | 'invoices' | 'edit_invoices' | 'money' | 'treasury' | 'inventory' | 'map' | 'hours' | 'settings')`,
`hasRole('owner'|'office'|'mechanic'|'treasurer')`, `isOwner()`, `myTrucks()`, `me.value` (the person on screen, or the
one previewed) from `src/data/auth.ts`; `may.*` and `isField()` in `src/domain/rights.ts`; the rights on one job
(`jobRights`, `editRights`, `mayEditJob`, `mayChangeTruck`) in `src/domain/jobs/rights.ts`. Hide or disable what a
person can't do (the server refuses anyway). Rules of the server worth knowing: a mechanic sees his truck's jobs, can
invoice and get paid for them, and must get paid before finishing (`pay_first`), unless the office allows « payer plus
tard ».

## Screens and navigation

`src/app/routes.ts` lists every address. A screen is `export default function X({ params, query }: ScreenProps)` and
starts with `<Page title=… sub=… back="/fallback" actions=…>`. Links are `<a href="#/job/ID">` or
`href('/job/ID', { tab: 'x' })`; code uses `navigate('/…')`, `goBack('/fallback')`, `setQuery({ day: '2026-11-05' })`
(changes the query without a history step); `ScreenProps` and these four come from `src/platform/router.ts`. Phone vs
computer: `wide.value` from `src/platform/media.ts` (≥ 960 px) only when the content itself changes (week vs day);
otherwise CSS.

Query conventions used across sections: `#/book?customer=ID`, `#/book?walkin=1`, `#/book?quote=ID`,
`#/book?day=YYYY-MM-DD&block=am`, `#/customer/new`, `#/quote/new`, `#/treasury?add=1`, `#/agenda/YYYY-MM-DD?view=week`,
`#/hours/TRUCK_ID`, `#/settings/<section>`, `#/book?customer=ID&vehicle=ID` (the car already chosen), `#/oil?show=soon|all` (« Rappels d’huile »), `#/timesheet/STAFF?week=DAY` (« Heures travaillées »).

## The design kit (`src/ui`)

| Need | Use |
|---|---|
| A screen | `Page` (title, sub, back, actions, help) |
| A section | `Panel` (title, sub, action, help, `flush` for rows edge to edge, `plain` inside a sheet) |
| A list | `Rows` + `RowItem` (title, sub, start, end, href/onClick, chevron) — lines with separators, not cards |
| A job | `JobTicket` (from `shared/jobs`) — built on `Ticket` (stub = stop number + block) |
| The one next step | `BigStep` (icon, label, sub) — red engine-start button; **at most one per screen** |
| Buttons | `Button` (variant primary/secondary/ghost/danger, `confirm="Toucher encore pour…"` for a 2-tap destructive action, async `onClick` shows a spinner), `IconButton` (always a `label`) |
| A question | `ask({ title, text, ok, danger })` → boolean; `askText({ title, label })` → string or null (a reason) |
| A form | `Form`, `Field` (label, hint, error, optional, help; `group` for Seg/Chips), `Input`, `Textarea`, `Select`, `MoneyInput` (cents), `PhoneInput`, `SearchInput`, `Check`, `Switch`, `Seg`, `Chips`, `Stepper`, `DateInput` |
| A panel that rises | `Sheet` (open, onClose, title, footer, wide) — phone back button closes it |
| Status | `StatusPill` (job), `InvoicePill`, `Pill` (tone), `Stamp` (PAYÉ / Annulé / Absent; `animate` when it just happened) |
| Money | `Money` (cents), `Totals` (subtotal/TPS/TVQ/total/paid/balance); `money()`, `parseMoney()` in `lib/money` |
| Info | `Banner` (info/warn/bad/ok), `Empty` (title, text, action), `Help` (the « ? » bubble), `Skeleton`, `Spinner`, `Kv`, `Tabs`, `Avatar` |
| Feedback | `toast(text, { kind })`, `run()`, `attempt()` |
| A menu on a right-click or a long press | `openMenu(e, actions, title?)`, `openMenuAt(x, y, actions, title?)`, `pressProps(onPress)` (500 ms), `MenuAction`, from `src/ui/ContextMenu.tsx` (not in the index; `ContextMenuHost` is mounted once in the shell) |
| Small hooks | `useSettled(value, ms)`, `useFocusOnMount(on, find)` from `src/ui/hooks.ts` |

CSS: use the tokens (`var(--ink)`, `--ink-2`, `--line`, `--accent`, `--sp-*`, `--t-*`, `--r-*`, status `--st-*`) and the
classes in `src/ui/styles/*.css` (`stack`, `stack-lg`, `row`, `row-wrap`, `between`, `grow`, `grid-2`, `muted`, `faint`,
`num`, `small`, `ellipsis`, `glass`, `glass-strong`). Put a section's own CSS in `features/<section>/<section>.css`,
imported by its screen, with class names prefixed by the section (`.agenda-…`); CSS that several sections use sits
with its shared concept (e.g. `shared/places/customers.css`, `shared/invoices/invoices.css`, `shared/moment/booking.css`)
and each screen that needs it imports it. Glass only on large surfaces. Every colour must work in the 6 themes (H.I.S
light/dark, Platine, Noir et or, Émeraude, Saphir, Bordeaux): use tokens, never hard-coded colours (truck/person colours
are data and are fine).

## Words (i18n)

`t('section.key', { n, name })` from `src/lib/i18n`. Each section owns `src/i18n/fr/<section>.ts` and
`src/i18n/en/<section>.ts` (the English file is typed `typeof fr` — same keys); only `src/lib/i18n.ts` (and, for the
customer's page, `src/client/i18n.ts` with `ct()`) imports the dictionaries. Plurals:
`{ one: '{n} job', other: '{n} jobs' }` used with `{ n }`. Customer-facing text (invoice, estimate, texts) follows the
**customer's language** (`customer.lang`): `tl(lang, 'key')`. Writing: Québec French, tutoiement inside the team
(« Choisis le bloc »), vouvoiement for customers; plain verbs; the same word through a flow (button « Encaisser » →
toast « Paiement enregistré »); errors say what to do; no ALL-CAPS labels, no « A · B · C » strings, no arrows in
buttons, no exclamation marks except customer thanks. Dates and money via `lib/dates` (`longDay`, `tinyDay`, `clock`,
`clockRange`, `duration`, `stamp`) and `lib/money` (`money`), with `lang.value`.

## Shared components (one owner each; others only import them)

Paths under `src/`. Owner: the package that owns the folder (`app-shell` is the frame).

| Component | Owner | Contract (props are fixed — see the stub file) |
|---|---|---|
| `shared/customers/CustomerPicker` | customers | `{ value, onPick(id), allowCreate?, autoFocus? }` |
| `shared/vehicles/VehiclePicker` | places-vehicles | `{ customerId, value, onPick(id) }` |
| `shared/vehicles/CarPicker` | places-vehicles | `{ value: { year, make, model }, onValue, errors?, testid? }` — Année → Marque → Modèle, no typing (models: NHTSA vPIC, kept on the phone) |
| `shared/vehicles/vinScan` | places-vehicles | `barcodeReader()` (the phone's BarcodeDetector, else ZXing WebAssembly), `readVinPhoto(file)` (OCR + check digit) |
| `shared/map/roads` | map-hours | `routeThrough(points)` (OSRM, by the streets), `knownLeg(a, b)` |
| `shared/app/UpdatePanel` | app-shell | `()` — the version on this device, « Vérifier les mises à jour » |
| `services/backdrop` + `ui/backdrops` | app-shell | `myPhoto`, `setMyPhoto(dataUrl)`, `shrinkPhoto(file)`, `fitSize(w, h)`; `HIS_NIGHT`, `HIS_DAY` in `ui/backdrops` — what is behind the glass (the H.I.S pictures, or my photo on this device) |
| `shared/app/moved` | app-shell | `MovedBanner` — on the old address (GitHub Pages) only: the app's new address, a button to open it (sign-in screen and above every screen) |
| `app/more` + `domain/jobs/counts` | app-shell (`counts`: jobs) | pure: `filtersFor`, `tilesFor`, `dueCents`, `unpaidCount`, `TILE_HUE`; `dayCounts` in `domain/jobs/counts` — what « Plus » shows (tested in more.test.ts) |
| `shared/places/AddressField` + `geocode(q)` | places-vehicles | `{ value: PlaceValue, onValue, label? }` — leaving the field without choosing a suggestion takes the position when one place fits (`locate`) |
| `shared/places/locate` + `places` | places-vehicles | `locate(address, { postal?, city?, fresh? })` → found / choose / none / offline: the same door, street and town (or postal code) as typed, else nothing; `searchPlaces(q)` asks Photon (empty answers not kept) |
| `shared/customers/locator` | customers | `locateMissing({ only?, force? })`, `startLocator()`, `spreadToJobs(customerId, lat, lng)` — the positions still missing (customers, coming appointments) found in the background on the phones of the people who book; « Chercher » / « Trouver » ask at once. A job or customer position found later re-plans its block (server trigger, Part 15) |
| `domain/stock/needs` + `shared/stock/needsView` | stock-dashboard | pure `weekNeeds(input)`: what the week's appointments take (oil by grade in litres, filters, new tires by size and season, fixed parts), against the stock; `needsOf(service)` (said in Réglages, or guessed from the name); `NeedsCard` (« La journée », Thursday to Sunday); screen `#/needs?week=` |
| `shared/moment/BlockPicker` | moment-pickers | `{ lat, lng, duration, excludeJob?, value, onPick({ day, block, truck_id? }) }` |
| `shared/moment/ServicePicker` + `itemsDuration` | moment-pickers (`itemsDuration`, `ItemDraft` in `domain/moment/logic`: booking) | `{ value: ItemDraft[], onValue, lang?, allowCustom? }` |
| `shared/jobs/JobTicket` | jobs | `{ job, showDay?, showTruck? }` |
| `shared/map/MapView` | map-hours | `{ markers: MapMarker[], lines?: MapLine[], height? }` |
| `shared/invoices/InvoicePanel` | invoices | `{ jobId }` |
| `shared/invoices/PaySheet` | invoices | `{ open, onClose, invoiceId, onPaid? }` |
| `shared/guide/GuideCard` | comms-guide | `()` → the next first step, or null |

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
`web_services`, `web_suggest`, `web_book`; on/off = `settings.booking.web.on`, Réglages → Réservations; brakes through `rate_hit`, Part 24: `busy` = 429, try again in a few minutes) · `client { action: view|sign|answer|pay|check, token }` (public page: `sign { signer, png, confirm }` = the estimate signed with the
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
older version show a notification once (`src/shared/app/pwa.ts`).

## Checks before you say a section is done

1. `npx tsc --noEmit -p . 2>&1 | grep -E "src/((features|shared|domain)/<yours>|i18n/(fr|en)/<yours>|dev/demo-extra/<yours>)"` → nothing
   (other sections are being written at the same time: ignore their errors).
2. Unit tests for your pure logic, next to it: `src/domain/<concept>/*.test.ts` (or `src/features/<section>/*.test.ts`
   for a section's own) (vitest, jsdom) → `npx vitest run src/domain/<concept> src/features/<section>`.
3. Screens in demo mode: phone and desktop, French and English, light and dark, no page errors; the main flows tried
   by clicking (your own Playwright script in your scratchpad: `require('playwright')` works from any folder).
   The map tiles (openstreetmap.org) and other outside sites can't be reached from this machine: that is expected.
4. Every string in both dictionaries; no hard-coded French in components (except customer data).
5. `npx vitest run src/architecture.test.ts` → green: no import of yours breaks the layers (« Folders »).
