const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const aggregator = require('./lib/aggregator');
const axios = require('axios');
const NodeCache = require('node-cache');
const hlsproxy = require('./lib/hlsproxy');

const TMDB_KEY = process.env.TMDB_API_KEY || 'b9896a58cdbfa6752a420e406877d1a5';
const PORT = process.env.PORT || 7000;
const TMDB_BASE = 'https://api.themoviedb.org/3';

// URL pública donde queda expuesto este addon en Railway (o donde sea). Se usa
// para armar las URLs del proxy de HLS que le entregamos al reproductor.
// En Railway, seteá esta variable con la URL que te da el proyecto, ej:
// https://tuapp.up.railway.app
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
aggregator.setPublicUrl(PUBLIC_URL);

// cache corta para no golpear TMDB en cada scroll/click del usuario
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

async function tmdbGet(path, params) {
  const key = path + JSON.stringify(params || {});
  const hit = cache.get(key);
  if (hit) return hit;
  const { data } = await axios.get(TMDB_BASE + path, {
    params: Object.assign({ api_key: TMDB_KEY, language: 'es-MX' }, params),
    timeout: 10000
  });
  cache.set(key, data);
  return data;
}

// géneros de película estándar de TMDB (es-MX)
const GENRES = [
  { id: 28, name: 'Acción' }, { id: 12, name: 'Aventura' }, { id: 16, name: 'Animación' },
  { id: 35, name: 'Comedia' }, { id: 80, name: 'Crimen' }, { id: 99, name: 'Documental' },
  { id: 18, name: 'Drama' }, { id: 10751, name: 'Familia' }, { id: 14, name: 'Fantasía' },
  { id: 36, name: 'Historia' }, { id: 27, name: 'Terror' }, { id: 10402, name: 'Música' },
  { id: 9648, name: 'Misterio' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Ciencia ficción' },
  { id: 53, name: 'Suspense' }, { id: 10752, name: 'Bélica' }, { id: 37, name: 'Western' }
];
const GENRE_BY_NAME = GENRES.reduce((m, g) => (m[g.name] = g.id, m), {});

const manifest = {
  id: 'com.bflix.stremio',
  version: '1.1.0',
  name: 'BFlix',
  description: 'Addon no oficial que agrega Cinecalidad, GNULA, Poseidon HD, PelisGo y Refugio (contenido en español), con catálogo TMDB.',
  logo: 'https://i.imgur.com/6Fjnyzl.png',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  catalogs: [
    { type: 'movie', id: 'bflix-popular', name: 'BFlix - Populares', extra: [{ name: 'skip' }] },
    { type: 'movie', id: 'bflix-top', name: 'BFlix - Mejor valoradas', extra: [{ name: 'skip' }] },
    {
      type: 'movie', id: 'bflix-genre', name: 'BFlix - Por género',
      extra: [{ name: 'genre', options: GENRES.map((g) => g.name), isRequired: true }, { name: 'skip' }]
    },
    { type: 'movie', id: 'bflix-search', name: 'BFlix - Buscar', extra: [{ name: 'search', isRequired: true }] }
  ],
  idPrefixes: ['tt', 'bflix:']
};

const builder = new addonBuilder(manifest);

// ---------- helpers TMDB / IMDb ----------

async function tmdbFind(imdbId) {
  const data = await tmdbGet(`/find/${imdbId}`, { external_source: 'imdb_id' });
  return (data.movie_results && data.movie_results[0]) || null;
}

function tmdbToMeta(m) {
  // m.imdb_id ya viene con el prefijo "tt" cuando existe
  const id = m.imdb_id ? m.imdb_id : 'bflix:' + m.id;
  return {
    id,
    type: 'movie',
    name: m.title || m.name,
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : undefined,
    background: m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : undefined,
    description: m.overview,
    releaseInfo: (m.release_date || '').substring(0, 4),
    imdbRating: m.vote_average ? String(Math.round(m.vote_average * 10) / 10) : undefined,
    genres: (m.genres || []).map((g) => g.name)
  };
}

function toCatalogMeta(m) {
  return {
    id: 'bflix:' + m.id, // se resuelve a imdb (si existe) en /meta
    type: 'movie',
    name: m.title,
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : undefined,
    releaseInfo: (m.release_date || '').substring(0, 4)
  };
}

// ---------- CATALOG ----------

builder.defineCatalogHandler(async ({ id, extra }) => {
  try {
    const page = extra && extra.skip ? Math.floor(Number(extra.skip) / 20) + 1 : 1;
    let data;

    if (id === 'bflix-search' && extra && extra.search) {
      data = await tmdbGet('/search/movie', { query: extra.search, page });
    } else if (id === 'bflix-top') {
      data = await tmdbGet('/movie/top_rated', { page });
    } else if (id === 'bflix-genre' && extra && extra.genre) {
      const genreId = GENRE_BY_NAME[extra.genre];
      if (!genreId) return { metas: [] };
      data = await tmdbGet('/discover/movie', { with_genres: genreId, sort_by: 'popularity.desc', page });
    } else {
      data = await tmdbGet('/movie/popular', { page });
    }

    const metas = (data.results || []).filter((m) => m.poster_path).map(toCatalogMeta);
    return { metas };
  } catch (e) {
    console.error('catalog error', e.message);
    return { metas: [] };
  }
});

// ---------- META ----------

builder.defineMetaHandler(async ({ id }) => {
  try {
    let m;
    if (id.startsWith('bflix:')) {
      const tmdbId = id.split(':')[1];
      const data = await tmdbGet(`/movie/${tmdbId}`, { append_to_response: 'external_ids' });
      m = data;
      m.imdb_id = data.external_ids && data.external_ids.imdb_id;
    } else if (id.startsWith('tt')) {
      m = await tmdbFind(id);
      if (m) {
        // /find no trae "genres" con nombre completo ni todos los campos; completar con /movie/:id
        const full = await tmdbGet(`/movie/${m.id}`, {});
        m = Object.assign(full, { imdb_id: id });
      }
    } else {
      return { meta: null };
    }
    if (!m) return { meta: null };
    return { meta: tmdbToMeta(m) };
  } catch (e) {
    console.error('meta error', e.message);
    return { meta: null };
  }
});

// ---------- STREAM ----------

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== 'movie') return { streams: [] };
  try {
    let title, year;
    if (id.startsWith('tt')) {
      const m = await tmdbFind(id);
      if (!m) return { streams: [] };
      title = m.title;
      year = (m.release_date || '').substring(0, 4);
    } else if (id.startsWith('bflix:')) {
      const tmdbId = id.split(':')[1];
      const data = await tmdbGet(`/movie/${tmdbId}`, {});
      title = data.title;
      year = (data.release_date || '').substring(0, 4);
    } else {
      return { streams: [] };
    }

    const results = await aggregator.getStreams(title, year);

    const streams = results.map((r) => {
      if (r.type === 'torrent' && r.infoHash) {
        return { name: r.name, title: r.title, infoHash: r.infoHash };
      }
      // embed resuelto o sin resolver: se ofrece como link externo/reproducible
      return { name: r.name, title: r.title + (r.resolved ? '' : ' (enlace externo)'), url: r.url };
    }).filter((s) => s.infoHash || s.url);

    return { streams };
  } catch (e) {
    console.error('stream error', e.message);
    return { streams: [] };
  }
});

const app = express();

// Rutas del proxy HLS: el reproductor de Stremio pide el m3u8/segmentos a
// TRAVÉS de nosotros (mismo IP/headers que negociaron el m3u8 real).
app.get('/hlsproxy/playlist/:token/*', (req, res) => hlsproxy.handleHlsPlaylistProxy(PUBLIC_URL, req, res));
app.get('/hlsproxy/segment/:token/*', hlsproxy.handleHlsSegmentProxy);

app.use(getRouter(builder.getInterface()));

app.listen(PORT, () => {
  console.log(`BFlix Stremio addon escuchando en el puerto ${PORT}`);
  console.log(`PUBLIC_URL usada para el proxy de HLS: ${PUBLIC_URL}`);
});

async function shutdown() {
  const SW = require('./lib/resolvers/streamwish');
  await SW.closeBrowser();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

