class SiteNavbar extends HTMLElement {
  connectedCallback() {
    const currentPage = window.location.pathname;

    const isHome =
      currentPage.includes("index") ||
      currentPage === "/" ||
      currentPage === "";

    const navLinkBase =
      "font-mono text-[10.5px] tracking-[0.1em] uppercase no-underline px-3.5 py-1.5 rounded-[3px] transition-colors duration-[180ms]";
    const navLinkIdle =
      "text-[color:var(--text3)] hover:text-[color:var(--text2)] hover:bg-[var(--bg2)]";
    const navLinkActive = "text-[color:var(--red)] bg-[var(--red-g)]";

    const link = (href, label, active, extra = "") =>
      `<a href="${href}" class="${navLinkBase} ${active ? navLinkActive : navLinkIdle}${extra ? " " + extra : ""}">${label}</a>`;

    this.innerHTML = `
      <nav class="site-nav fixed top-0 left-0 right-0 z-[100] flex items-center px-8 h-14 mt-6">
        <a href="index.html" class="nav-brand font-display text-xl font-bold tracking-[0.08em] no-underline mr-9 flex-shrink-0">
          <img
            src="icon.gif"
            class="h-[70px]"
          />
        </a>

        <div class="flex gap-0.5 flex-1 items-center">
          ${link("index.html", "Home", isHome)}
          ${link("index.html#skills", "Skills", false)}
          ${link("index.html#projects", "Projects", false)}
          ${link("jobs.html", "Jobs", currentPage.includes("jobs"))}
          ${link("travel-card-quiz.html", "Travel Cards", currentPage.includes("travel-card-quiz"))}
          ${link("palladium.html", "Palladium Quiz", currentPage.includes("palladium"))}
          ${link("metro.html", "Metro", currentPage.includes("metro"))}
          ${link("grocery.html", "Grocery", currentPage.includes("grocery"))}
          <a href="https://github.com/aeonss"
             target="_blank"
             class="${navLinkBase} ${navLinkIdle} ml-auto">
            GitHub ↗
          </a>
        </div>
      </nav>
    `;
  }
}

customElements.define("site-navbar", SiteNavbar);
