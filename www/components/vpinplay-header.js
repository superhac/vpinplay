class VPinPlayHeader extends HTMLElement {
  constructor() {
    super();
    this.lastRefreshTime = null;
    this.updateInterval = null;
  }

  connectedCallback() {
    const h1Id = this.getAttribute("h1-id") || "";
    const refreshBtnId =
      this.getAttribute("refresh-btn-id") || "refreshDashboardBtn";

    const path = window.location.pathname;

    const navItems = [
      { name: "Global", href: "/" },
      { name: "Tables", href: "/tables" },
      { name: "Players", href: "/players" },
      { name: "Scores", href: "/scores" },
    ];

    const navHtml = navItems
      .map((item) => {
        let isActive = false;

        if (item.href === "/") {
          isActive = path === "/" || path === "" || path === "/index.html";
        } else {
          isActive = path === item.href || path === `${item.href}/`;
        }

        return `<li><a href="${item.href}" class="nav-link ${isActive ? "active" : ""}">${item.name}</a></li>`;
      })
      .join("");

    this.innerHTML = `
            <header class="header">
                <div class="header-left">
                    <div class="header-logo">
                        <a href="/"><img src="img/header-logo.png" alt="VPinPlay Logo"></a>
                    </div>
                    <div class="header-content">
                        <h1 ${h1Id ? `id="${h1Id}"` : ""}>VPin Play</h1>
                    </div>
                </div>

                <button class="menu-toggle" aria-label="Toggle navigation">☰</button>

                <nav class="header-nav">
                    <ul class="nav-links">
                        ${navHtml}
                    </ul>
                    <div class="header-actions">
                        <slot></slot>
                        <button id="themeToggleBtn" class="btn btn-theme" onclick="toggleTheme()" aria-label="Toggle Theme">
                            <span id="theme-icon-container"></span>
                            <span id="theme-text">Dark</span>
                        </button>
                        <button id="${refreshBtnId}" class="btn" onclick="refreshDashboard()">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C10.0825 2 11.9242 3.02974 13 4.58579" 
                                        stroke="currentColor" 
                                        stroke-width="2" 
                                        stroke-linecap="round"/>
                                <path d="M13 1V5H9" 
                                        stroke="currentColor" 
                                        stroke-width="2" 
                                        stroke-linecap="round" 
                                        stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </nav>
            </header>
        `;

    // Mobile menu toggle logic
    const toggle = this.querySelector(".menu-toggle");
    const nav = this.querySelector(".header-nav");
    if (toggle && nav) {
      toggle.addEventListener("click", () => {
        nav.classList.toggle("open");
        toggle.textContent = nav.classList.contains("open") ? "✕" : "☰";
      });
    }
    this.startUpdateTimer();
  }

  disconnectedCallback() {
    this.stopUpdateTimer();
  }

  startUpdateTimer() {
    this.updateButtonText();

    this.updateInterval = setInterval(() => {
      this.updateButtonText();
    }, 1000);
  }

  stopUpdateTimer() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  updateButtonText() {
    const refreshBtnId =
      this.getAttribute("refresh-btn-id") || "refreshDashboardBtn";
    const btn = this.querySelector(`#${refreshBtnId}`);

    const refreshIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 6px;">
        <path d="M14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C10.0825 2 11.9242 3.02974 13 4.58579" 
                stroke="currentColor" 
                stroke-width="2" 
                stroke-linecap="round"/>
        <path d="M13 1V5H9" 
                stroke="currentColor" 
                stroke-width="2" 
                stroke-linecap="round" 
                stroke-linejoin="round"/>
        </svg>`;

    if (btn && this.lastRefreshTime) {
      const timeAgo = this.fmtTimeAgo(this.lastRefreshTime);
      btn.innerHTML = `${refreshIcon} (${timeAgo})`;
    } else if (btn) {
      btn.innerHTML = `${refreshIcon}`;
    }
  }

  fmtTimeAgo(date) {
    if (!date) return "-";
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  markRefresh() {
    this.lastRefreshTime = new Date();
    this.updateButtonText();
  }
}
customElements.define("vpinplay-header", VPinPlayHeader);
