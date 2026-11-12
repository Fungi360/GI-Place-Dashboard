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
  if (!r || !r.valid) return;
  $("acres").textContent = "~" + fmt(r.acres, r.acres < 100 ? 1 : 0);
  $("county").value = "Lee";
  $("customToggle").checked = true;
  $("thumbLabel").textContent = "Click to edit area";
  $("split").innerHTML = "";
  $("status").textContent = "Area is entirely within Lee County.";
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
  if (!r.valid) {
    live.textContent = r.error;
    $("applyBtn").disabled = true;
    return;
  }
  live.innerHTML = `<strong>~${fmt(r.acres, r.acres < 100 ? 1 : 0)} acres</strong> · Lee County`;
  $("applyBtn").disabled = false;
}
