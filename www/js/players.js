let currentUserId = null;

async function refreshDashboard() {
  const header = document.querySelector("vpinplay-header");
  if (header) header.setRefreshing(true);

  try {
    if (!currentUserId) return;

    const [
      lastSyncRes,
      countRes,
      runtimeSumRes,
      runtimeWeekRes,
      startCountSumRes,
      startCountWeekRes,
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
    ]);

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
    setKpi(
      "kpiTotalActivity",
      `${fmtWeeklyRuntime(totalRuntime)} / ${fmtNumber(totalStarts)}`,
    );
    setKpi(
      "kpiWeeklyActivity",
      `${fmtWeeklyRuntime(runtimeWeek)} / ${fmtNumber(startsWeek)}`,
    );
  } finally {
    if (header) {
      header.markRefresh();
    }
  }
}

async function init() {
  await customElements.whenDefined("vpinplay-header");
  const params = new URLSearchParams(window.location.search);
  const userId = params.get("userid");

  currentUserId = userId;

  if (currentUserId) {
    dashboard.style.display = "";
    const carouselsContainer = document.getElementById("carouselsContainer");
    if (carouselsContainer) {
      carouselsContainer.style.display = "flex";
    }
    const userBadge = document.getElementById("userBadge");
    if (userBadge) {
      userBadge.textContent = currentUserId;
    }
    refreshDashboard();
  } else {
    dashboard.style.display = "none";
    const carouselsContainer = document.getElementById("carouselsContainer");
    if (carouselsContainer) {
      carouselsContainer.style.display = "none";
    }
    const userBadge = document.getElementById("userBadge");
    if (userBadge) {
      userBadge.textContent = "";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});
