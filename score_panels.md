# Score Panels

This document explains the current process for creating new score panels for a table when given:

- a new `vpsId`
- a JSON score blob
- an existing panel to use as the base

The goal is to make future panel creation fast and consistent for both:

- `www/panels/score_table/*.html`
- `www/panels/score_user/*.html`

There are now two main score JSON families in use:

- leaderboard-style payloads with `entries[]`
- single-value payloads with `score_type` + `value`

## Current Working Examples

Use these as the reference implementations:

- Global scoreboard panel: [www/panels/score_table/vZDUDUii.html](/home/superhac/test/vpinfe_online_service/www/panels/score_table/vZDUDUii.html)
- User scoreboard panel: [www/panels/score_user/vZDUDUii.html](/home/superhac/test/vpinfe_online_service/www/panels/score_user/vZDUDUii.html)
- Complex multi-section user panel example: [www/panels/score_user/9Paf7-CL.html](/home/superhac/test/vpinfe_online_service/www/panels/score_user/9Paf7-CL.html)
- Flexible table panel example: [www/panels/score_table/WyxpJ3Wjt3.html](/home/superhac/test/vpinfe_online_service/www/panels/score_table/WyxpJ3Wjt3.html)

## Folder Layout

- Table-wide/global panels live in `www/panels/score_table/`
- Per-user panels live in `www/panels/score_user/`
- Shared table panel styling is in [www/css/score-table-panel.css](/home/superhac/test/vpinfe_online_service/www/css/score-table-panel.css)
- Shared user panel styling is in [www/css/score-user-panel.css](/home/superhac/test/vpinfe_online_service/www/css/score-user-panel.css)

## Inputs Needed

For a new panel request, the minimum useful inputs are:

- the target `vpsId`
- the base panel to copy from
- the score JSON blob

Helpful extra info:

- whether both `score_table` and `score_user` panels are needed
- whether the table has a known art image in `vpinmediadb`
- whether the score sections should be shown exactly as given, or normalized into a simpler layout

## High-Level Rule

Always start from the closest existing panel instead of building from scratch.

Choose the base by score shape, not by table theme or ROM name.

In practice:

- If the JSON has `GRAND CHAMPION` plus one ranked section, use `vZDUDUii` as the simplest base
- If the JSON has several custom sections, use `9Paf7-CL` as the richer base
- If the sections are dynamic or not yet known, `WyxpJ3Wjt3` can be a good flexible `score_table` base
- If the JSON is a single-value score with no `entries` array, use `fz-KTflv` as the base

## Creating a New `score_table` Panel

### 1. Copy the Best Base

Create:

- `www/panels/score_table/<NEW_VPSID>.html`

Usually copy one of:

- `www/panels/score_table/vZDUDUii.html` for simple two-section boards
- `www/panels/score_table/9Paf7-CL.html` for `GRAND CHAMPION` plus multiple ranked sections
- `www/panels/score_table/WyxpJ3Wjt3.html` for dynamic section-title handling
- `www/panels/score_table/fz-KTflv.html` for `score.value` / single-value score types

### 2. Update the VPS ID

Change:

```js
const PANEL_VPS_ID = "<NEW_VPSID>";
```

### 3. Map the JSON Sections to Cards

Read `Score.entries` from the JSON blob and list unique `section` values.

If the JSON does not have an `entries` array and instead looks like this:

```json
{
  "score_type": "HIGHEST SCORE",
  "value": 42520
}
```

then do not use section grouping. Use the `fz-KTflv` pattern instead:

- one card
- title from `score.score_type`
- value from `score.value`
- in `score_table`, render a ranked user list by sorting all matched rows on `score.value`
- in `score_user`, render the user’s single value in a hero card

Important:

- panel layout decisions should be driven by the actual score payload shape
- do not choose the panel structure from `rom` or `resolved_rom` alone
- `rom` and `resolved_rom` may differ without affecting the needed panel layout

Example:

```json
[
  { "section": "GRAND CHAMPION", ... },
  { "section": "HIGHEST SCORES", "rank": 1, ... },
  { "section": "HIGHEST SCORES", "rank": 2, ... }
]
```

Typical mappings:

- `GRAND CHAMPION` -> hero card via `renderGrandChampion(...)`
- ranked lists like `HIGHEST SCORES` -> `renderRankedList(...)`
- special one-off sections -> `renderSpecial(...)` in user panels, or custom rendering if needed

If the new table does not use a section, remove its card and its render call.

Example for a simple global panel:

```js
const groups = groupEntries(entries);
renderGrandChampion((groups.get("GRAND CHAMPION") || [])[0] || null);
renderRankedList("afm-highest-body", (groups.get("HIGHEST SCORES") || []).slice(0, RANKED_SECTION_LIMIT));
```

### 4. Set the Entry Limit

For ranked sections, choose the correct cap.

Current example:

```js
const RANKED_SECTION_LIMIT = 4;
```

Use the JSON blob to determine the intended count. If the blob has 4 ranked rows, set the limit to 4.

### 5. Preserve Score Formatting

Keep these utility behaviors unless the new table needs something special:

- `scoreText(entry)` for score/value rendering
- `groupEntries(entries)` for section grouping
- `compareEntries(...)` for sorting
- `scoreOwnerLabel(...)` to prefer matched user IDs but fall back to initials when needed

For global panels, `scoreOwnerLabel(...)` should usually prefer:

1. `matchedUserId`
2. `initials`

For single-value global panels like `fz-KTflv`:

1. sort all matched rows by `score.value` descending
2. render a top-N user list
3. use `score.score_type` as the visible card title

### 6. Keep the Clean Status Behavior

On successful load, the panel should hide the status bar instead of leaving a success message visible.

Expected pattern:

```js
function clearStatus() {
  const el = q("afm-status");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}
```

Then call `clearStatus()` after the grid is shown.

## Creating a New `score_user` Panel

### 1. Copy the Best Base

Create:

- `www/panels/score_user/<NEW_VPSID>.html`

Usually copy one of:

- `www/panels/score_user/vZDUDUii.html` for simple `Grand Champion` + `Highest Scores`
- `www/panels/score_user/9Paf7-CL.html` for tables with several sections
- `www/panels/score_user/fz-KTflv.html` for `score.value` / single-value score types

### 2. Update the VPS ID

Change:

```js
const PANEL_VPS_ID = "<NEW_VPSID>";
```

### 3. Update the Art URL

Header art uses this pattern:

```html
src="https://github.com/superhac/vpinmediadb/raw/refs/heads/main/<VPSID>/1k/bg.png"
```

So replace the embedded VPS ID in the image URL.

If the art does not exist yet, the panel may still work, but the image will fail to load until the asset exists.

### 4. Use VPSDB Name, Not Hard-Coded Text

Do not hard-code the table title.

The current correct pattern is:

- show a temporary loading label in the markup
- populate the real title from API data after loading

Markup:

```html
<div class="afm-kicker" id="afm-kicker">Loading table...</div>
```

Script helper:

```js
function getTableDisplayName(row) {
  const vpsdbName = typeof row?.vpsdb?.name === "string" ? row.vpsdb.name.trim() : "";
  if (vpsdbName) return vpsdbName;

  const tableTitle = typeof row?.tableTitle === "string" ? row.tableTitle.trim() : "";
  if (tableTitle) return tableTitle;

  return PANEL_VPS_ID;
}
```

After loading:

```js
q("afm-kicker").textContent = getTableDisplayName(row);
```

### 5. Include Header Metadata

The current user-panel header should show:

- VPSDB table name as the largest text
- rating
- manufacturer and year
- last update

Current markup pattern:

```html
<div class="afm-meta-stack">
  <div class="afm-meta-line afm-rating-line">
    <span class="afm-rating-label">Rating</span>
    <span id="afm-rating">Loading...</span>
  </div>
  <div class="afm-meta-line" id="afm-subtitle">Loading metadata...</div>
  <div class="afm-meta-line" id="afm-meta">Waiting for user score data.</div>
</div>
```

### 6. Fetch Rating Summary

User panels now also fetch rating data:

```js
async function fetchRatingSummary() {
  const path = `/api/v1/tables/${encodeURIComponent(PANEL_VPS_ID)}/rating-summary`;
  return api(path);
}
```

Then load it in parallel with the score row and initials:

```js
const [scoreResult, initialsResult, ratingSummaryResult] = await Promise.all([
  fetchScoreRow(userId),
  fetchUserInitials(userId),
  fetchRatingSummary(),
]);
```

### 7. Populate Metadata

Current behavior:

- title comes from `row.vpsdb.name`, fallback `row.tableTitle`
- rating comes from `ratingSummaryResult.data.avgRating`
- manufacturer and year come from `row.vpsdb`
- last update comes from `row.updatedAt`

Current pattern:

```js
q("afm-kicker").textContent = getTableDisplayName(row);
q("afm-rating").innerHTML = fmtRatingStars(ratingSummaryResult.ok ? ratingSummaryResult.data?.avgRating : null);

const manufacturer = typeof row?.vpsdb?.manufacturer === "string" ? row.vpsdb.manufacturer.trim() : "";
const year = row?.vpsdb?.year === null || row?.vpsdb?.year === undefined ? "" : String(row.vpsdb.year).trim();
q("afm-subtitle").innerHTML = `<strong>${escapeHtml(manufacturer || "Unknown Manufacturer")}</strong>${year ? ` • ${escapeHtml(year)}` : ""}`;

const updatedAt = row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "Unknown";
q("afm-meta").textContent = `Last update: ${updatedAt}`;
```

### 8. Preserve User-ID Replacement Logic

The user panel should continue replacing matching initials with the loaded user ID when possible.

Keep this logic:

- fetch `/api/v1/users/<userId>/initials`
- build a `replacement` object with `userId` and `initials`
- pass it to `renderGrandChampion(...)`, `renderRankedList(...)`, and `renderSpecial(...)`

For single-value score panels with no `entries[]`, initials replacement is not usually needed because the panel renders only the current user’s value.

### 9. Keep the Clean Status Behavior

Use the same approach as the table panels:

- hidden by default
- shown only while loading or on error
- hidden again after success

## Section Decision Guide

When given a JSON score blob, use this guide:

- One hero entry plus one ranked section:
  Use the `vZDUDUii` pattern
- One hero entry plus multiple ranked sections:
  Use the `9Paf7-CL` pattern
- No hero section, or unknown/custom labels:
  Consider the `WyxpJ3Wjt3` pattern for `score_table`
- One-off stat sections:
  Use a `renderSpecial(...)`-style card in `score_user`
- No `entries`, only `score_type` and `value`:
  Use the `fz-KTflv` pattern

## Common Things to Change

For every new panel, always check these:

- `PANEL_VPS_ID`
- art URL in `score_user`
- which cards exist in the HTML
- which section names are rendered in JS
- ranked list limit
- whether this is an `entries[]` panel or a `score.value` panel
- error messages that still mention an old table
- title source: must use VPSDB name, not a hard-coded table name

## Common Things Not to Break

- query params:
  `userid`, `userId`, `apibase`, `apiBase`
- API base fallback:
  `window.VPINPLAY_PANEL_CONFIG.apiBase`
- user ID fallback:
  `window.VPINPLAY_PANEL_CONFIG.userId`
- initials replacement logic in `score_user`
- hidden-on-success status behavior

## Standard Workflow For Future Requests

When asked to create a new panel:

1. Identify whether `score_table`, `score_user`, or both are needed.
2. Identify the score payload shape first:
   `entries[]` or single-value `score.value`.
3. Pick the closest existing base for that shape.
4. Copy to the new VPS ID filename.
5. Inspect the JSON blob and list all section names, or confirm it is a single-value score.
6. Remove unused cards.
7. Update render calls to exactly match the JSON structure.
8. Set ranked-entry limits to the intended count when applicable.
9. In user panels, verify header title, rating, manufacturer, year, and last update are wired correctly.
10. Remove any old hard-coded table names or leftover messages.
11. Verify the status panel hides after successful load.

## What To Provide In Future Requests

To make future panel creation fast, the request should ideally include:

- the new `vpsId`
- whether you want `score_table`, `score_user`, or both
- which existing panel should be used as the base
- the JSON score blob

Optional but helpful:

- the human-readable table name if known
- whether the panel should stay minimal or keep extra sections
- whether the table art already exists in `vpinmediadb`

## Current Recommended Defaults

If no special instruction is given:

- use `vZDUDUii` as the base for simple new scoreboards
- use `9Paf7-CL` as the base for complex multi-section scoreboards
- use `fz-KTflv` as the base for single-value score types
- always use VPSDB name as the visible title in `score_user`
- always include rating, manufacturer, year, and last update in `score_user`
- always hide success status bars after the panel loads
