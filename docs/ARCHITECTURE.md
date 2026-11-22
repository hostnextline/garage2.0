# Architecture — Mécanique Mobile H.I.S (V2)

The app of a **mobile garage** in Montréal: the owner (Hassan) and the office book appointments by phone into time
**blocks** (matin 8–12, après-midi 12–16, soir 16–20); the server places each job on a truck and orders the stops
from « Départ des camions » (`settings.booking.home`, Réglages → Réservations; also reached from Horaires and the map
legend): cheapest insertion, then each truck's route improved (`route_improve`: a piece turned around, a stop moved).
Moving the start or a number of the route estimate re-plans every coming booked block (trigger `settings_replan`,
Part 17). With « Vraies routes » on (Part 27, `settings.booking.roads_on`, off on live), the driving is not estimated:
it is the real road times the server function `drive` measured (TomTom, OSRM behind) and kept in `drive_times`; a trip
not measured yet counts the fixed « Trajet inconnu » and is said « pas encore mesuré », never a straight line (an arrival
that counts it carries `jobs.eta_measured = false` and is said « heure : trajets pas encore mesurés »). Off, the screens
show the server's estimate as live does (the way back). Each truck may leave from its own address (`trucks.start`, Horaires → « Départ de ce camion », Part 18); the afternoon and evening leave from the truck's last stop of the block before, and each block tries to end near the next one's first stop (only with an order that still fits in the truck's hours); the mechanics (Saleh: Camion Complet, Adam: Voiture) do the work at the customer's place, get the waiver signed, invoice
and get paid before leaving; a treasurer keeps the books. People are beginners with apps: **simple words, one obvious
action per screen, help bubbles « ? »**. Read `docs/DESIGN.md` first (the look and the writing rules).

Languages: French (Québec) first, English second. Phones first (mechanics with gloves, in the sun), computer second.

## Stack

Vite 7 · Preact 10 + `@preact/signals` · TypeScript strict · no CSS framework (our own tokens) · `lucide-preact` icons ·
Supabase (Postgres with row-level security, RPC functions, Edge Functions) · IndexedDB copy of the data (works offline) ·
PWA (installable, offline shell). Allowed libraries (already installed): `leaflet`, `jspdf`, `jspdf-autotable`, `fflate`,
`idb`. **Do not add packages.** Heavy tools loaded only when used come from `https://cdn.jsdelivr.net/npm/<pkg>@<exact version>`
(cached by the service worker), e.g. `tesseract.js@5.1.1` for reading receipts. Maps, roads and addresses: TomTom when
the build has its browser key (`TOMTOM_KEY` of `src/lib/config.ts`, from `VITE_TOMTOM_KEY`), else and whenever TomTom does
not answer the free OpenStreetMap services (tiles, OSRM and its FOSSGIS copy, Photon); plain `fetch`, no package.

## Folders

Every file of `src/` sits in a **layer**. A file imports only from its own layer and from the layers its row lists
(the ones below it); tests (`*.test.ts`, `*.test.tsx`) may import anything. `src/architecture.test.ts` checks every
import at each `npm test` (« The architecture test », below).

| Layer | Holds | May import |
|---|---|---|
| `src/lib` | pure helpers: dates, money, text, the i18n runtime, config, errors (`errorMessage`, `isNetworkError`, `Refused`, `codeWords`), TomTom's addresses and answers (`tomtom.ts`) | lib (and `lib/i18n.ts` the dictionaries) |
| `src/platform` | the browser: hash router (`route`, `href`, `navigate`, `goBack`, `setQuery`, `ScreenProps`), history, media (`wide`, `touch`), focus | lib |
| `src/data` | types, schema, store, local copy (IndexedDB), sync, sign-in and rights, `api.ts` (every change), `select.ts` | lib, platform |
| `src/domain/<concept>` | the garage's rules, **no JSX**, no `preact` (`@preact/signals` is fine), no `lucide-preact` | lib, platform, data, domain |
| `src/ui` | the design kit (+ `ContextMenu`) | lib, platform, ui; data only as `import type` |
| `src/services` | background work with no screen: theme, backdrop, position, push, bubbles, the roads sweep, the trip's arrival time asked again | lib, platform, data, domain, services |
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
  lib/                  dates, money, text (phone, postal code, VIN, names; norm/squash for search), i18n, config (the
                        TomTom browser key, never in the demo: tomtomKeyFor), errors (codeWords: the words of a refusal
                        code alone), tomtom (TomTom's tiles, route, geocoding addresses and the reading of their answers;
                        checkTile / tileWatch: TomTom's own answer decides the switch to OpenStreetMap's tiles),
                        dict-check (a test helper: two dictionaries have the same keys)
  platform/             router (the # addresses), history (a sheet's own back step), media (wide, touch, roomy), focus
  data/                 types, schema (the tables kept), store (in-memory tables), local (IndexedDB copy), select (lookups),
                        api (every change), sync (offline outbox), auth (who/rights, callFn), roads (« Vraies routes »:
                        what the app asks the function « drive », the switch, the two previews)
  domain/               rights.ts (may, isField: who may open what)
    moment/             days and blocks in words (words, dayWords), the booking rules (logic, choice), « Choisir sur la
                        carte » (days), the time grids of « Plages d'arrivée » (grid, units), the outbox helper (outbox),
                        the server's row with the real roads (serverPlace: place, order, what it adds)
    jobs/               the one next step (steps), who may do what on a job (rights), a job in words, a day's counts,
                        a server preview's state (asked: off / asking / none / done), the server's answers for « Changer
                        de camion » (move: fitOf) and « Ordre des arrêts » (stopOrder: serverOrder), a stop en route's
                        real time (when: enRouteTicket)
    money/              invoices and estimates (invoice, quote), the report's periods (period), expenses, the Coffre's jobs
    stock/              quantities, value and moves (stock), what the week's work takes (needs)
    oil/                « Rappels d'huile » (due, select)
    vehicles/           the old app's engine list (engineRef), cars in words
    team/               the rights of each role (rights), the « team » server function (teamApi)
  ui/                   the design kit (import from '../../ui'); ContextMenu (right-click / long press), hooks, backdrops
                        (the H.I.S pictures); styles/ (tokens, base, components, menu)
  services/             theme (the look), backdrop (my photo behind the glass), position (shared during the day), push (the
                        alert while the app is closed), bubbles (what 🤖, « Appel entrant » and « Texto entrant » share),
                        roadsSweep (« Vraies routes »: the trips left, measured in the background by the owner's or the
                        office's app), tripRefresh (the driver's phone asks the arrival time again while it drives)
  shared/               one folder per concept (rank):
    sign/ (0)           SignaturePad, signature
    look/ (0)           LookChoices (« Apparence »: Réglages and Mon compte), settings.css
    export/ (0)         the accountant's files (exports, xlsx), the receipt reader (ocr)
    app/ (0)            pwa (the installed app, its updates), UpdatePanel, moved (MovedBanner)
    places/ (1)         AddressField, locate, places (TomTom and Photon together), photon (placeKey: one key for an
                        address from either service), tomtom (TomTom's answers → suggestions), match (what was typed: is it
                        the door, the merge of the two lists), address, TruckStartPanel, customers.css
    map/ (2)            MapView (TomTom's tiles with the key, OpenStreetMap's when refused), roads (TomTom, then OSRM,
                        then FOSSGIS; nothing drawn until a real road), useRoads (roadOf, roadTotal, roadState, roadAdded),
                        assemble, device, ago
    charts/ (2)         charts, useReport
    vehicles/ (3)       CarPicker, VehiclePicker, VehicleBits, SpecPanel, VinHistory, carModels, vinScan, vehicleText
    customers/ (4)      CustomerPicker, CustomerFields, bits, facts, search, dupes, shortcuts, locator, ConversationSheet,
                        Attachments, texts, conversation.css
    stock/ (4)          needsView (NeedsCard), inventory.css
    moment/ (5)         BlockPicker, WindowPicker, PickGrid, PickList, MomentMap, DayRoute, RoutePreview, ServicePicker,
                        notify, preview, useDayWindows, roadNote (the words while a road is not drawn), parts
                        (RoadsBanner: « mesure en cours » / « pas encore mesurées »), booking.css
    jobs/ (6)           JobTicket, CarFirst, CarCheckSheet, CarHistory, PartsSheet, StepButton, TextOutcome, flow, parts,
                        select, bookedBy, carWords, vinStep, jobs.css; « Déplacer »: MoveSheet (the one move sheet: the job
                        screen's, and in place through MoveHost: openMove(id), mounted by the Carte, Vue d'ensemble and
                        Aujourd'hui; `fromList`: the message 6 s with « Voir », a move kept on the phone asks « Texter … ? » once sent,
                        window mode opens on the stop's day), moving (mayMove: booked + « Réserver » + no move waiting;
                        moveWaiting = movesWaiting OR a move_job pending in the outbox; moveSettled, waitForMove;
                        noteMoved / movedLately: moved from a list a moment ago), MoveWaiting (« En attente d'envoi »);
                        shortcuts (an appointment's shortcut menu: jobActions, jobMenu, jobPress, menuProps;
                        option onMove = the sheet in place), copy (« Copier / Coller »); the agenda re-exports them;
                        exactMove (« Déplacer à l'heure choisie »: moveAt, the ONE flow of every move to a time shown,
                        and doneWords; see the section of that name below); textAsk (« Texter … ? »: askMovedText, the
                        ONE question before the « moved » text of every change of an appointment; nothing goes by itself)
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
supabase/functions      server functions: notify, enroute (a job's trip; return / return_end: the way back to the start), client, book, stripe, vin, team, conversation, backup,
                        drive (« Vraies routes »: warm, sweep, status); _shared/roads.ts (the measuring, for drive and
                        book), _shared/tomtom.ts (TomTom on the server: « Je pars »'s route, the Matrix requests)
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
`notesOf`, `garageName`, `roadsOn`: « Vraies routes » on, from the phone's copy of the settings) or directly with `rowsOf('table')`, `getRow('table', id)`, `tableSignal('table')` from
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

« Vraies routes » (Part 27) in the data layer, `src/data/roads.ts`: `warmRoads(point, from, days, waitMs = 3500)` before
the planner (`suggestBlocks` and `suggestWindows` await it when the switch is on: the address's trips measured first, the
screen waits 3.5 s at most, never a refusal; one request per place and page of 14 days, remembered 10 minutes; the rest
asked behind), `placeRoads` / `retryRoads` / `roadsTick` for the screens (« mesure en cours », « Réessayer », ask again
when a measure lands), `measureRoads` (the sweep, one at a time on a device) / `roadsStatus` / `roadsSwitch(on, op?)` for
the settings panel, `movePreview(truck, day, block, jobs, { asTold })` (POST, never offline: it runs the action on the
server and undoes it; `stopOrderPreview` went with « Ordre des arrêts » in Part 28, « Réorganiser la journée » asks its own
`day_order_preview` through `src/data/dayOrder.ts`), and `warmAfterSent` / `warmJob` / `warmPlace` (a booking, a move, « Changer
de client », a new position that reached the server: its place measured in the background), `warmStart(point)` (a new
« Départ de ce camion » / « Départ des camions » that reached the server: that start measured at once for today + 14 days;
`homeWarmed` keeps one warm per start, cleared by `resetRoads`). `src/services/roadsSweep.ts`
measures what is left in the background (owner / office, switch on, every 10 min, while the server says `more`). With
the switch off nothing there sends anything. The jobs rows carry `eta_measured` (`types.ts`; the server's only):
`domain/jobs/when.ts` `plannedTime(job)` (null when it is false) and `etaUnsure(job)` are what every screen reads before
saying an arrival; the map's `assemble(raw, { measuredOf })` takes it from the phone's row (`team_map` does not send it).
The suggestion keys (`baseKey`, `shared/moment/hooks.ts`) and `useDayWindows` hold the switch: a picker asks again when it
flips.

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
| A menu on a right-click or a long press | `openMenu(e, actions, title?)`, `openMenuAt(x, y, actions, title?)`, `pressProps(onPress)` (500 ms), `MenuAction`, from `src/ui/ContextMenu.tsx` (not in the index; `ContextMenuHost` is mounted once in the shell). An appointment's menu (the agenda's): `menuProps(job, { onMove })` from `src/shared/jobs/shortcuts.tsx` |
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
| `shared/map/roads` | map-hours | `routeThrough(points, fetch?, timeoutMs?, key?, day?)` (TomTom with the key, then OSRM, then FOSSGIS, by the streets; today « now », another day its usual hours), `knownLeg(a, b, day?)`, `addedTotal` (only two totals of the same planner); `useRoads(trucks, day?)`, `roadOf`, `roadTotal`, `roadState` ('asking' / 'down' / 'never' → `map.roadNote.*`), `roadAdded` in `useRoads.ts` |
| `shared/app/UpdatePanel` | app-shell | `()` — the version on this device, « Vérifier les mises à jour » |
| `services/backdrop` + `ui/backdrops` | app-shell | `myPhoto`, `setMyPhoto(dataUrl)`, `shrinkPhoto(file)`, `fitSize(w, h)`; `HIS_NIGHT`, `HIS_DAY` in `ui/backdrops` — what is behind the glass (the H.I.S pictures, or my photo on this device) |
| `shared/app/moved` | app-shell | `MovedBanner` — on the old address (GitHub Pages) only: the app's new address, a button to open it (sign-in screen and above every screen) |
| `app/more` + `domain/jobs/counts` | app-shell (`counts`: jobs) | pure: `filtersFor`, `tilesFor`, `dueCents`, `unpaidCount`, `TILE_HUE`; `dayCounts` in `domain/jobs/counts` — what « Plus » shows (tested in more.test.ts) |
| `shared/places/AddressField` + `geocode(q)` | places-vehicles | `{ value: PlaceValue, onValue, label? }` — leaving the field without choosing a suggestion takes the position when one place fits (`locate`) |
| `shared/places/locate` + `places` | places-vehicles | `locate(address, { postal?, city?, fresh? })` → found / choose / none / offline (`partial`: TomTom answered, Photon needed and down): the same door, street and town (or postal code) as typed, else nothing; `searchPlaces(q)` asks TomTom (with the app's key) and Photon when TomTom does not have the door typed (`match.ts` `isTypedDoor`, `mergePlaces`); TomTom 2.5 s, rests 60 s after a failure; a save hurries (both at once); without the key, Photon alone (empty answers not kept) |
| `shared/customers/locator` | customers | `locateMissing({ only?, force? })`, `startLocator()`, `spreadToJobs(customerId, lat, lng)` — the positions still missing (customers, coming appointments) found in the background on the phones of the people who book; « Chercher » / « Trouver » ask at once. A job or customer position found later re-plans its block (server trigger, Part 15) |
| `domain/stock/needs` + `shared/stock/needsView` | stock-dashboard | pure `weekNeeds(input)`: what the week's appointments take (oil by grade in litres, filters, new tires by size and season, fixed parts), against the stock; `needsOf(service)` (said in Réglages, or guessed from the name); `NeedsCard` (« La journée », Thursday to Sunday); screen `#/needs?week=` |
| `shared/moment/BlockPicker` | moment-pickers | `{ lat, lng, duration, excludeJob?, value, onPick({ day, block, truck_id? }) }` |
| `shared/moment/ServicePicker` + `itemsDuration` | moment-pickers (`itemsDuration`, `ItemDraft` in `domain/moment/logic`: booking) | `{ value: ItemDraft[], onValue, lang?, allowCustom? }` |
| `shared/jobs/JobTicket` | jobs | `{ job, showDay?, showTruck? }` |
| `shared/map/MapView` | map-hours | `{ markers: MapMarker[], lines?: MapLine[], height? }` — TomTom's tiles with the key; a failed tile is asked once more (`checkTile`): TomTom refuses → OpenStreetMap's tiles on every map of the visit |
| `shared/invoices/InvoicePanel` | invoices | `{ jobId }` |
| `shared/invoices/PaySheet` | invoices | `{ open, onClose, invoiceId, onPaid? }` |
| `shared/guide/GuideCard` | comms-guide | `()` → the next first step, or null |
| `shared/jobs/DayOrderHost` (Part 28) | jobs | `openDayOrder(day, { truck?, job?, first? })`, `DayOrderHost({ onSaved? })` (mounted by the agenda, Aujourd'hui, the Carte, Vue d'ensemble, the job screen); `mayOrderDay(day)` in `domain/jobs/dayOrder` |
| `shared/jobs/TellHost` (Part 28) | jobs | `openTell(day)` — mounts its own root on first use (no screen mounts it): the send list « Envoyer les heures aux clients » |
| `shared/jobs/ToldBanner` / `ToldBits` (Part 28) | jobs | `ToldBanner({ day, onSend? })`, `ToldDays()` (nothing when N = 0 or not owner / « Réserver »); `ToldJobLine({ job })`, `ToldWarn({ job })`, `toldDayToast(before)`; the rule in `domain/jobs/told` (`tellState`, `toldWindow`, `clientsDue`, `dueOn`, `dueDays`, `tellCtx`) |

Keep the exported names and props exactly; you may add optional props.

## Guided tour anchors (`data-tour="…"`)

The calm tour (section guide) highlights elements by these ids; put them on the matching element in your screens:
`nav-today`, `nav-agenda`, `nav-customers`, `nav-…` and `quick-add`, `sync-state` (frame, done) · `agenda-day`,
`agenda-block`, `agenda-week` · `book-customer`, `book-vehicle`, `book-services`, `book-block`, `book-confirm` ·
`hours-truck`, `hours-grid`, `hours-apply` · `customers-search`, `customer-book` · `today-shift`, `today-next` ·
`job-bigstep`, `job-waiver`, `job-work`, `job-extra`, `job-invoice`, `job-pay` · `invoice-send`, `invoice-pay` ·
`quote-items`, `quote-send` · `team-invite`, `team-rights` · `map-legend` · `settings-company`, `settings-services`,
`settings-texts`, `settings-look`, `settings-connect` · `treasury-add`, `treasury-report` · `inventory-low` · `dashboard-kpis`.

## Test ids of « Vraies routes » (`data-testid`, read by `tests/e2e/routes.test.cjs` and the unit tests)

Réglages → Réservations, panel « Vraies routes » (`features/settings/booking/RoadsPanel.tsx`): `booking-roads`,
`roads-switch`, `roads-state`, `roads-key`, `roads-left`, `roads-month`, `roads-nokey`, `roads-loading`, `roads-error`,
`roads-retry`, `roads-measure`, `roads-background`, `roads-progress`, `roads-stop`, `roads-message`, `roads-message-close`,
`roads-late`, `roads-late-row`, `roads-late-close`, `roads-kept`, `roads-kept-close`, `roads-rush`, `roads-rush-never`, the
numbers `booking-roads_month_tx`, `booking-roads_web_tx`, `booking-near_min`; « Le calcul de la route »: `booking-plan`,
`booking-<key>-estimate`. Branchements → TomTom (`features/settings/connect/TomtomPanel.tsx`): `connect-tomtom`,
`tomtom-state`, `tomtom-server`, `tomtom-month`, `tomtom-browser`, `tomtom-error`, `tomtom-retry`.
The pickers and maps: `roads-measuring`, `roads-failed` (the banner of an address being measured / not measured),
`bp-unknown-warn`, `bp-legend-unknown` (a calendar cell « À vérifier »), `mm-road`, `mm-facts-day`, `mm-day-unmeasured`
(« Choisir sur la carte »), `route-preview-road`, `route-preview-day` (« Voir sur la carte »), `day-route-road`,
`road-note-<truck id>` (the map legend's note while a road is not drawn, beside `road-<truck id>`), `overview-road`
(« Vue d'ensemble »).
The sheets: `close-day-server`, `close-day-place`, `close-day-refused`, `close-day-why`, `close-day-road-note`
(« La voiture ferme »); `stop-order-pending`, `stop-order-server` (« Ordre des arrêts »).
An arrival not measured (`jobs.eta_measured` false): `overview-unsure-<job id>` (« Vue d'ensemble »), `legend-unsure-<truck
id>` (the map legend's next stop), `move-window-unsure-<start>` (the move-window sheet). The online booking page's « no
moment » note: `book-none` (and `book-none-new` for « Voir d’autres dates »), with « Aucun moment libre » or, when the
server says `unmeasured`, « On ne peut pas proposer de moment en ligne pour cette adresse en ce moment : appelez-nous. ».
`src/app/vraies-routes.flow.test.tsx` drives the whole path on the phone (the real data layer and pickers, « drive » and
the planner pretended).

## Test ids of « Déplacer » from the trucks' stops (read by `tests/e2e/app.test.cjs` and the unit tests)

Hassan, 2026-11-21: « move apts time from here », on the three screens that list a truck's stops. The move sheet is
`move-sheet` (`move-ok`) on every screen; the menu is `agenda-menu` with `menu-move` (and the agenda's other shortcuts).
Carte: `map-move` (« Déplacer » on the card of the stop chosen, beside `map-open-job`); the menu on each `stop-<job id>`.
Vue d'ensemble: the menu on each row (`overview-job-<job id>`, on its wrapper `.overview-row`). Aujourd'hui: « Les
camions » `today-truck-stops-<truck id>` (« Voir les N arrêts » / « Cacher les arrêts »), `today-truck-list-<truck id>`,
and each stop's ticket with its menu `today-stop-<job id>` (also « Ma journée »: its next stop, « Ensuite », the finished
ones). A move kept on the phone: `move-wait-<job id>` (« En attente d'envoi », on the Carte's row and card, Vue d'ensemble's
row, Aujourd'hui's ticket). Unit tests: `src/shared/jobs/shortcuts.test.tsx` (the rule, onMove), `src/features/map/stops-move.test.tsx`,
`src/features/overview/stops-move.test.tsx`, `src/features/today/stops-move.test.tsx` (each screen: shown for who may, not
for a mechanic without « Réserver », an appointment under way or done, a move waiting; the sheet in place; moved, the list
follows), and the three `stops-move-more.test.tsx` (map, overview, today: a move kept on the phone asks « Texter … ? » once
sent with `tell`, the mark, a move_job in the outbox or a « Je pars » waiting hides « Déplacer », « À placer », « Ma journée »'s next
stop, the long press, « Voir », the sheet closing when the stop goes under way, the words per right, the hand-text sheet
on the map); end to end: the step « « Déplacer » from the map … » of `app.test.cjs` (the hand-text sheet asserted on the map).

## « Déplacer à l'heure choisie » (the exact move: a move by hand lands where it was pointed)

Hassan, 2026-11-21: « when i move an appointement, i want it to move exactly where i point it to move, but the rest stays
the same » (STATE.md 20:00 S1–S9 / A1–A6 and 20:25: S6 corrected, A7). Window mode only (« Plages d'arrivée » on); blocks
mode and « Flexible », the day alone, « Réorganiser la journée », « Coller ici » move as before. Part 28: a late other
customer on a day other than today gets his new window when he is told (`lateWindow` in `exactMove.ts`: « Il aura … avec
« Envoyer les heures aux clients » », the done words `jobs.exact.doneLate`; today, or his window will not move:
`jobs.exact.doneLateToday`, « Avertis … »).
- Data (`src/data/exact.ts`, the ONE place that names the server's keys): `exactArgs(at, lateOk)` → `p_exact: { at, late_ok }`
  (move_job's 8th argument, sent by `api.ts` `moveJob` when `win.at` is given: never queued, A4); `exactPreview(job, day,
  truck, at)` → `move_preview(p_job, p_day, p_truck, p_at)` (its trial `rows` are never applied: `callRpc(…, { apply: false })`);
  `exactAnswer` reads `exact`, `stops[{ id, day, truck_id, order_before, order_after, eta_before, eta_after, win_start,
  win_end, delay_min, late, late_min, measured }]`, `over_hours`, `earliest`, `earliest_keep`; `exactRefusal` reads a thrown
  refusal by its `hint` (`arrive_late` with `details` JSON `{ earliest, earliest_keep }`, `late_changed`, `pick_truck`).
  `src/data/roads.ts` `warmJobDay` (A7: « Vraies routes » on, that place's trips of that day measured before the preview).
- The rule (`src/domain/jobs/exact.ts`): `exactCase` → ok (`pushed`: later but inside their window, said) / late / early /
  unsure (a trip not measured, or no answer) / refused; `lateOkOf`; `keptTimeOf` (« Changer de camion » keeps the time);
  `src/domain/moment/exactAt.ts` (`exactAtOf`: the minute a « Déplacer » choice showed; `windowRowAt`: the agenda's window list).
- The flow (`src/shared/jobs/exactMove.ts` `moveAt`): no signal → said, nothing kept; A7's measure; the preview; ONE question
  (`ask`: the grid always asks, a sheet's tap only when there is something to hear); « Garde-route »; the move with the
  stops accepted late; `late_changed` / `arrive_late` → looked at once more. Callers: the agenda's hour grids
  (`features/agenda/move.ts` `moveToTime`, the block held where it was let go: `landings`, test id `grid-held-<job id>`),
  the window list (`moveToWindow`), « Déplacer » (`MoveSheet`), « Changer de camion » (`TruckSheet`).
- Test ids: the grid's blocks `grid-job-<job id>`, its units `grid-unit-<day>-<minute>-<truck id>` (the drop reads the
  pointer's height in the column), `grid-held-<job id>`; the questions are the kit's `ask` (`ask-ok`, the other answer the
  sheet's other button); « Déplacer » `move-sheet` / `move-ok`, a phone's hours `pick-time-<minute>`, the Carte's card
  `map-move` (on a phone the stops are in the pull-up panel `map-pull-handle`); « Laisser l'app choisir » `truck-auto`.
- Tests: unit `src/data/exact*.test.ts`, `src/domain/jobs/exact.test.ts`, `src/shared/jobs/exactMove.test.ts`,
  `MoveSheet-exact.test.tsx`, `src/features/agenda/exact-move.test.tsx`, `src/features/jobs/TruckSheet-exact.test.tsx`,
  `src/dev/demo-windows.test.ts` (A6), `src/ui/sheetFoot.test.tsx` (the two long answers fit a phone); database
  `tests/db/exact-move*.test.mjs`; end to end `tests/e2e/deplacer.test.cjs` (9 steps, the real server: the grid's drop at
  13 h 30, somebody late, a time the truck cannot reach, the phone from the Carte, a booking after the move, « Laisser
  l'app choisir », « Vraies routes » on measured and not measured, « Texter … ? » answered « Pas maintenant » then the
day's button).

## « Texter … ? » (ask first: no « moved » text goes by itself)

Hassan, 2026-11-22: « i do not want them to receive a text automatically when i change their appointement. the system
should ask me first ». `src/shared/jobs/textAsk.tsx`: `askMovedText(job | id, { via: 'notify' | 'jobs', after? })` is called
by every path that used to send (agenda `move.ts` send / exactSaid / textWhenSent: `via: 'notify'`; `MoveSheet`, `MoveHost`,
`TruckSheet`: `via: 'jobs'`); it asks nothing unless `wantsText('moved', id)`. Its own root (`data-owner="text-ask"`).
« Envoyer le texto » = notifyCustomer('moved') for 'notify', and for 'jobs' sendText('moved') where a `text-outcome` host is
mounted (`hostMounted` in `hosts.ts`), else notifyCustomer. A navigation closes it through `Sheet`'s `onNavigate`: it
rises again on the next screen. The next question waits for the send and its hand-text sheet (`outcomeClosed`).
Part 28: « Pas maintenant » (was « Pas de texto ») sends nothing and leaves the client owed his hour for « Envoyer les heures
aux clients »; then E4's `toldDayToast(before)` (a client expected today, or tomorrow after 18 h: a toast with that day's
button); a flow that asked nothing calls `toldDayAfter(before)` (held while a question is open, never after « Envoyer le
texto »). « Envoyer le texto » goes under the server's lease and writes what the client was told.
- Test ids: `text-ask` (the sheet), `text-ask-when` (the moment), `text-ask-later` (« Pas maintenant : rien ne part … »), `text-ask-send`, `text-ask-skip`; Réglages → Textos
  `msg-on-moved` (aria-label « Demander avant d’envoyer, Rendez-vous changé »).
- Tests: `src/shared/jobs/textAsk.test.tsx` (the question, its sends and outcomes, a screen without a host, the row
  leaving the phone, a navigation, the back button, two questions), the paths' unit tests, `SettingsScreen.test.tsx`; end
  to end `tests/e2e/harness.cjs` `textAsk(page, { send })`, `deplacer.test.cjs` (`textAskIf`: 2 s with the question up,
  no `notify` request; step 8: « Pas maintenant », ✕, « Voir », then the day's button), `app.test.cjs`, `plages.test.cjs`, `mise-a-jour.test.cjs`.

## « Réorganiser la journée » and « Envoyer les heures aux clients » (Part 28)

Hassan, 2026-11-22: « i want to be able to easely rearange a day » (he chose « Drag in a list ») and « dont send any text,
put a button that will send for all clients, ill press it when day is filled and im done re organizing ». The contract is
REARRANGE.md of the work folder; CLAUDE.md « Things to know » says what it does.
- Data (one file each, the only ones that name the server's keys): `src/data/dayOrder.ts` — `dayOrderPreview(ask)` →
  `day_order_preview(p_day, p_lists, p_moved, p_was, p_auto)` (POST `{ noOp: true, apply: false }`), `dayOrderSave(ask,
  accept, op)` → `day_order_save(p_op, …, p_accept)` (`queue: false`: never kept on the phone), `dayAnswer` / `dayRefusal`
  (`day_changed` with `by: { name }`, `outcome_changed` whose detail is the whole answer, `changed`, `truck_off`,
  `truck_ends`, `needs_truck`, `not_allowed`), `isDeadlock` / `isLockBusy` / `isNoAnswer`, `keepDraft` / `keptDraft` /
  `dropDraft` (`localStorage` `his.dayOrder.<staff>.<day>`, every access in a try), `DAY_ORDER_WAIT_MS` 600; Part 29:
  `needsConfirm(answer, { moved, auto })` also counts `pushedOf` (a stop not dragged pushed later by more than
  `SHIFT_MIN`) and `repinnedOf` (a late minute moved to the arrival);
  `src/data/tell.ts` — `tellList(day)` (`tell_list`, read only), `sendDay(day, only, again?)` (notify `{ action: 'day', day,
  base, op, only, again? }`, a NEW op each call; 100 ids at most a call, the sheet sends longer lists in parts),
  `tellMark(marks)` (`tell_mark`, `queue: false`).
- The rules (pure, `src/domain/jobs/`): `dayOrder.ts` (`draftOf`, `moveTo`, `moveBy`, `putFirst`, `putOn`, `backToPlace`,
  `canDrop` → `machine` / `off` / `right` / `block` / `kind`, `changed`, `rebase`, `wasOf`, `listsOf`, `movedOf`,
  `mayOrderDay`); `told.ts` (`tellState` = the server's `tell_state`, both checked on `tests/fixtures/told-cases.json`;
  `toldWindow`, `clientsDue`, `dueOn`, `dueDays`, `tellRows`, `tellCtx`).
- The screens (`src/shared/jobs/`): `DayOrderSheet.tsx` + `DayOrderHost.tsx` + `listDrag.ts` (Pointer Events, no package:
  a finger by the grip only, `touch-action: none` there; a mouse by the whole row; the ghost on `document.body`; a chip
  held 400 ms; auto-scroll of `.sheet-body`) + `dayorder.css` (`dayord-*`); `TellSheet.tsx` + `TellHost.tsx` (`openTell`);
  `ToldBanner.tsx` (`ToldBanner`, `ToldDays`); `ToldBits.tsx` (`ToldJobLine`, `ToldWarn`, `toldDayToast`). Mounted:
  the agenda's day bar (`DayView`: the button + `ToldBanner`), the week's block menu (computer), Aujourd'hui (`TeamDay`:
  the button, `ToldDays`, `TomorrowPanel` in `TeamPanels.tsx` with « Réorganiser demain »; `MechanicDay`: « Réorganiser
  ma journée », `ToldWarn`), the Carte, Vue d'ensemble, any stop's menu (`shortcuts.tsx`), the job screen (`MomentPanel`:
  `reorg.open` + `ToldJobLine`; `MenuSheet`: « Mettre en premier » opens the sheet with the stop first). « Fixer les
  plages » (`WindowsPanel`) opens tomorrow's list; the late list of « Vraies routes » (`RoadsPanel`) has « Je l'ai
  averti »; `TruckCard` says what the customer was told (`toldWindow`); the week's day heads (`WeekParts`) count the due.
  « C'est envoyé » on the two « send by hand » sheets (`TextOutcome.tsx`, `shared/moment/notify.tsx`) when the answer
  carries `told` → `tell_mark` 'hand'. Retired: `StopOrderSheet.tsx`, `useOrderPreview`, `stopOrderPreview`,
  `windowTexts.ts`, `select.ts` `toConfirm`, `ConfirmPanel`.
- Words: `src/i18n/{fr,en}/reorg.ts`, `tell.ts`; errors `day_changed`, `outcome_changed`, `truck_off`, `truck_ends`.
- Test ids — the sheet: `dayorder-sheet`, `dayorder-status`, `dayorder-unsaved`, `dayorder-auto` / `dayorder-auto-back`,
  chips `dayorder-chip-<truck id>` (phone), trucks `dayorder-truck-<truck id>`, heads `dayorder-head-<truck id>` (a drop
  target: its end), `dayorder-headline-<id>`, `dayorder-over-<id>`, `dayorder-refused-<id>`, `dayorder-unmeasured-<id>`;
  rows `dayorder-row-<job number>` (`data-dayord-row data-id data-truck data-block data-index`), grip `dayorder-grip-<n>`,
  main `dayorder-main-<n>` (a tap = the row's menu), `dayorder-eta-<n>`, `dayorder-hours-<n>`, `dayorder-pill-<n>`,
  `dayorder-note-<n>`, under way `dayorder-live-<n>`; end slot `dayorder-end-<truck>` (`-<block>` in blocks mode), drop
  line `dayorder-line`, ghost `dayorder-ghost`; summary `dayorder-summary` (`dayorder-summary-go`, `dayorder-retry`);
  buttons `dayorder-save`, `dayorder-cancel`, `dayorder-close`, `dayorder-send`; notices `dayorder-offline`,
  `dayorder-measuring`, `dayorder-waitmove`, `dayorder-changed`, `dayorder-draft-back` (`dayorder-forget`),
  `dayorder-auto-shown`, `dayorder-auto-lost`, `dayorder-outcome`; the row's menu `dayorder-menu`,
  `dayorder-menu-first|up|down|back`, `dayorder-menu-on-<truck>`; `dayorder-live` (aria-live), `dayorder-unplaced`.
  Entry points: `agenda-reorg` (in `agenda-daybar`), `menu-reorg-day`, `map-reorg`, `today-reorg`, `today-reorg-mine`,
  `today-tomorrow-order` (« Réorganiser demain »), `overview-reorg`, `menu-reorg`, `job-order`, `menu-order`, `menu-first`. The texts: `told-banner`
  (`told-banner-send`), `told-days` (`told-day-<day>`), `today-tomorrow` (`today-tomorrow-line`, `today-tomorrow-send`,
  `today-tomorrow-row`, `today-tomorrow-none`), `told-job-line`, `told-warn`; the list `tell-sheet`, `tell-reach`
  (`tell-row`, `tell-row-line`), `tell-self` (`tell-self-row`, `tell-mark-<id>`), `tell-drift` (`tell-drift-row`),
  `tell-unmeasured` (`tell-measure`), `tell-go`, `tell-cancel`, `tell-progress`; the result `tell-result`, `tell-sent`,
  `tell-maybe` (`tell-resend`), `tell-failed` (`tell-retry-<id>`), `tell-busy`, `tell-already`, `tell-tocall`
  (`tell-tocall-row`), `tell-byhand` (`tell-byhand-row`, `tell-open-<id>`, `tell-handed-<id>`, `tell-all-sent`),
  `tell-left` (`tell-go-left`), `tell-all`, `tell-close`, `tell-refreshed`, `tell-failure`, `tell-right`.
- Tests: unit `src/domain/jobs/{dayOrder,told}.test.ts`, `src/data/{dayOrder,tell}.test.ts`,
  `src/shared/jobs/{DayOrderSheet,DayOrderHost,TellSheet,TellHost,ToldBanner,ToldBits}.test.tsx`, `listDrag.test.ts`,
  `src/shared/moment/notify-told.test.tsx`, `src/features/today/TeamPanels.test.tsx`, `src/features/agenda/WeekParts-told.test.tsx`,
  `src/dev/demo-{reorg,tell}.test.ts`; database `tests/db/reorganiser.test.mjs`, `tests/db/textos-journee.test.mjs`; API
  `tests/api/textos-journee.test.mjs`; end to end `tests/e2e/reorganiser.test.cjs` (+ `reorganiser.helpers.cjs`: a mouse
  drag, a finger through the DevTools protocol, the save, the oracle) and the steps it changed in `deplacer`, `plages`,
  `routes` (4a).

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
« Vraies routes » (Part 27): `roads_switch(p_op, p_on)` (owner; the only way to flip `booking.roads_on`; refused
`roads_cold` while a coming usual-hours trip has no time; off sets every `jobs.eta_measured` back to null) → `{ ok, on,
planned, kept: [{ day, block }], late: [job ids], unchanged? }` · the column `jobs.eta_measured` (boolean, the planner's
only: null off or with no arrival, false while a trip before that stop counts the « Trajet inconnu »; a window is never cut
from a false one — `book_job` / `move_job` leave the appointment « flexible » — and it is never judged late) ·
`move_preview(p_truck, p_day, p_block, p_jobs, p_as_told default false)` → `{ order, eta: { id: minute },
refused, refused_why: { id: code }, day_min, day_km (null while a trip is not measured, always null off), unmeasured }` ·
« Déplacer à l'heure choisie » (Part 27, fragment `ops/generateurs/vraies-routes/exact.sql`): `move_job(p_op, p_job, p_day,
p_block, p_truck, p_win_start, p_win_flex, p_exact)` with `p_exact = { at, late_ok: [job ids] }` (no default: the 5 and
7 argument forms are unchanged; window mode: the job arrives at `at` on its truck (`p_truck`, else its own), window =
`win_for(at)`, `jobs.arrive_at = at`, the other stops of that truck's day keep their order and times; blocks mode: the
block of that minute, `exact: false`) → move_job's answer + `exact, at, stops, over_hours, earliest, earliest_keep`;
refusals `arrive_late` (details `{ earliest, earliest_keep }`, both at or after the minute), `late_changed`, `pick_truck` ·
`move_preview(p_job, p_day, p_truck, p_at)` → the same answer, nothing written (never `late_changed`: it says the late
stops) · the column `jobs.arrive_at` (0..1439 or null, the server's only): every later plan holds that stop at its
minute (placed late and said late — activity `window_late` `why: 'pin'` — rather than moved), the others are planned as
always; cleared by a move without `p_exact` (« Laisser l'app choisir », the old app), an « Ordre des arrêts » that lists
it, the windows switched off ·
`stop_order_preview(p_truck, p_day, p_block, p_jobs)` → `[{ id, eta, late, measured (null off) }]` (both run `move_job` /
`set_stop_order` and undo them: the action's own rights, nothing written; call them with POST; since Part 28 the app no
longer calls `stop_order_preview` nor `set_stop_order`: they stay for older phones).
« Réorganiser la journée » (Part 28, `20261122000100_reorganiser.sql`): `day_order_preview(p_day, p_lists, p_moved default
'{}', p_was default null, p_auto default false)` (nothing written; `p_lists` null only with `p_auto`: the planner's lists)
and `day_order_save(p_op, p_day, p_lists, p_moved, p_was, p_auto, p_accept)` → `{ ok, day, basis_ok, mode, roads, rewin,
auto, lists: [{ truck, block, jobs }], stops: [{ id, truck_id, truck_before, block, order, order_before, eta, eta_before,
measured, win, new_win, win_back, flex_fixed, flex_later, late_min, early_min, pin, pin_lost, pin_moved, pin_new, pin_was,
over }], trucks: [{ id, block, hours_end, finish, over_min, drive_min, unmeasured }], accept: { windows, flex, late, early,
pins, over, at }, due_after }` (Part 29, `20261122000200_garder_ordre.sql`: `pin_new` = a stop dragged, pinned at the hour
of its new place; `pin_was` = its minute before, for a stop whose minute this save points, else null; `pin` = the minute
after the save; `accept.at` = { id: minute }, sent back raw: the save refuses `outcome_changed` unless each is the one shown
or at most 5 minutes later; a « new window » equal to the window it has is no longer sent; activity `day_ordered` gains
`pinned`) (the save adds `saved: true` and `rows: { jobs }`; a basis that changed: preview `basis_ok: false` with `gone`,
`new`, `changed`, `by`; save `day_changed`); `p_was` = `{ job id: [truck_id, block, stop_order, win_start, win_end,
arrive_at, status] }` of every booked / en route / on site job of the day on the listed trucks · `tell_list(p_day)` (owner /
« Réserver ») → `[{ id, number, customer_id, state: new|changed|drift, kind: booking|window|moved|null, told, now: { day,
start, end, rewin }, phone_ok, sms_ok, kind_on }]` · `tell_mark(p_op, p_marks: [{ id, how: call|hand, kind, day, start, end }])`
→ `{ ok, marked, changed, busy, rows: { jobs } }` · the columns `jobs.told_day`, `told_start`, `told_end`, `told_at`,
`told_how` (sms|maybe|call|hand|install), `told_by`, `hand_at` (the server's only; cleared when the customer or his phone
changes). Service role only: `day_order_core`, `tell_now`, `tell_state`, `tell_take`, `tell_done`, `tell_release`,
`told_install`, `day_rewin_on`, `told_hours`; Part 29's `plan_breaks(p_plan, p_xid)` → the vehicles whose stored day that
plan breaks (window mode), read by `plan_route` (which then answers, switch off too, `frozen: [vehicle ids]` and `kept: []`
for such a tight day: those vehicles keep their order), `replan_block_safe` (`{ skipped, kept, why: 'late' }`) and
`roads_replan`. With the switch on, the
suggestion rows (`suggest_blocks`, `suggest_windows`, the web ones) also carry `unmeasured`, `add_km` null when a trip is
not measured, `day_km`, `rank` and `route` (exact in window mode only; null by blocks); `far` is said only from measured
trips (`hop_known`; the day without its unmeasured legs), never by a guess; a row with `unmeasured` > 0 comes after every
measured one (never ordered by its guessed minutes) and the app never marks it best; off, the same keys and order as
before. `drive_wanted`, `drive_store`, `drive_spend_add`, `roads_state`, `drive_prune`, `web_unmeasured`, `eta_walk`,
`route_mark`, `eta_known` are the server key's only (the function `drive`, `book`, the planner).
Settings keys of « Vraies routes » (`settings.booking`; `src/data/types.ts`, the panel's `model.ts`): `roads_on` (false;
only `roads_switch` flips it: trigger `settings_roads_guard`), `roads_rush` (true: the morning and evening rush times),
`roads_rush_min` (15: a rush time is asked only for a trip of at least this; owner only), `roads_keep_days` (120: a time
older is asked again; owner only), `roads_month_tx` (10 000: TomTom Matrix transactions a month; 0 = never TomTom; owner
only), `roads_web_tx` (1 000: the online booking page's share of it; owner only), `near_min` (10: « proche » in minutes of
measured driving while on). `roads_rush_min` and `roads_keep_days` are not on a screen (the server's defaults); the guard
keeps all four « owner only » numbers for anybody else's save.
Server functions (`callFn` / helpers in api.ts): `notify { kind: booking|window|moved|arrived|extras|invoice|payment_reminder, job_id, resend? }` →
`{ status: sent|off|no_phone|error|already, message, link, phone }` (texts go through GoHighLevel; when it is not connected the
answer gives the message and the link so the person can send it from their own phone; Part 28: booking / window / moved go
under the lease `tell:<job>` and write what the client was told; `already` when nothing new is owed (`why: 'told'`) or
another send holds him (`why: 'busy'`); a client never told anything asked moved / window gets the booking text
(`sent_kind: 'booking'`); their `off` / `error` answers carry `told: { day, start, end }`, `kind`, `job_id`, and `maybe: true` when the text may
have gone) · `notify { action: 'day', day, base, op, only: [job ids ≤ 100], again?: [job ids] }` (owner / « Réserver »; Part
28) → `{ ok, status: 'done', day, sent, maybe, already, busy, gone, quiet: [{ id, phone, why }], no_phone, failed: [{ id,
error, phone, told, kind }], by_hand: [{ id, phone, message, link, told, kind }], left }` (call again with `left` and a NEW
op; `left` also holds a customer whose row another action held for the whole call — `busy` is only another send holding
his lease) · `enroute { action: start|refresh|end, job_id, pos?, notify? }` ·
`vin { vin }` · `team { action: list|invite|reset-link|invite-cancel|remove|secrets|secrets-set|sms-test|leave|forgot|invite-info|invite-accept }` ·
`drive { action: warm, point: { lat, lng }, from?, days?: 1…14, only?: 'point' }` (any member; without `point`: owner / office)
· `drive { action: sweep }` (owner / office, or the nightly job's GitHub ticket) → `{ ok, ready, left, left0, stored,
planned, kept, late, no_road, tomtom: ok|no_key|refused|busy|over_budget|unused, osrm: ok|down|unused, spent: { month, tx,
cap }, more }` (call again while `more`; the nightly ticket's sweep also `pruned` and `late_jobs: [{ id, number, day,
block }]`; a person past 30 calls an hour that ask TomTom for an address gets that address measured by OSRM and
`tomtom: over_budget`) · `drive { action: status }` → `{ ok, key, on, left, left0, month, rows: { tomtom, osrm, none } }`
(120 an hour a person, then `busy` 429) · `enroute refresh` (a trip under way only: an ended one → `not_en_route` 409,
another member's → 403, more than one every 4 minutes or 8 a trip → `busy` 429; never a text; « Je pars » start / return
ask a road 30 times an hour a person, then go without a time) ·
`book { action: info|slots|book }` (public, no token: « Réserver en ligne », client.html#reserver, Part 23; calls the service-role-only
`web_services`, `web_suggest`, `web_book`; on/off = `settings.booking.web.on`, Réglages → Réservations; brakes through `rate_hit`, Part 24: `busy` = 429, try again in a few minutes; « Vraies routes » on, `slots` refuses `web_off` before measuring anything, then measures the address and answers `unmeasured: true` when it offers nothing because moments were left out as not measured) · `client { action: view|sign|answer|pay|check, token }` (public page: `sign { signer, png, confirm }` = the estimate signed with the
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
« Vraies routes » in the demo (`src/dev/demo-extra/roads.ts`: a pretend `drive` and `roads_switch`, made-up times from
the distance, never a request out): `?demo&routes=1` opens it with the switch on and every trip measured;
`&tomtom=nokey|refuse|busy|over|down|missing` shows each failure of the panel. The demo NEVER uses a TomTom key, whatever
the shell or a `.env` gives (`tomtomKeyFor` in `lib/config.ts`): it would spend the garage's transactions on pretend data.

## Where the app lives

**https://mecanique-mobile-his.vercel.app/** — Vercel (team NextLine, project « mecanique-mobile-his »). GitHub builds
and tests every change of `main`, then pushes the built app to the branch `vercel` (with `ops/vercel/vercel.json`:
headers, nothing built on Vercel); Vercel publishes that branch. The same build also goes to `gh-pages`, the old address
https://hostnextline.github.io/garage2.0/, kept for links already sent: it shows `MovedBanner` (`movedTo()` in
`lib/config.ts`). Links made by the server always point to `HOME_URL` (`DEFAULT_BASES` in
`supabase/functions/_shared/links.ts`; a test checks both are the same). The build takes TomTom's BROWSER key from the
GitHub repository variable `TOMTOM_KEY` (`deploy.yml` → `VITE_TOMTOM_KEY`); restricted on TomTom's site to both
addresses above; empty = the free OpenStreetMap services. The SERVER key is a secret of the functions (`TOMTOM_KEY`),
never in the build.

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
   The map tiles (openstreetmap.org) and other outside sites can't be reached from this machine: that is expected
   (the demo has no TomTom key: OpenStreetMap's tiles, OSRM and Photon, as without the key).
4. Every string in both dictionaries; no hard-coded French in components (except customer data).
5. `npx vitest run src/architecture.test.ts` → green: no import of yours breaks the layers (« Folders »).
