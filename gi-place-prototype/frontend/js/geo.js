// geo.js - pure geometry logic (no DOM, no map). Uses Turf.js.
// The Python backend should recompute the final acreage later; this is the browser preview.

const M2_TO_ACRES = 0.000247105381;
const LEE_COUNTY_ERROR = "Selection must be entirely within Lee County.";

/**
 * Returns the acreage for a polygon entirely within Lee County, or a validation error.
 * @param {Feature<Polygon|MultiPolygon>} poly
 * @param {FeatureCollection} counties Florida counties with properties.name
 * @returns {{valid: true, acres: number} | {valid: false, error: string}}
 */
function analyzePolygon(poly, counties) {
  const leeCounty = counties.features.find(county => county.properties.name === "Lee");
  if (!leeCounty) return { valid: false, error: LEE_COUNTY_ERROR };

  const totalM2 = turf.area(poly);
  const [minX, minY, maxX, maxY] = turf.bbox(poly);
  let primaryCounty = null;
  let primaryOverlapM2 = 0;

  for (const county of counties.features) {
    const [cx0, cy0, cx1, cy1] = turf.bbox(county);
    if (minX > cx1 || maxX < cx0 || minY > cy1 || maxY < cy0) continue;

    let overlap;
    try {
      overlap = turf.intersect(poly, county);
    } catch (error) {
      overlap = null;
    }
    if (!overlap) continue;

    const overlapM2 = turf.area(overlap);
    if (overlapM2 > primaryOverlapM2) {
      primaryOverlapM2 = overlapM2;
      primaryCounty = county.properties.name;
    }
  }

  // The topology check rejects even small areas outside Lee County; the area check
  // also guards against polygons that extend beyond the county data coverage.
  let entirelyWithinLee = false;
  try {
    entirelyWithinLee = turf.booleanWithin(poly, leeCounty);
  } catch (error) {
    entirelyWithinLee = false;
  }

  if (!entirelyWithinLee || primaryCounty !== "Lee") {
    return { valid: false, error: LEE_COUNTY_ERROR };
  }

  return { valid: true, acres: totalM2 * M2_TO_ACRES };
}
