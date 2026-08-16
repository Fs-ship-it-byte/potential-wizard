// Resuelve embeds de la familia Streamwish (streamwish, niramirus, embedwish,
// filemoon, vidhide, hgplaycdn...) y VidHide/filelions a un .m3u8 directo.
// Portado del addon viejo de PoseidonHD2, que ya lo tenía funcionando contra
// GNULA y Poseidon.
//
// Estrategia en 2 pasos:
//  1) Rápido (axios, sin navegador): sirve cuando el sitio redirige con un
//     window.location simple o ya trae el m3u8 en el HTML plano / bloques
//     eval(p,a,c,k,e,d) empacados.
//  2) Puppeteer (navegador headless real): necesario cuando el salto de
//     dominio y la carga del m3u8 solo ocurren ejecutando el JS real del
//     sitio (fetch/XHR internos). Interceptamos la red y capturamos la
//     petición al .m3u8 cuando el propio player la dispara.

const axios = require('axios');
const { URL } = require('url');

const PS_UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

const EMBED_HOSTS = [
  'streamwish', 'niramirus', 'filemoon', 'embedwish', 'vidhide',
  'vidhideplus', 'wishfast', 'strwish', 'awish', 'flaswish',
  'swdyu', 'embedrise', 'kerapoxy', 'smoothpre', 'fsdcmo',
  'loadpre', 'doodstream', 'voe.sx', 'voe.', 'voeun', 'moon.watch',
  'vidmoly', 'vudeo', 'mp4upload', 'vtube.to', 'upstream',
  'hgplaycdn', 'medixiru',
  // DoodStream tiene un montón de dominios espejo, todos con el mismo patrón
  'dood.', 'doodstream', 'dooood', 'ds2play', 'doods.', 'dood.re', 'dood.wf',
  'dood.pm', 'dood.cx', 'dood.la', 'dood.ws', 'dood.sh', 'dood.watch', 'dood.to',
  'd0000d', 'dooodster',
  // Vimeo real (embed público o "privado" con hash de dominio) y "vimeos.net"
  // -- que a pesar del nombre parecido es un host DISTINTO, propio de
  // Cinecalidad, que además pide contraseña antes de mostrar el menú.
  'vimeo.com', 'player.vimeo', 'vimeos.net'
];

function isVoeHost(url) {
  return /voe\.(sx|to|com|dev)|voeun/i.test(url || '');
}

function isDoodHost(url) {
  return /d(?:o+)d(?:stream)?\.|ds2play|d0000d|dooodster/i.test(url || '');
}

function isVimeoHost(url) {
  return /vimeo\.com|vimeos\.net/i.test(url || '');
}

// Hosts que sabemos que NO se pueden resolver con axios (necesitan JS del
// navegador sí o sí: countdown, mouse-move, botón skip, etc) -- nos saltamos
// directo el intento rápido para no perder tiempo.
function needsBrowserOnly(url) {
  return isVoeHost(url) || isDoodHost(url) || isVimeoHost(url);
}

function isEmbedHost(url) {
  for (let i = 0; i < EMBED_HOSTS.length; i++) {
    if (url.indexOf(EMBED_HOSTS[i]) !== -1) return true;
  }
  return false;
}

function patchDtoE(url) {
  return url.replace(/\/d\/([A-Za-z0-9]+)(\?|$|#)/, '/e/$1$2').replace(/\/d\/([A-Za-z0-9]+)$/, '/e/$1');
}

function unpackJsVh(p, a, c, k) {
  while (c--) {
    if (k[c]) p = p.replace(new RegExp('\\b' + c.toString(a) + '\\b', 'g'), k[c]);
  }
  return p;
}

function makeAbsoluteVh(url, base) {
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

function parseJsObjVh(str) {
  try {
    const clean = str
      .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/:\s*'([^']*)'/g, ':"$1"')
      .replace(/,\s*\}/g, '}');
    return JSON.parse(clean);
  } catch (e) {}
  return null;
}

function extractM3u8FromObjVh(obj, base) {
  if (!obj) return null;
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (v && typeof v === 'string' && v.indexOf('master.m3u8') !== -1) return makeAbsoluteVh(v, base);
  }
  for (let j = 0; j < keys.length; j++) {
    const v2 = obj[keys[j]];
    if (v2 && typeof v2 === 'string' && v2.indexOf('.m3u8') !== -1) return makeAbsoluteVh(v2, base);
  }
  for (let k = 0; k < keys.length; k++) {
    const v3 = obj[keys[k]];
    if (v3 && typeof v3 === 'string' && v3.indexOf('/hls/') !== -1) return makeAbsoluteVh(v3, base);
  }
  return null;
}

function extractHlsFromCallistanise(code, base) {
  const sourceRefM = code.match(/(?:sources?|file)\s*:\s*(?:\[?\s*\{[^}]*(?:file|src)\s*:\s*)?([a-zA-Z_$][a-zA-Z0-9_$]{0,4})\s*\.\s*([a-zA-Z0-9_]+)\s*\|\|\s*\1\s*\.\s*([a-zA-Z0-9_]+)(?:\s*\|\|\s*\1\s*\.\s*([a-zA-Z0-9_]+))?/i);
  if (sourceRefM) {
    const varName = sourceRefM[1];
    const keys = [sourceRefM[2], sourceRefM[3]];
    if (sourceRefM[4]) keys.push(sourceRefM[4]);
    const varRe = new RegExp('var\\s+' + varName.replace('$', '\\$') + '\\s*=\\s*(\\{[\\s\\S]{1,800}?\\})', 'i');
    const vm = code.match(varRe);
    if (vm) {
      const vo = parseJsObjVh(vm[1]);
      if (vo) {
        for (let ki = 0; ki < keys.length; ki++) {
          const kv = vo[keys[ki]];
          if (kv && kv.indexOf('.m3u8') !== -1) return makeAbsoluteVh(kv, base);
        }
        const fb = extractM3u8FromObjVh(vo, base);
        if (fb) return fb;
      }
    }
  }

  const anyVarM = code.match(/var\s+([a-zA-Z_$][a-zA-Z0-9_$]{0,4})\s*=\s*(\{[^{}]{10,800}\})/g);
  if (anyVarM) {
    for (let vi = 0; vi < anyVarM.length; vi++) {
      const vm2 = anyVarM[vi].match(/var\s+([a-zA-Z_$][a-zA-Z0-9_$]{0,4})\s*=\s*(\{[^{}]{10,800}\})/);
      if (!vm2) continue;
      if (vm2[2].indexOf('m3u8') === -1 && vm2[2].indexOf('/hls/') === -1) continue;
      const vo2 = parseJsObjVh(vm2[2]);
      if (!vo2) continue;
      const found = extractM3u8FromObjVh(vo2, base);
      if (found) return found;
    }
  }

  const fm = code.match(/(?:file)\s*:\s*["']([^"']+\.(?:m3u8|txt)[^"']*?)["']/i);
  if (fm) return makeAbsoluteVh(fm[1], base);
  const am = code.match(/(https?:\/\/[^"'\s\\]+\.(?:m3u8|txt)[^"'\s\\]*)/i);
  if (am) return am[1];
  return null;
}

function findMutantRedirect(html, base) {
  const patterns = [
    /window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i,
    /location\.replace\s*\(\s*['"]([^'"]+)['"]\s*\)/i,
    /<meta[^>]+http-equiv\s*=\s*['"]refresh['"][^>]+content\s*=\s*['"][^'">\s]+url=([^'">\s]+)/i,
    /<iframe[^>]+src\s*=\s*['"]([^'"]+\/(?:e|embed)\/[a-zA-Z0-9]+[^'"]*)['"]/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = html.match(patterns[i]);
    if (m && m[1]) return makeAbsoluteVh(m[1], base);
  }
  return null;
}

function unpackEvalBlocks(html) {
  const evalRegex = /eval\(\s*function\s*\(p,a,c,k,e,[rd]\)[\s\S]*?\}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\s*\.split\('\|'\)/g;
  let match;
  let unpacked = '';
  while ((match = evalRegex.exec(html)) !== null) {
    const p = match[1];
    const a = parseInt(match[2], 10);
    const c = parseInt(match[3], 10);
    const k = match[4].split('|');
    unpacked += '\n' + unpackJsVh(p, a, c, k);
  }
  return unpacked;
}

// Sigue la redirección client-side hasta el dominio "mutante" final y
// desempaqueta el player para sacar el m3u8 real, sin navegador.
async function resolveStreamwishHls(embedUrl) {
  const visited = {};
  let currentUrl = embedUrl;
  let refererOrigin = 'https://www.google.com/';

  for (let hop = 0; hop < 4; hop++) {
    if (visited[currentUrl]) break;
    visited[currentUrl] = true;

    let res;
    try {
      res = await axios.get(currentUrl, {
        headers: { ...PS_UA, Referer: refererOrigin },
        timeout: 10000
      });
    } catch (e) {
      return null;
    }

    const html = res.data;
    const finalUrl = (res.request && res.request.res && res.request.res.responseUrl) || currentUrl;
    const origin = new URL(finalUrl).origin;

    const unpacked = unpackEvalBlocks(html);
    const hls = extractHlsFromCallistanise(unpacked + '\n' + html, origin);
    if (hls) {
      return { url: hls, headers: { Referer: origin + '/', Origin: origin, 'User-Agent': PS_UA['User-Agent'] } };
    }

    const nextUrl = findMutantRedirect(html, origin);
    if (!nextUrl || nextUrl === currentUrl) return null;

    currentUrl = nextUrl;
    refererOrigin = origin + '/';
  }
  return null;
}

// ---------- Puppeteer (navegador headless real) ----------
// Necesario porque streamwish.to/e/ID no redirige por HTTP ni por un
// window.location.href simple: el cambio de dominio y la carga del .m3u8
// ocurren mediante JS ejecutado en el navegador (fetch/XHR internos, DOM
// dinámico). axios nunca lo va a "ver" porque no ejecuta JavaScript.

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch (e) { /* opcional, ver getBrowser() */ }

let _browserInstance = null;
async function getBrowser() {
  if (!puppeteer) throw new Error('puppeteer no está instalado');
  if (_browserInstance && _browserInstance.isConnected()) return _browserInstance;
  const launchOpts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  };
  // Le apuntamos directo al Chromium de apt (ver Dockerfile) en vez de dejar
  // que puppeteer intente encontrar uno "compatible" por su cuenta -- eso fue
  // justo lo que rompió ("Could not find Chrome") con la imagen bundleada.
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  _browserInstance = await puppeteer.launch(launchOpts);
  return _browserInstance;
}

async function closeBrowser() {
  if (_browserInstance) {
    try { await _browserInstance.close(); } catch (e) {}
    _browserInstance = null;
  }
}

async function resolveStreamwishHlsViaBrowser(embedUrl, timeoutMs, trace) {
  timeoutMs = timeoutMs || 35000;
  if (!puppeteer) return null;

  let browser;
  let page;
  let onTargetCreated;
  const tStart = Date.now();
  const t = (msg) => { if (trace) trace.push('[' + (Date.now() - tStart) + 'ms] ' + msg); };

  try {
    browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(PS_UA['User-Agent']);
    await page.setRequestInterception(true);
    // Evita sorpresas con un timeout interno distinto al nuestro (Puppeteer
    // usa 30000ms por defecto para varias esperas si no se lo pisamos acá) --
    // esto fue justo lo que pasó con vimeos.net: quedó esperando el password
    // y explotó a los 30000ms exactos con un timeout que no era el nuestro.
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    // Si el sitio dispara un diálogo JS (alert/confirm/prompt -- por ejemplo
    // un checkPassword() con contraseña incorrecta), lo cerramos enseguida:
    // un diálogo sin atender bloquea CUALQUIER evaluate()/click() posterior
    // y sí o sí termina colgando la página hasta el timeout.
    page.on('dialog', async (dialog) => {
      t('Diálogo JS detectado (' + dialog.type() + '): "' + dialog.message() + '" -- cerrando');
      try { await dialog.dismiss(); } catch (e) {}
    });

    let resolved = null;
    // Origen "de respaldo" SIEMPRE es el de la página embed (nunca el del
    // propio CDN de video) -- lo usamos solo si por algún motivo no logramos
    // leer el Referer real de la petición capturada.
    let pageOrigin = null;
    try { pageOrigin = new URL(embedUrl).origin; } catch (e) {}

    // Calcula el header Origin a partir del Referer REAL con el que salió la
    // petición (que es el origen legítimo que espera el CDN) -- NUNCA a
    // partir de la URL del propio video. Mandar "Origin: <mismo dominio del
    // CDN>" no tiene sentido (ningún navegador lo hace así) y varios CDNs
    // anti-hotlink lo rechazan con 403 por eso mismo.
    function originFromReferer(referer) {
      if (referer) {
        try { return new URL(referer).origin; } catch (e) {}
      }
      return pageOrigin;
    }
    let lastRefererByUrl = 'https://www.google.com/';
    let requestCount = 0;
    const seenHosts = new Set();

    onTargetCreated = async (target) => {
      try {
        if (target.opener() === page.target()) {
          t('Se abrió una pestaña nueva (popup/ad), cerrándola');
          const popup = await target.page();
          if (popup) await popup.close();
        }
      } catch (e) {}
    };
    browser.on('targetcreated', onTargetCreated);

    page.on('request', (req) => {
      const url = req.url();
      requestCount++;
      try { seenHosts.add(new URL(url).host); } catch (e) {}
      const type = req.resourceType();
      const urlLower = url.toLowerCase();

      // Bloqueo SUAVE de ads: solo cortamos anuncios/trackers puros por
      // palabra clave (no scripts del reproductor en sí, que a veces también
      // son 'script'/'xhr' y los necesitamos para que cargue el video).
      // Esto es clave para DoodStream, que muele con popunders/redirects
      // publicitarios que si no filtramos, tapan el click real al player.
      const AD_KEYWORDS = ['/ads/', 'vast', 'vpaid', 'popads', 'popcash', 'pop.', 'tracker', 'analytics', 'doubleclick', 'adservice', 'adsystem'];
      if (AD_KEYWORDS.some((kw) => urlLower.includes(kw))) {
        req.abort();
        return;
      }
      // OJO: NO abortamos 'media' — el <video> puede pedir el .m3u8 o los
      // segmentos directamente como resourceType 'media', y si lo abortamos
      // nunca vemos esa URL. Solo cortamos imágenes/fuentes.
      if (type === 'image' || type === 'font') {
        req.abort();
        return;
      }
      // 'document' excluido a propósito: si a este resolver le pasan de
      // entrada una URL que YA es un .m3u8 (ej. reusar por error un link
      // nuestro ya resuelto, o un embed que redirige directo a un .m3u8),
      // la navegación principal ("document") no cuenta como "encontrado" --
      // solo cuenta si el .m3u8 lo pide el REPRODUCTOR desde dentro de la
      // página (media/xhr/fetch/other), que es la señal real de que el link
      // fue negociado por el JS del sitio.
      if (!resolved && type !== 'document' && (/\.m3u8(\?|$)/i.test(url) || /master\.json(\?|$)/i.test(url))) {
        resolved = {
          url,
          headers: {
            Referer: req.headers()['referer'] || lastRefererByUrl,
            Origin: originFromReferer(req.headers()['referer'] || lastRefererByUrl),
            'User-Agent': PS_UA['User-Agent']
          }
        };
        t('¡MATCH! manifiesto capturado (por URL, type=' + type + '): ' + url);
      }
      // VOE, DoodStream y algunos hosts similares a veces sirven un .mp4
      // directo en vez de HLS (sin master.m3u8) — lo capturamos igual si
      // viene como 'media'.
      if (!resolved && type === 'media' && /\.mp4(\?|$)/i.test(url)) {
        resolved = {
          url,
          headers: {
            Referer: req.headers()['referer'] || lastRefererByUrl,
            Origin: originFromReferer(req.headers()['referer'] || lastRefererByUrl),
            'User-Agent': PS_UA['User-Agent']
          },
          isMp4: true
        };
        t('¡MATCH! mp4 directo capturado (por URL): ' + url);
      }
      req.continue();
    });

    page.on('response', async (resp) => {
      if (resolved) return;
      try {
        const ct = resp.headers()['content-type'] || '';
        const rUrl = resp.url();
        if (/mpegurl|vnd\.apple\.mpegurl|dash\+xml/i.test(ct)) {
          resolved = {
            url: rUrl,
            headers: {
              Referer: resp.request().headers()['referer'] || lastRefererByUrl,
              Origin: originFromReferer(resp.request().headers()['referer'] || lastRefererByUrl),
              'User-Agent': PS_UA['User-Agent']
            }
          };
          t('¡MATCH! Manifiesto detectado por content-type "' + ct + '": ' + rUrl);
        } else if (/^video\/mp4/i.test(ct)) {
          resolved = {
            url: rUrl,
            headers: {
              Referer: resp.request().headers()['referer'] || lastRefererByUrl,
              Origin: originFromReferer(resp.request().headers()['referer'] || lastRefererByUrl),
              'User-Agent': PS_UA['User-Agent']
            },
            isMp4: true
          };
          t('¡MATCH! video/mp4 detectado por content-type: ' + rUrl);
        }
      } catch (e) {}
    });

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        lastRefererByUrl = frame.url();
        t('Navegó a: ' + frame.url());
      }
    });

    t('Iniciando goto a ' + embedUrl);
    try {
      await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs, referer: 'https://www.google.com/' });
      t('goto completó (domcontentloaded)');
    } catch (e) {
      t('goto tiró error/timeout: ' + e.message);
    }

    // Si la página es un 404 (el link cambió, contenido caído, etc), no vale
    // la pena perder 15-35s clickeando algo que no existe: cortamos ya.
    try {
      const pageTitle = await page.title();
      if (/no encontrada|not found|404/i.test(pageTitle)) {
        t('Página parece un 404 ("' + pageTitle + '"), abortando temprano');
        return null;
      }
    } catch (e) {}

    // Portal con contraseña (típico de Cinecalidad para sus embeds propios de
    // vimeos.net): <input id="password"> + <button onclick="checkPassword()">.
    // Sin esto, el resolver genérico nunca pasa de esta pantalla -- solo sabe
    // clickear, nunca escribir texto.
    try {
      const hasPasswordGate = await page.evaluate(() => !!document.querySelector('#password, input[type="password"]'));
      if (hasPasswordGate) {
        t('Portal con contraseña detectado, escribiendo "cinecalidad.ec"');
        const pwSelector = (await page.$('#password')) ? '#password' : 'input[type="password"]';
        await page.click(pwSelector, { clickCount: 3 }).catch(() => {});
        await page.type(pwSelector, 'cinecalidad.ec', { delay: 40 }).catch(() => {});

        const clickedBtn = await page.evaluate(() => {
          // 1) el patrón exacto que describieron: onclick="checkPassword()"
          const byOnclick = document.querySelector('[onclick*="checkPassword"]');
          if (byOnclick) { byOnclick.click(); return 'onclick=checkPassword()'; }
          // 2) si existe la función global, llamarla directo
          if (typeof window.checkPassword === 'function') { window.checkPassword(); return 'window.checkPassword()'; }
          // 3) respaldo: botón "Entrar/Enviar/Submit" cerca del input
          const btns = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
          for (const b of btns) {
            const txt = (b.innerText || b.value || '').trim();
            if (/entrar|enviar|submit|ok|acceder/i.test(txt)) { b.click(); return 'texto:' + txt; }
          }
          return null;
        });
        t('Click en botón de contraseña: ' + (clickedBtn || 'NO SE ENCONTRÓ NINGÚN BOTÓN'));

        // Dar tiempo a que el JS de la página revele el menú de servidores
        // (o navegue) después de aceptar la contraseña.
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e) {
      t('Error manejando portal de contraseña: ' + e.message);
    }

    const viewport = page.viewport() || { width: 1280, height: 720 };
    const centerX = Math.floor(viewport.width / 2);
    const centerY = Math.floor(viewport.height / 2);

    // Clic agresivo: sobre la página principal Y sobre cada iframe hijo
    // (streamwish suele meter el player real en un <iframe> anidado), más
    // varios selectores típicos de overlay de "play", más forzar video.play()
    // directamente por si el click no alcanza al elemento real (overlays
    // superpuestos, ads, etc).
    async function tryClickEverywhere() {
      try { await page.mouse.click(centerX, centerY); } catch (e) {}
      const selectors = [
        'video', '.jw-icon-playback', '.vjs-big-play-button', '.play-button',
        '#player', '.plyr__control--overlaid', '.vjs-play-control',
        '.fp-play', '.fp-playbtn', '[class*="play"]', '.jw-display-icon-container',
        '#start', 'img#start', '[id="start"]', 'img[src*="play"]', '[onclick*="play"]'
      ];
      const frames = page.frames();
      for (const frame of frames) {
        try {
          await frame.evaluate((sels) => {
            for (const s of sels) {
              const el = document.querySelector(s);
              if (el) { try { el.click(); } catch (e) {} }
            }
            const video = document.querySelector('video');
            if (video) {
              try { video.muted = true; video.play().catch(() => {}); } catch (e) {}
            }
          }, selectors);
        } catch (e) { /* frame puede haberse destruido, seguimos */ }
      }
      // click centrado también dentro de cada iframe visible
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        try {
          const el = await frame.$('body');
          if (el) {
            const box = await el.boundingBox();
            if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          }
        } catch (e) {}
      }
    }

    // Botón "saltar publicidad" (típico de DoodStream y similares: countdown
    // de unos segundos y después aparece un botón "Saltar/Skip/Cerrar/Close").
    // Lo buscamos por TEXTO en vez de por selector CSS porque cada mirror le
    // pone una clase distinta, pero el texto es bastante estable.
    async function tryClickSkipAdButton() {
      const frames = page.frames();
      for (const frame of frames) {
        try {
          await frame.evaluate(() => {
            const re = /saltar|skip|close|cerrar|continuar|continue/i;
            const candidates = document.querySelectorAll('button, a, div, span');
            for (const el of candidates) {
              const txt = (el.innerText || el.textContent || '').trim();
              if (txt && txt.length < 30 && re.test(txt)) {
                const style = window.getComputedStyle(el);
                if (style && style.display !== 'none' && style.visibility !== 'hidden') {
                  try { el.click(); } catch (e) {}
                }
              }
            }
          });
        } catch (e) { /* frame destruido, seguimos */ }
      }
    }

    // Simula presencia humana con pequeños movimientos de mouse: algunos
    // hosts (DoodStream entre ellos) no revelan el link real del video hasta
    // detectar movimiento de mouse, no solo un click puntual.
    async function simulateMouseMovement() {
      try {
        const vp = page.viewport() || { width: 1280, height: 720 };
        const x = Math.floor(Math.random() * vp.width);
        const y = Math.floor(Math.random() * vp.height);
        await page.mouse.move(x, y, { steps: 5 });
      } catch (e) {}
    }

    const start = Date.now();
    let lastClickAt = 0;
    let lastSkipCheckAt = 0;
    while (!resolved && Date.now() - start < timeoutMs) {
      if (Date.now() - lastClickAt > 1500) {
        lastClickAt = Date.now();
        await tryClickEverywhere();
        await simulateMouseMovement();
      }
      if (Date.now() - lastSkipCheckAt > 1000) {
        lastSkipCheckAt = Date.now();
        await tryClickSkipAdButton();
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    t('Fin del loop. Requests totales vistos: ' + requestCount + '. Hosts: ' + [...seenHosts].join(', '));
    return resolved;
  } catch (e) {
    t('ERROR general: ' + e.message);
    return null;
  } finally {
    if (browser && onTargetCreated) {
      try { browser.off('targetcreated', onTargetCreated); } catch (e) {}
    }
    if (page) {
      try { await page.close(); } catch (e) {}
    }
  }
}

// ---------- VidHide / filelions ----------

async function resolveVidHideHls(url) {
  let fileId = null;
  const dm = url.match(/https?:\/\/filelions\.(?:to|tv|com)\/v\/([A-Za-z0-9]+)/i);
  if (dm) {
    fileId = dm[1];
  } else if (url.indexOf('player.php') !== -1 || /player\./i.test(url)) {
    let playerHtml;
    try {
      playerHtml = (await axios.get(url, { headers: PS_UA, timeout: 8000 })).data;
    } catch (e) { return null; }
    const m = playerHtml.match(/['"]https?:\/\/filelions\.(?:to|tv|com)\/v\/([A-Za-z0-9]+)['"]/i);
    if (!m) return null;
    fileId = m[1];
  } else {
    return null;
  }

  const base = 'https://callistanise.com';
  const calliPaths = ['/embed/', '/v/'];
  for (let pi = 0; pi < calliPaths.length; pi++) {
    const calliUrl = base + calliPaths[pi] + fileId;
    let calliHtml;
    try {
      calliHtml = (await axios.get(calliUrl, {
        headers: { 'User-Agent': PS_UA['User-Agent'], Referer: 'https://filelions.to/' },
        timeout: 8000
      })).data;
    } catch (e) { continue; }

    const em = calliHtml.match(/\}\s*\(\s*'([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\s*\.split\('\\\|'\)\s*\)/im);
    if (em && em[1] !== undefined) {
      const decoded = unpackJsVh(em[1], parseInt(em[2], 10), parseInt(em[3], 10), em[4].split('|'));
      const hls = extractHlsFromCallistanise(decoded, base);
      if (hls) return hls;
    }
    const hls2 = extractHlsFromCallistanise(calliHtml, base);
    if (hls2) return hls2;
  }
  return null;
}

// Sigue un "player.php" (de GNULA/Poseidon/etc) hasta el iframe embed real.
async function resolveEmbedUrl(playerPageUrl) {
  let html;
  try {
    html = (await axios.get(playerPageUrl, { headers: PS_UA, timeout: 8000 })).data;
  } catch (e) { return null; }

  const patterns = [
    /window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i,
    /location\.replace\s*\(\s*['"]([^'"]+)['"]\s*\)/i,
    /<meta[^>]+http-equiv\s*=\s*['"]refresh['"][^>]+content\s*=\s*['"][^'">\s]+url=([^'">\s]+)/i,
    /src\s*=\s*['"]((?:https?:)?\/\/[^'"]+\/(?:e|embed|v)\/[a-zA-Z0-9]+[^'"]*)['"]/i,
    /(https?:\/\/[^\s'"<>\\]+\/(?:e|embed|v)\/[a-zA-Z0-9]+[^\s'"<>\\]*)/i
  ];

  for (let i = 0; i < patterns.length; i++) {
    const m = html.match(patterns[i]);
    if (m && m[1]) return m[1];
  }
  return null;
}

// Intento genérico legacy: busca directamente un file/src/source .m3u8|.mp4
// en el HTML (desempaquetado) del embed.
async function resolveDirectVideoUrl(embedUrl) {
  try {
    const res = await axios.get(embedUrl, { headers: { ...PS_UA, Referer: 'https://www.google.com/' }, timeout: 10000 });
    const html = res.data;
    const finalUrl = res.request.res.responseUrl || embedUrl;
    const origin = new URL(finalUrl).origin;

    const unpackedExtra = unpackEvalBlocks(html);
    const unpackedHtml = html + '\n' + unpackedExtra;

    const fileRegex = /(?:file|src|source)\s*:\s*["'](https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)['"]/i;
    const linkMatch = unpackedHtml.match(fileRegex);

    if (linkMatch) {
      return { url: linkMatch[1], headers: { Referer: origin + '/', Origin: origin, 'User-Agent': PS_UA['User-Agent'] } };
    }
  } catch (e) {
    return null;
  }
  return null;
}

// ---------- API de alto nivel: dado CUALQUIER url de player/embed, intenta
// devolver { url, headers } de un .m3u8 directo, probando toda la cadena. ----------

async function resolveToDirectHls(playerOrEmbedUrl) {
  // 1. VidHide directo
  if (/vidhide|filelions/i.test(playerOrEmbedUrl)) {
    const hls = await resolveVidHideHls(playerOrEmbedUrl);
    if (hls) return { url: hls, headers: { 'User-Agent': PS_UA['User-Agent'] } };
  }

  const isPlayerPage = /player\.php|player\./i.test(playerOrEmbedUrl)
    && !isEmbedHost(playerOrEmbedUrl)
    && !needsBrowserOnly(playerOrEmbedUrl);

  // 2a. Rápido (axios, sin JS): solo tiene sentido si YA es un embed final Y
  // no es de los hosts que sabemos que necesitan JS del navegador sí o sí
  // (VOE, DoodStream, Vimeo -- countdown, mouse-move, botón skip, etc).
  if (!isPlayerPage && !needsBrowserOnly(playerOrEmbedUrl)) {
    const fast = await resolveStreamwishHls(playerOrEmbedUrl);
    if (fast && fast.url) return fast;
  }

  // 2b. Navegador headless: SIEMPRE arrancamos desde la URL ORIGINAL
  // (player.php incluido). Puppeteer hace click, espera, sigue el primer
  // redirect (ej. a streamwish.to/e/ID), espera el redirect automático al
  // dominio final "mutante" (ej. hglamioz.com/e/ID) y clickea ahí también si
  // hace falta -- todo dentro de la MISMA sesión/página, capturando la
  // petición real al .m3u8 en cualquier punto de la cadena.
  const viaBrowser = await resolveStreamwishHlsViaBrowser(playerOrEmbedUrl);
  if (viaBrowser && viaBrowser.url) return viaBrowser;

  // 2c. Último recurso: si el navegador no encontró nada, probamos
  // desenvolver el player.php de forma estática y reintentar ahí.
  if (isPlayerPage) {
    const found = await resolveEmbedUrl(playerOrEmbedUrl);
    if (found) {
      const fast2 = await resolveStreamwishHls(found);
      if (fast2 && fast2.url) return fast2;
      const direct2 = await resolveDirectVideoUrl(found);
      if (direct2 && direct2.url) return direct2;
    }
  } else {
    const direct = await resolveDirectVideoUrl(playerOrEmbedUrl);
    if (direct && direct.url) return direct;
  }

  return null;
}

module.exports = {
  EMBED_HOSTS,
  isEmbedHost,
  isVoeHost,
  isDoodHost,
  isVimeoHost,
  needsBrowserOnly,
  patchDtoE,
  resolveStreamwishHls,
  resolveStreamwishHlsViaBrowser,
  resolveVidHideHls,
  resolveEmbedUrl,
  resolveDirectVideoUrl,
  resolveToDirectHls,
  getBrowser,
  closeBrowser
};
