// Agrega resultados de las 7 fuentes portadas (Cinecalidad, GNULA, Poseidon2HD,
// PelisGo, Refugio, + resolvers Earnvids/Embed69) y los normaliza al formato
// de "stream" que espera el SDK de Stremio.

const CC = require('./sources/cinecalidad');
const GN = require('./sources/gnula');
// Poseidon HD se dio de baja como proveedor (pedido explícito, para aliviar
// la carga -- era la fuente que más servidores redundantes aportaba y la
// que peor sobrevivía a la cola de concurrencia). El módulo lib/sources/poseidon.js
// queda en el repo por si se quiere reactivar más adelante, pero ya no se
// importa ni se llama desde acá.
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

// Prueba la búsqueda con cada título de `titles` en orden (normalmente:
// título localizado primero, título original de TMDB como respaldo) hasta
// encontrar un match. Esto es lo que mejora la detección quan el sitio
// indexa el contenido con el nombre en otro idioma que el que da TMDB en
// es-MX (típico en series: "La Casa del Dragón" vs "House of the Dragon").
async function searchBestMatch(searchFn, label, titles, year, getTitle, getYear, filterFn) {
  const tried = new Set();
  for (const t of titles) {
    if (!t || tried.has(t)) continue;
    tried.add(t);
    const results = await safe(searchFn(t), label);
    if (!results || !results.length) continue;
    const candidates = filterFn ? filterFn(results) : results;
    const match = bestMatch(candidates.length ? candidates : results, t, year, getTitle, getYear);
    if (match) return match;
  }
  return null;
}

// Arma la lista de títulos a probar: el localizado primero, el original
// como respaldo (si es distinto).
function titleVariants(title, originalTitle) {
  const list = [title];
  if (originalTitle && originalTitle !== title) list.push(originalTitle);
  return list;
}

// ---------- extracción de infoHash de un magnet ----------

function magnetToInfoHash(magnet) {
  const m = /urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/.exec(magnet || '');
  return m ? m[1].toLowerCase() : null;
}

// ---------- por fuente ----------

async function fromCinecalidad(title, year, originalTitle) {
  const titles = titleVariants(title, originalTitle);
  const match = await searchBestMatch(CC.searchCinecalidad, 'cinecalidad', titles, year, (r) => r.titulo, (r) => r.year);
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

async function fromGnula(title, year, originalTitle) {
  const titles = titleVariants(title, originalTitle);
  const match = await searchBestMatch(GN.searchGnula, 'gnula', titles, year, (r) => r.title || r.titulo || '', (r) => r.year);
  if (!match) return [];
  const data = await safe(GN.fetchGnulaLifeMovie(match.url), 'gnula-detail');
  if (!data || !data.servers) return [];
  return data.servers.map((s) => ({
    name: 'GNULA', title: s.label || 'Servidor', url: s.url, type: 'embed', hostHint: s.locker || null
  }));
}

async function fromPelisGo(title, year, originalTitle) {
  const titles = titleVariants(title, originalTitle);
  const match = await searchBestMatch(PG.searchPelisGo, 'pelisgo', titles, year, (r) => r.titulo || r.title || '', (r) => r.year);
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

async function fromRefugio(title, year, originalTitle) {
  const titles = titleVariants(title, originalTitle);
  const match = await searchBestMatch(RF.searchRefugio, 'refugio', titles, year, (r) => r.titulo || r.title || '', (r) => r.year);
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

// ---------- fuentes: SERIES (temporada/episodio) ----------

async function gnulaEpisode(title, year, season, episode, originalTitle) {
  const titles = titleVariants(title, originalTitle);
  const match = await searchBestMatch(
    GN.searchGnula, 'gnula-series-search', titles, year,
    (r) => r.titulo || r.title || '', (r) => r.year,
    (results) => results.filter((r) => /\/series\//i.test(r.url))
  );
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

// ---------- resolución de embeds a link directo cuando se pueda ----------

async function cinecalidadEpisode(title, year, season, episode, originalTitle) {
  const titles = titleVariants(title, originalTitle);
  const match = await searchBestMatch(
    CC.searchCinecalidad, 'cinecalidad-series-search', titles, year,
    (r) => r.titulo, (r) => r.year,
    (results) => results.filter((r) => CC.isCinecalidadSeriesUrl(r.url))
  );
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
// resolver. Los que necesitan Puppeteer (streamwish/VOE/DoodStream/Vimeos)
// hacen una cadena real de varios pasos -- click, esperar unos segundos,
// redirect, esperar OTRO redirect automático, click de nuevo -- que
// legítimamente puede tardar más de 10s. Ese fue el valor que puse la vez
// pasada y terminó cortando resoluciones que sí iban a funcionar (por eso
// "todos externos" de golpe). Lo subo a algo realista para esa cadena.
const RESOLVE_TIMEOUT_MS = 25000;

// Además del timeout, limitamos cuántas resoluciones por NAVEGADOR corren en
// simultáneo. Antes lanzábamos TODOS los embeds de una película/episodio a
// la vez con Promise.all -- si había 5-6 servidores que necesitaban
// Puppeteer al mismo tiempo, todos competían por la misma CPU/memoria del
// contenedor de Railway (que no es infinita) y terminaban tardando MÁS que
// si corrieran de a poco, aumentando las chances de que varios pisaran el
// timeout juntos. Con un límite de concurrencia, cada uno tiene más recursos
// reales disponibles y termina más rápido.
const MAX_CONCURRENT_BROWSER_RESOLVES = 2;

// Techo de seguridad para TODO el paso de resolución en conjunto (no por
// servidor individual) -- ver uso en getStreams/getEpisodeStreams.
// Antes, si este plazo se cumplía, se perdía TODO (ver el fix de arriba en
// mapWithConcurrencyLimit) -- por eso lo tenía corto (28s) para minimizar el
// daño. Ahora que un corte a mitad de camino conserva lo que ya resolvió,
// podemos darle más margen real a contenidos con varios servidores lentos.
const GLOBAL_RESOLVE_DEADLINE_MS = 45000;

// Con la prueba gratuita de Railway (512MB-1GB compartidos), subir la
// concurrencia de Puppeteer es riesgoso -- cada pestaña de Chromium come
// 150-300MB, y ya vimos títulos con 28 servidores en total (GNULA+Poseidon+
// Cinecalidad+Refugio). A concurrencia 2, eso son 14 rondas -- a ~5s cada
// una (lo que muestran los traces reales), son ~70s, muy por encima del
// techo global, y los últimos de la cola nunca llegan a intentarlo siquiera.
// En vez de repartir el presupuesto entre TODOS (la mayoría se queda sin
// turno igual), lo concentramos en un grupo más chico -- como ya vienen
// intercalados por fuente, ese grupo sigue teniendo variedad de las 4.
// El resto queda como enlace externo directamente, sin gastar tiempo/memoria
// en un intento que de todos modos no iba a tener chance real.
const MAX_STREAMS_TO_RESOLVE = 10;

function withTimeout(promise, ms, fallbackValue) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Corre `fn` sobre cada item de `items`, pero nunca más de `limit` a la vez.
// Si se pasa `deadlineMs`, cuando se cumple el plazo se devuelve el array TAL
// COMO ESTÁ en ese momento -- los que ya terminaron quedan con su valor
// resuelto, los que no llegaron a tiempo quedan con su valor ORIGINAL (nunca
// undefined). Esto es clave: antes usábamos Promise.race por fuera, y
// cuando el timeout ganaba se descartaba TODO el resultado (incluso los que
// ya habían resuelto bien) y se devolvía la lista completa sin resolver de
// vuelta -- por eso "todos absolutamente todos como externos" de golpe en
// vez de solo los lentos.
async function mapWithConcurrencyLimit(items, limit, fn, deadlineMs) {
  const results = items.slice(); // pre-llenado con los originales: si el plazo corta a mitad de camino, los que no llegaron quedan con esto (no undefined)
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const allDone = Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  if (deadlineMs) {
    await Promise.race([allDone, new Promise((resolve) => setTimeout(resolve, deadlineMs))]);
  } else {
    await allDone;
  }
  // `results` ya tiene lo que haya podido terminar -- sea que allDone ganó la
  // carrera (todo resuelto) o que el deadline la cortó (parcial + originales).
  return results;
}

// Envuelve mapWithConcurrencyLimit aplicando el tope MAX_STREAMS_TO_RESOLVE:
// solo los primeros N streams de tipo 'embed' (en el orden ya intercalado
// por fuente) se mandan a resolver de verdad. El resto pasa de largo sin
// costo (ni tiempo ni memoria) y queda tal cual llegó -- como enlace
// externo. Los torrents no cuentan para el tope porque ya vienen resueltos
// (no necesitan Puppeteer).
async function resolveStreamsWithBudget(all) {
  let embedCount = 0;
  const withinBudget = all.map((s) => {
    if (s.type !== 'embed') return true;
    embedCount++;
    return embedCount <= MAX_STREAMS_TO_RESOLVE;
  });

  return mapWithConcurrencyLimit(
    all,
    MAX_CONCURRENT_BROWSER_RESOLVES,
    (s, i) => (withinBudget[i] && s.type === 'embed' ? resolveEmbedToDirect(s) : s),
    GLOBAL_RESOLVE_DEADLINE_MS
  );
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

// Intercala listas de distintas fuentes (una de cada, por turno) en vez de
// concatenarlas en bloque. Importante para la fase de resolución: con
// concurrencia limitada, los workers toman los items en orden de array -- si
// concatenáramos [...cinecalidad, ...gnula, ..., ...poseidon], Poseidon
// (al ir último) quedaría esperando turno detrás de TODOS los servidores de
// las demás fuentes, y para cuando le toca podría no quedar presupuesto de
// tiempo. Intercalando, cada fuente entra a la cola desde el principio.
function interleave(arrays) {
  const out = [];
  const max = Math.max(0, ...arrays.map((a) => a.length));
  for (let i = 0; i < max; i++) {
    for (const arr of arrays) {
      if (i < arr.length) out.push(arr[i]);
    }
  }
  return out;
}

// ---------- API principal ----------

async function getStreams(title, year, originalTitle) {
  const [cc, gn, pg, rf] = await Promise.all([
    fromCinecalidad(title, year, originalTitle),
    fromGnula(title, year, originalTitle),
    fromPelisGo(title, year, originalTitle),
    fromRefugio(title, year, originalTitle)
  ]);

  let all = interleave([gn, cc, pg, rf]);
  all = await resolveStreamsWithBudget(all);
  return all;
}

// title/year: de la SERIE (no del episodio). season/episode: números.
// Cubre GNULA y Cinecalidad (Poseidon dado de baja; PelisGo/Refugio solo
// tienen metadata de temporadas, no un fetcher de episodio individual).
async function getEpisodeStreams(title, year, season, episode, originalTitle) {
  const [gn, cc] = await Promise.all([
    gnulaEpisode(title, year, season, episode, originalTitle),
    cinecalidadEpisode(title, year, season, episode, originalTitle)
  ]);

  let all = interleave([gn, cc]);
  all = await resolveStreamsWithBudget(all);
  return all;
}

module.exports = { getStreams, getEpisodeStreams, magnetToInfoHash, setPublicUrl };
