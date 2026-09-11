# airDash common change recipes

A recipe is a complete, inspectable example of one kind of change: the file to open, the lines to alter, the validation to run, and the deployment procedure to follow. Each recipe names the real files and shows real code from this project. Use a recipe as a pattern for the change you actually need.

Every recipe assumes you are at the project root:

```bash
cd /opt/dashy-database/projects/airdash
```

Every recipe ends by pointing to one of two deployment procedures in the [deployment guide](deployment.md): a frontend-only deployment (build, no restart) or an API deployment (restart, no build). Do not skip the release backup those procedures require.

## Change the Portal pilot and base line

**Goal:** Replace the Hangar heading intro `AD0001 is based at KATL.` with a home icon followed by `AD0001; KATL.`

**Classification:** Frontend only. Build required, no API restart.

This is the reference example for the most common request: change how something looks on one page. It also demonstrates the one complication a beginner is likely to hit, which is that the target prop accepted only plain text.

### 1. Find the code

The visible text is generated from a template string, so search for the static fragment:

```bash
grep -n 'is based at' web/src/App.tsx
```

Before the change, line 504 inside the `Portal` component read:

```tsx
return <Page title={quip} icon={<FiHome />} intro={`${me.pilot.pilot_number} is based at ${me.pilot.base_code}.`}>
```

`intro` is a prop of the shared `Page` component. Find its definition:

```bash
grep -n 'function Page(' web/src/App.tsx
```

```tsx
function Page({ title, icon, intro, children }: { title: string; icon: ReactNode; intro?: string; children: ReactNode }) {
```

`intro?: string` means the prop accepts text only. An icon is a React element, not text, so passing one would fail the type check. Two edits are needed.

### 2. Widen the prop type

Change `intro?: string` to `intro?: ReactNode`. `ReactNode` is already imported at the top of `App.tsx`, and it accepts strings, elements, and fragments. The `Page` body renders `{intro && <p>{intro}</p>}`, which works unchanged for either type.

After the change:

```tsx
function Page({ title, icon, intro, children }: { title: string; icon: ReactNode; intro?: ReactNode; children: ReactNode }) {
```

Every other page that passes a plain string to `intro` continues to compile, because a string is a valid `ReactNode`.

### 3. Replace the intro content

Replace the template string with a span containing the icon and the new wording. A `className` is added so the icon can be styled.

After the change:

```tsx
return <Page title={quip} icon={<FiHome />} intro={<span className="portal-pilot-base"><FiHome />{me.pilot.pilot_number}; {me.pilot.base_code}.</span>}>
```

Reading the JSX left to right: a `span` with a class, the `FiHome` icon component, the pilot number variable, a literal `; `, the base code variable, and a literal `.`. `FiHome` is already imported because the page heading uses it.

### 4. Style the icon

Append one rule to the end of `web/src/styles.css`:

```css
.portal-pilot-base{display:inline-flex;align-items:center;gap:7px}.portal-pilot-base svg{flex:0 0 auto;color:var(--teal);font-size:.95rem}
```

`inline-flex` with `align-items:center` puts the icon and text on one vertically centered line. `gap` separates them. `var(--teal)` is the project accent color, and `flex:0 0 auto` prevents the icon from shrinking.

### 5. Validate

```bash
npm --prefix web run typecheck
out=$(mktemp -d /tmp/airdash-check.XXXXXX)
( cd web && npm exec vite -- build --outDir "$out" --emptyOutDir )
grep -aFq 'portal-pilot-base' "$out"/app-assets/index-*.js && echo js-marker-present
grep -aFq 'portal-pilot-base' "$out"/app-assets/index-*.css && echo css-marker-present
```

All three checks must succeed. Had step 2 been skipped, the type check would have reported `Type 'Element' is not assignable to type 'string'` at line 504, which is the expected and useful failure.

### 6. Deploy

Follow [Deploy a frontend-only change](deployment.md#deploy-a-frontend-only-change). After the build, open `https://air.dashydoggo.com/portal` and confirm the heading intro shows the icon followed by `AD0001; KATL.`

### Variations

- **Different wording:** edit the literal text inside the span. No type change is needed a second time.
- **Different icon:** replace `<FiHome />` with another imported Feather icon, or import a new one.
- **Different separator:** change `; ` to any literal. Do not reintroduce a literal arrow glyph; the project uses `<FiArrowRight className="inline-arrow" />` for arrows.

## Change static text on a page

**Classification:** Frontend only.

1. Search for the exact visible text: `grep -n 'Volanta required' web/src/App.tsx`.
2. Edit the string in place. If the text is inside a template string with `${}`, keep the variables and change only the literal parts.
3. Run the frontend validation sequence using a fragment of the new text as the marker.
4. Deploy with the frontend-only procedure.

If the text appears in more than one place and only one should change, read the surrounding component name to confirm you are editing the right occurrence.

## Change a color, spacing, or layout rule

**Classification:** Frontend only.

1. In the browser, inspect the element and note its class name.
2. Find the existing rule: `grep -n 'class-name' web/src/styles.css`.
3. Either edit the rule in place or append an overriding rule at the end of the file. Appending is safer when the original rule is part of a long minified line.
4. For phone layouts, add the override inside a `@media(max-width:650px){ ... }` block.
5. Validate. Use the class name as the CSS marker.
6. Deploy with the frontend-only procedure.

Colors should use the variables defined in `:root` at the top of `styles.css` so the palette stays consistent.

## Add a new section to the Portal

**Classification:** Frontend only.

The Portal uses a `PortalSectionHeading` component for its unboxed section heroes. To add a section:

```tsx
<PortalSectionHeading id="portal-my-section" icon={<FiStar />} eyebrow="Kicker text" title="Section title" description="One sentence explaining the section." />
<section className="my-section">
  ...content...
</section>
```

Then add the section to the Hangar outline so it is navigable:

```tsx
<a href="#portal-my-section"><FiStar /> Section title</a>
```

The `id` on the heading is the anchor target, and `.portal-section-heading[id]` already has `scroll-margin-top` so the sticky header does not cover it. Validate with the `id` string as the marker and deploy with the frontend-only procedure.

## Add a navigation link

**Classification:** Frontend only.

Navigation is defined in `Layout` as two arrays, `primaryLinks` and `secondaryLinks`. Each entry is `[path, label, icon]`. Add an entry to the appropriate array. If the path is new, also add a `<Route path="..." element={<YourPage />} />` in the `App` component's `<Routes>` block and create the page component. Validate and deploy with the frontend-only procedure.

## Add a field to an existing API response

**Goal:** Expose an existing database column through an endpoint the frontend or automation reads.

**Classification:** API. Restart required. Frontend build only if the UI displays the field.

This is exactly how `departure_gate`, `arrival_gate`, and `pilot_number` were added to `/live` for the PowerPoint exporter.

### 1. Find the route

```bash
grep -n 'app.get("/live"' api/src/server.js
```

### 2. Add the column to the SELECT

Before:

```js
const result = await pool.query(`SELECT a.id, a.registration, a.status, r.flight_number, ...
```

After:

```js
const result = await pool.query(`SELECT a.id, a.registration, a.status, a.departure_gate, a.arrival_gate, r.flight_number, ..., p.pilot_number, ...
```

The alias before each column (`a.`, `r.`, `p.`) refers to the table alias in the `FROM` and `JOIN` clauses of the same query. Add the column under the alias of the table that owns it.

**Important:** Only expose fields that are appropriate for the route's audience. `/live` is public. Never add a private column such as `vatsim_cid`, an email, or a Discord username to a public route.

### 3. Update the frontend type

If the frontend consumes the field, add it to the matching interface in `web/src/types.ts` so TypeScript knows it exists:

```ts
export interface Assignment { ...; departure_gate?: string | null; ... }
```

### 4. Validate

```bash
npm --prefix api run check
npm --prefix api run test:streaks
cd api
PORT=39150 node src/server.js > /tmp/smoke.log 2>&1 &
smoke_pid=$!
sleep 3
curl -fsS http://127.0.0.1:39150/live | grep -o '"departure_gate":"[^"]*"' | head -1
kill "$smoke_pid"
cd ..
```

### 5. Deploy

Follow [Deploy an API-only change](deployment.md#deploy-an-api-only-change). If the UI also changed, then follow the frontend-only procedure.

## Add a new API endpoint

**Classification:** API. Restart required.

Add a route near related routes in `api/src/server.js`:

```js
app.get("/my-route", requireUser, async (req, res) => {
  const result = await pool.query(
    "SELECT id, title FROM airdash.org_updates WHERE created_by=$1 ORDER BY created_at DESC LIMIT $2",
    [req.user.id, 20],
  )
  res.json({ items: result.rows })
})
```

Rules:

- Choose `requireUser` for pilot routes, `requireOwner` for administration, or no middleware for public read-only data.
- Every value that comes from the request must be a `$n` parameter, never concatenated into the SQL string.
- Use `clean(req.body.field, maxLength)` for text input and validate enumerations against an explicit list.
- Return errors as `res.status(4xx).json({ error: "Message the user can read" })`.
- Write an `audit()` record for any state change an owner might need to trace later.

Validate with the API sequence, using a temporary process to call the new route. Deploy with the API procedure. The browser reaches the route at `/api/my-route`.

## Add a database column

**Classification:** Migration. API restart required. Database backup required.

### 1. Add the migration statement

Open `api/src/database.js` and find the block of `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements. Add yours alongside them:

```sql
ALTER TABLE airdash.pilots ADD COLUMN IF NOT EXISTS favorite_airport TEXT;
```

`IF NOT EXISTS` makes repeated startups safe. Allowing `NULL` (the default when no `NOT NULL` is specified) or providing a `DEFAULT` keeps existing rows valid. A `NOT NULL` column without a default fails on a table that already has rows.

### 2. Back up

Run both the [release backup](backup-and-recovery.md#release-backup) and the [database backup](backup-and-recovery.md#database-backup).

### 3. Validate

The temporary-process smoke test applies the migration, which is the real test:

```bash
npm --prefix api run check
cd api
PORT=39150 node src/server.js > /tmp/smoke.log 2>&1 &
smoke_pid=$!
sleep 4
grep -i error /tmp/smoke.log || echo no-startup-errors
kill "$smoke_pid"
cd ..
docker exec dashy-postgres psql -U dashy -d dashyden -Atc \
  "SELECT column_name FROM information_schema.columns WHERE table_schema='airdash' AND table_name='pilots' AND column_name='favorite_airport';"
```

The last command prints the column name if the migration succeeded.

### 4. Deploy

Follow [Deploy an API-only change](deployment.md#deploy-an-api-only-change). Because the temporary process already applied the migration, the production restart finds the column present and continues.

### 5. Use the column

Read or write it in a route as in the previous recipes. Add it to `types.ts` if the frontend displays it.

## Add a notification type

**Classification:** API, and frontend only if the new group needs its own rendering. Restart required; build only if the frontend changes.

Notifications are server-authoritative. `getNotificationPayload` in `api/src/notifications.js` runs one query per group, `normalizeRecord` turns each row into a title, body, and link, and `syncNotificationHistory` inserts new records into `airdash.notification_history` keyed by `(discord_id, event_key)`. The frontend reads the `history` array and the unread `total`; it does not compute anything per group.

1. **API, group name:** add the new group to the `notificationGroups` array in `api/src/notifications.js`. Groups not in this array are never synchronized into history.
2. **API, query:** in `getNotificationPayload`, add a query to the owner branch, the pilot branch, or both, and add its rows to the returned object under the new group name. Include in the selected columns whatever `normalizeRecord` needs, and an `id` or other identity column so `eventKey` is stable. Return an empty array for the branch that does not use the group, as `expired: []` does for the owner.
3. **API, rendering:** add a `case "<newGroup>":` to the `switch` in `normalizeRecord` that sets `title`, `body`, and `href`. The `href` should be a page route with an anchor the page understands, such as `/portal#portal-updates`.
4. **Frontend type:** add the optional array to `NotificationPayload` in `web/src/notificationState.ts` so that pages which read the raw group (the Hangar reads `progress`, `orgUpdates`, and `aircraft`) can type it.
5. **Frontend rendering:** nothing is required for the bell panel, which renders `history` generically. Add page-specific rendering only if the Hangar or Administration should show the group in its own section.
6. Validate the API sequence and call `GET /notifications` in the smoke test to see the new records appear in `history`. Deploy the API first, then the frontend if it changed.

Records that change produce a new `event_key` and therefore a new notification; design the selected columns so that irrelevant changes (for example a `reviewed_at` timestamp that updates on every save) do not create duplicates.

## Change the SimBrief or VATSIM remark

**Classification:** API for SimBrief generation, frontend for the VATSIM pre-file URL.

The SimBrief `manualrmk` is set in `buildSimBriefDispatchParams` in `api/src/recoveryMissions.js`, which `GET /assignments/:id/simbrief-generate` calls; there is one remark for standard flights and one for recovery ferries. The VATSIM remark is built in `web/src/flightPlan.ts` from the constants `AIRDASH_CALLSIGN_REMARK` and `AIRDASH_SITE_REMARK` by `completeRemark` and `appendAirDashRemark`. Change the literal text, validate the relevant side (`npm --prefix api run test:flight-outcomes` asserts the ferry remark), and deploy the relevant side. Keep the site name inside `RMK/` and avoid hyphens in the remark text, which ICAO treats as field delimiters.

## Publish a new static asset

**Classification:** Static file. No build, no restart.

```bash
install -m 644 /path/from/upload.png site/assets/new-name.png
curl -fsS -o /dev/null -w '%{http_code}\n' https://air.dashydoggo.com/assets/new-name.png
```

Reference it from source as `/assets/new-name.png`. `site/assets/` is cached for one day by Nginx, so use a new filename when replacing an image.

## Add an announcement

**Classification:** No code change.

Sign in as the owner, open `/admin`, and use the organization-update composer. Announcements are stored permanently in `airdash.org_updates` and appear in the Hangar Announcements card and the `/announcements` archive. The composer is the intended path; do not insert rows by hand.

## Change aircraft status

**Classification:** No code change.

Sign in as the owner, open `/admin`, select the Aircraft tab, and use the status controls. Inspection sets a 48-hour hold that the expiry job releases automatically. Maintenance requires manual release. Every change writes an audit event and appears in Equipment notifications for pilots.

## Add or edit a route (flight)

**Classification:** Migration-style seed. API restart required.

Routes are seeded in `database.js` with `INSERT ... ON CONFLICT (flight_number) DO NOTHING`. Add a tuple of `(flight_number, origin, destination, block_minutes, days)` to the seed list, keeping the flight number unique and the origin/destination pair unique. Validate with a temporary process, then restart the API. The schedule job creates departures for the new route within ten minutes. Editing an existing route's attributes requires an explicit `UPDATE`, because `DO NOTHING` leaves existing rows unchanged; write that `UPDATE` with a `WHERE flight_number=...` clause after taking a database backup.

## Update this documentation

**Classification:** Documentation only.

Edit the Markdown files in `docs/`. Follow the [documentation style standard](documentation-style.md). Keep paths and commands literal, and rerun any command you document so the expected output stays accurate. No build or restart is involved.
