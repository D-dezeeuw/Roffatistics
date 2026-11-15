// Shared categories (15 Nov 2026): Layers dropdown and Ranglijst pickers use
// one definition (datasets.js DATASET_GROUPS); retired herkomst layer ids redirect.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DATASETS, DATASET_KEYS, DATASET_GROUPS, LAYER_CATEGORIES, LAYER_KEYS, RETIRED_LAYERS, resolveLayerKey,
  groupDatasets, categoryOf, categoryDatasets, categoryHeadline, rankKeyForCategory, datasetInScope,
} from '../modules/datasets.js';
import { NEDERLAND_REGION, LAYER_REGIONS, REGIONS, decodeRegio, regionSharesOf, nederlandShareOf, onbekendShareOf } from '../modules/herkomst-regio.js';
import { sanitizePatch, parseHash } from '../modules/state.js';
import { parseShareHash } from '../modules/share-link.js';

describe('categories', () => {
  it('every sortable (layer) metric belongs to exactly one category', () => {
    for (const k of LAYER_KEYS) {
      const owners = LAYER_CATEGORIES.filter(c => categoryDatasets(c.key).some(d => d.key === k));
      assert.equal(owners.length, 1, k);
      assert.equal(categoryOf(k), owners[0].key, k);
    }
    assert.equal(new Set(LAYER_KEYS).size, LAYER_KEYS.length);
  });
  it('layer list and Ranglijst read the same categories', () => {
    assert.deepEqual(groupDatasets().map(g => g.key), LAYER_CATEGORIES.map(c => c.key));
    assert.deepEqual(groupDatasets().flatMap(g => g.datasets.map(d => d.key)), [...LAYER_KEYS]);
    const list = readFileSync(new URL('../modules/list.js', import.meta.url), 'utf8');
    assert.match(list, /LAYER_CATEGORIES/);
    assert.match(list, /class="list-cat-select"/);
    assert.match(list, /<label class="list-rank-field">Categorie/);
    assert.match(list, /<label class="list-rank-field">Onderdeel/);
  });
  it('every layer category has a headline that is one of its own layers', () => {
    for (const c of LAYER_CATEGORIES) {
      assert.ok(c.headline, c.key);
      assert.equal(categoryOf(c.headline), c.key, c.key);
    }
  });
  it('falls back to the headline when no Onderdeel is chosen', () => {
    assert.equal(rankKeyForCategory('criminaliteit', null, 'rotterdam'), 'crimeRate');
    assert.equal(rankKeyForCategory('score'), 'woonscore');
    assert.equal(rankKeyForCategory('herkomst', null, 'nederland'), 'originDutchPct');
    assert.equal(rankKeyForCategory('criminaliteit', 'crimeBike', 'rotterdam'), 'crimeBike');
    assert.equal(rankKeyForCategory('criminaliteit', 'avgIncome', 'rotterdam'), 'crimeRate', 'a metric of another category is ignored');
    assert.equal(rankKeyForCategory('criminaliteit', 'crimeBike', 'nederland'), 'crimeRate', 'not in scope');
    assert.equal(rankKeyForCategory('overall', 'crimeBike'), 'overall');
    assert.equal(categoryHeadline('voorzieningen', 'nederland'), null, 'no layers there');
    assert.equal(categoryHeadline('nope'), null);
  });
  it('the crime category is in the layer list for both scopes', () => {
    const crime = groupDatasets().find(g => g.key === 'criminaliteit');
    assert.equal(crime.label, 'Criminaliteit');
    assert.equal(crime.datasets[0].key, 'crimeRate');
    assert.equal(crime.datasets[0].label, 'Misdrijven totaal');
    for (const scope of ['rotterdam', 'nederland']) assert.ok(categoryDatasets('criminaliteit', scope).length >= 1, scope);
    assert.ok(categoryDatasets('criminaliteit', 'rotterdam').length > 10, 'sub-categories per wijk/buurt');
    assert.ok(['crimeBurglary', 'crimeViolence', 'crimeStreetRobbery', 'crimeBike', 'crimeVandalism', 'crimeDensity', 'crimeNearby'].every(k => categoryOf(k) === 'criminaliteit'));
  });
  it('wide layer dropdown: columns on the unbounded inner list, never on the height-limited dropdown', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /\.layers-dropdown\s*\{[^}]*columns:/);
    assert.match(css, /\.layers-cols > ul\s*\{[^}]*columns:\s*2/);
    assert.doesNotMatch(css, /\.layers-dropdown\.open\s*\{[^}]*display:\s*grid/);
  });
});

describe('retired herkomst layers', () => {
  const hidden = DATASET_GROUPS.filter(g => g.layer === false).map(g => g.key);
  const hiddenKeys = DATASET_KEYS.filter(k => hidden.includes(DATASETS[k].group));
  it('are no layers but keep their data', () => {
    assert.ok(hiddenKeys.includes('originEuropePct') && hiddenKeys.includes('hk_marokko'));
    for (const k of hiddenKeys) assert.ok(!LAYER_KEYS.includes(k) && DATASETS[k], k);
  });
  it('every retired id redirects to a layer with data in the same scope', () => {
    for (const k of hiddenKeys) {
      const to = RETIRED_LAYERS[k];
      assert.ok(LAYER_KEYS.includes(to), `${k} → ${to}`);
      for (const sc of ['rotterdam', 'nederland']) if (datasetInScope(k, sc)) assert.ok(datasetInScope(to, sc), `${k} → ${to} in ${sc}`);
    }
    assert.equal(resolveLayerKey('crimeRate'), 'crimeRate');
  });
  it('old deep links and share links open the successor', () => {
    assert.equal(sanitizePatch({ dataset: 'hk_marokko' }).dataset, 'hr_noordAfrika');
    assert.equal(sanitizePatch({ dataset: 'originEuropePct' }).dataset, 'hr_westEuropa');
    assert.equal(sanitizePatch({ dataset: 'jouwscore' }).dataset, 'woonscore');
    assert.equal(parseHash('#scope=rotterdam&dataset=hk_suriname').dataset, 'hr_zuidAmerika');
    const d = parseShareHash('#view=list&rank=nonWesternPct&sort=hk_turkije.desc');
    assert.equal(d.list.rankKey, 'hr_zuidAmerika');
    assert.deepEqual(d.list.sort, { column: 'hr_westAzie', dir: 'desc' });
    const e = parseShareHash('#view=list&rank=crimeRate&sort=rank.asc');
    assert.equal(e.list.rankKey, 'crimeRate');
    assert.deepEqual(e.list.sort, { column: 'rank', dir: 'asc' });
  });
});

describe('Nederland in Herkomst per regio', () => {
  it('is the first Herkomst layer at every level', () => {
    assert.equal(LAYER_REGIONS[0], NEDERLAND_REGION);
    assert.equal(NEDERLAND_REGION.metric, 'originDutchPct');
    assert.ok(!REGIONS.some(r => r.key === 'nederland'), 'REGIONS stay the migration partition');
    assert.equal(categoryDatasets('herkomst')[0].key, 'originDutchPct');
    assert.equal(DATASETS.originDutchPct.label, 'Nederland (%)');
    assert.ok(datasetInScope('originDutchPct', 'rotterdam') && datasetInScope('originDutchPct', 'nederland'));
    for (const r of LAYER_REGIONS) assert.equal(categoryOf(r.metric), 'herkomst', r.key);
  });
  it('sums with the other regions and Onbekend to ~100% per gemeente', () => {
    const file = readFileSync(new URL('../data/nl/herkomst-regio-gemeente-2026.json', import.meta.url), 'utf8');
    const data = decodeRegio(JSON.parse(file));
    let checked = 0;
    for (const entry of data.values()) {
      const nl = nederlandShareOf(entry), unk = onbekendShareOf(entry);
      const regions = Object.values(regionSharesOf(entry));
      if (nl == null || unk == null || regions.some(v => v == null)) continue;
      const sum = nl + unk + regions.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 100) <= 1.5, `${entry.name}: ${sum}`);
      checked++;
    }
    assert.ok(checked > 300, `gemeenten checked: ${checked}`);
  });
});
