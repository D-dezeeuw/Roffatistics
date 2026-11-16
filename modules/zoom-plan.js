// Which area level is drawn (coloured) and which score stamps show, per zoom
// and scope. Pure: overlays.js (Nederland), nl-drill.js and city-scope.js
// follow it, tests/zoom-plan.test.js sweeps every zoom of both scopes.
//
// Rule (W10, v0.28.1): every zoom from the minimum to MAX_ZOOM colours at
// least one level, and every coloured level of a score layer is stamped. A
// finer level replaces a coarser one only once it is "ready" (geometry drawn
// and at least one value for the active layer); until then the coarser level
// stays coloured and stamped.

export const MIN_ZOOM          = 0;
export const MAX_ZOOM          = 17;
export const ZOOM_MUNICIPALITY = 10;   // Nederland: gemeenten
export const ZOOM_WIJK         = 12;   // Nederland: wijken of the gemeente at the map centre
export const ZOOM_BUURT        = 13;   // Nederland: its buurten
export const ZOOM_BUURT_RD     = 13;   // Rotterdam: buurten instead of wijken

/**
 * Lowest zoom at which stamps of a level may show: the lowest zoom at which
 * the plan can colour that level (Rotterdam wijken from the city fit down).
 * Density is handled by declutter (score-labels.js), not by hiding a level.
 */
export const LABEL_MIN_ZOOM = Object.freeze({ provincie: 0, gemeente: ZOOM_MUNICIPALITY, wijk: 0, buurt: ZOOM_BUURT });

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Nederland tier at `zoom`: 'province' (≤ 9), 'municipality' (10–11), 'wijk' (12), 'buurt' (≥ 13). */
export function nlTier(zoom) {
  if (zoom >= ZOOM_BUURT)        return 'buurt';
  if (zoom >= ZOOM_WIJK)         return 'wijk';
  if (zoom >= ZOOM_MUNICIPALITY) return 'municipality';
  return 'province';
}

/** Rotterdam level at `zoom`: buurt from ZOOM_BUURT_RD when the buurten have values, else wijk. */
export function cityLevel(zoom, { buurtReady = true } = {}) {
  return zoom >= ZOOM_BUURT_RD && buurtReady ? 'buurt' : 'wijk';
}

/**
 * Nederland plan for a tier. `readyGemeente` = GM code whose drill layer (of
 * this tier's level) is drawn with values, else null. draw = coloured levels:
 * { level, except } colours all of that level but `except`, { level, only }
 * just one gemeente's areas.
 */
export function nlPlan(tier, { readyGemeente = null, isScore = true } = {}) {
  let draw;
  if (tier === 'buurt' || tier === 'wijk') {
    draw = readyGemeente
      ? [{ level: 'gemeente', except: readyGemeente }, { level: tier, only: readyGemeente }]
      : [{ level: 'gemeente', except: null }];
  } else if (tier === 'municipality') draw = [{ level: 'gemeente', except: null }];
  else draw = [{ level: 'provincie', except: null }];
  return { tier, draw, labels: isScore ? draw.map(d => d.level) : [] };
}

/**
 * Full plan for (zoom, scope, dataset readiness):
 *   scope 'nederland': nlPlan(nlTier(zoom), { readyGemeente, isScore })
 *   scope 'rotterdam': one level, cityLevel(zoom, { buurtReady })
 */
export function zoomPlan(zoom, scope, { isScore = true, readyGemeente = null, buurtReady = true } = {}) {
  if (scope === 'rotterdam') {
    const level = cityLevel(zoom, { buurtReady });
    return { tier: level, draw: [{ level, except: null }], labels: isScore ? [level] : [] };
  }
  return nlPlan(nlTier(zoom), { readyGemeente, isScore });
}

/** True when stamps of `level` may show at `zoom`. Unknown levels never show. */
export function labelsVisibleAt(level, zoom) {
  const min = LABEL_MIN_ZOOM[level];
  return isNum(min) && isNum(zoom) && zoom >= min;
}
