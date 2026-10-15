// ui.js - updates the left "Input Data" panel and the picker footer. No map code here.

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const DEFAULT_NOTE = "Click the map preview to draw your site.";

function initCountyDropdown(counties) {
  const names = counties.features.map(f => f.properties.name).sort();
  $("county").innerHTML = '<option value="">–</option>' +
    names.map(n => `<option value="${n}">${n} County</option>`).join("");
}

/** Show the APPLIED site in the panel. */
function showResult(r) {
  $("acres").textContent = "~" + fmt(r.acres, r.acres < 100 ? 1 : 0);
  $("sqmi").textContent = fmt(r.sqMiles, 2);
  $("ha").textContent = fmt(r.hectares, 1);
  $("centroid").textContent = r.centroid[0].toFixed(4) + ", " + r.centroid[1].toFixed(4);
  $("county").value = r.county || "";
  $("customToggle").checked = true;
  $("thumbLabel").textContent = "Click to edit area";

  let html = "";
  if (r.counties.length > 1) {
    html = "<table><tr><th>County split</th><th>Acres</th></tr>" +
      r.counties.map(c => `<tr><td>${c.name}</td><td>${fmt(c.acres)} (${c.pct.toFixed(1)}%)</td></tr>`).join("") +
      (r.outsideAcres > 1 ? `<tr><td>Outside FL / water edge</td><td>${fmt(r.outsideAcres)}</td></tr>` : "") +
      "</table>";
  }
  $("split").innerHTML = html;

  if (!r.county) $("status").innerHTML = '<span class="warn">This area is outside Florida county data.</span>';
  else if (r.counties.length > 1) $("status").innerHTML = `<span class="warn">Area spans ${r.counties.length} counties; largest share (${r.county}) selected.</span>`;
  else $("status").textContent = `Area is entirely in ${r.county} County.`;
}

/** Reset the panel to "nothing selected". */
function clearResult() {
  ["acres", "sqmi", "ha", "centroid"].forEach(id => ($(id).textContent = "–"));
  $("county").value = "";
  $("customToggle").checked = false;
  $("thumbLabel").textContent = "Click to select area";
  $("split").innerHTML = "";
  $("status").textContent = DEFAULT_NOTE;
}

/** Live readout in the picker footer (the DRAFT, not yet applied). */
function showDraft(r) {
  const live = $("live");
  if (!r) { live.textContent = "No area drawn yet"; $("applyBtn").disabled = true; return; }
  const county = r.county ? `${r.county} County` : "outside Florida";
  const extra = r.counties.length > 1 ? ` (+${r.counties.length - 1} more)` : "";
  live.innerHTML = `<strong>~${fmt(r.acres, r.acres < 100 ? 1 : 0)} acres</strong> &middot; ${county}${extra}`;
  $("applyBtn").disabled = false;
}
