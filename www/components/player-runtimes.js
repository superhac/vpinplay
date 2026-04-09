class PlayerRuntimes extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.data = [];
    this.limit = 10;
  }

  connectedCallback() {
    this.render();
    if (this.getAttribute("vps-id")) {
      this.loadData();
    }
  }

  static get observedAttributes() {
    return ["vps-id", "limit"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "vps-id" && oldValue !== newValue && this.shadowRoot) {
      this.loadData();
    } else if (name === "limit" && oldValue !== newValue) {
      this.limit = parseInt(newValue) || 10;
      if (this.getAttribute("vps-id") && this.shadowRoot) {
        this.loadData();
      }
    }
  }

  async loadData() {
    const vpsId = this.getAttribute("vps-id");
    if (!vpsId) {
      this.data = [];
      this.updateTable();
      return;
    }

    try {
      const [playerRuntimes] = await Promise.all([
        api(
          `/api/v1/tables/${encodeURIComponent(vpsId)}/top-runtime-players?limit=${this.limit}`,
        ),
      ]);

      this.data = Array.isArray(playerRuntimes.data) ? playerRuntimes.data : [];
      console.log("Player runtimes loaded:", this.data.length, "players");
    } catch (error) {
      console.error("Error loading player runtimes:", error);
      this.data = [];
    }

    this.updateTable();
  }

  updateTable() {
    const title = this.shadowRoot.querySelector("h3");
    const tbody = this.shadowRoot.querySelector("tbody");

    if (title) {
      title.textContent = `Top Player Play Time (${this.data.length})`;
    }

    if (tbody) {
      tbody.innerHTML = this.data.length
        ? this.data
            .map(
              (row) => `
          <tr>
            <td>${this.linkUserId(row.userId)}</td>
            <td>${this.fmtWeeklyRuntime(row.runTime)}</td>
            <td>${this.fmtDate(row.lastRun)}</td>
            <td>${this.fmtDate(row.updatedAt)}</td>
          </tr>
        `,
            )
            .join("")
        : '<tr><td colspan="4" style="text-align: center; color: var(--ink-dim);">No play time recorded</td></tr>';
    }
  }

  linkUserId(userId) {
    return `<a href="/users.html?userid=${encodeURIComponent(userId)}" class="user-link">${userId}</a>`;
  }

  fmtWeeklyRuntime(minutes) {
    const totalMinutes = Number(minutes || 0);
    if (totalMinutes <= 0) return "0m";

    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;

    if (hours > 0) {
      return remainingMinutes > 0
        ? `${hours}h ${remainingMinutes}m`
        : `${hours}h`;
    }
    return `${totalMinutes}m`;
  }

  fmtDate(dateStr) {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  render() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="/css/base.css">
      <style>
        :host {
          display: block;
        }

        h3 {
          margin: 0 0 1rem 0;
          font-size: 1.1rem;
          font-weight: 800;
          color: var(--ink);
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }

        thead {
          background: var(--surface-2);
          border-bottom: 2px solid var(--line);
        }

        th {
          padding: 0.75rem 0.5rem;
          text-align: left;
          font-weight: 700;
          color: var(--ink);
          text-transform: uppercase;
          font-size: 0.75rem;
          letter-spacing: 0.05em;
        }

        td {
          padding: 0.75rem 0.5rem;
          border-bottom: 1px solid var(--line);
          color: var(--ink);
        }

        tbody tr {
          transition: background 150ms ease;
        }

        tbody tr:hover {
          background: var(--surface-2);
        }

        .user-link {
          color: var(--neon-cyan);
          text-decoration: none;
          font-weight: 600;
          transition: color 150ms ease;
        }

        .user-link:hover {
          color: var(--neon-pink);
          text-shadow: var(--glow-pink);
        }

        @media (max-width: 640px) {
            h3 {
                font-size: 0.9rem;
            }

            th {
                font-size: 0.7rem;
            }

            tr, td {
                font-size: 0.8rem;
            }
        }
      </style>

      <h3>Top Player Play Time (0)</h3>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Run Time</th>
            <th>Last Played</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="4" style="text-align: center; color: var(--ink-muted);">Loading...</td>
          </tr>
        </tbody>
      </table>
    `;
  }
}

customElements.define("player-runtimes", PlayerRuntimes);
