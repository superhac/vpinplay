async function refreshDashboard() {
  const btn = document.querySelector("#refreshDashboardBtn");
  if (btn) btn.classList.add("refreshing");
  const limit = parseDashboardLimit();
  q("limitInput").value = String(limit);

  const [
    lastSyncRes,
    vpsdbStatusRes,
    weeklyActivityRes,
    userCountRes,
    tableCountRes,
    topPlayerPlaysRows,
    topPlayerRuntimeRows,
    topRatedRows,
    topPlayTimeRows,
    newlyAddedRows,
    topVariantsRows,
    latestSubmittedScoresRows,
  ] = await Promise.all([
    api("/api/v1/sync/last"),
    api("/api/v1/vpsdb/status"),
    api("/api/v1/tables/activity-weekly?days=7"),
    api("/api/v1/users/count"),
    api("/api/v1/tables/count"),
    loadTopPlayerActivity("startCountPlayed"),
    loadTopPlayerActivity("runTimePlayed"),
    fetchPaginatedRows("/api/v1/tables/top-rated", limit),
    fetchPaginatedRows("/api/v1/tables/top-play-time", limit),
    fetchPaginatedRows("/api/v1/tables/newly-added", limit),
    fetchPaginatedRows("/api/v1/tables/top-variants", limit),
    fetchLatestSubmittedScores(limit),
  ]);

  q("kpiLastSync").textContent = lastSyncRes.ok
    ? fmtDate(lastSyncRes.data.lastSyncAt)
    : "-";
  q("kpiLastSyncUser").textContent =
    `Last sync by user: ${lastSyncRes.ok ? lastSyncRes.data.userId || "-" : "-"}`;

  q("kpiTotalTables").textContent = tableCountRes.ok
    ? fmtNumber(tableCountRes.data.totalTableRows)
    : "-";
  q("kpiUserCount").textContent = userCountRes.ok
    ? fmtNumber(userCountRes.data.userCount)
    : "-";

  if (vpsdbStatusRes.ok) {
    const statusText = String(vpsdbStatusRes.data.status || "unknown");
    setKpi(
      "kpiVpsdbStatus",
      statusText,
      statusText === "ok" ? "status-ok" : "status-bad",
    );
    q("kpiVpsdbMeta").textContent =
      `records: ${vpsdbStatusRes.data.recordCount ?? "-"} | last: ${fmtDate(vpsdbStatusRes.data.lastSyncAt)}`;
  } else {
    setKpi("kpiVpsdbStatus", "error", "status-bad");
    q("kpiVpsdbMeta").textContent = "Unable to fetch VPSDB status";
  }

  if (weeklyActivityRes.ok) {
    q("kpiRuntimeWeek").textContent =
      `${fmtNumber(weeklyActivityRes.data.runTimePlayed)} min`;
    q("kpiStartsWeek").textContent = fmtNumber(
      weeklyActivityRes.data.startCountPlayed,
    );
  } else {
    q("kpiRuntimeWeek").textContent = "-";
    q("kpiStartsWeek").textContent = "-";
  }

  renderTable(
    "topRatedTable",
    [
      {
        label: "Table",
        getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
        html: true,
      },
      {
        label: "Avg Rating",
        getter: (r) => fmtRatingStars(r.avgRating, { showNumeric: true }),
        html: true,
      },
      { label: "Rating Count", getter: (r) => r.ratingCount },
      { label: "VPS ID", getter: (r) => linkVpsId(r.vpsId), html: true },
    ],
    topRatedRows,
  );

  renderTable(
    "topPlayTimeGlobalTable",
    [
      {
        label: "Table",
        getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
        html: true,
      },
      {
        label: "Run Time (Total)",
        getter: (r) => `${Number(r.runTimeTotal || 0)} min`,
      },
      { label: "Starts (Total)", getter: (r) => r.startCountTotal },
      { label: "Players", getter: (r) => r.playerCount },
      { label: "VPS ID", getter: (r) => linkVpsId(r.vpsId), html: true },
    ],
    topPlayTimeRows,
  );

  renderTable(
    "newlyAddedTable",
    [
      {
        label: "Table",
        getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
        html: true,
      },
      { label: "First Seen", getter: (r) => fmtDate(r.firstSeenAt) },
      { label: "Variations", getter: (r) => r.variationCount },
      { label: "VPS ID", getter: (r) => linkVpsId(r.vpsId), html: true },
    ],
    newlyAddedRows,
  );

  renderTable(
    "topVariantsTable",
    [
      {
        label: "Table",
        getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
        html: true,
      },
      { label: "Variants", getter: (r) => r.variationCount },
      { label: "VPS ID", getter: (r) => linkVpsId(r.vpsId), html: true },
    ],
    topVariantsRows,
  );

  q("topPlayerPlaysTitle").textContent =
    `Top Player Plays (${TOP_PLAYER_DAYS}d)`;
  q("topPlayerPlaytimeTitle").textContent =
    `Top Player Playtime (${TOP_PLAYER_DAYS}d)`;

  renderTable(
    "topPlayerPlaysTable",
    [
      { label: "User", getter: (r) => linkUserId(r.userId), html: true },
      { label: "Plays", getter: (r) => fmtNumber(r.startCountPlayed) },
    ],
    topPlayerPlaysRows,
  );

  renderTable(
    "topPlayerPlaytimeTable",
    [
      { label: "User", getter: (r) => linkUserId(r.userId), html: true },
      { label: "Run Time", getter: (r) => `${fmtNumber(r.runTimePlayed)} min` },
    ],
    topPlayerRuntimeRows,
  );

  renderTable(
    "latestSubmittedScoresTable",
    [
      {
        label: "Table",
        getter: (r) =>
          linkTableName(
            r.tableTitle || r.vpsdb?.name || "Unknown Table",
            r.vpsId,
          ),
        html: true,
      },
      { label: "User", getter: (r) => linkUserId(r.userId), html: true },
      { label: "Label", getter: (r) => r.label || "-" },
      { label: "Score", getter: (r) => fmtLatestScoreValue(r.score) },
      { label: "Updated", getter: (r) => fmtDate(r.updatedAt) },
    ],
    latestSubmittedScoresRows,
  );

  if (ENABLE_ALL_TABLES_PANEL) {
    await loadAllTablesPage();
  }

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
  if (!ENABLE_ALL_TABLES_PANEL) {
    const allTablesPanel = q("allTablesPanel");
    if (allTablesPanel) allTablesPanel.style.display = "none";
  }
  refreshDashboard();
});

async function fetchLatestSubmittedScores(limit) {
  const safeLimit = Math.max(1, Math.min(API_PAGE_LIMIT, Number(limit || 0) || 5));
  const res = await api(
    `/api/v1/users/scores/latest?limit=${encodeURIComponent(safeLimit)}&offset=0`,
  );
  return res.ok && Array.isArray(res.data?.items) ? res.data.items : [];
}
