class TablesMetadata extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.vpsId = "";
    this.rows = [];
    this.activitySummary = null;
    this.expanded = false;
  }

  static get observedAttributes() {
    return ["vps-id"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "vps-id" && oldValue !== newValue) {
      this.vpsId = newValue;
      this.refresh();
    }
  }

  connectedCallback() {
    this.render();
    this.attachEventListeners();
    this.setExpanded(false);
  }

  setExpanded(expanded) {
    this.expanded = expanded;
    const details = this.shadowRoot.getElementById("metadata-details");
    const expandIcon = this.shadowRoot.querySelector(".expand-icon");
    if (details) details.style.display = expanded ? "block" : "none";
    if (expandIcon)
      expandIcon.style.transform = expanded ? "rotate(180deg)" : "rotate(0deg)";
  }

  attachEventListeners() {
    const expandButton = this.shadowRoot.getElementById("expandButton");
    if (expandButton) {
      expandButton.addEventListener("click", () => {
        this.setExpanded(!this.expanded);
      });
    }
  }

  async refresh() {
    if (!this.vpsId) {
      this.rows = [];
      this.activitySummary = null;
      this.updateContent();
      return;
    }

    try {
      const [tableByIdRes, activitySummaryRes] = await Promise.all([
        api(`/api/v1/tables/${encodeURIComponent(this.vpsId)}`),
        api(
          `/api/v1/tables/${encodeURIComponent(this.vpsId)}/activity-summary`,
        ),
      ]);

      this.rows =
        tableByIdRes.ok && Array.isArray(tableByIdRes.data)
          ? tableByIdRes.data
          : [];
      this.activitySummary = activitySummaryRes.ok
        ? activitySummaryRes.data
        : null;
      this.updateContent();
    } catch (e) {
      console.error("Error refreshing metadata component", e);
    }
  }

  updateContent() {
    this.renderAssociatedRoms();
    this.renderDerivativeDifferences();
  }

  renderAssociatedRoms() {
    const container = this.shadowRoot.getElementById("associatedRomsDetails");
    const rows = this.rows;
    const activitySummary = this.activitySummary;

    if (!rows || rows.length === 0) {
      container.innerHTML = `<div class="muted">No submitted table data found for this VPS ID.</div>`;
      return;
    }

    const romMap = new Map();
    rows.forEach((row, index) => {
      const filename = String(row?.vpxFile?.filename || "").trim();
      const romValues = [
        ...new Set(
          [row?.rom, row?.vpxFile?.rom]
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      ];

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

  renderDerivativeDifferences() {
    const container = this.shadowRoot.getElementById(
      "derivativeDifferencesDetails",
    );
    const title = this.shadowRoot.getElementById("derivativeDifferencesTitle");
    const rows = this.rows;

    const count = Array.isArray(rows) ? rows.length : 0;
    const comparisonCount = count > 1 ? (count * (count - 1)) / 2 : 0;
    if (title) {
      title.textContent = `Derivative Differences (${comparisonCount} comparisons)`;
    }

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
      const map = this.buildDerivativeComparableMap(row);
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
                  ${field("leftSubmittedBy", this.fmtSubmitters(left.row?.submittedByUserIdsNormalized), true)}
                  ${field("rightSubmittedBy", this.fmtSubmitters(right.row?.submittedByUserIdsNormalized), true)}
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

  buildDerivativeComparableMap(row) {
    const toComparableValue = (v) =>
      v === null || v === undefined ? "" : String(v);
    const out = {};
    out.rom = toComparableValue(row?.rom);
    out.alttitle = toComparableValue(row?.alttitle);
    out.altvpsid = toComparableValue(row?.altvpsid);
    flattenObject(row?.vpxFile || {}, "vpxFile").forEach((item) => {
      out[item.key] = toComparableValue(item.value);
    });
    return out;
  }

  fmtSubmitters(submitters) {
    if (!Array.isArray(submitters) || submitters.length === 0) {
      return '<span class="muted">Unknown</span>';
    }
    return submitters
      .filter((v) => String(v || "").trim() !== "")
      .map((v) => linkUserId(v))
      .join(", ");
  }

  render() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="/css/base.css">
      <style>
        :host {
          display: block;
          width: 100%;
        }
        .header-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }
        .header-row h3 {
          margin: 0;
        }
        .expand-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1.5rem;
          height: 1.5rem;
          padding: 0;
          border: 1px solid var(--line);
          border-radius: var(--radius);
          background: var(--surface-2);
          color: var(--neon-purple);
          cursor: pointer;
          flex: 0 0 auto;
          transition: transform 120ms ease;
        }
        .expand-button:hover {
          background: var(--neon-purple);
          border-color: var(--neon-purple);
          color: var(--surface);
        }
        .expand-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1rem;
          height: 1rem;
          transition: transform 120ms ease;
        }
        .expand-icon svg {
          width: 100%;
          height: 100%;
        }
        .derivative-panel {
          margin-top: 24px;
          padding-top: 16px;
          border-top: 1px solid var(--line);
        }
        .derivative-title {
           display: block;
           font-weight: 800;
           margin-bottom: 12px;
        }

        /* Chips for variation differences */
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 10px;
        }

        .chip {
          border: 2px solid var(--neon-purple);
          border-radius: 999px;
          background: var(--surface-2);
          color: var(--ink);
          padding: 5px 10px;
          font-size: 0.78rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          box-shadow: var(--glow-purple);
          transition: all 200ms ease;
        }

        .chip:hover {
          background: var(--neon-purple);
          color: var(--ink);
          transform: translateY(-1px);
        }

        /* Variation details */
        .variation-details {
          margin-top: 12px;
          display: grid;
          gap: 10px;
        }

        .variation-card {
          border-radius: 12px;
          background: var(--surface-2);
          padding: 12px;
          position: relative;
        }

        .variation-title {
          font-weight: 800;
          margin-bottom: 8px;
          font-size: 0.92rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .variation-subtitle {
          color: var(--ink-muted);
          font-size: 0.8rem;
          margin: -4px 0 8px;
        }

        .variation-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px 10px;
        }

        .variation-field {
          border-radius: 8px;
          padding: 8px;
          background: var(--surface);
        }

        .variation-label {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--neon-cyan);
          margin-bottom: 4px;
          font-weight: 700;
        }

        .variation-value {
          font-size: 0.9rem;
          word-break: break-word;
        }

        /* Media queries */
        @media (max-width: 600px) {
          .variation-grid {
            grid-template-columns: 1fr;
          } 
        }

      </style>
      <div class="header-row">
        <h3 id="associatedRomsTitle">Metadata</h3>
        <button id="expandButton" class="expand-button" type="button">
          <span class="expand-icon"> 
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M5 7l5 5 5-5M5 11l5 5 5-5"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
          </span>
        </button>
      </div>
      <div id="metadata-details">
        <div id="associatedRomsDetails" class="variation-details"></div>
        <div class="derivative-panel">
          <span id="derivativeDifferencesTitle" class="derivative-title">Derivative Differences</span>
          <div id="derivativeDifferencesDetails" class="variation-details"></div>
        </div>
      </div>
    `;
  }
}

customElements.define("tables-metadata", TablesMetadata);
