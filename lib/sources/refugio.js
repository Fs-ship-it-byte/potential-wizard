var http = require('../http');
var U    = require('./utils');

var RF_BASE = 'https://elrefugiodelpirata.com';
var RF_UA   = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
var RF_TTL  = 5 * 60 * 1000;
var rfCache = {};

var RF_GENRE_MAP = {
    'Accion':          'accion-peliculas',
    'Animacion':       'animacion-peliculas',
    'Aventura':        'aventura-peliculas',
    'Belico':          'belica-peliculas',
    'Ciencia Ficcion': 'ciencia-ficcion-peliculas',
    'Comedia':         'comedia-peliculas',
    'Crimen':          'crimen-peliculas',
    'DC Comics':       'accion-peliculas',
    'Drama':           'drama-peliculas',
    'Fantasia':        'fantasia-peliculas',
    'Documentales':    'documentales-peliculas',
    'Familiar':        'familia-peliculas',
    'Infantiles':      'familia-peliculas',
    'Marvel':          'accion-peliculas',
    'Misterio':        'misterio-peliculas',
    'Romance':         'romance-peliculas',
    'Suspenso':        'suspenso-peliculas',
    'Terror':          'terror-peliculas',
    'Thriller':        'thriller-peliculas',
    'Western':         'western-peliculas'
};

async function rfGet(url) {
    var now = Date.now();
    if (rfCache[url] && (now - rfCache[url].ts) < RF_TTL) return rfCache[url].data;
    try {
        var data = (await http.request(url, { headers: RF_UA, compression: true, noFail: true, caching: true, cacheTime: 300 })).toString();
        rfCache[url] = { data: data, ts: now };
        return data;
    } catch(e) { return ''; }
}

function cleanRfTitle(raw) {
    if (!raw) return '';
    var t = raw;
    t = t.replace(/\s*\|.*$/i, '');
    t = t.replace(/\s*(?:pelicula|pel\u00edcula|peli)\s*(?:online)?\s*(?:gratis|completa?)?\s*(?:espa[\u00f1n]ol|spanish|castellano|english|latino|subtitulada?)?\s*(?:online|gratis|hd|completa?)?$/i, '');
    t = t.replace(/\s*(?:online\s*)?(?:espa[\u00f1n]ol|spanish|castellano|en\s*espa[\u00f1n]ol)\s*$/i, '');
    t = t.replace(/\s*(?:online|gratis|completa?|hd)\s*$/i, '');
    t = t.replace(/\s+series?\s*$/i, '');
    return t.replace(/\s+/g, ' ').replace(/^ +| +$/g, '');
}

function parseRfList(html) {
    var results = [];
    if (!html) return results;
    var parts = html.split('<article');
    for (var i = 1; i < parts.length; i++) {
        var block = parts[i];
        var urlM = /href="(https:\/\/elrefugiodelpirata\.com\/[^"]+)"[^>]*rel="bookmark"/.exec(block);
        if (!urlM) continue;
        var url = urlM[1];
        var titleM = /class="entry-title"[^>]*>[^<]*<a[^>]*>([^<]+)<\/a>/.exec(block);
        if (!titleM) continue;
        var rawTitle = titleM[1].replace(/&#(\d+);/g, function(m, n) { try { return String.fromCharCode(parseInt(n, 10)); } catch(e) { return ''; } });
        var title = cleanRfTitle(rawTitle);
        if (!title) continue;
        var imgM = /class="[^"]*wp-post-image[^"]*"[^>]*src="([^"]+)"/.exec(block);
        if (!imgM) imgM = /src="(https?:\/\/elrefugiodelpirata\.com\/wp-content\/uploads\/[^"]+)"/.exec(block);
        var poster = imgM ? imgM[1] : null;
        results.push({ url: url, titulo: title, poster: poster });
    }
    return results;
}

function parseRfNextPage(html) {
    var m = /class="next page-numbers"[^>]*href="([^"]+)"/.exec(html);
    if (!m) m = /href="([^"]+)"[^>]*class="next page-numbers"/.exec(html);
    if (!m) m = /<link[^>]*rel="next"[^>]*href="([^"]+)"/.exec(html);
    return m ? m[1].replace(/&amp;/g, '&') : null;
}

function classifyRfEmbedUrl(raw) {
    if (!raw) return null;
    var u = raw.replace(/&amp;/g, '&').replace(/\\+"/g, '').replace(/\s+/g, '').trim();
    if (!u || u.indexOf('http') !== 0) return null;
    if (/minochinos\.com\/(?:embed|v)|filemoon\.(?:sx|in)\/e|moonplayer\.one\/e|earnvids\.com\/e/i.test(u))
        return { name: 'Minochinos', url: u };
    if (/dintezuvio\.com|callistanise\.com/i.test(u)) {
        var dm = /\/(?:embed|v|e)\/([a-zA-Z0-9_-]+)/i.exec(u);
        return dm ? { name: 'Dintezuvio', url: 'https://callistanise.com/embed/' + dm[1] } : null;
    }
    if (/smoothpre\.com/i.test(u))
        return { name: 'Smoothpre', url: u };
    if (/hglink\.to|streamwish\.[a-z]{2,}|strwish\.com|awish\.[a-z]{2,}|vidhide\.[a-z]{2,}|vid2faf\.site|vidhidemix\.com/i.test(u))
        return { name: 'Streamwish', url: u };
    if (/embed69\.org\/(?:download|d)\//i.test(u)) {
        var em = /embed69\.org\/(?:download|d)\/([a-zA-Z0-9_-]+)/i.exec(u);
        return em ? { name: 'Embed69', url: 'https://embed69.org/d/' + em[1], type: 'embed69' } : null;
    }
    return null;
}

function normalizeRfLang(raw) {
    if (!raw) return null;
    var l = raw.toLowerCase();
    if (/latino|lat\.?\s*$|espa[ñn]ol\s*latino/.test(l)) return 'rfLangLatino';
    if (/castellano|^espa[ñn]ol$|espa[ñn]ol\s*(de\s*)?espa[ñn]a|espa[ñn]ol\s*castellano/.test(l)) return 'rfLangCastellano';
    if (/ingl[eé]s|^english$|subtitulad|^vose$|^sub\b/.test(l)) return 'rfLangEnglish';
    if (/portugu[eé]s|^portuguese$/.test(l)) return 'rfLangPortuguese';
    if (/franc[eé]s|^french$|fran[cç]ais/.test(l)) return 'rfLangFrench';
    return null;
}

function parseRfLangGroups(html) {
    if (!html) return [];
    var groups = [];
    var parts, i, chunk, labelM, lang, entries;

    var opcionMap = {};
    var svScriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    var svScriptM;
    while ((svScriptM = svScriptRe.exec(html)) !== null) {
        var svBlk = svScriptM[1];
        if (svBlk.indexOf('showVideo') === -1) continue;
        var opRe = /option\s*===\s*'([^']+)'[^']*'<iframe[^>]*src="(https?:\/\/[^"]+)"/gi;
        var om;
        while ((om = opRe.exec(svBlk)) !== null) {
            opcionMap[om[1]] = om[2];
        }
        break;
    }

    function extractEntries(block) {
        var res = [];
        var seen = {};

        function tryAdd(url) {
            var c = classifyRfEmbedUrl(url);
            if (!c) return;
            var k = c.url.toLowerCase().replace(/^https?:\/\//i, '');
            if (seen[k]) return;
            seen[k] = true;
            res.push(c);
        }

        var selRe = /selectDropdownOption\s*\([^,]+,\s*['"]([^'"]+)['"]/gi;
        var sm;
        while ((sm = selRe.exec(block)) !== null) {
            if (opcionMap[sm[1]]) tryAdd(opcionMap[sm[1]]);
        }

        var svRe = /showVideo\s*\(\s*['"]([^'"]+)['"]\s*\)/gi;
        var svm;
        while ((svm = svRe.exec(block)) !== null) {
            if (opcionMap[svm[1]]) tryAdd(opcionMap[svm[1]]);
        }

        if (!res.length) {
            var re = /['"`](https?:\/\/[^'"`\s\\<>]{8,})['"`]/g;
            var m;
            while ((m = re.exec(block)) !== null) {
                tryAdd(m[1]);
            }
        }

        return res;
    }

    parts = html.split(/class="[^"]*pr-style-group[^"]*"/i);
    if (parts.length > 1) {
        for (i = 1; i < parts.length; i++) {
            chunk = parts[i];
            labelM = /class="[^"]*pr-style-label[^"]*"[^>]*>\s*([^<\n]+?)\s*</.exec(chunk);
            lang = labelM ? labelM[1].replace(/\s+/g, ' ').trim() : null;
            entries = extractEntries(chunk);
            if (entries.length) groups.push({ lang: lang, entries: entries });
        }
        if (groups.length) return groups;
    }

    parts = html.split(/class="dropdown"/i);
    if (parts.length > 1) {
        for (i = 1; i < parts.length; i++) {
            chunk = parts[i];
            labelM = /class="dropbtn"[^>]*>\s*([^<▼\n]+?)(?:\s*▼\s*)?</.exec(chunk);
            lang = labelM ? labelM[1].replace(/\s+/g, ' ').trim() : null;
            entries = extractEntries(chunk);
            if (entries.length) groups.push({ lang: lang, entries: entries });
        }
        if (groups.length) return groups;
    }

    return groups;
}

function parseRfDetail(html) {
    if (!html) return null;
    var data = {};
    var ogTitle = /property="og:title"\s+content="([^"]+)"/.exec(html);
    if (!ogTitle) ogTitle = /property='og:title'\s+content='([^']+)'/.exec(html);
    if (ogTitle) data.title = cleanRfTitle(ogTitle[1].trim());
    var ogImage = /property="og:image"\s+content="([^"]+)"/.exec(html);
    if (ogImage) data.poster = ogImage[1].trim();
    var ogDesc = /property="og:description"\s+content="([^"]+)"/.exec(html);
    if (ogDesc) data.synopsis = ogDesc[1].replace(/&#[0-9]+;/g, '').replace(/&amp;/g, '&').trim();
    var catM = /property="article:section"\s+content="([^"]+)"/.exec(html);
    if (catM) data.category = catM[1].trim();

    data.embedUrl  = null;
    data.embedUrls = [];
    var seen = {};

    function addEmbed(entry) {
        if (!entry || !entry.url) return;
        var key = entry.url.toLowerCase().replace(/^https?:\/\//i, '');
        if (seen[key]) return;
        seen[key] = true;
        data.embedUrls.push(entry);
    }

    var scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    var scriptM;
    while ((scriptM = scriptRe.exec(html)) !== null) {
        var block = scriptM[1];
        if (block.indexOf('showVideo') === -1 && block.indexOf('videoContainer') === -1) continue;
        var srcRe = /\bsrc\s*=\s*[\\]?["'](https?:\/\/[^"'\s\\>]+)[\\]?["']/gi;
        var sm;
        while ((sm = srcRe.exec(block)) !== null) {
            addEmbed(classifyRfEmbedUrl(sm[1]));
        }
        var srcRe2 = /\bSRC\s*=\s*\\"(https?:\/\/[^\\"]+)\\"/gi;
        var sm2;
        while ((sm2 = srcRe2.exec(block)) !== null) {
            addEmbed(classifyRfEmbedUrl(sm2[1]));
        }
    }

    var allEmbedRe = /(https?:\/\/(?:minochinos\.com\/(?:embed|v)|filemoon\.(?:sx|in)\/e|moonplayer\.one\/e|earnvids\.com\/e|dintezuvio\.com\/(?:embed|v|e)|callistanise\.com\/(?:embed|v|e)|hglink\.to\/e|streamwish\.[a-z]{2,}\/e|strwish\.com\/e|awish\.[a-z]{2,}\/e|vidhide\.[a-z]{2,}\/e|vidhideplus\.com\/e|smoothpre\.com\/(?:e|v)|embed69\.org\/(?:download|d))\/[a-zA-Z0-9_-]+)/gi;
    var aem;
    while ((aem = allEmbedRe.exec(html)) !== null) {
        addEmbed(classifyRfEmbedUrl(aem[1]));
    }

    if (!data.embedUrls.length) {
        var svM = /'(https?:\/\/(?:minochinos\.com\/(?:embed|v)|filemoon\.sx\/e|filemoon\.in\/e|moonplayer\.one\/e|earnvids\.com\/e)\/[^\s"'\\<>]+)'/.exec(html);
        if (!svM) { var svM2 = /'(https?:\/\/(?:dintezuvio\.com|callistanise\.com)\/(?:embed|v|e)\/[^\s"'\\<>]+)'/i.exec(html); if (svM2) svM = [null, svM2[1]]; }
        if (svM) addEmbed(classifyRfEmbedUrl(svM[1]));
        var swM = /https?:\/\/(?:hglink\.to|streamwish\.[a-z]{2,}|strwish\.com|awish\.[a-z]{2,}|vidhide\.[a-z]{2,}|vid2faf\.site|vidhidemix\.com|smoothpre\.com)\/[ef]\/([a-zA-Z0-9_-]+)/i.exec(html);
        if (swM) addEmbed(classifyRfEmbedUrl(swM[0]));
        var e69M = /https?:\/\/embed69\.org\/(?:download|d)\/([a-zA-Z0-9_-]+)/i.exec(html);
        if (e69M) addEmbed(classifyRfEmbedUrl(e69M[0]));
    }

    data.embedUrl = data.embedUrls.length ? data.embedUrls[0].url : null;

    var lgData = parseRfLangGroups(html);
    if (lgData.length) {
        var lgUrls = [];
        var lgSeen = {};
        for (var lgi = 0; lgi < lgData.length; lgi++) {
            var lg = lgData[lgi];
            for (var lei = 0; lei < lg.entries.length; lei++) {
                var le = lg.entries[lei];
                var lk = le.url.toLowerCase().replace(/^https?:\/\//i, '');
                if (lgSeen[lk]) continue;
                lgSeen[lk] = true;
                le.lang = lg.lang;
                lgUrls.push(le);
            }
        }
        if (lgUrls.length) {
            data.embedUrls = lgUrls;
            data.embedUrl  = lgUrls[0].url;
        }
    }

    return data;
}

async function searchRefugio(query) {
    if (!query) return [];
    try {
        return parseRfList(await rfGet(RF_BASE + '/?s=' + encodeURIComponent(query) + '&ct_post_type=post%3Apage'));
    } catch(e) { return []; }
}

async function fetchRfCategory(sectionTitle) {
    var slug = RF_GENRE_MAP[sectionTitle];
    if (!slug) return { items: [], nextUrl: null };
    try {
        var html = await rfGet(RF_BASE + '/pelispeliculas/' + slug + '/');
        return { items: parseRfList(html), nextUrl: parseRfNextPage(html) };
    } catch(e) { return { items: [], nextUrl: null }; }
}

async function fetchRfPage(url) {
    try {
        var html = await rfGet(url);
        return { items: parseRfList(html), nextUrl: parseRfNextPage(html) };
    } catch(e) { return { items: [], nextUrl: null }; }
}

function isRfSeriesPage(html) {
    return !!(html && /<ul[^>]*class="[^"]*all-episodes[^"]*"[^>]*>/i.test(html));
}

function parseRfSeriesDetail(html) {
    if (!html) return null;
    var data = { title: '', poster: null, synopsis: '', episodes: [] };
    var ogTitle = /property="og:title"\s+content="([^"]+)"/.exec(html);
    if (!ogTitle) ogTitle = /property='og:title'\s+content='([^']+)'/.exec(html);
    if (ogTitle) data.title = cleanRfTitle(ogTitle[1].trim());
    var ogImage = /property="og:image"\s+content="([^"]+)"/.exec(html);
    if (ogImage) data.poster = ogImage[1].trim();
    var ogDesc = /property="og:description"\s+content="([^"]+)"/.exec(html);
    if (ogDesc) data.synopsis = ogDesc[1].replace(/&#[0-9]+;/g, '').replace(/&amp;/g, '&').trim();
    var ulM = /<ul[^>]*class="[^"]*all-episodes[^"]*"[^>]*>([\s\S]*?)<\/ul>/i.exec(html);
    if (ulM) {
        var liRe = /<li[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
        var liM;
        while ((liM = liRe.exec(ulM[1])) !== null) {
            var hrefM = /href="([^"]+)"/.exec(liM[2]);
            var titleM = /<h2[^>]*class="Title"[^>]*>([^<]+)<\/h2>/i.exec(liM[2]);
            if (!hrefM || !titleM) continue;
            data.episodes.push({ season: liM[1], title: titleM[1].trim(), url: hrefM[1] });
        }
    }
    return data;
}

exports.rfGet                = rfGet;
exports.RF_BASE              = RF_BASE;
exports.RF_GENRE_MAP         = RF_GENRE_MAP;
exports.normalizeRfLang      = normalizeRfLang;
exports.isRfSeriesPage       = isRfSeriesPage;
exports.parseRfSeriesDetail  = parseRfSeriesDetail;
exports.parseRfList          = parseRfList;
exports.parseRfNextPage      = parseRfNextPage;
exports.parseRfDetail        = parseRfDetail;
exports.searchRefugio   = searchRefugio;
exports.fetchRfCategory = fetchRfCategory;
exports.fetchRfPage     = fetchRfPage;
