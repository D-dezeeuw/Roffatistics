// Minimal GeoTIFF reader for the RIVM WCS tiles (plan-milieu phase 2): one
// image, uncompressed, strips or tiles (GeoServer writes tiles), 32-bit float, either byte order. The georeference
// comes from ModelTransformation (34264) or ModelPixelScale (33550) + ModelTiepoint
// (33922); GDAL_NODATA (42113) gives the nodata value. Anything else throws, so a
// WCS error page (XML) or an unexpected encoding never passes as data.
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };

/** Buffer → { width, height, data: Float32Array (row-major, top row first), ox, oy, sx, sy, nodata }. */
export function readFloatTiff(buf) {
  const order = buf.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') throw new Error(`geotiff: not a TIFF (${JSON.stringify(buf.toString('latin1', 0, 40))})`);
  const le = order === 'II';
  const u16 = o => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = o => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = o => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error('geotiff: BigTIFF or bad magic');
  const ifd = u32(4), n = u16(ifd), tags = new Map();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
    const size = (TYPE_SIZE[type] ?? 1) * cnt, off = size <= 4 ? e + 8 : u32(e + 8);
    const vals = [];
    if (type === 2) vals.push(buf.toString('latin1', off, off + cnt).replace(/\0+$/, ''));
    else for (let k = 0; k < cnt; k++) vals.push(type === 3 ? u16(off + 2 * k) : type === 4 ? u32(off + 4 * k) : type === 12 ? f64(off + 8 * k) : buf[off + k]);
    tags.set(tag, vals);
  }
  const one = t => tags.get(t)?.[0];
  const width = one(256), height = one(257);
  if (one(259) !== 1) throw new Error(`geotiff: compression ${one(259)} not supported`);
  if (one(258) !== 32 || (one(339) ?? 1) !== 3 || (one(277) ?? 1) !== 1) throw new Error('geotiff: only single-band float32');
  const data = new Float32Array(width * height);
  const rd = o => (le ? buf.readFloatLE(o) : buf.readFloatBE(o));
  if (tags.has(322)) {
    // Tiles of tw × th pixels, row by row; edge tiles are padded to the full size.
    const tw = one(322), th = one(323), offsets = tags.get(324), across = Math.ceil(width / tw);
    if (offsets.length !== across * Math.ceil(height / th)) throw new Error('geotiff: tile count');
    offsets.forEach((o, t) => {
      const c0 = (t % across) * tw, r0 = Math.floor(t / across) * th;
      for (let r = 0; r < th && r0 + r < height; r++) for (let c = 0; c < tw && c0 + c < width; c++) data[(r0 + r) * width + c0 + c] = rd(o + 4 * (r * tw + c));
    });
  } else {
    const offsets = tags.get(273), counts = tags.get(279);
    let px = 0;
    offsets.forEach((o, s) => { for (let b = 0; b < counts[s] && px < data.length; b += 4) data[px++] = rd(o + b); });
    if (px !== data.length) throw new Error(`geotiff: ${px} of ${data.length} pixels`);
  }
  let ox, oy, sx, sy;
  const mt = tags.get(34264);
  if (mt) [sx, , , ox, , sy, , oy] = mt;
  else {
    const sc = tags.get(33550), tp = tags.get(33922);
    if (!sc || !tp) throw new Error('geotiff: no georeference');
    [sx, sy] = [sc[0], -sc[1]];
    [ox, oy] = [tp[3] - tp[0] * sx, tp[4] - tp[1] * sy];
  }
  const nd = one(42113);
  return { width, height, data, ox, oy, sx, sy, nodata: nd == null || nd === '' ? null : Number(nd) };
}
