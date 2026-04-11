class PlayerRatings extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.data = [];
  }

  connectedCallback() {
    this.render();
    if (this.getAttribute("vps-id")) {
      this.loadData();
    }
  }

  static get observedAttributes() {
    return ["vps-id"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "vps-id" && oldValue !== newValue && this.shadowRoot) {
      this.loadData();
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
      const [playerRatings] = await Promise.all([
        api(`/api/v1/tables/${encodeURIComponent(vpsId)}/user-ratings`),
      ]);

      this.data = Array.isArray(playerRatings.data) ? playerRatings.data : [];
    } catch (error) {
      console.error("Error loading player ratings:", error);
      this.data = [];
    }

    this.updateTable();
  }

  updateTable() {
    const title = this.shadowRoot.querySelector("h3");
    const tbody = this.shadowRoot.querySelector("tbody");

    if (title) {
      title.textContent = `Player Ratings (${this.data.length})`;
    }

    if (tbody) {
      tbody.innerHTML = this.data.length
        ? this.data
            .map(
              (row) => `
          <tr>
            <td>${this.linkUserId(row.userId)}</td>
            <td>${this.fmtRatingStars(row.rating)}</td>
            <td>${this.fmtDate(row.lastRun)}</td>
            <td>${this.fmtDate(row.updatedAt)}</td>
          </tr>
        `,
            )
            .join("")
        : '<tr><td colspan="4" style="text-align: center; color: var(--ink-dim);">No ratings yet</td></tr>';
    }
  }

  linkUserId(userId) {
    return `<a href="/players?userid=${encodeURIComponent(userId)}&vpsid=${encodeURIComponent(this.getAttribute("vps-id"))}" class="user-link">${userId}</a>`;
  }

  fmtRatingStars(rating) {
    const numericRating = Math.round(rating * 10) / 10;
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 >= 0.5 ? 1 : 0;
    const emptyStars = 5 - fullStars - halfStar;

    const stars =
      "★".repeat(fullStars) + (halfStar ? "⯨" : "") + "☆".repeat(emptyStars);

    return `<span class="rating-stars" title="${numericRating}">${stars} <span class="rating-numeric">${numericRating}</span></span>`;
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
          transition: background-color 150ms ease;
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

        .rating-stars {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          color: var(--neon-yellow);
        }

        .rating-numeric {
          color: var(--ink);
          font-weight: 600;
          font-size: 0.85em;
        }

        @media (max-width: 640px) {
            th {
                font-size: 0.7rem;
            }
            tr, td {
                font-size: 0.8rem;
            }
            .rating-stars {
                display: flex;
                flex-direction: column;
                align-items: center;
            }
        }
      </style>

      <h3>Player Ratings (0)</h3>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Rating</th>
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

customElements.define("player-ratings", PlayerRatings);
