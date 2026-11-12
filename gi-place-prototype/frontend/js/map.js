// map.js - two Leaflet maps:
//   createMiniMap()    small, non-interactive preview in the panel
//   createPickerMap()  full-size map with the draw tools (inside the overlay)

const LEHIGH_ACRES = [26.60, -81.64];
const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const STREET_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
// Bottom -> top stacking of Step 1 overlays (keys match the /run-step1 "layers").
const STEP1_DRAW_ORDER = ["residual", "groundwater", "trees", "riparian", "drainage", "steep"];
const SHAPE_STYLE ={ color: "#2f4ea2", fillColor: "#4f6bd8", fillOpacity: 0.35, weight: 2 };

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

/* ---------- Step 1 output map ---------- */
function createOutputMap() {
  const map = L.map("map").setView(LEHIGH_ACRES, 9);
  L.tileLayer(SATELLITE_URL, {
    maxZoom: 19,
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics"
  }).addTo(map);

  // One pane per Step 1 layer, so stacking stays fixed no matter which order
  // layers are toggled: broad layers at the bottom, narrow features on top.
  STEP1_DRAW_ORDER.forEach((name, i) => {
    map.createPane(`step1-${name}`).style.zIndex = String(410 + i);
  });

  // name -> L.imageOverlay. Layers stay in this registry while hidden so the
  // sidebar toggles can re-add them without another backend request.
  let outputLayers = {};

  function clearLayers() {
    Object.values(outputLayers).forEach(layer => map.removeLayer(layer));
    outputLayers = {};
  }

  return {
    map,
    clearLayers,
    /** Replace all overlays. bounds are the lat/lon corners of the EPSG:3857 PNG grid. */
    showLayers(layers, bounds, onLayerError = () => {}) {
      clearLayers();

      for (const [name, url] of Object.entries(layers || {})) {
        if (!url) continue;
        const pane = STEP1_DRAW_ORDER.includes(name) ? `step1-${name}` : "overlayPane";
        const layer = L.imageOverlay(url, bounds, { opacity: 0.82, interactive: false, pane });
        layer.on("error", () => onLayerError(`Could not load the ${name} result layer.`));
        layer.addTo(map);
        outputLayers[name] = layer;
      }

      if (Object.keys(outputLayers).length) map.fitBounds(bounds);
      map.invalidateSize();
    },
    hasLayer(name) {
      return name in outputLayers;
    },
    isVisible(name) {
      return !!outputLayers[name] && map.hasLayer(outputLayers[name]);
    },
    setVisible(name, visible) {
      const layer = outputLayers[name];
      if (!layer) return false;
      if (visible && !map.hasLayer(layer)) layer.addTo(map);
      if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
      return true;
    }
  };
}

/* ---------- Full-size picker map ---------- */
// onPolygon(geojson | null, error?) fires when the selected shape changes.
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

  const leeCounty = counties.features.find(county => county.properties.name === "Lee");
  const validationError = "Error: You can only draw within Lee County.";

  function isWithinLee(geojson) {
    if (!leeCounty) return false;
    try {
      return turf.booleanWithin(geojson, leeCounty);
    } catch (error) {
      return false;
    }
  }

  function rejectLayer(layer) {
    if (current === layer) current = null;
    if (map.hasLayer(layer)) layer.remove();
    if (map.pm.globalDrawModeEnabled()) map.pm.disableDraw();
    onPolygon(null, validationError, true);
  }

  function clearCurrent() {
    if (!current) return;
    const previous = current;
    current = null;
    map.removeLayer(previous);
  }

  function attach(layer) {
    current = layer;
    const update = () => {
      if (current !== layer) return;
      const geojson = layer.toGeoJSON();
      if (!isWithinLee(geojson)) {
        rejectLayer(layer);
        return;
      }
      onPolygon(geojson);
    };
    layer.on("pm:edit", update);
    layer.on("pm:vertexadded", update);
    layer.on("pm:vertexremoved", update);
  }

  // Starting a replacement drawing clears the old shape and selection immediately.
  map.on("pm:drawstart", () => {
    clearCurrent();
    onPolygon(null, null, true);
  });

  map.on("pm:create", (e) => {
    const layer = e.layer;
    clearCurrent();
    const geojson = layer.toGeoJSON();
    if (!isWithinLee(geojson)) {
      rejectLayer(layer);
      return;
    }
    attach(layer);
    onPolygon(geojson);
  });
  map.on("pm:remove", (e) => {
    if (e.layer === current) { current = null; onPolygon(null, null, true); }
  });

  return {
    map,
    /** Put an existing polygon on the map so the user can edit it, or start empty (null). */
    load(feature) {
      if (map.pm.globalDrawModeEnabled()) map.pm.disableDraw();
      clearCurrent();
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
      clearCurrent();
      onPolygon(null, null, true);
    }
  };
}
