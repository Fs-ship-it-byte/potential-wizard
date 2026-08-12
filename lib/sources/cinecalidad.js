
var http   = require('../http');

var CC_BASE = 'https://www.cinecalidad.am';
var ccUA    = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

var B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64decode(s) {
    var out = '';
    var len = s.length;
    for (var i = 0; i < len; i += 4) {
        var c0 = B64C.indexOf(s.charAt(i));
        var c1 = B64C.indexOf(s.charAt(i + 1));
        var c2 = s.charAt(i + 2) === '=' || !s.charAt(i + 2) ? 0 : B64C.indexOf(s.charAt(i + 2));
        var c3 = s.charAt(i + 3) === '=' || !s.charAt(i + 3) ? 0 : B64C.indexOf(s.charAt(i + 3));
        if (c0 < 0 || c1 < 0) continue;
        var n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
        out += String.fromCharCode((n >> 16) & 0xff);
        if (s.charAt(i + 2) && s.charAt(i + 2) !== '=') out += String.fromCharCode((n >> 8) & 0xff);
        if (s.charAt(i + 3) && s.charAt(i + 3) !== '=') out += String.fromCharCode(n & 0xff);
    }
    return out;
}

function cleanCcTitle(raw) {
    return (raw || '')
        .replace(/^Ver\s+(?:Serie|Pelicula|online\s+gratis)\s+/i, '')
        .replace(/\s+Online\s+Gratis(?:\s+HD)?\s*[-–]\s*Cinecalidad\s*$/i, '')
        .replace(/\s*[-–]\s*Cinecalidad\s*$/i, '')
        .trim();
}

function isCinecalidadMovieUrl(url)  { return !!(url && /cinecalidad\.am\/ver-pelicula\//i.test(url)); }
function isCinecalidadSeriesUrl(url) { return !!(url && /cinecalidad\.am\/ver-serie\//i.test(url)); }
function isCinecalidadEpUrl(url)     { return !!(url && /cinecalidad\.am\/ver-el-episodio\//i.test(url)); }

function parseCcList(html) {
    var items = [];
    var seen  = {};
    var re    = /id="post-\d+"[^>]+class="item[^"]*"[^>]*>([\s\S]{0,1400}?)<\/article>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
        var block = m[1];
        var hrefM = block.match(/href="(https?:\/\/www\.cinecalidad\.am\/ver-(?:pelicula|serie)\/[^"]+)"/);
        if (!hrefM || seen[hrefM[1]]) continue;
        seen[hrefM[1]] = true;
        var imgM  = block.match(/(?:data-src|src)="(https:\/\/image\.tmdb\.org[^"]+)"/);
        var altM  = block.match(/alt="([^"]+)"/);
        var seltM = block.match(/class="selt[^"]*">\s*([^<]+)/);
        var yearM = block.match(/<p>(\d{4})<\/p>/);
        items.push({
            titulo: altM  ? altM[1]              : '',
            url:    hrefM[1],
            poster: imgM  ? imgM[1]              : '',
            type:   seltM ? seltM[1].trim()      : '',
            year:   yearM ? yearM[1]             : ''
        });
    }
    return items;
}

function parseCcPlayerOptions(html) {
    var options = [];
    var re = /class="dooplay_player_option[^"]*"[^>]+data-option="([^"]+)"[^>]*>([\s\S]{0,80}?)<(?:span|!--|\/li|\/ul)/g;
    var m;
    while ((m = re.exec(html)) !== null) {
        var rawOpt  = m[1].replace(/&amp;/g, '&');
        var label   = m[2].replace(/[\s\n\r]+/g, ' ').trim();
        if (!label) label = 'Servidor';
        var embedUrl;
        if (rawOpt.indexOf('http') === 0) {
            embedUrl = rawOpt;
        } else {
            var zpm = rawOpt.match(/zopass=([A-Za-z0-9+/=]+)/);
            if (!zpm) continue;
            embedUrl = b64decode(zpm[1]);
        }
        if (!embedUrl || embedUrl.indexOf('http') !== 0) continue;
        if (embedUrl.indexOf('youtube.com') !== -1) continue;
        options.push({ name: label, url: embedUrl });
    }
    return options;
}

function parseCcSeriesEpisodes(html) {
    var eps   = [];
    var seen  = {};
    var liRe  = /<li[^>]*class="mark-\d+"[^>]*>([\s\S]{0,600}?)<\/li>/g;
    var m;
    while ((m = liRe.exec(html)) !== null) {
        var block  = m[1];
        var hrefM  = block.match(/href="(https?:\/\/www\.cinecalidad\.am\/ver-el-episodio\/([^"\/]+)\/?)"/ );
        if (!hrefM || seen[hrefM[1]]) continue;
        seen[hrefM[1]] = true;
        var thumbM = block.match(/data-src="(https?:\/\/[^"]+)"/);
        var sxe    = hrefM[2].match(/-(\d+)x(\d+)$/);
        eps.push({
            url:     hrefM[1],
            season:  sxe ? parseInt(sxe[1], 10) : 1,
            episode: sxe ? parseInt(sxe[2], 10) : 1,
            thumb:   thumbM ? thumbM[1] : ''
        });
    }
    eps.sort(function(a, b) {
        return a.season !== b.season ? a.season - b.season : a.episode - b.episode;
    });
    return eps;
}

function parseCcDetail(html) {
    var titleM   = html.match(/og:title[^>]+content="([^"]+)"/);
    var titleTag = html.match(/<title>([^<]+)<\/title>/);
    var raw      = titleM ? titleM[1] : (titleTag ? titleTag[1] : '');
    var posterM  = html.match(/(?:data-src|src)="(https:\/\/image\.tmdb\.org\/t\/p\/w342\/[^"]+)"/);
    var synM     = html.match(/class="sinopsis[^"]*"[^>]*>([\s\S]{0,800}?)<\/div>/);
    var synM2    = !synM && html.match(/<p><p>([\s\S]{20,800}?)<\/p><\/p>/);
    var synM3    = !synM && !synM2 && html.match(/itemprop="description"[^>]*>[\s\S]{0,120}?<p>([\s\S]{10,600}?)<\/p>/);
    var syn      = synM  ? synM[1].replace(/<[^>]+>/g, '').trim()
                 : synM2 ? synM2[1].replace(/<[^>]+>/g, '').trim()
                 : synM3 ? synM3[1].replace(/<[^>]+>/g, '').trim() : '';
    var ratingM  = html.match(/<b>([\d.]+)<\/b>\/10/);
    var yearM    = html.match(/<strong>Fecha:<\/strong>\s*(\d{4})/);
    var genreSpanM = html.match(/<strong>G[eé]nero:<\/strong>([\s\S]{0,300}?)<\/span>/i);
    var genres = '';
    if (genreSpanM) {
        var gBlock = genreSpanM[1], gRe = /aria-label="([^"]+)"/g, gm, gArr = [];
        while ((gm = gRe.exec(gBlock)) !== null) gArr.push(gm[1]);
        genres = gArr.join(', ');
    }
    var creatorM  = html.match(/<strong>Creador:<\/strong>[\s\S]{0,50}?<a[^>]*>([^<]+)<\/a>/i);
    var castSpanM = html.match(/<strong>Elenco:<\/strong>([\s\S]{0,600}?)<\/span>/i);
    var cast = '';
    if (castSpanM) {
        var cBlock = castSpanM[1], cRe = /aria-label="([^"]+)"/g, cm, cArr = [];
        while ((cm = cRe.exec(cBlock)) !== null) cArr.push(cm[1]);
        cast = cArr.slice(0, 5).join(', ');
    }
    var poster   = posterM ? posterM[1] : '';
    var backdrop = poster ? poster.replace('/t/p/w342/', '/t/p/w780/') : '';
    return {
        title:    cleanCcTitle(raw),
        poster:   poster,
        backdrop: backdrop,
        synopsis: syn,
        rating:   ratingM  ? ratingM[1]          : '',
        year:     yearM    ? yearM[1]             : '',
        genres:   genres,
        creator:  creatorM ? creatorM[1].trim()   : '',
        cast:     cast
    };
}

async function searchCinecalidad(q) {
    var html;
    try {
        html = (await http.request(CC_BASE + '/?s=' + encodeURIComponent(q), {
            headers: ccUA, compression: true, noFail: true
        })).toString();
    } catch(e) { return []; }
    return parseCcList(html);
}

async function fetchCcPage(url) {
    var html;
    try {
        html = (await http.request(url, { headers: ccUA, compression: true, noFail: true })).toString();
    } catch(e) { return ''; }
    return html;
}

async function fetchCcDownloadMagnet(downloadUrl) {
    var html;
    try {
        html = (await http.request(downloadUrl, { headers: ccUA, compression: true, noFail: true })).toString();
    } catch(e) { return null; }
    var magnetM = html.match(/data-href="(magnet:[^"]+)"/) ||
                  html.match(/<input[^>]+value="(magnet:[^"]+)"/) ||
                  html.match(/href="(magnet:[^"]+)"/);
    if (!magnetM) return null;
    var magnet = magnetM[1].replace(/&amp;/g, '&');
    var qualM  = html.match(/<h3[^>]*class="titulo-h3"[^>]*>([^<]+)<\/h3>/);
    var qual   = '';
    if (qualM) {
        var qRaw = qualM[1];
        var qm   = qRaw.match(/(?:WEB-DL|BluRay|HDCAM|DVDRIP|HDRip|HDTS|CAM)[^|<]*/i);
        qual = qm ? qm[0].trim() : '';
    }
    return { magnet: magnet, qual: qual };
}

async function parseCcTorrentLinks(html) {
    var links  = [];
    var seen   = {};
    var sbssM  = html.match(/id="panel_descarga"[\s\S]+?<ul[^>]*>([\s\S]+?)<\/ul>/) ||
                 html.match(/id="sbss"[^>]*>([\s\S]+?)<\/ul>/);
    var block  = sbssM ? sbssM[1] : '';
    if (!block) return links;
    var re = /<a[^>]+href="([^"]+)"[^>]*>\s*<li([^>]*)>([\s\S]{0,300}?)<\/li>/g;
    var m;
    while ((m = re.exec(block)) !== null) {
        var href   = m[1].replace(/&amp;/g, '&');
        var liAttr = m[2];
        var inner  = m[3];
        var nameM  = inner.match(/^([^<\s][^<]*)/);
        var spanM  = inner.match(/<span[^>]*>([\s\S]{0,80}?)<\/span>/);
        var name   = nameM ? nameM[1].trim() : '';
        var qual   = spanM ? spanM[1].trim() : '';
        var nameLow = name.toLowerCase();
        var isCcDownload = href.indexOf('cinecalidad') !== -1 && href.indexOf('?download=') !== -1;
        var isUtorrent   = nameLow === 'utorrent' || nameLow.indexOf('torrent') !== -1;
        if (href.indexOf('magnet:') === 0) {
            if (seen[href]) continue;
            seen[href] = true;
            links.push({ magnet: href, label: name + (qual ? '  ' + qual : '') });
        } else if (isCcDownload && isUtorrent) {
            var result = await fetchCcDownloadMagnet(href);
            if (!result || seen[result.magnet]) continue;
            seen[result.magnet] = true;
            var finalQual = qual || result.qual;
            links.push({ magnet: result.magnet, label: name + (finalQual ? '  ' + finalQual : '') });
        }
    }
    return links;
}

module.exports = {
    ccUA:                  ccUA,
    isCinecalidadMovieUrl:  isCinecalidadMovieUrl,
    isCinecalidadSeriesUrl: isCinecalidadSeriesUrl,
    isCinecalidadEpUrl:     isCinecalidadEpUrl,
    parseCcList:            parseCcList,
    parseCcPlayerOptions:   parseCcPlayerOptions,
    parseCcSeriesEpisodes:  parseCcSeriesEpisodes,
    parseCcDetail:          parseCcDetail,
    searchCinecalidad:      searchCinecalidad,
    fetchCcPage:            fetchCcPage,
    parseCcTorrentLinks:    parseCcTorrentLinks
};


