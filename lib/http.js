// Shim que imita la API de "movian/http" del plugin original, pero usando axios.
// Así los scrapers portados (que llaman http.request(url, opts).toString())
// funcionan casi sin tocarlos.

const axios = require('axios');

const DEFAULT_TIMEOUT = 15000;

/**
 * request(url, options)
 * options soportadas (igual que Movian): headers, compression, noFail, caching, cacheTime, method, postdata
 * Devuelve un objeto con .toString() -> body como string (igual que Movian).
 */
function request(url, options) {
  options = options || {};
  const headers = Object.assign({}, options.headers || {});

  if (options.compression) {
    headers['Accept-Encoding'] = headers['Accept-Encoding'] || 'gzip, deflate';
  }

  const axiosConfig = {
    url,
    method: options.method || (options.postdata ? 'POST' : 'GET'),
    headers,
    timeout: options.timeout || DEFAULT_TIMEOUT,
    responseType: 'arraybuffer',
    validateStatus: () => true, // nunca tirar excepción por status; lo maneja el llamador
    maxRedirects: 10
  };

  if (options.postdata) {
    axiosConfig.data = options.postdata;
  }

  // Movian es síncrono; aquí lo hacemos síncrono "de facto" para el llamador
  // devolviendo una promesa que se debe await-ear. Los scrapers portados usan
  // funciones async wrapper (ver sources/*.js) en vez del estilo síncrono original.
  return axios(axiosConfig).then((res) => {
    const buf = Buffer.from(res.data);
    return {
      statuscode: res.status,
      toString: () => buf.toString('utf8'),
      buffer: buf
    };
  }).catch((err) => {
    if (options.noFail) {
      return { statuscode: 0, toString: () => '', buffer: Buffer.alloc(0) };
    }
    throw err;
  });
}

module.exports = { request };
