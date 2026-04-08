async function refreshDashboard() {
  const header = document.querySelector("vpinplay-header");
  if (header) header.setRefreshing(true);

  try {
    const [lastSyncRes, vpsdbStatusRes, userCountRes, tableCountRes] =
      await Promise.all([
        api("/api/v1/sync/last"),
        api("/api/v1/vpsdb/status"),
        api("/api/v1/users/count"),
        api("/api/v1/tables/count"),
      ]);

    q("kpiLastSync").textContent = lastSyncRes.ok
      ? fmtDate(lastSyncRes.data.lastSyncAt)
      : "-";
    q("kpiLastSyncUser").textContent =
      `Last sync by user: ${lastSyncRes.ok ? lastSyncRes.data.userId || "-" : "-"}`;

    q("kpiUserCount").textContent = userCountRes.ok
      ? fmtNumber(userCountRes.data.userCount)
      : "-";

    q("kpiTotalTables").textContent = tableCountRes.ok
      ? `${fmtNumber(tableCountRes.data.uniqueVpsIdCount)} / ${fmtNumber(tableCountRes.data.totalTableRows)}`
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
  } finally {
    if (header) {
      header.markRefresh();
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await customElements.whenDefined("vpinplay-header");
  refreshDashboard();
});
