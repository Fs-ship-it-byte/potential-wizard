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
const SW = require('./resolvers/streamwish');

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
    name: 'GNULA', title: s.label || 'Servidor', url: s.url, type: 'embed', hostHint: s.locker || null
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
  // OJO: RF.fetchRfPage() es para páginas de LISTADO (categoría/paginado),
  // devuelve {items,nextUrl}, no el HTML de una ficha. Para la página de
  // detalle de una película/serie hay que pedir el HTML crudo con rfGet().
  const html = await safe(RF.rfGet(match.url), 'refugio-page');
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

// ---------- fuentes: SERIES (temporada/episodio) ----------

async function gnulaEpisode(title, year, season, episode) {
  const results = await safe(GN.searchGnula(title), 'gnula-series-search');
  if (!results || !results.length) return [];
  const seriesResults = results.filter((r) => /\/series\//i.test(r.url));
  const match = bestMatch(seriesResults.length ? seriesResults : results, title, year, (r) => r.titulo || r.title || '', (r) => r.year);
  if (!match) return [];

  const slug = GN.gnlSeriesSlugFromUrl ? GN.gnlSeriesSlugFromUrl(match.url) : null;
  // gnlSeriesSlugFromUrl no está exportado en todas las versiones; si falta,
  // lo derivamos a mano del propio url (mismo patrón que usa el módulo).
  const seriesSlug = slug || (match.url.match(/\/series\/([^\/?#]+)/i) || [])[1];
  if (!seriesSlug) return [];

  const episodeUrl = GN.gnlEpisodeUrl(seriesSlug, season, episode);
  const data = await safe(GN.fetchGnulaLifeEpisode(episodeUrl), 'gnula-episode');
  if (!data || !data.servers) return [];
  return data.servers.map((s) => ({
    name: 'GNULA', title: s.label || 'Servidor', url: s.url, type: 'embed', hostHint: s.locker || null
  }));
}

async function poseidonEpisode(title, year, season, episode) {
  const results = await safe(PS.searchPoseidon2hdSeries(title), 'poseidon-series-search');
  if (!results || !results.length) return [];
  const match = bestMatch(results, title, year, (r) => r.title || r.titulo || '', (r) => r.year);
  if (!match || !match.tmdbId || !match.slug) return [];

  const data = await safe(PS.fetchPoseidonHD2Episode(match.tmdbId, match.slug, season, episode), 'poseidon-episode');
  if (!data || !data.streams) return [];
  return data.streams.map((s) => ({
    name: 'Poseidon HD', title: s.label || 'Servidor', url: s.playerUrl, type: 'embed'
  }));
}

// ---------- resolución de embeds a link directo cuando se pueda ----------

async function cinecalidadEpisode(title, year, season, episode) {
  const results = await safe(CC.searchCinecalidad(title), 'cinecalidad-series-search');
  if (!results || !results.length) return [];
  const seriesResults = results.filter((r) => CC.isCinecalidadSeriesUrl(r.url));
  const match = bestMatch(seriesResults.length ? seriesResults : results, title, year, (r) => r.titulo, (r) => r.year);
  if (!match) return [];

  const seriesHtml = await safe(CC.fetchCcPage(match.url), 'cinecalidad-series-page');
  if (!seriesHtml) return [];
  const episodes = CC.parseCcSeriesEpisodes(seriesHtml) || [];
  const ep = episodes.find((e) => e.season === Number(season) && e.episode === Number(episode));
  if (!ep) return [];

  const epHtml = await safe(CC.fetchCcPage(ep.url), 'cinecalidad-episode-page');
  if (!epHtml) return [];

  const streams = [];
  const players = CC.parseCcPlayerOptions(epHtml) || [];
  for (const p of players) {
    streams.push({ name: 'Cinecalidad', title: p.name || 'Servidor', url: p.url, type: 'embed' });
  }
  const torrents = await safe(CC.parseCcTorrentLinks(epHtml), 'cinecalidad-episode-torrents');
  for (const t of (torrents || [])) {
    const infoHash = magnetToInfoHash(t.magnet);
    if (infoHash) streams.push({ name: 'Cinecalidad', title: t.label || 'Torrent', infoHash, type: 'torrent' });
  }
  return streams;
}

// PUBLIC_URL se inyecta desde addon.js/env para armar los links del proxy HLS.
let PUBLIC_URL = process.env.PUBLIC_URL || 'http://127.0.0.1:7000';
function setPublicUrl(url) { PUBLIC_URL = url.replace(/\/+$/, ''); }

// Stremio tiene su propio límite de espera para la respuesta de un addon: si
// tarda demasiado, el cliente la descarta ENTERA (por eso "se queda cargando
// y se quita solo") -- aunque varios servidores ya hubieran terminado de
// resolver. Los que necesitan Puppeteer pueden tardar hasta 35s cada uno, y
// esperábamos a TODOS con Promise.all antes de responder. Ahora cada
// resolución individual tiene un tope propio: si no terminó a tiempo, esa
// entrada se entrega tal cual llegó (como enlace externo) en vez de trabar
// la respuesta completa por un solo servidor lento.
const RESOLVE_TIMEOUT_MS = 10000;

function withTimeout(promise, ms, fallbackValue) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function resolveEmbedToDirect(stream) {
  const url = stream.url;
  const hint = stream.hostHint || null; // ej. 'voe', 'doodstream', 'streamwish' -- viene de la fuente, no del dominio final (útil cuando el sitio usa mirrors con nombre random)
  try {
    // Cubre streamwish/niramirus/filemoon/vidhide/hgplaycdn/voe/dood/vimeo/etc,
    // con la cadena completa: axios rápido -> Puppeteer -> genérico -> vidhide.
    // El hostHint (cuando la fuente nos lo da) pesa TANTO como el patrón de
    // URL -- necesario porque VOE (y otros) usan dominios espejo con nombres
    // random que no van a matchear ningún patrón de hostname.
    const knownHint = hint && /voe|dood|streamwish|vidhide|filemoon|vimeo/i.test(hint);
    if (SW.isEmbedHost(url) || SW.isVoeHost(url) || SW.isDoodHost(url) || SW.isVimeoHost(url) || knownHint || /vidhide|filelions|player\.php|player\./i.test(url)) {
      const resolved = await withTimeout(
        safe(SW.resolveToDirectHls(url, hint), 'streamwish-resolve'),
        RESOLVE_TIMEOUT_MS,
        null
      );
      if (resolved && resolved.url) {
        const hlsproxy = require('./hlsproxy');
        const proxied = resolved.isMp4
          ? hlsproxy.buildProxyDirectUrl(PUBLIC_URL, resolved.url, resolved.headers)
          : hlsproxy.buildProxyPlaylistUrl(PUBLIC_URL, resolved.url, resolved.headers);
        return { ...stream, url: proxied, resolved: true };
      }
    }
    // Earnvids como resolver alterno para hosts que no cayeron arriba
    if (/vidhide|streamwish|filemoon|wishfast|embedwish/i.test(url)) {
      const hls = await withTimeout(safe(EV.extractHlsUrl(url), 'earnvids-resolve'), RESOLVE_TIMEOUT_MS, null);
      if (hls) {
        const hlsproxy = require('./hlsproxy');
        const proxied = hlsproxy.buildProxyPlaylistUrl(PUBLIC_URL, hls, {});
        return { ...stream, url: proxied, resolved: true };
      }
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

// title/year: de la SERIE (no del episodio). season/episode: números.
// Cubre GNULA, Poseidon HD y Cinecalidad. PelisGo/Refugio solo tienen
// metadata de temporadas, no un fetcher de episodio individual — quedan
// pendientes.
async function getEpisodeStreams(title, year, season, episode) {
  const [gn, ps, cc] = await Promise.all([
    gnulaEpisode(title, year, season, episode),
    poseidonEpisode(title, year, season, episode),
    cinecalidadEpisode(title, year, season, episode)
  ]);

  let all = [...gn, ...ps, ...cc];
  all = await Promise.all(all.map((s) => (s.type === 'embed' ? resolveEmbedToDirect(s) : s)));
  return all;
}

module.exports = { getStreams, getEpisodeStreams, magnetToInfoHash, setPublicUrl };
