// Proxy de HLS (playlist + segmentos). Portado del addon viejo de PoseidonHD2.
//
// Por qué existe: el master.m3u8 de hosts tipo hgplaycdn/hglamioz lleva un
// token atado a la IP y a los headers (Referer/Origin/UA) que lo "negociaron".
// Si le damos esa URL cruda al reproductor de Stremio, la petición sale desde
// OTRA IP y el CDN la rechaza aunque los headers estén bien puestos.
// Solución: este servidor reproxea TODO (m3u8 y cada segmento .ts) siempre con
// la misma IP/headers, y el reproductor solo habla con nosotros.

const axios = require('axios');
const { URL } = require('url');

function encodeProxyToken(url, headers) {
  return Buffer.from(JSON.stringify({ url, headers: headers || {} }), 'utf8').toString('base64url');
}

function decodeProxyToken(token) {
  try {
    return JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
}

function buildProxyPlaylistUrl(publicUrl, targetUrl, headers) {
  const token = encodeProxyToken(targetUrl, headers);
  return `${publicUrl}/hlsproxy/playlist/${token}/master.m3u8`;
}

// Para archivos que NO son un playlist HLS (ej. un .mp4 directo de VOE):
// no hay nada que reescribir, así que lo servimos por la ruta de "segmento"
// (passthrough puro, mismo IP/headers) en vez de la de "playlist".
function buildProxyDirectUrl(publicUrl, targetUrl, headers) {
  const token = encodeProxyToken(targetUrl, headers);
  return `${publicUrl}/hlsproxy/segment/${token}/file.mp4`;
}

function makeAbsolute(url, base) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  if (url.indexOf('/') === 0) {
    try {
      return new URL(base).origin + url;
    } catch (e) {
      return base + url;
    }
  }
  return base + '/' + url;
}

function isM3u8Path(uri) {
  const withoutQuery = uri.split('?')[0];
  return /\.m3u8$/i.test(withoutQuery);
}

// Reescribe un playlist .m3u8: cada línea de URI (sub-playlist o segmento) pasa
// a apuntar a nuestro propio proxy, conservando los headers originales.
//
// Para las líneas CON atributo URI="..." (I-FRAME-STREAM-INF, y también
// EXT-X-MEDIA de audio/subtítulos -- este último es justo el caso que se
// rompía: una pista de audio separada también es un sub-.m3u8, no un
// segmento, y hay que reescribir SU contenido también, no solo pasarlo
// crudo) decidimos "sub-playlist vs segmento" mirando si la URI referenciada
// termina en .m3u8 -- no de qué tag viene.
//
// Para la línea "pelada" que sigue a #EXT-X-STREAM-INF (video, sin atributo
// URI=), no podemos mirar la extensión (algunos sitios la disfrazan como
// .txt), así que ahí seguimos confiando en la etiqueta que la precede.
function rewriteM3u8(publicUrl, playlistText, baseUrl, headers) {
  const lines = playlistText.split(/\r?\n/);
  let nextIsPlaylist = false;

  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      const upper = trimmed.toUpperCase();

      if (/URI="([^"]+)"/i.test(trimmed)) {
        const rewritten = line.replace(/URI="([^"]+)"/i, (m, uri) => {
          const abs = makeAbsolute(uri, baseUrl.replace(/\/[^/]*$/, ''));
          const token = encodeProxyToken(abs, headers);
          const kind = isM3u8Path(uri) ? 'playlist' : 'segment';
          const filename = kind === 'playlist' ? 'sub.m3u8' : 'seg';
          return `URI="${publicUrl}/hlsproxy/${kind}/${token}/${filename}"`;
        });
        if (upper.startsWith('#EXT-X-STREAM-INF')) nextIsPlaylist = true;
        return rewritten;
      }

      if (upper.startsWith('#EXT-X-STREAM-INF')) nextIsPlaylist = true;
      return line;
    }

    // Línea de URI "pelada" (sin #): sub-playlist si la precedió STREAM-INF,
    // si no, segmento.
    const abs = makeAbsolute(trimmed, baseUrl.replace(/\/[^/]*$/, ''));
    const token = encodeProxyToken(abs, headers);
    const kind = nextIsPlaylist ? 'playlist' : 'segment';
    nextIsPlaylist = false;
    return `${publicUrl}/hlsproxy/${kind}/${token}/${kind === 'playlist' ? 'sub.m3u8' : 'seg'}`;
  });

  return out.join('\n');
}

async function handleHlsPlaylistProxy(publicUrl, req, res) {
  const data = decodeProxyToken(req.params.token);
  if (!data) return res.status(400).send('Token inválido');

  try {
    const upstream = await axios.get(data.url, {
      headers: data.headers,
      timeout: 15000,
      responseType: 'text',
      transformResponse: [(d) => d]
    });
    const rewritten = rewriteM3u8(publicUrl, upstream.data, data.url, data.headers);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(rewritten);
  } catch (e) {
    res.status(502).send('No se pudo obtener el playlist');
  }
}

async function handleHlsSegmentProxy(req, res) {
  const data = decodeProxyToken(req.params.token);
  if (!data) return res.status(400).send('Token inválido');

  try {
    const upstream = await axios.get(data.url, {
      headers: data.headers,
      timeout: 20000,
      responseType: 'stream'
    });
    res.set('Access-Control-Allow-Origin', '*');
    if (upstream.headers['content-type']) res.set('Content-Type', upstream.headers['content-type']);
    upstream.data.pipe(res);
  } catch (e) {
    res.status(502).send('No se pudo obtener el segmento');
  }
}

module.exports = {
  encodeProxyToken,
  decodeProxyToken,
  buildProxyPlaylistUrl,
  buildProxyDirectUrl,
  handleHlsPlaylistProxy,
  handleHlsSegmentProxy
};
