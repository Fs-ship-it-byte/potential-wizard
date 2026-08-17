var http = require('../http');

var UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
var GNL_SEARCH_BASE = 'https://gnula.life';

function isGnulaPlayerUrl(url) {
    return !!(url && /player\.gnula\.[a-z]+\/(?:player|download)\.php\?h=/i.test(url));
}

async function fetchGnulaEmbedUrl(url) {
    var html;
    try { html = (await http.request(url, { headers: UA, compression: true, noFail: true })).toString(); } catch(e) { return null; }
    if (!html) return null;
    var m = /var\s+url\s*=\s*['"]([^'"]+)['"]/i.exec(html);
    return m ? m[1] : null;
}

function gnlTableBlock(html) {
    var m = html.match(/<table class="table[^"]*">([\s\S]*?)<\/table>/);
    return m ? m[1] : html;
}

function gnlField(tableHtml, label) {
    var re = new RegExp('<td>' + label + '<\\/td><td>([\\s\\S]*?)<\\/td>');
    var m  = re.exec(tableHtml);
    return m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim() : '';
}

async function gnlExtractJsonValue(html, key) {
    var marker = '"' + key + '":';
    var searchFrom = 0;
    var idx, start, open;
    while (true) {
        idx = html.indexOf(marker, searchFrom);
        if (idx === -1) return null;
        start = idx + marker.length;
        var c0 = html.charAt(start);
        if (c0 === '{' || c0 === '[') { open = c0; break; }
        searchFrom = idx + marker.length;
    }
    var close = open === '{' ? '}' : ']';
    var depth = 0;
    var inStr = false;
    var strCh = '';
    var i = start;
    for (; i < html.length; i++) {
        var ch = html.charAt(i);
        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === strCh) inStr = false;
            continue;
        }
        if (ch === '"' || ch === '\'') { inStr = true; strCh = ch; continue; }
        if (ch === open) depth++;
        else if (ch === close) { depth--; if (depth === 0) { i++; break; } }
    }
    return i > start ? html.substring(start, i) : null;
}

var GNL_LOCKER_LABELS = {
    'streamwish': 'StreamWish',
    'vidhide':    'VidHide',
    'doodstream': 'DoodStream',
    'filemoon':   'FileMoon',
    'streamtape': 'StreamTape',
    'voe':        'VOE',
    'mixdrop':    'MixDrop',
    'upstream':   'UpStream'
};

var GNL_LANG_LABELS = {
    'latino':      'Latino',
    'castellano':  'Castellano',
    'subtitulado': 'Ingl\u00e9s',
    'ingles':      'Ingl\u00e9s',
    'english':     'Ingl\u00e9s'
};

// Antes esta lista excluía VOE/FileMoon/DoodStream porque el reproductor
// nativo de Movian (el addon original de donde viene este scraper) no podía
// reproducirlos y el plugin prefería ocultarlos antes que mostrar un link
// roto. Nosotros SÍ los resolvemos (Puppeteer + captura de red), así que
// ocultarlos nos priva justo de los servidores que más nos costó soportar.
var GNL_EXCLUDED_LOCKERS = {};

function gnlCap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function gnlLockerLabel(k) {
    return k ? (GNL_LOCKER_LABELS[k.toLowerCase()] || gnlCap(k)) : '';
}

function gnlLangLabel(k) {
    return k ? (GNL_LANG_LABELS[k.toLowerCase()] || gnlCap(k)) : '';
}

function gnlNormalizeLangKey(k) {
    if (!k) return '';
    k = k.toLowerCase();
    if (k === 'spanish') return 'castellano';
    if (k === 'english' || k === 'ingles') return 'subtitulado';
    return k;
}

function gnlCollectServers(node, langHint, out, seen) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) gnlCollectServers(node[i], langHint, out, seen);
        return;
    }
    if (node.result) {
        var locker = node.cyberlocker ? String(node.cyberlocker).toLowerCase() : '';
        if ((!locker || !GNL_EXCLUDED_LOCKERS[locker]) && !seen[node.result]) {
            seen[node.result] = true;
            var lang  = gnlNormalizeLangKey(node.language || langHint || '');
            var label = gnlLangLabel(lang) + (node.cyberlocker ? ' \u00b7 ' + gnlLockerLabel(node.cyberlocker) : '');
            out.push({ url: node.result, label: label, language: lang, locker: locker });
        }
        return;
    }
    for (var k in node) {
        if (!node.hasOwnProperty(k)) continue;
        gnlCollectServers(node[k], k, out, seen);
    }
}

function gnlJoinNames(arr) {
    if (!arr || !arr.length) return '';
    var out = [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].name) out.push(arr[i].name);
    return out.join(', ');
}

async function fetchGnulaLifeMovie(url) {
    var html;
    try { html = (await http.request(url, { headers: UA, compression: true, noFail: true })).toString(); } catch(e) { return null; }
    if (!html) return null;

    var tableHtml = gnlTableBlock(html);
    var data = {};

    data.title         = gnlField(tableHtml, 'T\u00edtulo');
    data.originalTitle = gnlField(tableHtml, 'T\u00edtulo Original');
    data.duration      = gnlField(tableHtml, 'Duraci\u00f3n');
    data.year          = gnlField(tableHtml, 'A\u00f1o de Estreno');
    data.country       = gnlField(tableHtml, 'Pa\u00eds');
    data.genres        = gnlField(tableHtml, 'G\u00e9neros');
    data.director      = gnlField(tableHtml, 'Directores');

    var ratingM = /([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/.exec(gnlField(tableHtml, 'Puntaje'));
    data.rating = ratingM ? ratingM[1] : '';

    if (!data.title) {
        var hm = html.match(/<h1[^>]*>([^<|]+)/);
        data.title = hm ? hm[1].replace(/\s*\|.*$/, '').trim() : '';
    }
    if (!data.title) return null;

    var om = html.match(/property="og:description"\s+content="([^"]*)"/);
    if (!om) om = html.match(/name="description"\s+content="([^"]*)"/);
    data.synopsis = om ? om[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, '\'').trim() : '';

    var images = [];
    var imgRe  = /property="og:image"\s+content="([^"]*)"/g;
    var imgM;
    while ((imgM = imgRe.exec(html)) !== null) images.push(imgM[1]);
    data.poster   = images[0] || null;
    data.backdrop = images[1] || images[0] || null;

    data.servers = [];
    var seen = {};

    var playersRaw = await gnlExtractJsonValue(html, 'players');
    var players = null;
    if (playersRaw) {
        try { players = JSON.parse(playersRaw.replace(/\\\//g, '/')); } catch(e) { players = null; }
    }
    if (players) gnlCollectServers(players, '', data.servers, seen);

    if (!data.servers.length) {
        var normalizedHtml = html.replace(/\\\//g, '/');
        var linkRe = /https?:\/\/player\.gnula\.[a-z]+\/(?:player|download)\.php\?h=[A-Za-z0-9_\-]+/ig;
        var linkM;
        while ((linkM = linkRe.exec(normalizedHtml)) !== null) {
            var lk = linkM[0].replace(/&amp;/g, '&');
            if (!seen[lk]) { seen[lk] = true; data.servers.push({ url: lk, label: '' }); }
        }
    }

    return data;
}

function gnlEpisodeUrl(seriesSlug, season, episode) {
    return 'https://gnula.life/series/' + seriesSlug + '/seasons/' + season + '/episodes/' + episode;
}

async function fetchGnulaLifeEpisode(url) {
    var html;
    try { html = (await http.request(url, { headers: UA, compression: true, noFail: true })).toString(); } catch(e) { return null; }
    if (!html) return null;

    var serieRaw   = await gnlExtractJsonValue(html, 'serie');
    var seasonRaw  = await gnlExtractJsonValue(html, 'season');
    var episodeRaw = await gnlExtractJsonValue(html, 'episode');
    if (!episodeRaw) return null;

    var serie, seasonObj, episodeObj;
    try { serie      = serieRaw  ? JSON.parse(serieRaw.replace(/\\\//g, '/'))  : null; } catch(e) { serie     = null; }
    try { seasonObj  = seasonRaw ? JSON.parse(seasonRaw.replace(/\\\//g, '/')) : null; } catch(e) { seasonObj = null; }
    try { episodeObj = JSON.parse(episodeRaw.replace(/\\\//g, '/')); } catch(e) { return null; }
    if (!episodeObj) return null;

    var data = {};
    data.seriesTitle         = serie && serie.titles ? serie.titles.name : '';
    data.seriesOriginalTitle = (serie && serie.titles && serie.titles.original) ? serie.titles.original.name : '';
    data.episodeTitle        = episodeObj.title || data.seriesTitle;
    data.seasonNumber        = seasonObj ? seasonObj.number : (episodeObj.slug ? parseInt(episodeObj.slug.season, 10) : null);
    data.episodeNumber       = (episodeObj.number != null) ? episodeObj.number : (episodeObj.slug ? parseInt(episodeObj.slug.episode, 10) : null);
    data.poster   = episodeObj.image || (serie && serie.images ? serie.images.poster : null);
    data.backdrop = (serie && serie.images) ? (serie.images.backdrop || serie.images.poster) : data.poster;
    data.synopsis = serie ? (serie.overview || '') : '';
    data.genres   = serie ? gnlJoinNames(serie.genres) : '';
    data.director = (serie && serie.cast) ? gnlJoinNames(serie.cast.directing) : '';
    data.country  = (serie && serie.cast) ? gnlJoinNames(serie.cast.countries) : '';
    data.rating   = (serie && serie.rate && serie.rate.average != null) ? String(serie.rate.average) : '';
    data.year     = '';

    var seasonEpisodesRaw = [];
    if (serie && serie.seasons) {
        for (var si = 0; si < serie.seasons.length; si++) {
            if (serie.seasons[si].number === data.seasonNumber) { seasonEpisodesRaw = serie.seasons[si].episodes || []; break; }
        }
    }
    for (var ei = 0; ei < seasonEpisodesRaw.length; ei++) {
        if (seasonEpisodesRaw[ei].number === data.episodeNumber && seasonEpisodesRaw[ei].releaseDate) {
            data.year = String(seasonEpisodesRaw[ei].releaseDate).substring(0, 4);
            break;
        }
    }
    if (!data.year && serie && serie.releaseDate) data.year = String(serie.releaseDate).substring(0, 4);

    var seriesSlug = (serie && serie.slug) ? serie.slug.name : (episodeObj.slug ? episodeObj.slug.name : '');
    data.seasonEpisodes = [];
    for (var sei = 0; sei < seasonEpisodesRaw.length; sei++) {
        var se = seasonEpisodesRaw[sei];
        data.seasonEpisodes.push({
            url:    gnlEpisodeUrl(seriesSlug, data.seasonNumber, se.number),
            title:  se.title || '',
            image:  se.image || null,
            number: se.number
        });
    }

    data.prevUrl = episodeObj.previousEpisodeSlug ? gnlEpisodeUrl(episodeObj.previousEpisodeSlug.name, episodeObj.previousEpisodeSlug.season, episodeObj.previousEpisodeSlug.episode) : null;
    data.nextUrl = episodeObj.nextEpisodeSlug     ? gnlEpisodeUrl(episodeObj.nextEpisodeSlug.name,     episodeObj.nextEpisodeSlug.season,     episodeObj.nextEpisodeSlug.episode)     : null;

    data.servers = [];
    var seen = {};
    if (episodeObj.players) gnlCollectServers(episodeObj.players, '', data.servers, seen);

    if (!data.servers.length) {
        var normalizedHtml = html.replace(/\\\//g, '/');
        var linkRe = /https?:\/\/player\.gnula\.[a-z]+\/(?:player|download)\.php\?h=[A-Za-z0-9_\-]+/ig;
        var linkM;
        while ((linkM = linkRe.exec(normalizedHtml)) !== null) {
            var lk = linkM[0].replace(/&amp;/g, '&');
            if (!seen[lk]) { seen[lk] = true; data.servers.push({ url: lk, label: '' }); }
        }
    }

    return data;
}

function gnlSeriesSlugFromUrl(url) {
    var m = /gnula\.[a-z]+\/series\/([^\/?#]+)/i.exec(url || '');
    return m ? m[1] : '';
}

async function fetchGnulaLifeSeries(url) {
    var html;
    try { html = (await http.request(url, { headers: UA, compression: true, noFail: true })).toString(); } catch(e) { return null; }
    if (!html) return null;

    var tableHtml = gnlTableBlock(html);
    var data = {};

    data.title    = gnlField(tableHtml, 'T\u00edtulo');
    data.originalTitle = gnlField(tableHtml, 'T\u00edtulo Original');
    data.duration = gnlField(tableHtml, 'Duraci\u00f3n');
    data.year     = gnlField(tableHtml, 'A\u00f1o de Estreno');
    data.country  = gnlField(tableHtml, 'Pa\u00eds');
    data.genres   = gnlField(tableHtml, 'G\u00e9neros');
    data.director = gnlField(tableHtml, 'Directores');

    var ratingM = /([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/.exec(gnlField(tableHtml, 'Puntaje'));
    data.rating = ratingM ? ratingM[1] : '';

    if (!data.title) {
        var hm = html.match(/<h1[^>]*>([^<|]+)/);
        data.title = hm ? hm[1].replace(/\s*\|.*$/, '').trim() : '';
    }
    if (!data.title) return null;

    var om = html.match(/property="og:description"\s+content="([^"]*)"/);
    if (!om) om = html.match(/name="description"\s+content="([^"]*)"/);
    data.synopsis = om ? om[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, '\'').trim() : '';

    var images = [];
    var imgRe  = /property="og:image"\s+content="([^"]*)"/g;
    var imgM;
    while ((imgM = imgRe.exec(html)) !== null) images.push(imgM[1]);
    data.poster   = images[0] || null;
    data.backdrop = images[1] || images[0] || null;

    data.slug = gnlSeriesSlugFromUrl(url);

    data.seasons = [];
    var selM = /serieBlockListEpisodes_selector[^>]*>\s*<select>([\s\S]*?)<\/select>/i.exec(html);
    if (selM) {
        var optRe = /<option value="(\d+)">/g;
        var optM;
        while ((optM = optRe.exec(selM[1])) !== null) data.seasons.push(parseInt(optM[1], 10));
    }
    data.seasons.sort(function(a, b) { return a - b; });

    return data;
}



function gnlDecodeNextImg(src) {
    if (!src) return null;
    var m = /[?&]url=([^&]+)/.exec(src);
    if (!m) return src;
    try { return decodeURIComponent(m[1]); } catch(e) { return null; }
}

function parseGnlSearchCards(html) {
    var results = [];
    if (!html) return results;
    var parts = html.split('<article>');
    for (var i = 1; i < parts.length; i++) {
        var block = parts[i];
        var um = /<a href="(\/(?:movies|series)\/[^"]+)"/.exec(block);
        if (!um) continue;
        var im = /<img[^>]+alt="([^"]*)"[^>]*src="([^"]*)"/.exec(block);
        if (!im) continue;
        var title = im[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
        if (!title) continue;
        var poster = gnlDecodeNextImg(im[2].replace(/&amp;/g, '&'));
        var ym = /<span>(\d{4})<\/span>/.exec(block);
        results.push({ url: GNL_SEARCH_BASE + um[1], titulo: title, poster: poster, year: ym ? ym[1] : '' });
    }
    return results;
}

async function searchGnula(query) {
    if (!query) return [];
    var url = GNL_SEARCH_BASE + '/search?q=' + encodeURIComponent(query);
    var html;
    try { html = (await http.request(url, { headers: UA, compression: true, noFail: true, caching: true, cacheTime: 300 })).toString(); } catch(e) { return []; }
    return parseGnlSearchCards(html);
}

async function searchGnulaMulti(titles) {
    var seen = {}, results = [];
    for (var i = 0; i < titles.length; i++) {
        if (!titles[i]) continue;
        var items = await searchGnula(titles[i]);
        for (var j = 0; j < items.length; j++) {
            if (!seen[items[j].url]) { seen[items[j].url] = true; results.push(items[j]); }
        }
    }
    return results;
}

exports.isGnulaPlayerUrl      = isGnulaPlayerUrl;
exports.fetchGnulaEmbedUrl    = fetchGnulaEmbedUrl;
exports.fetchGnulaLifeMovie   = fetchGnulaLifeMovie;
exports.fetchGnulaLifeEpisode = fetchGnulaLifeEpisode;
exports.fetchGnulaLifeSeries  = fetchGnulaLifeSeries;
exports.gnlEpisodeUrl         = gnlEpisodeUrl;
exports.gnlSeriesSlugFromUrl  = gnlSeriesSlugFromUrl;
exports.searchGnula           = searchGnula;
exports.searchGnulaMulti      = searchGnulaMulti;
