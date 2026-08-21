var http = require('../http');

var FC_BASE = 'https://www.fuegocine.com';
var FC_UA   = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

var FC_GENRE_MAP = {
    'Accion':          'Acci%C3%B3n',
    'Animacion':       'Animaci%C3%B3n',
    'Belico':          'B%C3%A9lica',
    'Ciencia Ficcion': 'Ciencia%20ficci%C3%B3n',
    'Comedia':         'Comedia',
    'Crimen':          'Crimen',
    'Drama':           'Drama',
    'Fantasia':        'Fantas%C3%ADa',
    'Documentales':    'Documental',
    'Familiar':        'Familia',
    'Infantiles':      'Familia',
    'Misterio':        'Misterio',
    'Romance':         'Romance',
    'Suspenso':        'Suspenso',
    'Terror':          'Terror',
    'Thriller':        'Thriller',
    'Western':         'Western'
};

function extractFcVideoUrl(url) {
    if (!url) return null;
    var m = url.match(/[?&]link=([^&"]+)/);
    if (m) {
        try {
            var decoded = decodeURIComponent(m[1]);
            if (decoded.indexOf('http') === 0) return decoded;
        } catch(e) {}
    }
    if (url.indexOf('http') === 0 && url.indexOf('blogspot.com') === -1) return url;
    return null;
}

function parseFcCards(html) {
    var results = [];
    if (!html) return results;
    var parts = html.split('<div class=\'crd\'');
    if (parts.length < 2) parts = html.split('<div class="crd"');
    for (var i = 1; i < parts.length; i++) {
        var block = parts[i];
        var um = block.match(/href=['"](https?:\/\/www\.fuegocine\.com\/[0-9]{4}\/[^'"]+\.html)['"]/);
        if (!um) continue;
        var url = um[1];
        var pm = block.match(/<img[^>]+src=['"]([^'"]+)['"]/);
        var poster = pm ? pm[1] : null;
        var tm = block.match(/crd__title[\s\S]{0,50}?<a[^>]*>([^<]+)<\/a>/);
        if (!tm) continue;
        var title = tm[1].replace(/&#[0-9]+;/g, '').replace(/&amp;/g, '&').trim();
        results.push({ url: url, poster: poster || null, titulo: title });
    }
    return results;
}

function nextFcPageUrl(html) {
    if (!html) return null;
    var m = html.match(/id="older-link"[^>]*href="([^"]+)"/);
    if (!m) m = html.match(/href="([^"]+)"[^>]*id="older-link"/);
    if (!m) m = html.match(/class="[^"]*older[^"]*"[^>]*href="([^"]+)"/);
    if (!m) m = html.match(/href="([^"]+)"[^>]*class="[^"]*older[^"]*"/);
    return m ? m[1] : null;
}

function fcMobileUrl(url) {
    if (!url) return url;
    if (url.indexOf('?') === -1) return url + '?m=1';
    if (url.indexOf('m=1') === -1) return url + '&m=1';
    return url;
}

async function searchFc(query) {
    if (!query) return [];
    var url = FC_BASE + '/search?q=' + encodeURIComponent(query) + '&max-results=20&m=1';
    var html;
    try {
        html = (await http.request(url, { headers: FC_UA, compression: true, noFail: true, caching: true, cacheTime: 300 })).toString();
    } catch(e) { return []; }
    return parseFcCards(html);
}

async function searchFcMulti(titles) {
    var seen = {}, results = [];
    for (var i = 0; i < titles.length; i++) {
        if (!titles[i]) continue;
        var items = await searchFc(titles[i]);
        for (var j = 0; j < items.length; j++) {
            if (!seen[items[j].url]) { seen[items[j].url] = true; results.push(items[j]); }
        }
    }
    return results;
}

async function fetchFcGenre(sectionTitle) {
    var label = FC_GENRE_MAP[sectionTitle];
    if (!label) return { items: [], nextUrl: null };
    var url = FC_BASE + '/search/label/' + label + '?max-results=20&m=1';
    var html;
    try {
        html = (await http.request(url, { headers: FC_UA, compression: true, noFail: true, caching: true, cacheTime: 300 })).toString();
    } catch(e) { return { items: [], nextUrl: null }; }
    return { items: parseFcCards(html), nextUrl: nextFcPageUrl(html) };
}

async function fetchFcPage(url) {
    var html;
    try {
        html = (await http.request(fcMobileUrl(url), { headers: FC_UA, compression: true, noFail: true })).toString();
    } catch(e) { return { items: [], nextUrl: null }; }
    return { items: parseFcCards(html), nextUrl: nextFcPageUrl(html) };
}

function parseFcDetail(html) {
    if (!html) return null;
    var data = {};

    var bgm = html.match(/class="post-hder"[^>]*style="background-image:\s*url\(([^)]+)\)/);
    if (!bgm) bgm = html.match(/data-backdrop="([^"]+)"/);
    if (!bgm) bgm = html.match(/data-player-backdrop="([^"]+)"/);
    if (bgm) data.backdrop = bgm[1].replace(/&amp;/g, '&').trim();

    var pm = html.match(/class="post__poster"[\s\S]{0,200}?<img[^>]+src="([^"]+)"/);
    if (pm) data.poster = pm[1];

    var tm = html.match(/class="post__title"[^>]*>([\s\S]*?)<\/h1>/);
    if (tm) data.title = tm[1].replace(/<[^>]*>/g, '').trim();

    var sm = html.match(/id="tmdb-synopsis"[^>]*>([\s\S]*?)<\/p>/);
    if (!sm) sm = html.match(/id="imdb-about"[^>]*>([\s\S]*?)<\/p>/);
    if (sm) data.synopsis = sm[1].replace(/<[^>]*>/g, '').trim();

    var rm = html.match(/id="imdb-score"[^>]*>([0-9.]+)/);
    if (rm) data.rating = rm[1].trim();

    var yearM = html.match(/data-year="([^"]+)"/);
    if (yearM) data.year = yearM[1];

    var durM = html.match(/data-du[ar]tion="([^"]+)"/);
    if (durM) data.duration = durM[1];

    var genM = html.match(/data-genres="([^"]+)"/);
    if (genM) data.genres = genM[1];

    var origM = html.match(/data-original-title="([^"]+)"/);
    if (origM) data.originalTitle = origM[1];

    data.links = [];

    var svMatch = html.match(/_SV_LINKS\s*=\s*\[([\s\S]*?)\]/);
    if (svMatch) {
        var block = svMatch[1];
        var entryRx = /\{[\s\S]*?lang\s*:\s*"([^"]*)"[\s\S]*?name\s*:\s*"([^"]*)"[\s\S]*?quality\s*:\s*"([^"]*)"[\s\S]*?url\s*:\s*"([^"]*)"[\s\S]*?tagVideo\s*:\s*(true|false)[\s\S]*?\}/g;
        var em;
        while ((em = entryRx.exec(block)) !== null) {
            var rawUrl  = em[4].replace(/&amp;/g, '&');
            var realUrl = extractFcVideoUrl(rawUrl);
            if (!realUrl) continue;
            data.links.push({
                lang:     em[1],
                name:     em[2].replace(/&#[0-9]+;/g, '').replace(/&[a-z]+;/g, '').trim(),
                quality:  em[3],
                url:      realUrl,
                tagVideo: em[5] === 'true'
            });
        }
    }

    return data;
}

exports.fcMobileUrl     = fcMobileUrl;
exports.searchFc        = searchFc;
exports.searchFcMulti   = searchFcMulti;
exports.fetchFcGenre    = fetchFcGenre;
exports.fetchFcPage     = fetchFcPage;
exports.parseFcDetail   = parseFcDetail;
exports.FC_GENRE_MAP    = FC_GENRE_MAP;
