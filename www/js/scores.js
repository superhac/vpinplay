function handleScoresSetupSubmit(event) {
  event.preventDefault();
  refreshDashboard();
}

function getCaseInsensitiveValue(obj, key) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
  const target = String(key).toLowerCase();
  const match = Object.keys(obj).find(
    (k) => String(k).toLowerCase() === target,
  );
  return match ? obj[match] : undefined;
}

function getScorePayload(row) {
  const directScore = getCaseInsensitiveValue(row, "score");
  if (
    directScore &&
    typeof directScore === "object" &&
    !Array.isArray(directScore)
  ) {
    return directScore;
  }

  const user = getCaseInsensitiveValue(row, "user");
  const nestedScore = getCaseInsensitiveValue(user, "score");
  if (
    nestedScore &&
    typeof nestedScore === "object" &&
    !Array.isArray(nestedScore)
  ) {
    return nestedScore;
  }

  return null;
}

function setStatus(message) {
  const el = q("status");
  if (el) el.textContent = message;
}

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    userId: (params.get("userid") || "").trim(),
    vpsId: (params.get("vpsid") || "").trim(),
  };
}

function setParams(userId, vpsId) {
  const url = new URL(window.location.href);
  if (userId) url.searchParams.set("userid", userId);
  else url.searchParams.delete("userid");
  if (vpsId) url.searchParams.set("vpsid", vpsId);
  else url.searchParams.delete("vpsid");
  window.history.replaceState({}, "", url);
}

async function fetchRowsWithUserScore(userId, vpsId = "") {
  const allRows = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (vpsId) query.set("vpsId", vpsId);

    const result = await api(
      `/api/v1/users/${encodeURIComponent(userId)}/tables/with-score?${query.toString()}`,
    );
    if (!result.ok || !Array.isArray(result.data)) {
      return {
        ok: false,
        rows: allRows,
        status: result.status,
        error: result.data?.error || "Request failed",
      };
    }

    allRows.push(...result.data);
    if (result.data.length < PAGE_SIZE) {
      return { ok: true, rows: allRows };
    }
  }
}

async function fetchRowsWithScoreForVpsId(vpsId) {
  const allRows = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await api(
      `/api/v1/users/tables/with-score?vpsId=${encodeURIComponent(vpsId)}&limit=${PAGE_SIZE}&offset=${offset}`,
    );
    if (!result.ok || !Array.isArray(result.data)) {
      return {
        ok: false,
        rows: allRows,
        status: result.status,
        error: result.data?.error || "Request failed",
      };
    }

    allRows.push(...result.data);
    if (result.data.length < PAGE_SIZE) {
      return { ok: true, rows: allRows };
    }
  }
}

function summarizeScores(rows) {
  const keyCounts = new Map();
  const typeSet = new Set();
  const tableSet = new Set();
  let maxValue = null;

  rows.forEach((row) => {
    tableSet.add(row.vpsId);

    const score = getScorePayload(row) || {};
    flattenObject(score).forEach((item) => {
      keyCounts.set(item.key, (keyCounts.get(item.key) || 0) + 1);
    });

    const scoreType = String(score.score_type || "").trim();
    if (scoreType) typeSet.add(scoreType);

    const numericValue = Number(score.value);
    if (Number.isFinite(numericValue)) {
      maxValue =
        maxValue === null ? numericValue : Math.max(maxValue, numericValue);
    }
  });

  return {
    scoreCount: rows.length,
    tableCount: tableSet.size,
    scoreTypeCount: typeSet.size,
    maxValue,
    keyCounts: [...keyCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    ),
  };
}

function renderKeyChips(keyCounts) {
  const title = q("scoreKeysTitle");
  const container = q("scoreKeysDetails");
  if (title) title.textContent = `Observed Score Keys (${keyCounts.length})`;

  if (!container) return;
  if (!keyCounts.length) {
    container.innerHTML = `<div class="muted">No score keys found in the current result set.</div>`;
    return;
  }

  container.innerHTML = keyCounts
    .map(
      ([key, count]) => `
        <span class="chip">
            <span>${escapeHtml(key)}</span>
            <span class="chip-count">${escapeHtml(String(count))}</span>
        </span>
    `,
    )
    .join("");
}

function renderScoreCards(rows) {
  const title = q("scoreCardsTitle");
  const container = q("scoreCards");
  if (title) title.textContent = `Scored Tables (${rows.length})`;
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = `<div class="muted">No score payloads matched this filter.</div>`;
    return;
  }

  const cards = rows.map((row) => {
    const score = getScorePayload(row) || {};
    const flatScore = flattenObject(score);
    const scoreType = score?.score_type
      ? String(score.score_type)
      : "Score Payload";
    const primaryValue = score?.value;
    const valueBadge =
      primaryValue === null || primaryValue === undefined || primaryValue === ""
        ? escapeHtml(scoreType)
        : `${escapeHtml(scoreType)}: ${escapeHtml(fmtNumber(primaryValue))}`;

    return `
            <div class="score-card">
                <div class="score-card-header">
                    <div>
                        <div class="score-card-title">${escapeHtml(fmtTableName(row))}</div>
                        <div class="score-card-subtitle">
                            VPS: ${linkVpsId(row.vpsId)}
                            <span class="muted">|</span>
                            Updated: ${escapeHtml(fmtDate(row.updatedAt))}
                        </div>
                    </div>
                    <div class="score-badge">${valueBadge}</div>
                </div>
                <div class="score-grid">
                    ${
                      flatScore.length
                        ? flatScore
                            .map(
                              (item) => `
                            <div class="score-field">
                                <div class="score-label">${escapeHtml(item.key)}</div>
                                <div class="score-value">${escapeHtml(item.value ?? "-")}</div>
                            </div>
                        `,
                            )
                            .join("")
                        : `<div class="muted">This entry has a score object, but it did not flatten into displayable fields.</div>`
                    }
                </div>
                <div style="margin-top:12px;">
                    <div class="score-label" style="margin-bottom:8px;">Raw Score JSON</div>
                    <pre>${escapeHtml(JSON.stringify(score, null, 2))}</pre>
                </div>
            </div>
        `;
  });

  container.innerHTML = cards.join("");
}

function renderOverview(rows) {
  const title = q("scoreOverviewTitle");
  if (title) title.textContent = `Score Overview (${rows.length})`;

  renderTable(
    "scoreOverviewTable",
    [
      { label: "Table", getter: (row) => fmtTableName(row) },
      { label: "VPS", getter: (row) => linkVpsId(row.vpsId), html: true },
      {
        label: "Score Type",
        getter: (row) => getScorePayload(row)?.score_type || "-",
      },
      {
        label: "Value",
        getter: (row) => fmtNumber(getScorePayload(row)?.value),
      },
      {
        label: "ROM",
        getter: (row) =>
          getScorePayload(row)?.rom ||
          getScorePayload(row)?.resolved_rom ||
          row?.vpsdb?.name ||
          "-",
      },
      { label: "Updated", getter: (row) => fmtDate(row.updatedAt) },
    ],
    rows.slice(0, 12),
  );
}

async function refreshDashboard() {
  const header = document.querySelector("vpinplay-header");
  if (header) header.setRefreshing(true);

  try {
    const userId = q("setupUserId").value.trim();
    const vpsIdFilter = q("vpsIdInput").value.trim();

    setParams(userId, vpsIdFilter);

    if (!vpsIdFilter && !userId) {
      setStatus(
        "Enter a userId, or enter a VPS ID to view scored rows across all users.",
      );
      renderOverview([]);
      renderKeyChips([]);
      renderScoreCards([]);
      q("kpiScoreCount").textContent = "0";
      q("kpiTableCount").textContent = "0";
      q("kpiScoreTypes").textContent = "0";
      q("kpiMaxValue").textContent = "-";
      return;
    }

    const usingCrossUserVpsIdQuery = !userId && !!vpsIdFilter;
    setStatus(
      usingCrossUserVpsIdQuery
        ? `Loading scored rows for ${vpsIdFilter} across all users...`
        : userId && vpsIdFilter
          ? `Loading scored rows for ${userId} filtered to ${vpsIdFilter}...`
          : `Loading scored tables for ${userId}...`,
    );
    const result = usingCrossUserVpsIdQuery
      ? await fetchRowsWithScoreForVpsId(vpsIdFilter)
      : await fetchRowsWithUserScore(userId, vpsIdFilter);

    if (!result.ok) {
      setStatus(`Failed to load scored rows (${result.status || "network"}).`);
      renderOverview([]);
      renderKeyChips([]);
      renderScoreCards([]);
      return;
    }

    const filteredRows = result.rows
      .filter((row) => !!getScorePayload(row))
      .sort((a, b) => {
        const aValue = Number(getScorePayload(a)?.value);
        const bValue = Number(getScorePayload(b)?.value);
        if (
          Number.isFinite(aValue) &&
          Number.isFinite(bValue) &&
          aValue !== bValue
        ) {
          return bValue - aValue;
        }
        return String(b?.updatedAt || "").localeCompare(
          String(a?.updatedAt || ""),
        );
      });

    const summary = summarizeScores(filteredRows);
    q("kpiScoreCount").textContent = String(summary.scoreCount);
    q("kpiTableCount").textContent = String(summary.tableCount);
    q("kpiScoreTypes").textContent = String(summary.scoreTypeCount);
    q("kpiMaxValue").textContent =
      summary.maxValue === null ? "-" : fmtNumber(summary.maxValue);

    renderOverview(filteredRows);
    renderKeyChips(summary.keyCounts);
    renderScoreCards(filteredRows);

    if (usingCrossUserVpsIdQuery) {
      setStatus(
        `Loaded ${filteredRows.length} scored row${filteredRows.length === 1 ? "" : "s"} for ${vpsIdFilter} across all users.`,
      );
    } else {
      setStatus(
        `Loaded ${filteredRows.length} scored table entr${filteredRows.length === 1 ? "y" : "ies"} for ${userId}${vpsIdFilter ? ` filtered to ${vpsIdFilter}` : ""}.`,
      );
    }
  } finally {
    if (header) {
      header.markRefresh();
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await customElements.whenDefined("vpinplay-header");

  const params = getParams();
  if (params.userId) q("setupUserId").value = params.userId;
  if (params.vpsId) q("vpsIdInput").value = params.vpsId;
  refreshDashboard();
});
