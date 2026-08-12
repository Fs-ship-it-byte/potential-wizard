// Agrega resultados de las 7 fuentes portadas (Cinecalidad, GNULA, Poseidon2HD,
// PelisGo, Refugio, + resolvers Earnvids/Embed69) y los normaliza al formato
// de "stream" que espera el SDK de Stremio.

const CC = require('./sources/cinecalidad');
const GN = require('./sources/gnula');
const PS = require('./sources/poseidon');
const PG = require('./sources/pelisgo');
const RF = require('./sources/refugio');
const EV = require('./sources/earnvids');
const E69 = require('./sources/embed69');
const httpShim = require('./http');

// ---------- utilidades de coincidencia de título ----------

function normTitle(t) {
  return (t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bestMatch(candidates, title, year, getTitle, getYear) {
  const nt = normTitle(title);
  let best = null, bestScore = -1;
  for (const c of candidates) {
    const ct = normTitle(getTitle(c));
    if (!ct) continue;
    let score = 0;
    if (ct === nt) score += 10;
    else if (ct.indexOf(nt) !== -1 || nt.indexOf(ct) !== -1) score += 5;
    else continue;
    const cy = getYear ? getYear(c) : null;
    if (year && cy && String(cy) === String(year)) score += 3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function safe(promise, label) {
  return promise.catch((err) => {
    console.error(`[${label}] error:`, err.message || err);
    return null;
  });
}

// ---------- extracción de infoHash de un magnet ----------

function magnetToInfoHash(magnet) {
  const m = /urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/.exec(magnet || '');
  return m ? m[1].toLowerCase() : null;
}

// ---------- por fuente ----------

async function fromCinecalidad(title, year) {
  const results = await safe(CC.searchCinecalidad(title), 'cinecalidad');
  if (!results || !results.length) return [];
  const match = bestMatch(results, title, year, (r) => r.titulo, (r) => r.year);
  if (!match) return [];
  const html = await safe(CC.fetchCcPage(match.url), 'cinecalidad-page');
  if (!html) return [];

  const streams = [];
  const players = CC.parseCcPlayerOptions(html) || [];
  for (const p of players) {
    streams.push({ name: 'Cinecalidad', title: p.name || 'Servidor', url: p.url, type: 'embed' });
  }
  const torrents = await safe(CC.parseCcTorrentLinks(html), 'cinecalidad-torrents');
  for (const t of (torrents || [])) {
    const infoHash = magnetToInfoHash(t.magnet);
    if (infoHash) streams.push({ name: 'Cinecalidad', title: t.label || 'Torrent', infoHash, type: 'torrent' });
  }
  return streams;
}

async function fromGnula(title, year) {
  const results = await safe(GN.searchGnula(title), 'gnula');
  if (!results || !results.length) return [];
  const match = bestMatch(results, title, year, (r) => r.title || r.titulo || '', (r) => r.year);
  if (!match) return [];
  const data = await safe(GN.fetchGnulaLifeMovie(match.url), 'gnula-detail');
  if (!data || !data.servers) return [];
  return data.servers.map((s) => ({
    name: 'GNULA', title: s.label || 'Servidor', url: s.url, type: 'embed'
  }));
}

async function fromPelisGo(title, year) {
  const results = await safe(PG.searchPelisGo(title), 'pelisgo');
  if (!results || !results.length) return [];
  const match = bestMatch(results, title, year, (r) => r.titulo || r.title || '', (r) => r.year);
  if (!match) return [];
  const htmlRes = await safe(httpShim.request(match.url, { headers: {}, compression: true, noFail: true }), 'pelisgo-page');
  const html = htmlRes ? htmlRes.toString() : null;
  if (!html) return [];
  const data = PG.parsePelisGoHtml(html);
  const streams = [];
  if (data.streamUrl) streams.push({ name: 'PelisGo', title: 'Servidor', url: data.streamUrl, type: 'embed' });
  if (data.pixeldrainUrl) streams.push({ name: 'PelisGo', title: 'Pixeldrain', url: data.pixeldrainUrl, type: 'embed' });
  if (data.okruUrl) streams.push({ name: 'PelisGo', title: 'OK.ru', url: data.okruUrl, type: 'embed' });
  return streams;
}

async function fromRefugio(title, year) {
  const results = await safe(RF.searchRefugio(title), 'refugio');
  if (!results || !results.length) return [];
  const match = bestMatch(results, title, year, (r) => r.titulo || r.title || '', (r) => r.year);
  if (!match) return [];
  const html = await safe(RF.fetchRfPage(match.url), 'refugio-page');
  if (!html) return [];
  const data = RF.parseRfDetail(html);
  if (!data || !data.embedUrls) return [];
  return data.embedUrls.map((e) => ({
    name: 'Refugio', title: e.label || e.host || 'Servidor', url: e.url, type: 'embed'
  }));
}

async function fromPoseidon(title, year) {
  const results = await safe(PS.searchPoseidon2hd(title), 'poseidon');
  if (!results || !results.length) return [];
  const match = bestMatch(results, title, year, (r) => r.titulo || r.title || '', (r) => r.year);
  if (!match) return [];
  const data = await safe(PS.fetchPoseidonHD2Streams(match.url), 'poseidon-streams');
  if (!data || !data.streams) return [];
  return data.streams.map((s) => ({
    name: 'Poseidon HD', title: s.label || 'Servidor', url: s.playerUrl, type: 'embed'
  }));
}

// ---------- resolución de embeds a link directo cuando se pueda ----------

async function resolveEmbedToDirect(stream) {
  const url = stream.url;
  try {
    if (/vidhide|streamwish|filemoon|wishfast|embedwish/i.test(url)) {
      const hls = await safe(EV.extractHlsUrl(url), 'earnvids-resolve');
      if (hls) return { ...stream, url: hls, resolved: true };
    }
  } catch (e) { /* sigue como embed sin resolver */ }
  return stream;
}

// ---------- API principal ----------

async function getStreams(title, year) {
  const [cc, gn, pg, rf, ps] = await Promise.all([
    fromCinecalidad(title, year),
    fromGnula(title, year),
    fromPelisGo(title, year),
    fromRefugio(title, year),
    fromPoseidon(title, year)
  ]);

  let all = [...cc, ...gn, ...pg, ...rf, ...ps];

  // Intenta resolver embeds conocidos a link directo (best-effort, no bloqueante)
  all = await Promise.all(all.map((s) => (s.type === 'embed' ? resolveEmbedToDirect(s) : s)));

  return all;
}

module.exports = { getStreams, magnetToInfoHash };
