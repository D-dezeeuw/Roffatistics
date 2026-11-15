// Live integration tests — these hit the real CBS OData API over the network.
// Purpose: verify that CBS data is reachable, that the response column names
// match what the code expects, and that a full data → normalize → formatPanelData
// pipeline produces non-dash values (i.e. real data would appear in the sidebar).
//
// Run with: node --test tests/integration.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCBS, normalizeProvinces, normalizeCrime, CBS_SELECT, CBS_COLUMNS } from '../modules/datasets.js';
import { formatPanelData } from '../modules/panel.js';
import { WIJK_COLUMNS, WIJK_SELECT, WIJK_TABLE, extractAreaValues, normalizeAreaCode } from '../modules/areas.js';
// Filters copied from app.js; the demographics select and column map come from modules/datasets.js
const CBS_FILTER   = "startswith(RegioS,'PV') and Perioden eq '2023JJ00'";
const CRIME_FILTER = "startswith(RegioS,'PV') and Perioden eq '2023JJ00' and (SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000')";
const CRIME_SELECT = 'RegioS,SoortMisdrijf,TotaalGeregistreerdeMisdrijven_1,GeregistreerdeMisdrijvenPer1000Inw_3';
const GM_FILTER    = "startswith(RegioS,'GM') and Perioden eq '2023JJ00'";

// ── Province demographics ─────────────────────────────────────────────────────

describe('CBS API — province demographics', { timeout: 15000 }, () => {
  it('API responds with province rows', async () => {
    const rows = await fetchCBS('70072ned', CBS_FILTER, CBS_SELECT);
    assert.ok(rows.length > 0, 'expected province rows from CBS — API may be down');
  });

  it('response contains all expected column names', async () => {
    const rows = await fetchCBS('70072ned', CBS_FILTER, CBS_SELECT);
    const r    = rows[0];
    const expected = Object.values(CBS_COLUMNS);
    for (const col of expected) {
      assert.ok(col in r, `CBS response missing column: ${col} — normalizeProvinces will produce nulls`);
    }
  });

  it('all province rows have non-null population after normalization', async () => {
    const raw  = await fetchCBS('70072ned', CBS_FILTER, CBS_SELECT);
    const rows = normalizeProvinces(raw);
    assert.ok(rows.length > 0, 'normalizeProvinces returned empty array');
    assert.ok(
      rows.every(r => r.population != null),
      'some provinces have null population — panel will show "—" for Bevolking',
    );
  });

  it('formatPanelData produces non-dash population and density for a province', async () => {
    const raw  = await fetchCBS('70072ned', CBS_FILTER, CBS_SELECT);
    const rows = normalizeProvinces(raw);
    const fmt  = formatPanelData(rows[0]);
    assert.notEqual(fmt.population, '—', `population is "—" — CBS data not reaching panel formatter`);
    assert.notEqual(fmt.density,    '—', `density is "—"`);
  });
});

// ── Province crime ─────────────────────────────────────────────────────────────

describe('CBS API — province crime', { timeout: 15000 }, () => {
  it('API responds with crime rows', async () => {
    const rows = await fetchCBS('83648NED', CRIME_FILTER, CRIME_SELECT);
    assert.ok(rows.length > 0, 'expected crime rows from CBS — API or table may be unavailable');
  });

  it('response contains all expected crime column names', async () => {
    const rows = await fetchCBS('83648NED', CRIME_FILTER, CRIME_SELECT);
    const r    = rows[0];
    const expected = ['RegioS', 'SoortMisdrijf', 'TotaalGeregistreerdeMisdrijven_1', 'GeregistreerdeMisdrijvenPer1000Inw_3'];
    for (const col of expected) {
      assert.ok(col in r, `CBS crime response missing column: ${col} — normalizeCrime will produce nulls`);
    }
  });

  it('merged province data produces non-dash crimeRate and totalCrimes', async () => {
    const [raw, crimeRaw] = await Promise.all([
      fetchCBS('70072ned', CBS_FILTER, CBS_SELECT),
      fetchCBS('83648NED', CRIME_FILTER, CRIME_SELECT),
    ]);
    const crimeLookup = Object.fromEntries(normalizeCrime(crimeRaw).map(r => [r.regionCode, r]));
    const rows = normalizeProvinces(raw).map(r => ({ ...r, ...crimeLookup[r.regionCode] }));
    const withCrime = rows.find(r => r.crimeRate != null);
    assert.ok(withCrime, 'no province with crimeRate after merge — regionCode mismatch between datasets?');
    const fmt = formatPanelData(withCrime);
    assert.notEqual(fmt.crimeRate,   '—', 'crimeRate is "—" after crime merge');
    assert.notEqual(fmt.totalCrimes, '—', 'totalCrimes is "—" after crime merge');
    assert.notEqual(fmt.catVermogen, '—', 'catVermogen is "—" after crime merge');
  });
});

// ── Municipality demographics (sample) ───────────────────────────────────────

describe('CBS API — municipality demographics (sample of 5)', { timeout: 20000 }, () => {
  it('API responds with municipality rows', async () => {
    const rows = await fetchCBS('70072ned', GM_FILTER, CBS_SELECT, undefined, undefined, 5);
    assert.ok(rows.length > 0, 'expected municipality rows from CBS');
    assert.ok(
      rows[0].RegioS.trim().startsWith('GM'),
      `expected GM prefix, got: ${rows[0].RegioS.trim()} — filter may be wrong`,
    );
  });

  it('normalized municipality rows have non-null population', async () => {
    const raw  = await fetchCBS('70072ned', GM_FILTER, CBS_SELECT, undefined, undefined, 5);
    const rows = normalizeProvinces(raw);
    assert.ok(
      rows.some(r => r.population != null),
      'all municipalities have null population in sample — column name may have changed',
    );
  });

  it('formatPanelData produces non-dash population for a municipality', async () => {
    const raw     = await fetchCBS('70072ned', GM_FILTER, CBS_SELECT, undefined, undefined, 5);
    const rows    = normalizeProvinces(raw);
    const withPop = rows.find(r => r.population != null);
    assert.ok(withPop, 'no municipality with population in sample');
    const fmt = formatPanelData(withPop);
    assert.notEqual(fmt.population, '—', 'municipality population is "—" — data is not reaching the sidebar');
  });
});

// ── Rotterdam wijken (Kerncijfers wijken en buurten) ─────────────────────────

describe('CBS API — Rotterdam wijken', { timeout: 15000 }, () => {
  it(`${WIJK_TABLE} returns all mapped columns for WK0599 wijken`, async () => {
    const rows = await fetchCBS(WIJK_TABLE, "startswith(WijkenEnBuurten,'WK0599')", WIJK_SELECT);
    assert.ok(rows.length >= 20, `expected ~21 Rotterdam wijken, got ${rows.length}`);
    for (const col of Object.values(WIJK_COLUMNS)) assert.ok(col in rows[0], `missing column ${col}`);
    const centrum = rows.find(r => normalizeAreaCode(r.WijkenEnBuurten) === 'WK059901');
    const v = extractAreaValues(centrum);
    assert.ok(v.population > 10000, 'Rotterdam Centrum population');
    assert.ok(v.avgIncome > 10 && v.wozValue > 100 && v.highEdu > 0, 'income, WOZ and education filled');
  });
});
