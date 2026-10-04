/**
 * The website's own script, as plain browser JavaScript (ES2017, no imports), held as a string the
 * way the shareable page's is (../share/html/client.ts). It's the theme, and nothing else:
 * - dark, or light once the reader picks it, which this browser keeps under the name the reports
 *   keep it under (`voicecap-theme`), so a choice made here carries to a report, and from one to
 *   here;
 * - the button that switches it, which starts hidden, since it does nothing without this script,
 *   and which this script shows.
 *
 * Without it the page is complete, and dark. Storage can be missing or refused (a private window,
 * or a browser set to keep nothing), so every use of it is in try/catch, and with nothing stored the
 * page is dark. All of it is inside one function, so it adds no name to the page, and a failure is
 * reported in the console and stops nothing else.
 */
export const SITE_SCRIPT = String.raw`
(function () {
  "use strict";

  // The theme: dark, or light once the reader picks it, kept in this browser.
  function theme() {
    var KEY = "voicecap-theme";
    var root = document.documentElement;
    var button = document.getElementById("theme-toggle");
    function saved() {
      try {
        return window.localStorage.getItem(KEY);
      } catch (error) {
        return null;
      }
    }
    function keep(choice) {
      try {
        window.localStorage.setItem(KEY, choice);
      } catch (error) {
        // Not kept: the page stays as picked until it's closed.
      }
    }
    function show(choice) {
      root.setAttribute("data-theme", choice);
      if (button) button.textContent = choice === "light" ? "Dark version" : "Light version";
    }
    show(saved() === "light" ? "light" : "dark");
    if (!button) return;
    button.addEventListener("click", function () {
      var choice = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      show(choice);
      keep(choice);
    });
    button.hidden = false;
  }

  try {
    theme();
  } catch (error) {
    if (window.console) window.console.error(error);
  }
})();
`;
