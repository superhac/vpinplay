class TableDetailsPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.vpsId = null;
    this.apiBase = null;
  }

  static get observedAttributes() {
    return ["vps-id", "api-base"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      if (name === "vps-id") {
        this.vpsId = newValue;
      } else if (name === "api-base") {
        this.apiBase = newValue.replace(/\/$/, "");
      }
      if (this.vpsId) this.loadPanel();
    }
  }

  connectedCallback() {
    this.render();
    const urlParams = new URLSearchParams(window.location.search);
    this.vpsId = this.getAttribute("vps-id") || urlParams.get("vpsid");
    this.apiBase = (
      this.getAttribute("api-base") || "https://api.vpinplay.com:8888"
    ).replace(/\/$/, "");
    if (this.vpsId) this.loadPanel();
  }

  render() {
    this.shadowRoot.innerHTML = `
    <link rel="stylesheet" href="css/base.css">
    <style>
      :host {
        display: block;
        width: 100%;
        color: var(--ink);
      }

      :host, :host * {
        box-sizing: border-box;
      }

      .table-focus-panel {
        display: grid;
        gap: 16px;
      }

      .table-focus-header {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        grid-template-rows: auto auto;
        grid-template-areas:
          "art title title title"
          "art copy total week";
        gap: 16px;
        align-items: stretch;
        width: 100%;
      }

      .table-focus-art {
        grid-area: art;
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--bg-secondary);
        align-self: stretch;
      }

      .table-focus-copy {
        grid-area: copy;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        justify-content: start;
        border-radius: 12px;
        background: var(--surface-2);
        padding: 14px 16px;
        border: 1px solid var(--line);
      }

      .table-focus-title {
        grid-area: title;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin: 0;
        font-size: clamp(2rem, 3.2vw, 3rem);
        line-height: 1.02;
        letter-spacing: 0.03em;
        color: inherit;
        font-family: var(--font-display, 'Orbitron', sans-serif);
        font-weight: 900;
      }

      .table-focus-vps-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        line-height: 0;
      }

      .table-focus-vps-logo {
        width: 2.4rem;
        height: 2.4rem;
        object-fit: contain;
        display: block;
      }

      .table-focus-rating-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 14px;
      }

      .table-focus-label,
      .table-focus-stat-sub {
        color: var(--ink-muted);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-size: 0.78rem;
        font-weight: 800;
      }

      .table-focus-rating {
        display: inline-flex;
        align-items: center;
        min-height: 1.6rem;
        font-size: 1.05rem;
      }

      .table-focus-subhead {
        font-size: 1.15rem;
        font-weight: 700;
      }

      .table-focus-meta {
        color: var(--ink-muted);
        font-size: 0.95rem;
        font-weight: 600;
      }

      .table-focus-stat-total {
        grid-area: total;
      }

      .table-focus-stat-week {
        grid-area: week;
      }

      .table-focus-stat-card {
        border-radius: 12px;
        background: var(--surface-2);
        padding: 14px 16px;
        border: 1px solid var(--line);
        display: flex;
        flex-direction: column;
        justify-content: start;
      }

      .table-focus-stat-value {
        font-size: clamp(2rem, 3vw, 2.35rem);
        line-height: 1;
        margin: 8px 0 10px;
        font-weight: 900;
        font-family: var(--font-display, 'Orbitron', sans-serif);
      }

      .rating-stars {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }

      .rating-star-cell {
        position: relative;
        display: inline-block;
        font-size: 1.2rem;
        line-height: 1;
      }

      .rating-star.empty {
        color: rgba(255, 239, 188, 0.15);
      }

      .rating-star.fill {
        position: absolute;
        top: 0;
        left: 0;
        overflow: hidden;
        color: var(--neon-yellow);
        text-shadow: var(--glow-yellow);
      }

      .rating-value {
        color: var(--ink-muted);
        font-size: 0.9rem;
        margin-left: 4px;
      }

      .status {
        margin-bottom: 14px;
        border-radius: 10px;
        padding: 10px 12px;
        background: rgba(0, 217, 255, 0.08);
        border: 1px solid rgba(0, 217, 255, 0.18);
        color: var(--neon-cyan);
        font-size: 0.9rem;
        font-weight: 700;
        box-shadow: var(--glow-cyan);
      }

      .status.error {
        color: var(--bad);
        border-color: rgba(255, 10, 120, 0.24);
        background: rgba(255, 10, 120, 0.12);
      }

      .muted {
        color: var(--ink-muted);
        font-style: italic;
      }

      @media (max-width: 900px) {
        .table-focus-header {
          grid-template-columns: 1fr;
          grid-template-rows: none;
          grid-template-areas:
            "art"
            "title"
            "copy"
            "total"
            "week";
        }

        .table-focus-art {
          width: 100%;
          height: auto;
          max-width: 420px;
          justify-self: start;
        }

        .table-focus-title,
        .table-focus-copy,
        .table-focus-stat-total,
        .table-focus-stat-week {
          align-self: auto;
        }
      }

      @media (max-width: 640px) {
        .table-focus-title {
          font-size: 1.7rem;
        }

        .table-focus-meta {
          font-size: 0.75rem;
        }
      }
    </style>
    <div id="status" class="status" hidden></div>
    <div id="content"></div>
  `;
  }

  q(id) {
    return this.shadowRoot.getElementById(id);
  }

  setStatus(message, tone = "info") {
    const el = this.q("status");
    if (!el) return;
    el.hidden = !message;
    el.textContent = message;
    el.className = `status ${tone}`;
  }

  clearStatus() {
    this.setStatus("");
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  fmtNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  fmtDate(value) {
    if (!value) return "-";
    const raw = String(value).trim();
    const hasTimeZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
    const normalized = !hasTimeZone && raw.includes("T") ? `${raw}Z` : raw;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  }

  fmtWeeklyRuntime(minutes) {
    const n = Number(minutes || 0);
    if (n <= 60) return `${n} min`;
    const hours = n / 60;
    const roundedHours = Number.isInteger(hours)
      ? String(hours)
      : hours.toFixed(1).replace(/\.0$/, "");
    return `${roundedHours} hr`;
  }

  fmtRatingStars(value, options = {}) {
    if (value === null || value === undefined || value === "") return "-";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "-";
    const clamped = Math.max(0, Math.min(5, numeric));
    const roundedToHalf = Math.round(clamped * 2) / 2;
    const fullStars = Math.floor(roundedToHalf);
    const hasHalf = roundedToHalf - fullStars >= 0.5;
    let stars = "";
    for (let i = 0; i < 5; i += 1) {
      const fillPercent =
        i < fullStars ? 100 : i === fullStars && hasHalf ? 50 : 0;
      stars += `<span class="rating-star-cell" aria-hidden="true"><span class="rating-star empty">★</span><span class="rating-star fill" style="width:${fillPercent}%">★</span></span>`;
    }
    const numericText = options.showNumeric
      ? ` <span class="rating-value">(${this.escapeHtml(clamped.toFixed(2))})</span>`
      : "";
    return `<span class="rating-stars" title="${this.escapeHtml(clamped.toFixed(2))} / 5" aria-label="${this.escapeHtml(clamped.toFixed(2))} out of 5 stars">${stars}</span>${numericText}`;
  }

  getTableArtUrl(vpsId) {
    if (!vpsId) return "";
    return `https://raw.githubusercontent.com/superhac/vpinmediadb/refs/heads/main/bg_thumbs/${encodeURIComponent(vpsId)}.png`;
  }

  async api(path) {
    try {
      const response = await fetch(`${this.apiBase}${path}`);
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 0, data: { error: error.message } };
    }
  }

  async loadPanel() {
    if (!this.vpsId) {
      this.q("content").innerHTML =
        `<div class="muted">Enter a VPS ID to see table details.</div>`;
      return;
    }

    this.setStatus(`Loading details for ${this.vpsId}...`);

    const [vpsdbRes, ratingSummaryRes, activitySummaryRes, activityWeeklyRes] =
      await Promise.all([
        this.api(`/api/v1/vpsdb/${encodeURIComponent(this.vpsId)}`),
        this.api(
          `/api/v1/tables/${encodeURIComponent(this.vpsId)}/rating-summary`,
        ),
        this.api(
          `/api/v1/tables/${encodeURIComponent(this.vpsId)}/activity-summary`,
        ),
        this.api(
          `/api/v1/tables/${encodeURIComponent(this.vpsId)}/activity-weekly?days=7`,
        ),
      ]);

    if (!vpsdbRes.ok || !vpsdbRes.data) {
      this.setStatus(`No VPSDB record found for ${this.vpsId}.`, "error");
      this.q("content").innerHTML = "";
      return;
    }

    this.clearStatus();
    this.renderDetails(
      vpsdbRes.data,
      ratingSummaryRes.ok ? ratingSummaryRes.data : null,
      activitySummaryRes.ok ? activitySummaryRes.data : null,
      activityWeeklyRes.ok ? activityWeeklyRes.data : null,
    );
  }

  renderDetails(record, ratingSummary, activitySummary, activityWeekly) {
    const vpsdb =
      record?.vpsdb && typeof record.vpsdb === "object" ? record.vpsdb : {};
    const title = vpsdb?.name || record?.vpsId || "Unknown Table";
    const manufacturer =
      typeof vpsdb?.manufacturer === "string" ? vpsdb.manufacturer.trim() : "";
    const year =
      vpsdb?.year === null || vpsdb?.year === undefined
        ? ""
        : String(vpsdb.year).trim();
    const subtitle = [manufacturer, year].filter(Boolean).join(" • ");
    const artUrl = this.getTableArtUrl(record?.vpsId);
    const avgRating = ratingSummary?.avgRating;
    const lastUpdated = record?.updatedAt
      ? this.fmtDate(record.updatedAt)
      : "-";
    const totalStarts = Number(activitySummary?.startCountTotal || 0);
    const totalRuntime = Number(activitySummary?.runTimeTotal || 0);
    const weeklyRuntime = Number(activityWeekly?.runTimePlayed || 0);
    const weeklyStarts = Number(activityWeekly?.startCountPlayed || 0);
    const vpsLink = record?.vpsId
      ? `https://virtualpinballspreadsheet.github.io/games?game=${encodeURIComponent(record.vpsId)}`
      : "";

    this.q("content").innerHTML = `
      <div class="table-focus-panel">
          <div class="table-focus-header">
              <img
                  class="table-focus-art"
                  src="${artUrl}"
                  alt="${this.escapeHtml(title)} backglass art"
                  onerror="this.style.display='none';"
              >
              <div class="table-focus-title">
                  <span>${this.escapeHtml(title)}</span>
                  ${vpsLink ? `<a class="table-focus-vps-link" href="${vpsLink}" target="_blank" rel="noopener noreferrer" aria-label="Open VPS entry for ${this.escapeHtml(title)}"><img class="table-focus-vps-logo" src="img/vpsLogo.png" alt="VPS"></a>` : ""}
              </div>
              <div class="table-focus-copy">
                  <div class="table-focus-subhead">${this.escapeHtml(subtitle || "Unknown Manufacturer")}</div>
                  <div class="table-focus-rating-row">
                      <div class="table-focus-label">Rating</div>
                      <div class="table-focus-rating">${this.fmtRatingStars(avgRating, { showNumeric: true })}</div>
                  </div>
                  <div class="table-focus-meta">Last update: ${this.escapeHtml(lastUpdated)}</div>
              </div>
              <section class="table-focus-stat-card table-focus-stat-total">
                  <div class="table-focus-label">Total Activity</div>
                  <div class="table-focus-stat-value">${this.escapeHtml(`${this.fmtWeeklyRuntime(totalRuntime)} / ${this.fmtNumber(totalStarts)}`)}</div>
                  <div class="table-focus-stat-sub">All-time playtime / starts</div>
              </section>
              <section class="table-focus-stat-card table-focus-stat-week">
                  <div class="table-focus-label">This Week Activity</div>
                  <div class="table-focus-stat-value">${this.escapeHtml(`${this.fmtWeeklyRuntime(weeklyRuntime)} / ${this.fmtNumber(weeklyStarts)}`)}</div>
                  <div class="table-focus-stat-sub">Last 7 days (delta)</div>
              </section>
          </div>
      </div>
    `;
  }
}

customElements.define("table-details-panel", TableDetailsPanel);
