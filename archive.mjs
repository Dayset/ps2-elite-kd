// Archive index page: search + status filter over the generated inventory table.
// The table itself is static HTML (scripts/build-archive.mjs writes the rows), so the
// list works with no JavaScript at all; this only adds filtering and the count line.
import { t as tr, ready } from "./i18n.mjs";

await ready;

const rows = [...document.querySelectorAll("#arcRows tr")];
const search = document.getElementById("arcSearch");
const count = document.getElementById("arcCount");
const filters = [...document.querySelectorAll(".arc-filter")];
let status = "all";

function applyFilter() {
  const q = (search.value || "").trim().toLowerCase();
  let shown = 0;
  for (const r of rows) {
    const okStatus = status === "all" || r.dataset.status === status;
    const okText = !q || (r.dataset.title || "").includes(q);
    const show = okStatus && okText;
    r.hidden = !show;
    if (show) shown++;
  }
  count.textContent = tr("arc.count", "Showing {shown} of {total} entries", { shown, total: rows.length });
}

for (const btn of filters) {
  btn.addEventListener("click", () => {
    status = btn.dataset.filter;
    for (const b of filters) b.classList.toggle("on", b === btn);
    applyFilter();
  });
}
search.addEventListener("input", applyFilter);
applyFilter();
