let derivativeRowsCache = [];

async function loadScoreTablePanel(vpsId) {
  const shell = q("scoreTablePanelShell");
  const host = q("scoreTablePanelEmbed");
  if (!shell || !host) return;

  host.replaceChildren();
  shell.classList.add("hidden");

  const cleanVpsId = String(vpsId || "").trim();
  if (!cleanVpsId) return;

  const src = `panels/score_table/${encodeURIComponent(cleanVpsId)}.html`;

  try {
    const response = await fetch(src);
    if (!response.ok) {
      return;
    }

    const html = await response.text();
    const template = document.createElement("template");
    template.innerHTML = html;

    const fragment = template.content;
    const scripts = [...fragment.querySelectorAll("script")];
    scripts.forEach((script) => script.remove());

    host.appendChild(fragment.cloneNode(true));

    scripts.forEach((oldScript) => {
      const newScript = document.createElement("script");
      [...oldScript.attributes].forEach((attr) => {
        newScript.setAttribute(attr.name, attr.value);
      });
      newScript.textContent = oldScript.textContent;
      host.appendChild(newScript);
    });

    shell.classList.remove("hidden");
  } catch (error) {
    host.replaceChildren();
    shell.classList.add("hidden");
  }
}

function getVpsidFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("vpsid") || "").trim();
}

function setVpisidInUrl(vpsId) {
  const url = new URL(window.location.href);
  if (vpsId) {
    url.searchParams.set("vpsid", vpsId);
  } else {
    url.searchParams.delete("vpsid");
  }
  window.history.replaceState({}, "", url);
}

function setLookupStatus(message, isError = false) {
  const el = q("lookupStatus");
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("error", !!isError);
}

function fmtSubmitters(submitters) {
  if (!Array.isArray(submitters) || submitters.length === 0) {
    return '<span class="muted">Unknown</span>';
  }
  return submitters
    .filter((v) => String(v || "").trim() !== "")
    .map((v) => linkUserId(v))
    .join(", ");
}

function getTableArtUrl(vpsId) {
  if (!vpsId) return "";
  return `https://github.com/superhac/vpinmediadb/raw/refs/heads/main/${encodeURIComponent(vpsId)}/1k/bg.png`;
}

async function lookupByFilehash() {
  const filehash = q("filehashInput").value.trim();
  if (!filehash) {
    setLookupStatus("Enter a file hash to search.", true);
    return;
  }
  setLookupStatus("Looking up hash...");
  const result = await api(
    `/api/v1/tables/by-filehash/${encodeURIComponent(filehash)}`,
  );
  if (!result.ok) {
    setLookupStatus(`Lookup failed (${result.status}).`, true);
    return;
  }
  const matchedVpsId = result.data?.vpsId
    ? String(result.data.vpsId).trim()
    : "";
  if (!matchedVpsId) {
    setLookupStatus("No table match found for that hash.", true);
    return;
  }
  q("vpsIdInput").value = matchedVpsId;
  const alt = result.data?.altvpsid
    ? ` (altvpsid: ${result.data.altvpsid})`
    : "";
  setLookupStatus(`Matched VPS ID: ${matchedVpsId}${alt}`);
  await refreshDashboard();
}

function toComparableValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function buildDerivativeComparableMap(row) {
  const out = {};
  out.rom = toComparableValue(row?.rom);
  out.alttitle = toComparableValue(row?.alttitle);
  out.altvpsid = toComparableValue(row?.altvpsid);
  flattenObject(row?.vpxFile || {}, "vpxFile").forEach((item) => {
    out[item.key] = toComparableValue(item.value);
  });
  return out;
}

function setDerivativePanelExpanded(expanded) {
  const details = q("derivativeDifferencesDetails");
  const toggle = q("derivativeDifferencesToggle");
  if (!details || !toggle) return;

  details.classList.toggle("hidden", !expanded);
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");

  const indicator = toggle.querySelector(".panel-toggle-indicator");
  if (indicator) {
    indicator.textContent = expanded ? "-" : "+";
  }
}

function updateDerivativePanelTitle(rows) {
  const title = q("derivativeDifferencesTitle");
  const count = Array.isArray(rows) ? rows.length : 0;
  const comparisonCount = count > 1 ? (count * (count - 1)) / 2 : 0;
  if (title) {
    title.textContent = `Derivative Differences (${comparisonCount} comparisons)`;
  }
}

function renderDerivativeDifferences(rows) {
  const container = q("derivativeDifferencesDetails");
  updateDerivativePanelTitle(rows);

  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="muted">No submitted table data found for this VPS ID.</div>`;
    return;
  }
  if (rows.length === 1) {
    container.innerHTML = `<div class="muted">Only one variation exists, so there is no derivative comparison yet.</div>`;
    return;
  }

  const allKeys = new Set();
  const rowMaps = rows.map((row) => {
    const map = buildDerivativeComparableMap(row);
    Object.keys(map).forEach((key) => allKeys.add(key));
    return { row, map };
  });

  const varyingKeys = [...allKeys]
    .filter((key) => {
      const vals = new Set(rowMaps.map((entry) => entry.map[key] ?? ""));
      return vals.size > 1;
    })
    .sort((a, b) => a.localeCompare(b));

  const field = (label, value, isHtml = false) => `
                <div class="variation-field">
                    <div class="variation-label">${escapeHtml(label)}</div>
                    <div class="variation-value">${isHtml ? (value ?? "-") : escapeHtml(value ?? "-")}</div>
                </div>
            `;

  const chips = varyingKeys.length
    ? `<div class="chips">${varyingKeys.map((key) => `<span class="chip">${escapeHtml(key)}</span>`).join("")}</div>`
    : `<div class="muted">No field-level metadata differences detected.</div>`;

  let html = `
                <div class="variation-card">
                    <div class="variation-title">Pairwise Comparison Across All Variations</div>
                    <div class="variation-subtitle">Compared by: vpxFile fields, ROM, alt title, alt VPS ID</div>
                    ${chips}
                </div>
            `;

  for (let i = 0; i < rowMaps.length; i += 1) {
    for (let j = i + 1; j < rowMaps.length; j += 1) {
      const left = rowMaps[i];
      const right = rowMaps[j];
      const leftName = left.row?.vpxFile?.filename || `Variation ${i + 1}`;
      const rightName = right.row?.vpxFile?.filename || `Variation ${j + 1}`;
      const changedKeys = varyingKeys.filter(
        (key) => (left.map[key] ?? "") !== (right.map[key] ?? ""),
      );
      const changedFields = changedKeys.length
        ? changedKeys
            .map((key) => {
              const leftValue = left.map[key] ?? "";
              const rightValue = right.map[key] ?? "";
              return field(
                key,
                `${escapeHtml(leftValue || "(empty)")} <span class="muted">vs</span> ${escapeHtml(rightValue || "(empty)")}`,
                true,
              );
            })
            .join("")
        : `<div class="muted">No differences between these two variations in compared fields.</div>`;

      html += `
                        <div class="variation-card">
                            <div class="variation-title">${escapeHtml(leftName)} vs ${escapeHtml(rightName)}</div>
                            <div class="variation-subtitle">${changedKeys.length} differing field${changedKeys.length === 1 ? "" : "s"}</div>
                            <div class="variation-grid">
                                ${field("leftSubmittedBy", fmtSubmitters(left.row?.submittedByUserIdsNormalized), true)}
                                ${field("rightSubmittedBy", fmtSubmitters(right.row?.submittedByUserIdsNormalized), true)}
                                ${field("leftCreatedAt", fmtDate(left.row?.createdAt))}
                                ${field("rightCreatedAt", fmtDate(right.row?.createdAt))}
                                ${changedFields}
                            </div>
                        </div>
                    `;
    }
  }

  container.innerHTML = html;
}

function syncDerivativeDifferences(rows, options = {}) {
  derivativeRowsCache = Array.isArray(rows) ? rows : [];
  updateDerivativePanelTitle(derivativeRowsCache);

  if (options.resetCollapsed) {
    setDerivativePanelExpanded(false);
  }

  const isExpanded =
    q("derivativeDifferencesToggle")?.getAttribute("aria-expanded") === "true";

  if (isExpanded) {
    renderDerivativeDifferences(derivativeRowsCache);
    return;
  }

  const container = q("derivativeDifferencesDetails");
  if (container) {
    container.innerHTML = "";
  }
}

function toggleDerivativeDifferences() {
  const toggle = q("derivativeDifferencesToggle");
  if (!toggle) return;

  const nextExpanded = toggle.getAttribute("aria-expanded") !== "true";
  setDerivativePanelExpanded(nextExpanded);

  if (nextExpanded) {
    renderDerivativeDifferences(derivativeRowsCache);
  }
}

function renderAssociatedRoms(rows, activitySummary = null) {
  const container = q("associatedRomsDetails");
  const title = q("associatedRomsTitle");

  if (!rows || rows.length === 0) {
    if (title) title.textContent = "Metadata";
    container.innerHTML = `<div class="muted">No submitted table data found for this VPS ID.</div>`;
    return;
  }

  const romMap = new Map();
  rows.forEach((row, index) => {
    const filename = String(row?.vpxFile?.filename || "").trim();
    (row?.submittedByUserIdsNormalized || []).forEach((userId) => {
      const normalized = String(userId || "").trim();
      if (!normalized) return;
      // submitters are tracked both globally and per-ROM entry
    });

    const romValues = [...new Set(
      [row?.rom, row?.vpxFile?.rom]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    )];

    romValues.forEach((rom) => {
      const key = rom.toLowerCase();
      if (!romMap.has(key)) {
        romMap.set(key, {
          rom,
          filenames: new Set(),
          submitters: new Set(),
          variants: 0,
          firstIndex: index,
        });
      }

      const entry = romMap.get(key);
      entry.variants += 1;
      if (filename) entry.filenames.add(filename);

      (row?.submittedByUserIdsNormalized || []).forEach((userId) => {
        const normalized = String(userId || "").trim();
        if (normalized) entry.submitters.add(normalized);
      });
    });

    if (!romValues.length && filename) {
      const key = `__no_rom__${index}`;
      romMap.set(key, {
        rom: "No ROM",
        filenames: new Set([filename]),
        submitters: new Set(
          (row?.submittedByUserIdsNormalized || [])
            .map((userId) => String(userId || "").trim())
            .filter(Boolean),
        ),
        variants: 1,
        firstIndex: index,
      });
    }
  });

  const romEntries = [...romMap.values()].sort((a, b) => {
    if (a.variants !== b.variants) return b.variants - a.variants;
    if (a.firstIndex !== b.firstIndex) return a.firstIndex - b.firstIndex;
    return a.rom.localeCompare(b.rom);
  });

  if (title) {
    title.textContent = "Metadata";
  }

  if (romEntries.length === 0) {
    container.innerHTML = `<div class="muted">No ROM values were found on the submitted variations for this VPS ID.</div>`;
    return;
  }

  const field = (label, value, isHtml = false) => `
                <div class="variation-field">
                    <div class="variation-label">${escapeHtml(label)}</div>
                    <div class="variation-value">${isHtml ? (value ?? "-") : escapeHtml(value ?? "-")}</div>
                </div>
            `;

  const playerCount = Number(activitySummary?.playerCount || 0);
  const summaryCard = `
                <div class="variation-card">
                    <div class="variation-title">Table Summary</div>
                    <div class="variation-grid">
                        ${field("player installs", String(playerCount))}
                        ${field("romCount", String(romEntries.filter((entry) => entry.rom !== "No ROM").length))}
                    </div>
                </div>
            `;

  container.innerHTML =
    summaryCard +
    romEntries
      .map(
        (entry) => `
                <div class="variation-card">
                    <div class="variation-grid">
                        ${field("rom", entry.rom)}
                        ${field("variationCount", String(entry.variants))}
                        ${field("files", [...entry.filenames].map(escapeHtml).join("<br>") || "-", true)}
                    </div>
                </div>
            `,
      )
      .join("");
}

function renderVpsdbDetails(record, ratingSummary = null, activitySummary = null, activityWeekly = null) {
  const container = q("vpsdbByIdDetails");
  if (!record) {
    container.innerHTML = `<div class="muted">No VPSDB record found for this VPS ID.</div>`;
    return;
  }

  const vpsdb = record?.vpsdb && typeof record.vpsdb === "object" ? record.vpsdb : {};
  const title = vpsdb?.name || record?.vpsId || "Unknown Table";
  const manufacturer = typeof vpsdb?.manufacturer === "string" ? vpsdb.manufacturer.trim() : "";
  const year = vpsdb?.year === null || vpsdb?.year === undefined ? "" : String(vpsdb.year).trim();
  const subtitle = [manufacturer, year].filter(Boolean).join(" • ");
  const artUrl = getTableArtUrl(record?.vpsId);
  const avgRating = ratingSummary?.avgRating;
  const lastUpdated = record?.updatedAt ? fmtDate(record.updatedAt) : "-";
  const totalStarts = Number(activitySummary?.startCountTotal || 0);
  const totalRuntime = Number(activitySummary?.runTimeTotal || 0);
  const weeklyRuntime = Number(activityWeekly?.runTimePlayed || 0);
  const weeklyStarts = Number(activityWeekly?.startCountPlayed || 0);

  container.innerHTML = `
                <div class="table-focus-panel">
                    <div class="table-focus-header">
                        <img
                            class="table-focus-art"
                            src="${artUrl}"
                            alt="${escapeHtml(title)} backglass art"
                            onerror="this.style.display='none';"
                        >
                        <div class="table-focus-copy">
                            <div class="table-focus-title">${escapeHtml(title)}</div>
                            <div class="table-focus-rating-row">
                                <div class="table-focus-label">Rating</div>
                                <div class="table-focus-rating">${fmtRatingStars(avgRating, { showNumeric: true })}</div>
                            </div>
                            <div class="table-focus-subhead">${escapeHtml(subtitle || "Unknown Manufacturer")}</div>
                            <div class="table-focus-meta">Last update: ${escapeHtml(lastUpdated)}</div>
                        </div>
                    </div>
                    <div class="table-focus-stats">
                        <section class="table-focus-stat-card">
                            <div class="table-focus-label">Total Table Plays</div>
                            <div class="table-focus-stat-value">${escapeHtml(fmtNumber(totalStarts))}</div>
                            <div class="table-focus-stat-sub">Sum of startCount</div>
                        </section>
                        <section class="table-focus-stat-card">
                            <div class="table-focus-label">Total Play Time</div>
                            <div class="table-focus-stat-value">${escapeHtml(fmtRuntime(totalRuntime))}</div>
                            <div class="table-focus-stat-sub">Sum of runTime</div>
                        </section>
                        <section class="table-focus-stat-card">
                            <div class="table-focus-label">This Week Play Time</div>
                            <div class="table-focus-stat-value">${escapeHtml(fmtRuntime(weeklyRuntime))}</div>
                            <div class="table-focus-stat-sub">Last 7 days (delta)</div>
                        </section>
                        <section class="table-focus-stat-card">
                            <div class="table-focus-label">This Week Plays</div>
                            <div class="table-focus-stat-value">${escapeHtml(fmtNumber(weeklyStarts))}</div>
                            <div class="table-focus-stat-sub">Last 7 days (delta)</div>
                        </section>
                    </div>
                </div>
            `;
}

async function refreshDashboard() {
  const btn = document.querySelector("#refreshDashboardBtn");
  if (btn) btn.classList.add("refreshing");
  const vpsId = q("vpsIdInput").value.trim();
  setVpisidInUrl(vpsId);

  if (!vpsId) {
    await loadScoreTablePanel("");
    renderTable(
      "playerRatingsTable",
      [{ label: "Info", getter: () => "Enter a VPS ID" }],
      [],
    );
    q("playerRatingsTitle").textContent = "Player Ratings (0)";
    renderAssociatedRoms([]);
    syncDerivativeDifferences([], { resetCollapsed: true });
    renderVpsdbDetails(null, null, null, null);
    return;
  }

  const [
    ratingSummaryRes,
    playerRatingsRes,
    tableByIdRes,
    vpsdbByIdRes,
    activitySummaryRes,
    activityWeeklyRes,
  ] =
    await Promise.all([
      api(`/api/v1/tables/${encodeURIComponent(vpsId)}/rating-summary`),
      api(`/api/v1/tables/${encodeURIComponent(vpsId)}/user-ratings`),
      api(`/api/v1/tables/${encodeURIComponent(vpsId)}`),
      api(`/api/v1/vpsdb/${encodeURIComponent(vpsId)}`),
      api(`/api/v1/tables/${encodeURIComponent(vpsId)}/activity-summary`),
      api(`/api/v1/tables/${encodeURIComponent(vpsId)}/activity-weekly?days=7`),
    ]);

  await loadScoreTablePanel(vpsId);

  const playerRatingsRows =
    playerRatingsRes.ok && Array.isArray(playerRatingsRes.data)
      ? playerRatingsRes.data
      : [];
  q("playerRatingsTitle").textContent =
    `Player Ratings (${playerRatingsRows.length})`;
  renderTable(
    "playerRatingsTable",
    [
      { label: "Player", getter: (r) => linkUserId(r.userId), html: true },
      {
        label: "Score",
        getter: (r) => fmtRatingStars(r.rating, { showNumeric: true }),
        html: true,
      },
      { label: "Last Played", getter: (r) => fmtDate(r.lastRun) },
      { label: "Updated", getter: (r) => fmtDate(r.updatedAt) },
    ],
    playerRatingsRows,
  );

  const byIdRows =
    tableByIdRes.ok && Array.isArray(tableByIdRes.data)
      ? tableByIdRes.data
      : [];
  renderAssociatedRoms(
    byIdRows,
    activitySummaryRes.ok ? activitySummaryRes.data : null,
  );
  syncDerivativeDifferences(byIdRows, { resetCollapsed: true });

  const vpsdbRecord =
    vpsdbByIdRes.ok && vpsdbByIdRes.data ? vpsdbByIdRes.data : null;
  renderVpsdbDetails(
    vpsdbRecord,
    ratingSummaryRes.ok ? ratingSummaryRes.data : null,
    activitySummaryRes.ok ? activitySummaryRes.data : null,
    activityWeeklyRes.ok ? activityWeeklyRes.data : null,
  );

  const header = document.querySelector("vpinplay-header");
  if (header) {
    header.markRefresh();
  }

  if (btn) {
    setTimeout(() => btn.classList.remove("refreshing"), 600);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  q("derivativeDifferencesToggle")?.addEventListener(
    "click",
    toggleDerivativeDifferences,
  );
  const vpsid = getVpsidFromUrl();
  if (vpsid) {
    q("vpsIdInput").value = vpsid;
  }
  refreshDashboard();
});
