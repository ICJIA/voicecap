/**
 * The report's inline filter script. Plain ES2017 so it runs in any current browser straight
 * from disk. Without it, the filter form stays hidden and the full table is shown.
 */
export const REPORT_SCRIPT = `
(function () {
  "use strict";
  var form = document.getElementById("filters");
  var table = document.getElementById("pages-table");
  var status = document.getElementById("row-count");
  if (!form || !table || !status || !table.tBodies[0]) return;
  var rows = Array.prototype.slice.call(table.tBodies[0].rows);
  var total = rows.length;
  function control(id) { return document.getElementById(id); }
  var flagged = control("filter-flagged");
  var review = control("filter-review");
  var changed = control("filter-changed");
  var manual = control("filter-manual");
  var template = control("filter-template");
  var compare = control("filter-compare");
  function pages(n) { return n.toLocaleString("en-US") + (n === 1 ? " page" : " pages"); }
  function apply() {
    var shown = 0;
    rows.forEach(function (row) {
      var d = row.dataset;
      var match =
        (!flagged || flagged.value === "" || d.flagged === flagged.value) &&
        (!review || review.value === "" || d.review === review.value) &&
        (!changed || !changed.checked || d.changed === "yes") &&
        (!manual || !manual.checked || d.manual === "yes") &&
        (!template || template.value === "" || d.template === template.value) &&
        (!compare || !compare.checked || d.compare === "changed");
      row.hidden = !match;
      if (match) shown += 1;
    });
    var text = "Showing " + shown.toLocaleString("en-US") + " of " + pages(total);
    if (status.textContent !== text) status.textContent = text;
  }
  form.addEventListener("change", apply);
  form.addEventListener("input", apply);
  form.addEventListener("submit", function (event) { event.preventDefault(); apply(); });
  form.addEventListener("reset", function () { window.setTimeout(apply, 0); });
  form.hidden = false;
  apply();
})();
`;
