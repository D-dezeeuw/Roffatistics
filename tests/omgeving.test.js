// Omgeving (modules/omgeving.js, W8, 15 Nov 2026): shared-boundary neighbours,
// "criminaliteit in de omgeving", non-residential areas that still show their
// own figures and still count for their neighbours, but never get a Woonscore.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  adjacencyFromFeatures, encodeNeighbours, decodeNeighbours, crimePerKm2, addOmgeving,
  omgevingDetail, omgevingText, crimeNoRateNote, neighbourPhrase, DOMINANT_SHARE,
} from '../modules/omgeving.js';
import { decodeLevel, encodeLevel } from '../modules/nl-areas.js';
import { scoreWithPreset, STANDAARD, NEARBY_W, resolvePreset } from '../modules/presets.js';
import { buildAreaDetail } from '../modules/area-detail.js';
import { areaModalHtml } from '../modules/area-modal.js';
import { extractAreaValues, WIJK_COLUMNS } from '../modules/areas.js';
import { answersToPreset, encodeAnswers, decodeAnswers, CRIMES } from '../modules/wizard-model.js';
import { DATASETS } from '../modules/datasets.js';

// Unit squares on a grid: (col,row) → polygon with corners (c,r)…(c+1,r+1).
const sq = (code, c, r) => ({ properties: { statcode: code }, geometry: { type: 'Polygon', coordinates: [[[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1], [c, r]]] } });

describe('adjacencyFromFeatures', () => {
  it('shared edges make neighbours; a corner touch does not', () => {
    // A B
    // C D   and E touches D only at a corner
    const adj = adjacencyFromFeatures([sq('A', 0, 1), sq('B', 1, 1), sq('C', 0, 0), sq('D', 1, 0), sq('E', 2, -1)]);
    assert.deepEqual(adj.get('A'), ['B', 'C']);
    assert.deepEqual(adj.get('D'), ['B', 'C']);
    assert.deepEqual(adj.get('E'), []);
  });
  it('MultiPolygon parts and rounding (float noise) are handled', () => {
    const multi = { properties: { statcode: 'M' }, geometry: { type: 'MultiPolygon', coordinates: [sq('', 5, 5).geometry.coordinates, [[[1.0000001, 0], [2, 0], [2, 1], [1.0000001, 1], [1.0000001, 0]]]] } };
    const adj = adjacencyFromFeatures([sq('A', 0, 0), multi], { decimals: 5 });
    assert.deepEqual(adj.get('A'), ['M']);
    assert.deepEqual(adjacencyFromFeatures([sq('A', 0, 0), multi]).get('A'), []);
  });
  it('encode/decode keeps every pair, both directions', () => {
    const adj = adjacencyFromFeatures([sq('A', 0, 1), sq('B', 1, 1), sq('C', 0, 0), sq('D', 1, 0)]);
    const codes = ['A', 'B', 'C', 'D'];
    const text = encodeNeighbours(codes, adj);
    assert.equal(text, '1,1;2;1;');
    assert.deepEqual(decodeNeighbours(codes, text), adj);
    assert.deepEqual(decodeNeighbours(['X', 'Y'], ''), new Map([['X', []], ['Y', []]]));
  });
  it('Rotterdam geometry: Stadsdriehoek borders Cool, every buurt has a neighbour', async () => {
    const geo = JSON.parse(await readFile(new URL('../data/rotterdam_buurten.geojson', import.meta.url), 'utf8'));
    const adj = adjacencyFromFeatures(geo.features, { decimals: 5 });
    assert.ok(adj.get('BU05990110').includes('BU05990112'), 'Stadsdriehoek – Cool');
    const lonely = [...adj].filter(([, n]) => !n.length).map(([c]) => c);
    assert.ok(lonely.length <= 2, `buurten without neighbours: ${lonely}`);
    for (const [c, ns] of adj) for (const n of ns) assert.ok(adj.get(n).includes(c), 'symmetric');
  });
});

// A small town: a residential buurt W1 next to a port (P, 5 inwoners, many
// crimes), W2 next to a park (K, nobody, 2 crimes); W1 and W2 do not touch.
const area = (code, name, values) => ({ code, name, level: 'buurt', parent: 'WK00000001', values: { housingStock: 1000, nonResidentialStock: 50, businesses: 60, ...values } });
const town = () => [
  area('BU00000001', 'Havenkant', { population: 3000, totalCrimes: 150, landArea: 1, crimeRate: 50, avgIncome: 30 }),
  area('BU00000002', 'Parkzijde', { population: 3000, totalCrimes: 150, landArea: 1, crimeRate: 50, avgIncome: 30 }),
  area('BU00000003', 'Haven', { population: 5, housingStock: 2, nonResidentialStock: 400, businesses: 300, totalCrimes: 900, landArea: 2, crimeRate: null }),
  area('BU00000004', 'Stadspark', { population: 0, housingStock: 0, nonResidentialStock: 3, businesses: 0, totalCrimes: 2, landArea: 2, crimeRate: null }),
  area('BU00000005', 'Midden', { population: 4000, totalCrimes: 120, landArea: 1, crimeRate: 30, avgIncome: 35 }),
];
const townAdj = new Map([
  ['BU00000001', ['BU00000003', 'BU00000005']], ['BU00000002', ['BU00000004', 'BU00000005']],
  ['BU00000003', ['BU00000001']], ['BU00000004', ['BU00000002']], ['BU00000005', ['BU00000001', 'BU00000002']],
]);

describe('addOmgeving: criminaliteit in de omgeving', () => {
  const list = addOmgeving(town(), townAdj);
  const by = c => list.find(a => a.code === c);
  it('crime per km² and the pooled omgeving', () => {
    assert.equal(crimePerKm2(150, 1), 150);
    assert.equal(crimePerKm2(5, 0), null);
    assert.equal(by('BU00000001').values.crimeDensity, 150);
    // (150 + 900 + 120) / (1 + 2 + 1) = 292.5
    assert.equal(by('BU00000001').values.crimeNearby, 292.5);
    // (150 + 2 + 120) / (1 + 2 + 1) = 68
    assert.equal(by('BU00000002').values.crimeNearby, 68);
    assert.deepEqual(by('BU00000001').neighbours, ['BU00000003', 'BU00000005']);
  });
  it('a buurt next to the port gets a worse omgeving score than one next to the park', () => {
    const { results } = scoreWithPreset(list, STANDAARD);
    const r = c => results.find(x => x.code === c);
    const near = c => r(c).factors.find(f => f.key === 'crimeNearby');
    assert.ok(near('BU00000001').f < near('BU00000002').f);
    assert.ok(r('BU00000001').score < r('BU00000002').score, 'same own figures, worse surroundings');
  });
  it('non-residential areas count for their neighbours but get no Woonscore', () => {
    const { results } = scoreWithPreset(list, STANDAARD);
    for (const c of ['BU00000003', 'BU00000004']) {
      const res = results.find(x => x.code === c);
      assert.equal(res.score, null);
      assert.ok(res.nonResidential);
    }
    assert.ok(by('BU00000003').values.crimeNearby > 0, 'the port has its own omgeving value for the map');
  });
  it('no adjacency: no omgeving (not the own density under another name)', () => {
    const solo = addOmgeving(town(), null);
    assert.equal(solo[0].values.crimeNearby, null);
    assert.equal(solo[0].values.crimeDensity, 150);
  });
  it('the dominant neighbour is named', () => {
    const d = omgevingDetail(by('BU00000001'), list);
    assert.equal(d.dominant.code, 'BU00000003');
    assert.ok(d.dominant.share >= DOMINANT_SHARE);
    const t = omgevingText(d, { name: 'Havenkant' });
    assert.match(t.text, /293 misdrijven per km² land in Havenkant en de 2 aangrenzende buurten samen \(1\.170 misdrijven op 4,00 km²\); in Havenkant zelf 150 per km²/);
    assert.match(t.why, /o\.a\. door het naastgelegen bedrijven-\/havengebied Haven \(900 misdrijven, 77% van het totaal\)/);
    assert.equal(omgevingDetail(by('BU00000002'), list).dominant, null, 'the park pulls nothing up');
    assert.equal(neighbourPhrase(by('BU00000005')), 'de naastgelegen buurt');
  });
});

describe('Standaard and the wizard use the omgeving', () => {
  it('Standaard Veiligheid has crimeNearby (lower) at a modest weight', () => {
    const vt = STANDAARD.themes.find(t => t.key === 'veiligheid');
    const m = vt.metrics.find(x => x.key === 'crimeNearby');
    assert.equal(m.pref, 'lower');
    assert.equal(m.w, NEARBY_W);
    const f = resolvePreset(STANDAARD, new Set(['crimeRate', 'crimeBurglary', 'crimeViolence', 'crimeStreetRobbery', 'crimeVandalism', 'crimeNearby', 'avgIncome']));
    const near = f.find(x => x.key === 'crimeNearby'), own = f.find(x => x.key === 'crimeRate');
    assert.ok(near.weight <= own.weight && near.weight > 0);
    assert.equal(DATASETS.crimeNearby.higherIsBetter, false);
  });
  it('the safety step can stress it, and the hash keeps the chip', () => {
    assert.equal(CRIMES.omgeving.key, 'crimeNearby');
    const p = answersToPreset({ veiligheid: ['omgeving'] });
    const m = p.themes.find(t => t.key === 'veiligheid').metrics.find(x => x.key === 'crimeNearby');
    assert.equal(m.w, 3);
    const plain = answersToPreset({}).themes.find(t => t.key === 'veiligheid').metrics.find(x => x.key === 'crimeNearby');
    assert.equal(plain.w ?? 1, NEARBY_W, 'Standaard weight kept in the draft');
    assert.deepEqual(decodeAnswers(encodeAnswers({ veiligheid: ['inbraak', 'omgeving'] })).veiligheid, ['inbraak', 'omgeving']);
  });
});

describe('non-residential areas keep their own figures', () => {
  const list = addOmgeving(town(), townAdj);
  const areas = { wijken: [], buurten: list };
  it('the modal shows count, per km² and the omgeving for the port, with the reason', () => {
    const d = buildAreaDetail(list[2], areas);
    assert.equal(d.woongebied.residential, false);
    assert.equal(d.woonscore, null);
    assert.equal(d.overall, null);
    const keys = d.entries.map(e => e.key);
    assert.ok(keys.includes('crimeDensity') && keys.includes('crimeNearby'));
    assert.ok(!keys.includes('crimeRate'), 'no per-1.000 rate with 5 inwoners');
    assert.match(d.crimeNote, /^900 misdrijven in 2025 \(450 per km² land\)\. Geen cijfer per 1\.000 inwoners: met 5 inwoners/);
    assert.equal(d.areaKm2, 2);
    const abs = buildAreaDetail(list[2], areas, { mode: 'abs' });
    assert.equal(abs.entries.find(e => e.key === 'crimeRate').value, 900);
    const html = areaModalHtml(d, { peers: 'nederland' });
    assert.match(html, /Misdrijven 2025/);
    assert.match(html, /Criminaliteit in de omgeving/);
    assert.match(html, /Krijgt geen Woonscore/);
  });
  it('a residential buurt with a rate gets no crime note, but its omgeving and the dominant neighbour', () => {
    const d = buildAreaDetail(list[0], areas);
    assert.equal(d.crimeNote, null);
    assert.match(d.omgeving.why, /Haven/);
    assert.match(areaModalHtml(d, { peers: 'nederland' }), /bedrijven-\/havengebied Haven/);
    assert.equal(crimeNoRateNote({ totalCrimes: 3, crimeRate: 1 }), null);
  });
});

describe('land area and the NL neighbour lists', () => {
  it('OppervlakteLand (ha) is read as km²', () => {
    assert.equal(WIJK_COLUMNS.landArea, 'OppervlakteLand_116');
    assert.equal(extractAreaValues({ OppervlakteLand_116: 413 }).landArea, 4.13);
  });
  it('encodeLevel stores nb, never the derived values; decodeLevel rebuilds them', () => {
    const data = encodeLevel(town(), { level: 'buurt', neighbours: townAdj });
    assert.equal(typeof data.nb, 'string');
    assert.ok(data.cols.landArea && !data.cols.crimeNearby && !data.cols.crimeDensity);
    const back = decodeLevel(data);
    assert.equal(back[0].values.crimeNearby, 292.5);
  });
  for (const file of ['wijken', 'buurten']) {
    it(`data/nl/${file}-2025.json: nearly every area has neighbours and an omgeving value`, async () => {
      const data = JSON.parse(await readFile(new URL(`../data/nl/${file}-2025.json`, import.meta.url), 'utf8'));
      const list = decodeLevel(data);
      assert.ok(list.filter(a => !a.neighbours.length).length <= 10);
      assert.ok(list.filter(a => a.values.crimeNearby != null).length >= list.length * 0.99);
      const by = new Map(list.map(a => [a.code, a]));
      if (file === 'buurten') {
        // Waalhaven (port) borders Oud Charlois and Heijplaat, and Schiedam's Wilhelminahaven across the gemeente border.
        const w = by.get('BU05992194');
        for (const c of ['BU05991574', 'BU05991593', 'BU06060202']) assert.ok(w.neighbours.includes(c), c);
      }
    });
  }
});
