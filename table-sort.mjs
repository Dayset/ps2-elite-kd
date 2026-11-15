// Click a header to sort any table.sortable; click again to flip. Numbers sort as numbers, "—" goes last.
const num = (s) => { const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m && /^[\s\[\]\d.,%+\-−×x]*$/.test(s.replace(/[a-z]/gi, "")) ? parseFloat(m[0]) : null; };
document.addEventListener("click", (e) => {
  const th = e.target.closest("table.sortable thead th");
  if (!th || e.target.closest("a")) return;
  const table = th.closest("table"), i = [...th.parentNode.children].indexOf(th);
  const dir = th.dataset.dir === "asc" ? "desc" : "asc";
  table.querySelectorAll("thead th").forEach((h) => { delete h.dataset.dir; h.removeAttribute("aria-sort"); });
  th.dataset.dir = dir;
  th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
  for (const tb of table.tBodies) {
    const rows = [...tb.rows].filter((r) => r.cells.length > 1);
    if (rows.length < 2) continue;
    const key = (r) => { const t = (r.cells[i]?.textContent || "").trim(); return [t, num(t)]; };
    const miss = (t, n) => n === null && (t === "" || t === "—" || t === "-");
    rows.sort((a, b) => {
      const [ta, na] = key(a), [tb2, nb] = key(b);
      if (miss(ta, na) !== miss(tb2, nb)) return miss(ta, na) ? 1 : -1;
      const c = na !== null && nb !== null ? na - nb : ta.localeCompare(tb2, undefined, { numeric: true });
      return dir === "asc" ? c : -c;
    });
    rows.forEach((r) => tb.append(r));
  }
});
