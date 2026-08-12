
var http   = require('../http');
var string = require('../string');
var U      = require('./utils');

var PG_UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

function parsePelisGoHtml(html) {
    var data = {
        title:        '',
        synopsis:     '',
        backdrop:     null,
        poster:       null,
        rating:       '',
        year:         '',
        streamUrl:    null,
        pixeldrainUrl: null,
        okruUrl:      null
    };

    var jm = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (jm) {
        try {
            var ld = JSON.parse(jm[1].trim());
            if (ld.name)                                     data.title    = string.entityDecode(ld.name);
            if (ld.description)                              data.synopsis = string.entityDecode(ld.description);
            if (ld.datePublished)                            data.year     = ld.datePublished.toString().substring(0, 4);
            if (ld.aggregateRating && ld.aggregateRating.ratingValue)
                data.rating = ld.aggregateRating.ratingValue.toString();
            if (ld.image && typeof ld.image === 'string')    data.poster   = ld.image;
        } catch(e) {}
    }

    if (!data.title) {
        var tm = /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html);
        if (!tm) tm = /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html);
        if (tm) data.title = string.entityDecode(tm[1]);
    }

    if (!data.synopsis) {
        var sm = /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i.exec(html);
        if (!sm) sm = /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i.exec(html);
        if (sm) data.synopsis = string.entityDecode(sm[1]);
    }

    var bgm = /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html);
    if (!bgm) bgm = /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html);
    if (bgm) data.backdrop = bgm[1];

    var em = html.match(/tplayer\.pelisgo\.online\/embed\/([^?&#"'\\]+)/i);
    if (em) data.streamUrl = 'https://tplayer.pelisgo.online/api/stream/' + em[1];

    var pm = html.match(/https?:\/\/(pixeldrain\.(?:com|dev))\/u\/([a-zA-Z0-9_-]+)/i);
    if (pm) data.pixeldrainUrl = 'https://' + pm[1] + '/api/file/' + pm[2] + '?download';

    var okm = html.match(/ok\.ru\/videoembed\/(\d+)/i);
    if (okm) data.okruUrl = 'https://ok.ru/videoembed/' + okm[1];

    return data;
}

async function searchPelisGo(query) {
    var results = [];
    var html;
    try {
        html = (await http.request('https://pelisgo.online/search?q=' + encodeURIComponent(query), { headers: PG_UA, compression: true, noFail: true })).toString();
    } catch(e) { return results; }
    if (!html) return results;
    var cardRe = /href="\/(movies|series)\/([a-z0-9][a-z0-9-]*[a-z0-9])"/g;
    var m, positions = [];
    while ((m = cardRe.exec(html)) !== null) {
        positions.push({ type: m[1], slug: m[2], pos: m.index });
    }
    for (var i = 0; i < positions.length; i++) {
        var start  = positions[i].pos;
        var end    = i + 1 < positions.length ? positions[i + 1].pos : html.length;
        var chunk  = html.substring(start, end);
        var altM   = chunk.match(/alt="([^"]+)"/);
        if (!altM) continue;
        var posterM = chunk.match(/url=(https?%3A%2F%2F[^&"]+)/);
        var poster  = posterM ? decodeURIComponent(posterM[1]) : '';
        var ratingM = chunk.match(/<span class="text-xs font-bold text-white">([\d.]+)<\/span>/);
        var yearM   = chunk.match(/>(\d{4})<\/span>/);
        results.push({
            titulo: string.entityDecode(altM[1]),
            url:    'https://pelisgo.online/' + positions[i].type + '/' + positions[i].slug,
            poster: poster,
            year:   yearM   ? yearM[1]   : '',
            rating: ratingM ? ratingM[1] : '',
            type:   positions[i].type
        });
    }
    return results;
}

function isPelisGoSeriesUrl(url) {
    return !!(url && /pelisgo\.online\/series\//i.test(url));
}

function parsePelisGoSeriesHtml(html) {
    var data = { title: '', synopsis: '', year: '', poster: null, backdrop: null, rating: '', slug: '', numSeasons: 1, seasonEpisodes: {} };
    var jmRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig;
    var jm;
    while ((jm = jmRe.exec(html)) !== null) {
        try {
            var ld = JSON.parse(jm[1].trim());
            if (ld.name)                                       data.title      = string.entityDecode(ld.name);
            if (ld.description)                                data.synopsis   = string.entityDecode(ld.description);
            if (ld.datePublished)                              data.year       = ld.datePublished.toString().substring(0, 4);
            if (ld.numberOfSeasons)                            data.numSeasons = parseInt(ld.numberOfSeasons, 10) || 1;
            if (ld.aggregateRating && ld.aggregateRating.ratingValue)
                data.rating = ld.aggregateRating.ratingValue.toString();
            if (ld.image && typeof ld.image === 'string')      data.poster     = ld.image;
            var urlM = (ld.url || '').match(/\/series\/([a-z0-9][a-z0-9-]*)/);
            if (urlM) data.slug = urlM[1];
            if (ld.containsSeason) {
                var cs = ld.containsSeason;
                for (var csi = 0; csi < cs.length; csi++) {
                    var csn = parseInt(cs[csi].seasonNumber, 10);
                    var cne = parseInt(cs[csi].numberOfEpisodes, 10);
                    if (csn > 0 && cne > 0) data.seasonEpisodes[csn] = cne;
                }
            }
            if (data.title) break;
        } catch(e) {}
    }
    var bgm = /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html);
    if (!bgm) bgm = /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html);
    if (bgm) data.backdrop = bgm[1];
    if (!data.slug) {
        var cm = /<link[^>]*rel=["']canonical["'][^>]*href=["'][^"']*\/series\/([a-z0-9][a-z0-9-]*)["']/i.exec(html);
        if (cm) data.slug = cm[1];
    }
    if (!data.title) {
        var tm = /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html);
        if (!tm) tm = /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html);
        if (tm) data.title = string.entityDecode(tm[1]);
    }
    return data;
}

exports.isPelisGoSeriesUrl   = isPelisGoSeriesUrl;
exports.parsePelisGoHtml     = parsePelisGoHtml;
exports.parsePelisGoSeriesHtml = parsePelisGoSeriesHtml;
exports.searchPelisGo        = searchPelisGo;


