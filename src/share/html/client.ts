/**
 * The shareable page's own script, as plain browser JavaScript (ES2017, no imports), held as a
 * string the way src/report/client.ts holds the report's. Besides the fingerprint check
 * (../check.ts), it's all the page does with scripts:
 * - the theme: dark, or light once the reader picks it, which this browser keeps;
 * - "Open every section": every fold opened, then, pressed again, each put back as it was;
 * - printing: every fold opened first, and each put back after;
 * - a link, or the page's address, pointing into a fold: the fold opened, and the page scrolled to
 *   what it points to.
 *
 * Without it the page is complete: every fold opens by hand. The two buttons at the top start
 * hidden, since they do nothing without it, and it shows them.
 *
 * It shares the page's one `<script>` with the check's script, which follows it. So:
 * - all of it is inside one function: the check's library declares its names at the top level of
 *   that script, and a top-level declaration of the same name here would stop it all parsing;
 * - each part starts in a function of its own, in try/catch: one that fails says so in the
 *   console, shows no button that would do nothing, and stops neither the other parts nor the
 *   check. The check's script comes last, so it can stop nothing here.
 *
 * Storage can be missing or refused (a private window, or a browser set to keep nothing), so every
 * use of it is in try/catch, and with nothing stored the page is dark.
 */
export const SHARE_SCRIPT = String.raw`
(function () {
  "use strict";

  function start(part) {
    try {
      part();
    } catch (error) {
      if (window.console) window.console.error(error);
    }
  }

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

  // Every fold opened at once, and then each put back as it was: by "Open every section", and
  // around printing.
  function folds() {
    function openEvery() {
      var before = Array.prototype.map.call(document.querySelectorAll("details"), function (fold) {
        return { fold: fold, open: fold.open };
      });
      before.forEach(function (each) {
        each.fold.open = true;
      });
      return before;
    }
    function putBack(before) {
      before.forEach(function (each) {
        each.fold.open = each.open;
      });
    }
    var printing = null;
    window.addEventListener("beforeprint", function () {
      if (printing === null) printing = openEvery();
    });
    window.addEventListener("afterprint", function () {
      if (printing !== null) putBack(printing);
      printing = null;
    });
    var button = document.getElementById("open-all");
    if (!button) return;
    var opened = null;
    button.addEventListener("click", function () {
      if (opened === null) {
        opened = openEvery();
        button.textContent = "Fold the details again";
      } else {
        putBack(opened);
        opened = null;
        button.textContent = "Open every section";
      }
    });
    button.hidden = false;
  }

  // A link into a fold, or an address pointing into one: every fold around what it points to
  // opens (the fold itself, when it points to one), and the page scrolls there.
  function links() {
    function targetOf(hash) {
      if (typeof hash !== "string" || hash.charAt(0) !== "#" || hash.length < 2) return null;
      var id = hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch (error) {
        // Not percent-encoded as an address would be: the id as written.
      }
      return document.getElementById(id);
    }
    // Opens every fold around the target, and the target when it's one. Says whether any was shut.
    function reveal(target) {
      var opened = false;
      var fold = target.closest("details");
      while (fold) {
        if (!fold.open) {
          fold.open = true;
          opened = true;
        }
        fold = fold.parentElement ? fold.parentElement.closest("details") : null;
      }
      return opened;
    }
    function go(hash) {
      var target = targetOf(hash);
      if (target && reveal(target)) target.scrollIntoView();
    }
    // A click comes before the browser follows the link, so the fold is open when it scrolls there,
    // even to the address it's already at.
    document.addEventListener("click", function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href^="#"]') : null;
      var target = link ? targetOf(link.getAttribute("href")) : null;
      if (target) reveal(target);
    });
    window.addEventListener("hashchange", function () {
      go(window.location.hash);
    });
    go(window.location.hash);
  }

  start(theme);
  start(folds);
  start(links);
})();
`;
