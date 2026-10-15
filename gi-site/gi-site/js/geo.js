// geo.js - pure geometry logic (no DOM, no map). Uses Turf.js.
// The Python backend should recompute the final acreage later; this is the browser preview.

const M2_TO_ACRES = 0.000247105381;
const M2_TO_SQMI = 1 / 2589988.11;

/**
 * poly:     GeoJSON Feature (Polygon/MultiPolygon) drawn by the user
 * counties: GeoJSON FeatureCollection of Florida counties (properties.name)
 * returns:  { acres, sqMiles, hectares, centroid:[lat,lon], county, counties:[{name,acres,pct}], outsideAcres }
 */
function analyzePolygon(poly, counties) {
  const totalM2 = turf.area(poly);
  const [minX, minY, maxX, maxY] = turf.bbox(poly);

  const shares = [];
  let insideM2 = 0;

  for (const county of counties.features) {
    // quick reject: skip counties whose bounding box doesn't touch the polygon
    const [cx0, cy0, cx1, cy1] = turf.bbox(county);
    if (minX > cx1 || maxX < cx0 || minY > cy1 || maxY < cy0) continue;

    let overlap = null;
    try { overlap = turf.intersect(poly, county); } catch (e) { overlap = null; }
    if (!overlap) continue;

    const m2 = turf.area(overlap);
    if (m2 < totalM2 * 0.001) continue; // ignore slivers (<0.1%) where a polygon edge just touches a county line
    insideM2 += m2;
    shares.push({ name: county.properties.name, m2 });
  }

  shares.sort((a, b) => b.m2 - a.m2);

  const [lon, lat] = turf.centroid(poly).geometry.coordinates;

  return {
    acres: totalM2 * M2_TO_ACRES,
    sqMiles: totalM2 * M2_TO_SQMI,
    hectares: totalM2 / 10000,
    centroid: [lat, lon],
    county: shares.length ? shares[0].name : null,   // largest share
    counties: shares.map(s => ({ name: s.name, acres: s.m2 * M2_TO_ACRES, pct: 100 * s.m2 / totalM2 })),
    outsideAcres: Math.max(0, (totalM2 - insideM2) * M2_TO_ACRES)
  };
}
