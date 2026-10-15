// map.js - two Leaflet maps:
//   createMiniMap()    small, non-interactive preview in the panel
//   createPickerMap()  full-size map with the draw tools (inside the overlay)

const LEHIGH_ACRES = [26.60, -81.64];
const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const STREET_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SHAPE_STYLE = { color: "#2f4ea2", fillColor: "#4f6bd8", fillOpacity: 0.35, weight: 2 };

function countyStyle(f) {
  const lee = f.properties.name === "Lee";
  return { color: lee ? "#ffd166" : "#ffffff", weight: lee ? 2.5 : 1, fill: false, opacity: 0.8 };
}

/* ---------- Small preview map ---------- */
function createMiniMap(counties) {
  const map = L.map("miniMap", {
    zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
    doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false
  }).setView(LEHIGH_ACRES, 9);
  L.tileLayer(SATELLITE_URL, { maxZoom: 19 }).addTo(map);
  L.geoJSON(counties, { interactive: false, style: countyStyle }).addTo(map);

  let shape = null;
  return {
    map,
    show(feature) {                       // draw the applied polygon and zoom to it
      if (shape) map.removeLayer(shape);
      shape = L.geoJSON(feature, { style: SHAPE_STYLE, interactive: false }).addTo(map);
      map.fitBounds(shape.getBounds(), { padding: [12, 12], animate: false });
    },
    reset() {
      if (shape) map.removeLayer(shape);
      shape = null;
      map.setView(LEHIGH_ACRES, 9, { animate: false });
    }
  };
}

/* ---------- Full-size picker map ---------- */
// onPolygon(geojson | null) fires whenever the drawn shape is created, edited or deleted.
function createPickerMap(counties, onPolygon) {
  const map = L.map("pickerMap").setView(LEHIGH_ACRES, 11);

  const satellite = L.tileLayer(SATELLITE_URL,
    { maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" }).addTo(map);
  const streets = L.tileLayer(STREET_URL,
    { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" });
  const countyLines = L.geoJSON(counties, { interactive: false, style: countyStyle }).addTo(map);
  L.control.layers({ "Satellite": satellite, "Street map": streets }, { "County lines": countyLines }).addTo(map);

  map.pm.addControls({
    position: "topleft",
    drawMarker: false, drawCircleMarker: false, drawPolyline: false, drawCircle: false, drawText: false,
    cutPolygon: false, rotateMode: false, dragMode: false,
    drawPolygon: true, drawRectangle: true, editMode: true, removalMode: true
  });
  map.pm.setPathOptions(SHAPE_STYLE);

  let current = null; // only one site at a time

  function attach(layer) {
    current = layer;
    const update = () => onPolygon(current.toGeoJSON());
    layer.on("pm:edit", update);
    layer.on("pm:vertexadded", update);
    layer.on("pm:vertexremoved", update);
  }

  map.on("pm:create", (e) => {
    if (current) map.removeLayer(current);
    attach(e.layer);
    onPolygon(current.toGeoJSON());
  });
  map.on("pm:remove", (e) => {
    if (e.layer === current) { current = null; onPolygon(null); }
  });

  return {
    map,
    /** Put an existing polygon on the map so the user can edit it, or start empty (null). */
    load(feature) {
      if (map.pm.globalDrawModeEnabled()) map.pm.disableDraw();
      if (current) { map.removeLayer(current); current = null; }
      if (feature) {
        const layer = L.geoJSON(feature, { style: SHAPE_STYLE }).getLayers()[0];
        layer.addTo(map);
        attach(layer);
        map.fitBounds(layer.getBounds(), { padding: [40, 40], animate: false });
      } else {
        map.setView(LEHIGH_ACRES, 11, { animate: false });
      }
    },
    clear() {
      if (map.pm.globalDrawModeEnabled()) map.pm.disableDraw();
      if (current) { map.removeLayer(current); current = null; }
      onPolygon(null);
    }
  };
}
