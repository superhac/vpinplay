let currentUserId = null;
let currentViewMode = "table";
let currentScorePanelVpsId = "";

const SCORE_USER_PANELS = {
  "9Paf7-CL": "panels/score_user/9Paf7-CL.html",
  SrcagQN8: "panels/score_user/SrcagQN8.html",
  WyxpJ3Wjt3: "panels/score_user/WyxpJ3Wjt3.html",
  "fz-KTflv": "panels/score_user/fz-KTflv.html",
  vZDUDUii: "panels/score_user/vZDUDUii.html",
};

async function loadEmbeddedPanel() {
  const host = q("scoreUserPanelEmbed");
  if (!host) return;
  const select = q("scoreUserPanelSelect");

  const userId =
    currentUserId ||
    new URLSearchParams(window.location.search).get("userid") ||
    "";
  if (!userId) {
    if (select) {
      select.innerHTML = `<option value="">Set userid first</option>`;
      select.disabled = true;
    }
    host.innerHTML = `<div class="muted">Set a userid to load the score panel.</div>`;
    return;
  }

  const vpsId = currentScorePanelVpsId || select?.value || "";
  const baseSrc = SCORE_USER_PANELS[vpsId];
  if (!baseSrc) {
    host.innerHTML = `<div class="muted">Choose a scoreboard to load its panel.</div>`;
    return;
  }

  const src = new URL(baseSrc, window.location.href);
  src.searchParams.set("userid", userId);

  try {
    const response = await fetch(src.toString());
    if (!response.ok) {
      host.innerHTML = `<div class="muted">Failed to load embedded panel (${response.status}).</div>`;
      return;
    }

    const html = await response.text();
    const template = document.createElement("template");
    template.innerHTML = html;

    host.replaceChildren();

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
  } catch (error) {
    host.innerHTML = `<div class="muted">Failed to load embedded panel: ${escapeHtml(error.message || "unknown error")}</div>`;
  }
}

function getRequestedScorePanelVpsId() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("score_vpsid") || "").trim();
}

function setRequestedScorePanelVpsId(vpsId) {
  const url = new URL(window.location.href);
  if (vpsId) {
    url.searchParams.set("score_vpsid", vpsId);
  } else {
    url.searchParams.delete("score_vpsid");
  }
  window.history.replaceState({}, "", url.toString());
}

function handleScorePanelChange(event) {
  const nextVpsId = String(event?.target?.value || "").trim();
  currentScorePanelVpsId = nextVpsId;
  setRequestedScorePanelVpsId(nextVpsId);
  loadEmbeddedPanel();
}

async function fetchAllUserTablesWithScore(userId) {
  const items = [];
  let offset = 0;

  while (true) {
    const res = await api(
      `/api/v1/users/${encodeURIComponent(userId)}/tables/with-score?limit=${encodeURIComponent(API_PAGE_LIMIT)}&offset=${encodeURIComponent(offset)}`,
    );
    if (!res.ok || !Array.isArray(res.data)) break;

    const pageItems = res.data;
    items.push(...pageItems);

    if (pageItems.length < API_PAGE_LIMIT) break;
    offset += pageItems.length;
  }

  return items;
}

function buildScorePanelOptions(rows) {
  const byVpsId = new Map();
  (rows || []).forEach((row) => {
    const vpsId = String(row?.vpsId || "").trim();
    if (!vpsId || !SCORE_USER_PANELS[vpsId] || byVpsId.has(vpsId)) return;
    byVpsId.set(vpsId, {
      vpsId,
      label: String(row?.vpsdb?.name || row?.tableTitle || vpsId).trim() || vpsId,
      src: SCORE_USER_PANELS[vpsId],
    });
  });

  return [...byVpsId.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

function syncScorePanelPicker(options) {
  const select = q("scoreUserPanelSelect");
  const host = q("scoreUserPanelEmbed");
  if (!select || !host) return false;

  if (!Array.isArray(options) || options.length === 0) {
    currentScorePanelVpsId = "";
    select.innerHTML = `<option value="">No matching scoreboards available</option>`;
    select.disabled = true;
    setRequestedScorePanelVpsId("");
    host.innerHTML = `<div class="muted">No supported score_user panel is available for this user's submitted scores yet.</div>`;
    return false;
  }

  const requested = getRequestedScorePanelVpsId();
  const selected =
    options.find((option) => option.vpsId === currentScorePanelVpsId) ||
    options.find((option) => option.vpsId === requested) ||
    options[0];

  currentScorePanelVpsId = selected.vpsId;
  select.disabled = false;
  select.innerHTML = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.vpsId)}"${option.vpsId === selected.vpsId ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");
  setRequestedScorePanelVpsId(selected.vpsId);
  return true;
}

function handleSetupSubmit(event) {
  event.preventDefault();
  applyUserId();
}

function getPreferredViewMode() {
  const saved = localStorage.getItem("vpin-view-mode");
  return saved === "carousel" ? "carousel" : "table";
}

function applyViewMode(mode) {
  currentViewMode = mode;
  const panels = q("panels");
  const btn = q("viewToggleBtn");
  if (mode === "carousel") {
    panels.classList.add("carousel-view");
    btn.textContent = "Table View";
  } else {
    panels.classList.remove("carousel-view");
    btn.textContent = "Carousel View";
  }
}

function initViewMode() {
  applyViewMode(getPreferredViewMode());
}

function toggleViewMode() {
  const next = currentViewMode === "carousel" ? "table" : "carousel";
  localStorage.setItem("vpin-view-mode", next);
  applyViewMode(next);
  refreshDashboard();
}

async function getGlobalAvgRatingMap(rows) {
  const vpsIds = [
    ...new Set((rows || []).map((r) => r?.vpsId).filter(Boolean)),
  ];
  if (vpsIds.length === 0) return {};

  const responses = await Promise.all(
    vpsIds.map((vpsId) =>
      api(`/api/v1/tables/${encodeURIComponent(vpsId)}/rating-summary`),
    ),
  );

  const map = {};
  responses.forEach((res, idx) => {
    const vpsId = vpsIds[idx];
    if (!res.ok || !res.data) {
      map[vpsId] = null;
      return;
    }
    const avg = res.data.avgRating;
    map[vpsId] = avg === null || avg === undefined ? null : Number(avg);
  });
  return map;
}

function fmtUserOverGlobalRating(row, globalAvgRatingMap) {
  const userRating = row?.rating;
  const globalAvg = globalAvgRatingMap?.[row?.vpsId];
  return `${fmtRatingStars(userRating)}<span class="rating-separator">/</span>${fmtRatingStars(globalAvg, { showNumeric: true })}`;
}

function getCardImageUrl(vpsId) {
  if (!vpsId) return "";
  return `https://github.com/superhac/vpinmediadb/raw/refs/heads/main/${encodeURIComponent(vpsId)}/cab.png`;
}

function renderCarousel(elId, rows, options = {}) {
  const el = q(elId);
  if (!rows || rows.length === 0) {
    el.innerHTML = `<div class="muted" style="padding: 20px;">No data</div>`;
    return;
  }

  let html = `<div class="carousel-container">`;
  rows.forEach((row) => {
    const title = options.titleGetter(row);
    const sub = options.subGetter(row);
    const vpsId = row.vpsId;
    const imgUrl = vpsId
      ? getCardImageUrl(vpsId)
      : "https://placehold.co/160x220/111d31/e8f0ff?text=No+VPS+ID";

    html += `
                    <a href="tables.html?vpsid=${encodeURIComponent(vpsId || "")}" class="carousel-card">
                        <div class="card-img-wrap">
                            <img src="${imgUrl}" alt="${escapeHtml(title)}" onerror="this.src='https://placehold.co/160x220/111d31/e8f0ff?text=No+Image'; this.onerror=null;" loading="lazy">
                        </div>
                        <div class="card-info">
                            <div class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                            <div class="card-sub">${options.subHtml ? sub : escapeHtml(sub)}</div>
                        </div>
                    </a>
                `;
  });
  html += `</div>`;
  el.innerHTML = html;
}

async function refreshDashboard() {
  if (!currentUserId) return;

  const btn = document.querySelector("#refreshDashboardBtn");
  if (btn) btn.classList.add("refreshing");

  q("userBadge").textContent = `userid=${currentUserId}`;

  const [
    lastSyncRes,
    countRes,
    runtimeSumRes,
    runtimeWeekRes,
    startCountSumRes,
    startCountWeekRes,
    topRatedRes,
    recentRes,
    topPlaytimeRes,
    mostPlayedRes,
    userNewlyAddedRes,
    latestSubmittedScoresRes,
    scorePanelRows,
  ] = await Promise.all([
    api(`/api/v1/users/${encodeURIComponent(currentUserId)}/last-sync`),
    api(`/api/v1/users/${encodeURIComponent(currentUserId)}/tables/count`),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/runtime-sum`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/runtime-weekly?days=7`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/start-count-sum`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/start-count-weekly?days=7`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/top-rated?limit=5`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/recently-played?limit=5`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/top-play-time?limit=5&offset=0`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/most-played?limit=5`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/newly-added?limit=5`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/scores/latest?limit=5&offset=0`,
    ),
    fetchAllUserTablesWithScore(currentUserId),
  ]);

  const scorePanelOptions = buildScorePanelOptions(scorePanelRows);
  const hasScorePanelSelection = syncScorePanelPicker(scorePanelOptions);
  if (hasScorePanelSelection) {
    await loadEmbeddedPanel();
  }

  const rowsNeedingGlobalRating = [
    ...(topRatedRes.ok ? topRatedRes.data : []),
    ...(recentRes.ok ? recentRes.data : []),
    ...(userNewlyAddedRes.ok ? userNewlyAddedRes.data : []),
  ];
  const globalAvgRatingMap = await getGlobalAvgRatingMap(
    rowsNeedingGlobalRating,
  );

  const totalStarts = startCountSumRes.ok
    ? Number(startCountSumRes.data.startCountTotal || 0)
    : 0;
  const totalRuntime = runtimeSumRes.ok
    ? Number(runtimeSumRes.data.runTimeTotal || 0)
    : 0;
  const runtimeWeek = runtimeWeekRes.ok
    ? Number(runtimeWeekRes.data.runTimePlayed || 0)
    : 0;
  const startsWeek = startCountWeekRes.ok
    ? Number(startCountWeekRes.data.startCountPlayed || 0)
    : 0;

  setKpi(
    "kpiTableCount",
    countRes.ok ? fmtNumber(countRes.data.tableCount) : "-",
  );
  setKpi(
    "kpiLastSync",
    lastSyncRes.ok ? fmtDate(lastSyncRes.data.lastSyncAt) : "-",
  );
  setKpi("kpiStarts", fmtNumber(totalStarts));
  setKpi("kpiRuntime", fmtRuntime(totalRuntime));
  setKpi("kpiRuntimeWeek", fmtRuntime(runtimeWeek));
  setKpi("kpiStartsWeek", fmtNumber(startsWeek));

  renderTable(
    "spotlightTable",
    [
      {
        label: "Table",
        getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
        html: true,
      },
      { label: "Run Time", getter: (r) => fmtRuntime(r.runTime) },
      { label: "Starts", getter: (r) => fmtNumber(r.startCount) },
    ],
    topPlaytimeRes.ok ? topPlaytimeRes.data : [],
  );

  const isCarousel = currentViewMode === "carousel";
  const tableListPanels = [
    {
      id: "topRatedTable",
      container: "topRatedContainer",
      data: topRatedRes.ok ? topRatedRes.data : [],
      title: "Top Rated (User)",
      sub: (r) => fmtUserOverGlobalRating(r, globalAvgRatingMap),
      cols: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        {
          label: "Mine / Avg Rating",
          getter: (r) => fmtUserOverGlobalRating(r, globalAvgRatingMap),
          html: true,
        },
        { label: "Starts", getter: (r) => r.startCount },
      ],
    },
    {
      id: "recentlyPlayedTable",
      container: "recentlyPlayedContainer",
      data: recentRes.ok ? recentRes.data : [],
      title: "Recently Played",
      sub: (r) =>
        `${fmtDate(r.lastRun)} • ${fmtUserOverGlobalRating(r, globalAvgRatingMap)}`,
      cols: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "Last Run", getter: (r) => fmtDate(r.lastRun) },
        {
          label: "Mine / Avg Rating",
          getter: (r) => fmtUserOverGlobalRating(r, globalAvgRatingMap),
          html: true,
        },
      ],
    },
    {
      id: "topPlaytimeTable",
      container: "topPlaytimeContainer",
      data: topPlaytimeRes.ok ? topPlaytimeRes.data : [],
      title: "Top Play Time",
      sub: (r) =>
        `${fmtRuntime(r.runTime)} (${fmtNumber(r.startCount)} starts)`,
      cols: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "Run Time", getter: (r) => fmtRuntime(r.runTime) },
        { label: "Starts", getter: (r) => fmtNumber(r.startCount) },
      ],
    },
    {
      id: "mostPlayedTable",
      container: "mostPlayedContainer",
      data: mostPlayedRes.ok ? mostPlayedRes.data : [],
      title: "Most Played",
      sub: (r) =>
        `${fmtNumber(r.startCount)} starts (Last: ${fmtDate(r.lastRun)})`,
      cols: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "Starts", getter: (r) => fmtNumber(r.startCount) },
        { label: "Last Run", getter: (r) => fmtDate(r.lastRun) },
      ],
    },
    {
      id: "userNewlyAddedTable",
      container: "userNewlyAddedContainer",
      data: userNewlyAddedRes.ok ? userNewlyAddedRes.data : [],
      title: "Newest Added",
      sub: (r) =>
        `Added: ${fmtDate(r.createdAt)} • ${fmtUserOverGlobalRating(r, globalAvgRatingMap)}`,
      cols: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "Added", getter: (r) => fmtDate(r.createdAt) },
        {
          label: "My / Avg Rating",
          getter: (r) => fmtUserOverGlobalRating(r, globalAvgRatingMap),
          html: true,
        },
      ],
    },
    {
      id: "latestSubmittedScoresTable",
      container: "latestSubmittedScoresContainer",
      data:
        latestSubmittedScoresRes.ok &&
        Array.isArray(latestSubmittedScoresRes.data?.items)
          ? latestSubmittedScoresRes.data.items
          : [],
      title: "Latest Submitted Scores",
      sub: (r) => `${r.label || "Score"} • ${fmtDate(r.updatedAt)}`,
      cols: [
        {
          label: "Table",
          getter: (r) =>
            linkTableName(
              r.tableTitle || r.vpsdb?.name || "Unknown Table",
              r.vpsId,
            ),
          html: true,
        },
        { label: "Label", getter: (r) => r.label || "-" },
        { label: "Score", getter: (r) => fmtLatestScoreValue(r.score) },
        { label: "Updated", getter: (r) => fmtDate(r.updatedAt) },
      ],
    },
  ];

  tableListPanels.forEach((panel) => {
    const container = q(panel.container);
    if (isCarousel) {
      renderCarousel(panel.container, panel.data, {
        titleGetter: (r) => fmtTableName(r),
        subGetter: panel.sub,
        subHtml: true,
      });
    } else {
      container.innerHTML = `<table id="${panel.id}"></table>`;
      renderTable(panel.id, panel.cols, panel.data);
    }
  });

  const header = document.querySelector("vpinplay-header");
  if (header) {
    header.markRefresh();
  }

  if (btn) {
    setTimeout(() => btn.classList.remove("refreshing"), 600);
  }
}

function applyUserId() {
  const entered = q("setupUserId").value.trim();
  if (!entered) return;
  const url = new URL(window.location.href);
  url.searchParams.set("userid", entered);
  window.location.href = url.toString();
}

function init() {
  initTheme();
  initViewMode();
  const params = new URLSearchParams(window.location.search);
  const userId = params.get("userid");
  currentScorePanelVpsId = getRequestedScorePanelVpsId();

  if (!userId) {
    q("dashboard").classList.add("hidden");
    loadEmbeddedPanel();
    return;
  }

  currentUserId = userId;
  q("dashboard").classList.remove("hidden");
  q("userBadge").textContent = `userid=${userId}`;
  loadEmbeddedPanel();
  refreshDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});
