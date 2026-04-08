const EXPANDED_DASHBOARD_PANEL_LIMIT = 100;
let expandedDashboardPanelId = null;
const dashboardPanelOffsets = {};

function getDashboardPanelOffset(panelId) {
  return dashboardPanelOffsets[panelId] || 0;
}

function setDashboardPanelOffset(panelId, offset) {
  dashboardPanelOffsets[panelId] = Math.max(0, Number(offset || 0));
}

function getDashboardPanelConfigs() {
  return {
    topRatedPanel: {
      tableId: "topRatedTable",
      pagerId: "topRatedPager",
      fetchPage: (limit, offset) =>
        fetchDashboardListPage("/api/v1/tables/top-rated", limit, offset),
      columns: [
        {
          label: "Table",
          getter: (r) => linkTableNameWithVps(fmtTableName(r), r.vpsId),
          html: true,
        },
        {
          label: "Avg Rating",
          getter: (r) => fmtRatingStars(r.avgRating, { showNumeric: true }),
          html: true,
        },
        { label: "Rating Count", getter: (r) => r.ratingCount },
      ],
    },
    topPlayTimePanel: {
      tableId: "topPlayTimeGlobalTable",
      pagerId: "topPlayTimePager",
      fetchPage: (limit, offset) =>
        fetchDashboardListPage("/api/v1/tables/top-play-time", limit, offset),
      columns: [
        {
          label: "Table",
          getter: (r) => linkTableNameWithVps(fmtTableName(r), r.vpsId),
          html: true,
        },
        {
          label: "Run Time (Total)",
          getter: (r) => fmtWeeklyRuntime(r.runTimeTotal),
        },
        { label: "Starts (Total)", getter: (r) => r.startCountTotal },
        { label: "Players", getter: (r) => r.playerCount },
      ],
    },
    topWeeklyPlayTimePanel: {
      tableId: "topWeeklyPlayTimeTable",
      pagerId: "topWeeklyPlayTimePager",
      fetchPage: (limit, offset) =>
        fetchDashboardObjectPage(
          "/api/v1/tables/top-play-time-weekly?days=7",
          limit,
          offset,
        ),
      columns: [
        {
          label: "Table",
          getter: (r) => linkTableNameWithVps(fmtTableName(r), r.vpsId),
          html: true,
        },
        {
          label: "Run Time (7d)",
          getter: (r) => fmtWeeklyRuntime(r.runTimePlayed),
        },
        { label: "Plays (7d)", getter: (r) => fmtNumber(r.startCountPlayed) },
        { label: "Players", getter: (r) => fmtNumber(r.playerCount) },
      ],
    },
    latestSubmittedRatingsPanel: {
      tableId: "latestSubmittedRatingsTable",
      pagerId: "latestSubmittedRatingsPager",
      fetchPage: (limit, offset) =>
        fetchDashboardListPage(
          "/api/v1/tables/latest-submitted-ratings",
          limit,
          offset,
        ),
      columns: [
        {
          label: "Table",
          getter: (r) => linkTableNameWithVps(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "User", getter: (r) => linkUserId(r.userId), html: true },
        {
          label: "Rating",
          getter: (r) => fmtRatingStars(r.rating, { showNumeric: true }),
          html: true,
        },
        { label: "Submitted", getter: (r) => fmtDate(r.updatedAt) },
      ],
    },
    newlyAddedPanel: {
      tableId: "newlyAddedTable",
      pagerId: "newlyAddedPager",
      fetchPage: (limit, offset) =>
        fetchDashboardListPage("/api/v1/tables/newly-added", limit, offset),
      columns: [
        {
          label: "Table",
          getter: (r) => linkTableNameWithVps(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "First Seen", getter: (r) => fmtDate(r.firstSeenAt) },
        { label: "Variations", getter: (r) => r.variationCount },
      ],
    },
    topVariantsPanel: {
      tableId: "topVariantsTable",
      pagerId: "topVariantsPager",
      fetchPage: (limit, offset) =>
        fetchDashboardListPage("/api/v1/tables/top-variants", limit, offset),
      columns: [
        {
          label: "Table",
          getter: (r) => linkTableNameWithVps(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "Variants", getter: (r) => r.variationCount },
      ],
    },
    topPlayerPlaysPanel: {
      tableId: "topPlayerPlaysTable",
      pagerId: "topPlayerPlaysPager",
      fetchPage: (limit, offset) =>
        loadTopPlayerActivityPage(
          "startCountPlayed",
          TOP_PLAYER_DAYS,
          limit,
          offset,
        ),
      beforeRender: () => {
        q("topPlayerPlaysTitle").textContent =
          `Top Player Plays (${TOP_PLAYER_DAYS}d)`;
      },
      columns: [
        { label: "User", getter: (r) => linkUserId(r.userId), html: true },
        { label: "Plays", getter: (r) => fmtNumber(r.startCountPlayed) },
      ],
    },
    topPlayerPlaytimePanel: {
      tableId: "topPlayerPlaytimeTable",
      pagerId: "topPlayerPlaytimePager",
      fetchPage: (limit, offset) =>
        loadTopPlayerActivityPage(
          "runTimePlayed",
          TOP_PLAYER_DAYS,
          limit,
          offset,
        ),
      beforeRender: () => {
        q("topPlayerPlaytimeTitle").textContent =
          `Top Player Playtime (${TOP_PLAYER_DAYS}d)`;
      },
      columns: [
        { label: "User", getter: (r) => linkUserId(r.userId), html: true },
        { label: "Run Time", getter: (r) => fmtWeeklyRuntime(r.runTimePlayed) },
      ],
    },
    latestSubmittedScoresPanel: {
      tableId: "latestSubmittedScoresTable",
      pagerId: "latestSubmittedScoresPager",
      fetchPage: (limit, offset) =>
        fetchLatestSubmittedScoresPage(limit, offset),
      columns: [
        {
          label: "Table",
          getter: (r) =>
            linkTableNameWithVps(
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
    },
  };
}

function syncExpandedDashboardPanelState() {
  const panels = document.querySelectorAll(".dashboard-panel");
  const grid = q("dashboardPanels");
  const isExpanded = Boolean(expandedDashboardPanelId);

  if (grid) {
    grid.classList.toggle("panel-expanded", isExpanded);
  }

  panels.forEach((panel) => {
    const button = panel.querySelector(".panel-expand-btn");
    const expanded = panel.id === expandedDashboardPanelId;
    const config = getDashboardPanelConfigs()[panel.id];
    const pager = config ? q(config.pagerId) : null;

    panel.classList.toggle("is-expanded", expanded);
    if (pager) pager.hidden = !expanded;

    if (button) {
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      button.setAttribute(
        "aria-label",
        `${expanded ? "Collapse" : "Expand"} ${panel.querySelector("h3")?.textContent || "panel"}`,
      );
    }
  });
}

function renderDashboardPanelPager(panelId, pagination) {
  const config = getDashboardPanelConfigs()[panelId];
  const pager = config ? q(config.pagerId) : null;
  if (!pager) return;

  if (!expandedDashboardPanelId || expandedDashboardPanelId !== panelId) {
    pager.hidden = true;
    pager.innerHTML = "";
    return;
  }

  const limit = Number(pagination?.limit || EXPANDED_DASHBOARD_PANEL_LIMIT);
  const offset = Number(pagination?.offset || 0);
  const returned = Number(pagination?.returned || 0);
  const hasPrev = Boolean(pagination?.hasPrev);
  const hasNext = Boolean(pagination?.hasNext);
  const pageNumber = Math.floor(offset / limit) + 1;
  const start = returned > 0 ? offset + 1 : 0;
  const end = offset + returned;
  const summary =
    pagination?.total !== undefined && pagination?.total !== null
      ? `Page ${pageNumber} (${start}-${end} of ${pagination.total})`
      : `Page ${pageNumber} (${start}-${end})`;

  pager.hidden = false;
  pager.innerHTML = `
    <button
      class="btn"
      type="button"
      onclick="changeDashboardPanelPage('${panelId}', -1)"
      ${hasPrev ? "" : "disabled"}
    >
      Prev
    </button>
    <button
      class="btn"
      type="button"
      onclick="changeDashboardPanelPage('${panelId}', 1)"
      ${hasNext ? "" : "disabled"}
    >
      Next
    </button>
    <span class="panel-pager-info">${escapeHtml(summary)}</span>
    <span class="panel-pager-info">${escapeHtml(`${limit} per page`)}</span>
  `;
}

async function renderDashboardPanels(defaultLimit) {
  const configs = getDashboardPanelConfigs();
  const entries = Object.entries(configs);

  await Promise.all(
    entries.map(async ([panelId, config]) => {
      const isExpanded = expandedDashboardPanelId === panelId;
      const limit = isExpanded ? EXPANDED_DASHBOARD_PANEL_LIMIT : defaultLimit;
      const offset = isExpanded ? getDashboardPanelOffset(panelId) : 0;
      const page = await config.fetchPage(limit, offset);
      const rows = Array.isArray(page?.items) ? page.items : [];

      if (typeof config.beforeRender === "function") {
        config.beforeRender();
      }

      renderTable(config.tableId, config.columns, rows);
      renderDashboardPanelPager(panelId, {
        limit,
        offset,
        returned: rows.length,
        ...page.pagination,
      });
    }),
  );
}

async function refreshDashboard() {
  const header = document.querySelector("vpinplay-header");
  if (header) header.setRefreshing(true);

  try {
    const limit = parseDashboardLimit();
    const limitInput = q("limitInput");
    if (limitInput) {
      limitInput.value = String(limit);
    }

    const [weeklyActivityRes, submittedScoresSummaryRes] = await Promise.all([
      api("/api/v1/tables/activity-weekly?days=7"),
      api("/api/v1/users/scores/summary?days=7"),
    ]);

    if (weeklyActivityRes.ok) {
      q("kpiWeeklyActivity").textContent = `${fmtWeeklyRuntime(
        weeklyActivityRes.data.runTimePlayed,
      )} / ${fmtNumber(weeklyActivityRes.data.startCountPlayed)}`;
    } else {
      q("kpiWeeklyActivity").textContent = "-";
    }

    if (submittedScoresSummaryRes.ok) {
      q("kpiSubmittedScores").textContent = `${fmtNumber(
        submittedScoresSummaryRes.data.totalSubmittedScores,
      )} / ${fmtNumber(submittedScoresSummaryRes.data.submittedScoresInWindow)}`;
      q("kpiSubmittedScoresSub").textContent =
        `Total / last ${fmtNumber(submittedScoresSummaryRes.data.windowDays)} days`;
    } else {
      q("kpiSubmittedScores").textContent = "-";
      q("kpiSubmittedScoresSub").textContent = "Total / last 7 days";
    }

    await renderDashboardPanels(limit);

    if (ENABLE_ALL_TABLES_PANEL) {
      await loadAllTablesPage();
    }
  } finally {
    if (header) {
      header.markRefresh();
    }
  }
}

async function toggleDashboardPanel(panelId) {
  if (expandedDashboardPanelId === panelId) {
    expandedDashboardPanelId = null;
  } else {
    expandedDashboardPanelId = panelId;
    setDashboardPanelOffset(panelId, 0);
  }
  syncExpandedDashboardPanelState();
  await refreshDashboard();
}

async function changeDashboardPanelPage(panelId, direction) {
  if (expandedDashboardPanelId !== panelId) return;
  const nextOffset =
    getDashboardPanelOffset(panelId) +
    direction * EXPANDED_DASHBOARD_PANEL_LIMIT;
  setDashboardPanelOffset(panelId, nextOffset);
  await refreshDashboard();
  q(panelId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.addEventListener("DOMContentLoaded", async () => {
  await customElements.whenDefined("vpinplay-header");

  if (!ENABLE_ALL_TABLES_PANEL) {
    const allTablesPanel = q("allTablesPanel");
    if (allTablesPanel) allTablesPanel.style.display = "none";
  }

  syncExpandedDashboardPanelState();
  refreshDashboard();
});

async function fetchLatestSubmittedScores(limit) {
  const page = await fetchLatestSubmittedScoresPage(limit, 0);
  return page.items;
}

async function fetchDashboardListPage(basePath, limit, offset = 0) {
  const safeLimit = Math.max(
    1,
    Math.min(API_PAGE_LIMIT, Number(limit || 0) || 5),
  );
  const safeOffset = Math.max(0, Number(offset || 0));
  const joiner = basePath.includes("?") ? "&" : "?";
  const res = await api(
    `${basePath}${joiner}limit=${encodeURIComponent(safeLimit)}&offset=${encodeURIComponent(safeOffset)}`,
  );
  const items = res.ok && Array.isArray(res.data) ? res.data : [];
  return {
    items,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      returned: items.length,
      hasPrev: safeOffset > 0,
      hasNext: items.length === safeLimit,
    },
  };
}

async function loadTopPlayerActivityPage(metric, days, limit, offset = 0) {
  const safeLimit = Math.max(
    1,
    Math.min(API_PAGE_LIMIT, Number(limit || TOP_PLAYER_LIMIT)),
  );
  const safeOffset = Math.max(0, Number(offset || 0));
  const res = await api(
    `/api/v1/users/top-activity?metric=${encodeURIComponent(metric)}&days=${encodeURIComponent(days)}&limit=${encodeURIComponent(safeLimit)}&offset=${encodeURIComponent(safeOffset)}`,
  );
  const items = res.ok && Array.isArray(res.data?.items) ? res.data.items : [];
  return {
    items,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      returned: items.length,
      ...(res.ok ? res.data?.pagination || {} : {}),
    },
  };
}

async function fetchDashboardObjectPage(basePath, limit, offset = 0) {
  const safeLimit = Math.max(
    1,
    Math.min(API_PAGE_LIMIT, Number(limit || 0) || 5),
  );
  const safeOffset = Math.max(0, Number(offset || 0));
  const joiner = basePath.includes("?") ? "&" : "?";
  const res = await api(
    `${basePath}${joiner}limit=${encodeURIComponent(safeLimit)}&offset=${encodeURIComponent(safeOffset)}`,
  );
  return {
    items: res.ok && Array.isArray(res.data?.items) ? res.data.items : [],
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      ...(res.ok ? res.data?.pagination || {} : {}),
    },
  };
}

async function fetchLatestSubmittedScoresPage(limit, offset = 0) {
  const safeLimit = Math.max(
    1,
    Math.min(API_PAGE_LIMIT, Number(limit || 0) || 5),
  );
  const safeOffset = Math.max(0, Number(offset || 0));
  const res = await api(
    `/api/v1/users/scores/latest?limit=${encodeURIComponent(safeLimit)}&offset=${encodeURIComponent(safeOffset)}`,
  );
  return {
    items: res.ok && Array.isArray(res.data?.items) ? res.data.items : [],
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      ...(res.ok ? res.data?.pagination || {} : {}),
    },
  };
}
