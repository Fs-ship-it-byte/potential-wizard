var http = require('../http');

var PS_UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

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
    if (url.indexOf('/') === 0) return base + url;
    return base + '/' + url;
}

function parseJsObjVh(str) {
    try {
        var clean = str
            .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
            .replace(/:\s*'([^']*)'/g, ':"$1"')
            .replace(/,\s*\}/g, '}');
        return JSON.parse(clean);
    } catch(e) {}
    return null;
}

function extractM3u8FromObjVh(obj, base) {
    if (!obj) return null;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
        var v = obj[keys[i]];
        if (v && typeof v === 'string' && v.indexOf('master.m3u8') !== -1)
            return makeAbsoluteVh(v, base);
    }
    for (var j = 0; j < keys.length; j++) {
        var v2 = obj[keys[j]];
        if (v2 && typeof v2 === 'string' && v2.indexOf('.m3u8') !== -1)
            return makeAbsoluteVh(v2, base);
    }
    for (var k = 0; k < keys.length; k++) {
        var v3 = obj[keys[k]];
        if (v3 && typeof v3 === 'string' && v3.indexOf('/hls/') !== -1)
            return makeAbsoluteVh(v3, base);
    }
    return null;
}

function extractHlsFromCallistanise(code, base) {
    var sourceRefM = code.match(/(?:sources?|file)\s*:\s*(?:\[?\s*\{[^}]*(?:file|src)\s*:\s*)?([a-zA-Z_$][a-zA-Z0-9_$]{0,4})\s*\.\s*([a-zA-Z0-9_]+)\s*\|\|\s*\1\s*\.\s*([a-zA-Z0-9_]+)(?:\s*\|\|\s*\1\s*\.\s*([a-zA-Z0-9_]+))?/i);
    if (sourceRefM) {
        var varName = sourceRefM[1];
        var keys = [sourceRefM[2], sourceRefM[3]];
        if (sourceRefM[4]) keys.push(sourceRefM[4]);
        var varRe = new RegExp('var\\s+' + varName.replace('$', '\\$') + '\\s*=\\s*(\\{[\\s\\S]{1,800}?\\})', 'i');
        var vm = code.match(varRe);
        if (vm) {
            var vo = parseJsObjVh(vm[1]);
            if (vo) {
                for (var ki = 0; ki < keys.length; ki++) {
                    var kv = vo[keys[ki]];
                    if (kv && kv.indexOf('.m3u8') !== -1) return makeAbsoluteVh(kv, base);
                }
                var fb = extractM3u8FromObjVh(vo, base);
                if (fb) return fb;
            }
        }
    }

    var anyVarM = code.match(/var\s+([a-zA-Z_$][a-zA-Z0-9_$]{0,4})\s*=\s*(\{[^{}]{10,800}\})/g);
    if (anyVarM) {
        for (var vi = 0; vi < anyVarM.length; vi++) {
            var vm2 = anyVarM[vi].match(/var\s+([a-zA-Z_$][a-zA-Z0-9_$]{0,4})\s*=\s*(\{[^{}]{10,800}\})/);
            if (!vm2) continue;
            if (vm2[2].indexOf('m3u8') === -1 && vm2[2].indexOf('/hls/') === -1) continue;
            var vo2 = parseJsObjVh(vm2[2]);
            if (!vo2) continue;
            var found = extractM3u8FromObjVh(vo2, base);
            if (found) return found;
        }
    }

    var fm = code.match(/(?:file)\s*:\s*["']([^"']+\.(?:m3u8|txt)[^"']*?)["']/i);
    if (fm) return makeAbsoluteVh(fm[1], base);
    var am = code.match(/(https?:\/\/[^"'\s\\]+\.(?:m3u8|txt)[^"'\s\\]*)/i);
    if (am) return am[1];
    return null;
}

async function resolveVidHideHls(url) {
    var fileId = null;
    var dm = url.match(/https?:\/\/filelions\.(?:to|tv|com)\/v\/([A-Za-z0-9]+)/i);
    if (dm) {
        fileId = dm[1];
    } else if (url.indexOf('player.poseidonhd2') !== -1 || url.indexOf('player.php') !== -1) {
        var playerHtml;
        try {
            playerHtml = (await http.request(url, { headers: PS_UA, compression: true, noFail: true })).toString();
        } catch(e) { return null; }
        if (!playerHtml) return null;
        var m = playerHtml.match(/['"]https?:\/\/filelions\.(?:to|tv|com)\/v\/([A-Za-z0-9]+)['"]/i);
        if (!m) return null;
        fileId = m[1];
    } else {
        return null;
    }
    var base = 'https://callistanise.com';
    var calliPaths = ['/embed/', '/v/'];
    for (var pi = 0; pi < calliPaths.length; pi++) {
        var calliUrl = base + calliPaths[pi] + fileId;
        var calliHtml;
        try {
            calliHtml = (await http.request(calliUrl, {
                headers: {
                    'User-Agent': PS_UA['User-Agent'],
                    'Referer': 'https://filelions.to/'
                },
                compression: true,
                noFail: true
            })).toString();
        } catch(e) { continue; }
        if (!calliHtml) continue;
        var em = calliHtml.match(/\}\s*\(\s*'([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)\s*\)/im);
        if (em) {
            var decoded = unpackJsVh(em[1], parseInt(em[2], 10), parseInt(em[3], 10), em[4].split('|'));
            var hls = extractHlsFromCallistanise(decoded, base);
            if (hls) return hls;
        }
        var hls2 = extractHlsFromCallistanise(calliHtml, base);
        if (hls2) return hls2;
    }
    return null;
}

var EMBED_HOSTS = [
    'streamwish', 'niramirus', 'filemoon', 'embedwish', 'vidhide',
    'vidhideplus', 'wishfast', 'strwish', 'awish', 'flaswish',
    'swdyu', 'embedrise', 'kerapoxy', 'smoothpre', 'fsdcmo',
    'loadpre', 'doodstream', 'voe.sx', 'filemoon', 'moon.watch',
    'vidmoly', 'vudeo', 'mp4upload', 'vtube.to', 'upstream',
    'hgplaycdn'
];

function patchDtoE(url) {
    return url.replace(/\/d\/([A-Za-z0-9]+)(\?|$|#)/, '/e/$1$2').replace(/\/d\/([A-Za-z0-9]+)$/, '/e/$1');
}

function isEmbedHost(url) {
    for (var i = 0; i < EMBED_HOSTS.length; i++) {
        if (url.indexOf(EMBED_HOSTS[i]) !== -1) return true;
    }
    return false;
}

async function resolveEmbedUrl(poseidonUrl) {
    var html;
    try {
        html = (await http.request(poseidonUrl, { headers: PS_UA, compression: true, noFail: true })).toString();
    } catch(e) { return null; }
    if (!html) return null;

    var patterns = [
        /window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i,
        /location\.replace\s*\(\s*['"]([^'"]+)['"]\s*\)/i,
        /<meta[^>]+http-equiv\s*=\s*['"]refresh['"][^>]+content\s*=\s*['"][^'"]*url=([^'">\s]+)/i,
        /href\s*=\s*['"]([^'"]*(?:streamwish|niramirus|filemoon|embedwish|vidhide|wishfast|doodstream|voe\.sx|vtube\.to)[^'"]*)['"]/i,
        /(https?:\/\/[^\s'"<>\\]+(?:streamwish|niramirus|filemoon|embedwish|vidhide|wishfast|doodstream|voe\.sx|vtube\.to)[^\s'"<>\\]*)/i
    ];

    for (var i = 0; i < patterns.length; i++) {
        var m = html.match(patterns[i]);
        if (m && m[1] && isEmbedHost(m[1])) {
            return patchDtoE(m[1]);
        }
    }

    var allUrls = html.match(/https?:\/\/[^\s'"<>\\]+/gi);
    if (allUrls) {
        for (var j = 0; j < allUrls.length; j++) {
            if (isEmbedHost(allUrls[j])) {
                return patchDtoE(allUrls[j]);
            }
        }
    }

    return null;
}

function parseDownloadTable(html) {
    var results = [];
    var dlRe = /<tr><td><span[^>]*>[^<]*<\/span>\s*([^<]+?)\s*<\/td><td>([^<]+)<\/td><td>[^<]*<span>([^<]+)<\/span>[^<]*<\/td><td><a[^>]+href="(https?:\/\/player\.poseidonhd2\.co\/download\.php[^"]+)"/gi;
    var langMap = { 'latino': 'Latino', 'espa\u00f1ol': 'Espa\u00f1ol', 'castellano': 'Espa\u00f1ol', 'subtitulado': 'Subtitulado', 'english': 'Subtitulado' };
    var m;
    while ((m = dlRe.exec(html)) !== null) {
        var serverRaw = m[1].replace(/^\s+|\s+$/g, '').toLowerCase();
        if (serverRaw !== 'streamwish') continue;
        var langRaw = m[2].replace(/^\s+|\s+$/g, '').toLowerCase();
        var lang = langMap[langRaw] || m[2].replace(/^\s+|\s+$/g, '');
        var quality = m[3].replace(/^\s+|\s+$/g, '') || 'HD';
        results.push({
            playerUrl: m[4],
            label: 'Streamwish \u00b7 ' + lang + ' \u00b7 ' + quality + ' (DL)'
        });
    }
    return results;
}

function parseCliLiStreams(html) {
    var results = [];
    var langMap = {
        'espa\u00f1ol latino': 'Latino',
        'latino':              'Latino',
        'espa\u00f1ol':        'Espa\u00f1ol',
        'castellano':          'Espa\u00f1ol',
        'subtitulado':         'Subtitulado',
        'english':             'Subtitulado'
    };
    var groupRe = /_1R6bW_0"[^>]*>\s*<span>([^<]+)[\s\S]*?sub-tab-lang[^"]*"([\s\S]*?)<\/ul>/gi;
    var gm;
    while ((gm = groupRe.exec(html)) !== null) {
        var langRaw = gm[1].replace(/^\s+|\s+$/g, '').toLowerCase();
        var lang = langMap[langRaw] || (langRaw ? (langRaw.charAt(0).toUpperCase() + langRaw.slice(1)) : 'Latino');
        var block = gm[2];
        var cliliRe = /data-tr="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>\s*([^<]+)\s*<\/span>/gi;
        var cm;
        while ((cm = cliliRe.exec(block)) !== null) {
            var playerUrl = cm[1];
            var text = cm[2].replace(/^\s+|\s+$/g, '');
            var serverMatch = text.match(/^\d+\.\s*([^\s-]+)/i);
            if (!serverMatch) continue;
            var serverName = serverMatch[1].toLowerCase();
            if (serverName !== 'vidhide' && serverName !== 'vidhideplus') continue;
            var qualMatch = text.match(/-\s*(\S+)\s*$/i);
            var quality = qualMatch ? qualMatch[1] : 'HD';
            var displayName = serverName === 'vidhideplus' ? 'VidHidePlus' : 'VidHide';
            results.push({
                playerUrl: playerUrl,
                label:     displayName + ' \u00b7 ' + lang + ' \u00b7 ' + quality
            });
        }
    }
    return results;
}

async function fetchPoseidonHD2Streams(url) {
    var html;
    try {
        html = (await http.request(url, { headers: PS_UA, compression: true, noFail: true })).toString();
    } catch(e) { return null; }
    if (!html) return null;

    var nm = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!nm) return null;

    var data;
    try { data = JSON.parse(nm[1]); } catch(e) { return null; }

    var pp = data && data.props && data.props.pageProps;
    if (!pp) return null;

    var subject = pp.thisMovie || pp.thisEpisode || null;
    if (!subject) return null;

    var images   = subject.images  || {};
    var titles   = subject.titles  || {};
    var rate     = subject.rate    || {};
    var genres   = subject.genres  || [];

    var poster   = images.poster   || null;
    var backdrop = images.backdrop || images.poster || null;
    var name     = titles.name     || '';
    var original = (titles.original && titles.original.name) ? titles.original.name : '';
    var overview = subject.overview || '';
    var runtime  = subject.runtime  ? (subject.runtime + ' min') : '';
    var rating   = rate.average     ? (Math.round(rate.average * 10) / 10).toString() : '';
    var year     = subject.releaseDate ? subject.releaseDate.substring(0, 4) : '';

    var genreNames = [];
    for (var gi = 0; gi < genres.length; gi++) genreNames.push(genres[gi].name);

    var videos  = subject.videos || {};
    var streams = [];
    var langMap = { spanish: 'Español', latino: 'Latino', english: 'Subtitulado' };
    var langs   = ['spanish', 'latino', 'english'];

    for (var li = 0; li < langs.length; li++) {
        var lang    = langs[li];
        var entries = videos[lang] || [];
        for (var ei = 0; ei < entries.length; ei++) {
            var e = entries[ei];
            if (!e.result) continue;
            if (e.cyberlocker === 'streamwish') {
                streams.push({
                    playerUrl: e.result,
                    label:     'Streamwish \u00b7 ' + langMap[lang] + ' \u00b7 ' + (e.quality || 'HD'),
                    locker:    'streamwish'
                });
            } else if (e.cyberlocker === 'vidhide') {
                streams.push({
                    playerUrl: e.result,
                    label:     'VidHide \u00b7 ' + langMap[lang] + ' \u00b7 ' + (e.quality || 'HD'),
                    locker:    'vidhide'
                });
            }
        }
    }

    var dlStreams = parseDownloadTable(html);
    for (var di = 0; di < dlStreams.length; di++) streams.push(dlStreams[di]);

    var cliliStreams = parseCliLiStreams(html);
    for (var ci = 0; ci < cliliStreams.length; ci++) streams.push(cliliStreams[ci]);

    return {
        name:       name,
        original:   original,
        poster:     poster,
        backdrop:   backdrop,
        overview:   overview,
        runtime:    runtime,
        rating:     rating,
        year:       year,
        genres:     genreNames,
        streams:    streams
    };
}

function normPsTitle(s) {
    return s.toLowerCase()
        .replace(/[áàäâ]/g, 'a')
        .replace(/[éèëê]/g, 'e')
        .replace(/[íìïî]/g, 'i')
        .replace(/[óòöô]/g, 'o')
        .replace(/[úùüû]/g, 'u')
        .replace(/ñ/g, 'n')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/  +/g, ' ')
        .replace(/^ | $/g, '');
}

var PS_STOP = { 'de':1,'la':1,'el':1,'los':1,'las':1,'un':1,'una':1,'en':1,'y':1,'a':1,'the':1,'of':1,'and':1,'del':1,'le':1,'les':1,'des':1,'da':1,'o':1,'e':1 };

function scorePsResult(qWords, tn) {
    if (!qWords.length) return 50;
    var tWords = tn.split(' ');
    var matched = 0;
    for (var qi = 0; qi < qWords.length; qi++) {
        var qw = qWords[qi];
        for (var ti = 0; ti < tWords.length; ti++) {
            var tw = tWords[ti];
            if (!tw) continue;
            if (qw === tw) { matched++; break; }
            if (qw.length >= 5 && tw.length >= 5) {
                var shorter = qw.length <= tw.length ? qw : tw;
                var longer  = qw.length <= tw.length ? tw  : qw;
                if (longer.indexOf(shorter) === 0 && shorter.length * 10 >= longer.length * 8) {
                    matched++;
                    break;
                }
            }
        }
    }
    return Math.floor(matched * 80 / qWords.length);
}

async function searchPoseidon2hdSeries(q) {
    var html;
    try {
        html = (await http.request('https://www.poseidonhd2.co/search?q=' + encodeURIComponent(q), { headers: PS_UA, compression: true, noFail: true })).toString();
    } catch(e) { return []; }
    if (!html) return [];

    var results = [];
    var seen    = {};
    var liRe    = /<li[^>]+class="[^"]*TPostMv[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    var item;
    while ((item = liRe.exec(html)) !== null) {
        var block  = item[1];
        var aMatch = block.match(/<a\s[^>]*href="(\/serie\/(\d+)\/([^"\/]+))"/i);
        if (!aMatch) continue;
        var url = 'https://www.poseidonhd2.co' + aMatch[1];
        if (seen[url]) continue;
        seen[url] = true;

        var tMatch = block.match(/<span[^>]+class="[^"]*Title[^"]*block[^"]*"[^>]*>([^<]+)<\/span>/i);
        if (!tMatch) tMatch = block.match(/<span[^>]+class="[^"]*block[^"]*Title[^"]*"[^>]*>([^<]+)<\/span>/i);
        if (!tMatch) continue;
        var title = tMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/^\s+|\s+$/g, '');
        if (!title) continue;

        results.push({ title: title, url: url, tmdbId: aMatch[2], slug: aMatch[3] });
    }
    return filterPsResults(results, q);
}


function filterPsResults(results, query) {
    var qn    = normPsTitle(query);
    var qRaw  = qn.split(' ');
    var qWords = [];
    for (var i = 0; i < qRaw.length; i++) {
        if (qRaw[i].length > 2 && !PS_STOP[qRaw[i]]) qWords.push(qRaw[i]);
    }
    var scored = [];
    for (var j = 0; j < results.length; j++) {
        var tn  = normPsTitle(results[j].title);
        var score;
        if (qn === tn) {
            score = 100;
        } else if (tn.indexOf(qn) === 0 && (tn.length === qn.length || tn.charAt(qn.length) === ' ')) {
            score = 90;
        } else {
            score = scorePsResult(qWords, tn);
        }
        if (score >= 40) scored.push({ r: results[j], score: score });
    }
    scored.sort(function(a, b) { return b.score - a.score; });
    var out = [];
    for (var k = 0; k < scored.length; k++) out.push(scored[k].r);
    return out;
}

async function searchPoseidon2hd(q) {
    var html;
    try {
        html = (await http.request('https://www.poseidonhd2.co/search?q=' + encodeURIComponent(q), { headers: PS_UA, compression: true, noFail: true })).toString();
    } catch(e) { return []; }
    if (!html) return [];

    var results = [];
    var seen    = {};
    var liRe    = /<li[^>]+class="[^"]*TPostMv[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    var item;
    while ((item = liRe.exec(html)) !== null) {
        var block  = item[1];
        var aMatch = block.match(/<a\s[^>]*href="(\/pelicula\/[^"]+)"/i);
        if (!aMatch) continue;
        var url = 'https://www.poseidonhd2.co' + aMatch[1];
        if (seen[url]) continue;
        seen[url] = true;

        var tMatch = block.match(/<span[^>]+class="[^"]*Title[^"]*block[^"]*"[^>]*>([^<]+)<\/span>/i);
        if (!tMatch) tMatch = block.match(/<span[^>]+class="[^"]*block[^"]*Title[^"]*"[^>]*>([^<]+)<\/span>/i);
        if (!tMatch) continue;
        var title = tMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/^\s+|\s+$/g, '');
        if (!title) continue;

        var poster  = null;
        var imgSrc  = block.match(/\bsrc="([^"]+tmdb[^"]+)"/i);
        if (imgSrc) {
            var uParam = imgSrc[1].match(/[?&]url=([^&"]+)/i);
            if (uParam) { try { poster = decodeURIComponent(uParam[1]); } catch(e2) {} }
        }

        results.push({ title: title, url: url, poster: poster });
    }
    return filterPsResults(results, q);
}

function parseNextData(html) {
    var nm = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!nm) return null;
    var data;
    try { data = JSON.parse(nm[1]); } catch(e) { return null; }
    return (data && data.props && data.props.pageProps) ? data.props.pageProps : null;
}

async function fetchPoseidonHD2Series(url) {
    var html;
    try {
        html = (await http.request(url, { headers: PS_UA, compression: true, noFail: true })).toString();
    } catch(e) { return null; }
    if (!html) return null;

    var pp = parseNextData(html);
    if (!pp) return null;

    var subject = pp.thisSerie || null;
    if (!subject) return null;

    var images   = subject.images  || {};
    var titles   = subject.titles  || {};
    var rate     = subject.rate    || {};
    var genres   = subject.genres  || [];

    var poster   = images.poster   || null;
    var backdrop = images.backdrop || images.poster || null;
    var name     = titles.name     || '';
    var original = (titles.original && titles.original.name) ? titles.original.name : '';
    var overview = subject.overview || '';
    var rating   = rate.average     ? (Math.round(rate.average * 10) / 10).toString() : '';
    var year     = subject.releaseDate ? subject.releaseDate.substring(0, 4) : '';
    var tmdbId   = subject.TMDbId ? subject.TMDbId.toString() : null;

    var genreNames = [];
    for (var gi = 0; gi < genres.length; gi++) genreNames.push(genres[gi].name);

    var slugMatch = url.match(/\/serie\/\d+\/([^/?#]+)/);
    var slug      = slugMatch ? slugMatch[1] : null;

    var rawSeasons = subject.seasons || [];
    var seasons = [];
    for (var si = 0; si < rawSeasons.length; si++) {
        var rs = rawSeasons[si];
        var sn = rs.number;
        if (typeof sn !== 'number' || sn <= 0) continue;
        var eps = rs.episodes || [];
        var epList = [];
        for (var ei = 0; ei < eps.length; ei++) {
            var ep = eps[ei];
            epList.push({
                number: ep.number || (ei + 1),
                title:  ep.title  || '',
                image:  ep.image  || null
            });
        }
        seasons.push({ number: sn, episodes: epList });
    }

    return {
        name:     name,
        original: original,
        poster:   poster,
        backdrop: backdrop,
        overview: overview,
        rating:   rating,
        year:     year,
        genres:   genreNames,
        seasons:  seasons,
        tmdbId:   tmdbId,
        slug:     slug
    };
}

async function fetchPoseidonHD2Episode(tmdbId, slug, season, episode) {
    var url = 'https://www.poseidonhd2.co/serie/' + tmdbId + '/' + slug + '/temporada/' + season + '/episodio/' + episode;
    var html;
    try {
        html = (await http.request(url, { headers: PS_UA, compression: true, noFail: true })).toString();
    } catch(e) { return null; }
    if (!html) return null;

    var pp     = parseNextData(html);
    if (!pp) return null;

    var serie   = pp.serie   || {};
    var epData  = pp.episode || {};

    var images  = serie.images  || {};
    var titles  = serie.titles  || {};
    var rate    = serie.rate    || {};

    var poster    = images.poster   || null;
    var backdrop  = images.backdrop || poster || null;
    var serieName = (titles.name)   ? titles.name : '';
    var epName    = serieName ? (serieName + ' ' + season + 'x' + episode) : '';
    var overview  = serie.overview  || '';
    var rating    = rate.average ? (Math.round(rate.average * 10) / 10).toString() : '';

    var rawSeasons = serie.seasons || [];
    var seasons = [];
    for (var si = 0; si < rawSeasons.length; si++) {
        var rs = rawSeasons[si];
        var sn = rs.number;
        if (typeof sn !== 'number' || sn <= 0) continue;
        var eps = rs.episodes || [];
        seasons.push({ number: sn, totalEpisodes: eps.length });
    }

    var videos  = epData.videos || {};
    var streams = [];
    var langMap = { spanish: 'Espa\u00f1ol', latino: 'Latino', english: 'Subtitulado' };
    var langs   = ['latino', 'spanish', 'english'];

    for (var li = 0; li < langs.length; li++) {
        var lang    = langs[li];
        var entries = videos[lang] || [];
        for (var ei = 0; ei < entries.length; ei++) {
            var e = entries[ei];
            if (!e.result) continue;
            if (e.cyberlocker === 'streamwish') {
                streams.push({
                    playerUrl: e.result,
                    label:     'Streamwish \u00b7 ' + langMap[lang] + ' \u00b7 ' + (e.quality || 'HD'),
                    locker:    'streamwish'
                });
            } else if (e.cyberlocker === 'vidhide') {
                streams.push({
                    playerUrl: e.result,
                    label:     'VidHide \u00b7 ' + langMap[lang] + ' \u00b7 ' + (e.quality || 'HD'),
                    locker:    'vidhide'
                });
            }
        }
    }

    var dlStreams = parseDownloadTable(html);
    for (var di = 0; di < dlStreams.length; di++) streams.push(dlStreams[di]);

    var cliliStreams = parseCliLiStreams(html);
    for (var ci = 0; ci < cliliStreams.length; ci++) streams.push(cliliStreams[ci]);

    return {
        name:     epName,
        poster:   poster,
        backdrop: backdrop,
        overview: overview,
        rating:   rating,
        streams:  streams,
        seasons:  seasons
    };
}

exports.resolveEmbedUrl         = resolveEmbedUrl;
exports.resolveVidHideHls       = resolveVidHideHls;
exports.fetchPoseidonHD2Streams = fetchPoseidonHD2Streams;
exports.fetchPoseidonHD2Series  = fetchPoseidonHD2Series;
exports.fetchPoseidonHD2Episode = fetchPoseidonHD2Episode;
exports.searchPoseidon2hdSeries = searchPoseidon2hdSeries;
exports.searchPoseidon2hd       = searchPoseidon2hd;
