class LatestSubmittedScoresPanel extends HTMLElement {
  constructor() {
    super();
    this.limit = 10;
  }

  static get observedAttributes() {
    return ["limit", "title"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    if (name === "limit") {
      this.limit = this.parseLimit(newValue);
    }

    if (this.isConnected) {
      this.render();
      this.load();
    }
  }

  connectedCallback() {
    this.limit = this.parseLimit(this.getAttribute("limit"));
    this.render();
    this.load();
  }

  parseLimit(value) {
    const parsed = Number(value || 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.max(1, Math.min(API_PAGE_LIMIT, Math.floor(parsed)));
  }

  getTitle() {
    return this.getAttribute("title") || "Latest Submitted Scores";
  }

  render() {
    this.innerHTML = `
      <div class="panel-heading">
        <h3>${escapeHtml(this.getTitle())}</h3>
      </div>
      <table></table>
    `;
  }

  async load() {
    const table = this.querySelector("table");
    if (!table) return;

    table.innerHTML = `<tr><td class="muted">Loading...</td></tr>`;

    const res = await api(
      `/api/v1/users/scores/latest?limit=${encodeURIComponent(this.limit)}&offset=0`,
    );

    const rows = res.ok && Array.isArray(res.data?.items) ? res.data.items : [];

    if (!rows.length) {
      table.innerHTML = `<tr><td class="muted">No data</td></tr>`;
      return;
    }

    let html = `
      <thead>
        <tr>
          <th>Table</th>
          <th>User</th>
          <th>Label</th>
          <th>Score</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
    `;

    rows.forEach((row) => {
      html += `
        <tr>
          <td>${linkTableNameWithVps(
            row.tableTitle || row.vpsdb?.name || "Unknown Table",
            row.vpsId,
          )}</td>
          <td>${linkUserId(row.userId)}</td>
          <td>${escapeHtml(row.label || "-")}</td>
          <td>${escapeHtml(fmtLatestScoreValue(row.score))}</td>
          <td>${escapeHtml(fmtDate(row.updatedAt))}</td>
        </tr>
      `;
    });

    html += "</tbody>";
    table.innerHTML = html;
  }
}

customElements.define(
  "latest-submitted-scores-panel",
  LatestSubmittedScoresPanel,
);
