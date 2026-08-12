
var _http = require('../http');

function RichText(x) { this.str = x.toString(); }
RichText.prototype.toRichString = function() { return this.str; };

function c(str, col, size) {
    return '<font ' + (size ? 'size="' + size + '" ' : '') + 'color="' + col + '">' + str + '</font>';
}

var CW      = 'FFFFFF';
var CGRAY   = 'AAAAAA';
var CGOLD   = 'FFD700';
var CCYAN   = '00DDFF';
var CLIME   = '88FF00';
var CGREEN  = '00FF88';
var CORANGE = 'FF8800';
var CRED    = 'FF4444';
var CPURPLE = 'BB66FF';
var CYELLOW = 'FFFF44';
var CSKY    = '44AAFF';

function qualityColor(q) {
    if (!q) return CSKY;
    if (/2160|4[kK]/i.test(q))        return CGOLD;
    if (/1080/i.test(q))               return CCYAN;
    if (/720/i.test(q))                return CLIME;
    if (/bluray|bdrip|brrip/i.test(q)) return CCYAN;
    if (/dvd/i.test(q))                return CORANGE;
    if (/hdrip|microhd/i.test(q))      return CPURPLE;
    return CSKY;
}

function ratingColor(r) {
    var n = parseFloat(r);
    if (n >= 8) return CLIME;
    if (n >= 7) return CGREEN;
    if (n >= 6) return CYELLOW;
    if (n >= 5) return CORANGE;
    return CRED;
}

function normalize(s) {
    return (s || '').toLowerCase()
        .replace(/[áàäâã]/g, 'a').replace(/[éèëê]/g, 'e')
        .replace(/[íìïî]/g, 'i').replace(/[óòöôõ]/g, 'o')
        .replace(/[úùüû]/g, 'u').replace(/[ñ]/g, 'n').replace(/[ç]/g, 'c');
}

function normalizeFull(s) {
    return normalize(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractQuality(title) {
    var m = (title || '').match(/\b(4[kK]|2160p|1080p|720p|480p|BluRay|BDRip|BRRip|WEB-DL|WEBRip|DVDRip|HDTV|HDRip|MicroHD)\b/i);
    return m ? m[1] : '';
}

function extractYear(title) {
    var m = (title || '').match(/\b((?:19|20)\d{2})\b/);
    return m ? m[1] : '';
}


function cleanMovieTitle(title) {
    if (typeof title !== 'string') return title;
    
    title = title.replace(/\s*\(?\d{4}\)?\.\s*$/g, '');
    title = title.replace(/\s*[-–—]\s*\d{4}\s*$/g, '');
    
    title = title.replace(/\s*(4[kK]|UHD|FHD|HD|2160p|1080p|720p|480p|BluRay|BDRip|BRRip|WEB-DL|WEBRip|DVDRip|HDTV|CAMRip|PreDVDRip|HDRip|MicroHD)\s*$/gi, '');
    
    title = title.replace(/\s*\[[^\]]*\]\s*$/g, '');
    
    title = title.replace(/\s*\([^)]*(?!(?:19|20)\d{2})[^)]*\)\s*$/g, '');
    
    title = title.replace(/\s*[\[({]\s*(?:lat|latino|esp|cast|eng|english|dual|sub|subtitulado|por|ptbr|hi|hindi|jap|ja)\s*[\])}]\s*$/gi, '');
    
    title = title.replace(/[._]+/g, ' ');
    
    title = title.replace(/\s+/g, ' ').trim();
    return title;
}

function stripTags(s) {
    return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function buildItemDesc(title, quality, year, synopsis) {
    var lines = [];
    if (title)   lines.push(c('Titulo:  ', CGOLD) + c(title, CW));
    if (quality) lines.push(c('Calidad: ', CCYAN) + c(quality, qualityColor(quality)));
    if (year)    lines.push(c('A\u00f1o:     ', CGOLD) + c(year, CYELLOW));
    if (synopsis && synopsis.length > 10) {
        if (lines.length) lines.push('');
        lines.push(c(synopsis, CW));
    }
    if (!lines.length) return null;
    return new RichText(lines.join('<br>'));
}

function buildRaveDesc(data) {
    var lines = [];
    if (data.title)       lines.push(c('T\u00edtulo:  ', CGOLD)   + c(data.title, CW));
    if (data.genres)      lines.push(c('G\u00e9neros: ', CPURPLE) + c(data.genres, CW));
    if (data.releaseDate) lines.push(c('Estreno: ', CGOLD)        + c(data.releaseDate, CYELLOW));
    if (data.duration)    lines.push(c('Duraci\u00f3n:', CGOLD)   + c(data.duration, CW));
    if (data.rating) {
        var rn = parseFloat(data.rating);
        lines.push(c('Rating:  ', ratingColor(rn)) + c(data.rating, ratingColor(rn)));
    }
    if (data.cast && data.cast.length) lines.push(c('Reparto: ', CSKY) + c(data.cast.slice(0, 5).join(', '), CGRAY));
    if (data.synopsis && data.synopsis.length > 10) { lines.push(''); lines.push(c(data.synopsis, CW)); }
    return new RichText(lines.join('<br>'));
}

function buildYtsDesc(data) {
    var lines = [];
    if (data.title)                        lines.push(c('Titulo:   ', CGOLD)   + c(data.title, CW));
    if (data.year)                         lines.push(c('A\u00f1o:      ', CGOLD)   + c(data.year, CYELLOW));
    if (data.genres && data.genres.length) lines.push(c('Genero:   ', CPURPLE) + c(data.genres.join(', '), CW));
    if (data.rating)                       lines.push(c('Rating:   ', ratingColor(parseFloat(data.rating))) + c(data.rating, ratingColor(parseFloat(data.rating))));
    if (data.director)                     lines.push(c('Director: ', CSKY)    + c(data.director, CW));
    if (data.cast && data.cast.length)     lines.push(c('Reparto:  ', CSKY)    + c(data.cast.slice(0, 4).join(', '), CGRAY));
    if (data.synopsis && data.synopsis.length > 10) { lines.push(''); lines.push(c(data.synopsis, CW)); }
    return new RichText(lines.join('<br>'));
}

function buildTmdbMovieDesc(movie) {
    var lines = [];
    var title    = movie.title || movie.original_title || '';
    var year     = movie.release_date ? movie.release_date.substring(0, 4) : '';
    var rating   = movie.vote_average ? (Math.round(movie.vote_average * 10) / 10).toString() : '';
    var synopsis = movie.overview || '';
    if (title)   lines.push(c('T\u00edtulo:  ', CGOLD) + c(title, CW));
    if (year)    lines.push(c('A\u00f1o:     ', CGOLD) + c(year, CYELLOW));
    if (rating)  lines.push(c('Rating:  ', ratingColor(parseFloat(rating))) + c(rating + ' / 10', ratingColor(parseFloat(rating))));
    if (synopsis && synopsis.length > 10) { lines.push(''); lines.push(c(synopsis, CW)); }
    if (!lines.length) return null;
    return new RichText(lines.join('<br>'));
}

function build1337xDesc(data, quality, year) {
    var lines = [];
    if (data.title)    lines.push(c('T\u00edtulo:  ', CGOLD)   + c(data.title, CW));
    if (year)          lines.push(c('A\u00f1o:     ', CGOLD)   + c(year, CYELLOW));
    if (quality)       lines.push(c('Calidad: ', CCYAN)        + c(quality, qualityColor(quality)));
    if (data.size)     lines.push(c('Tama\u00f1o:  ', CGOLD)   + c(data.size, CW));
    if (data.language) lines.push(c('Idioma:  ', CSKY)         + c(data.language, CW));
    if (data.genres)   lines.push(c('G\u00e9neros: ', CPURPLE) + c(data.genres, CW));
    if (data.rating) {
        var rn = parseFloat(data.rating);
        lines.push(c('IMDB:    ', ratingColor(rn)) + c('\u2605 ' + data.rating + ' / 10', ratingColor(rn)));
    }
    if (data.seeds || data.leeches)
        lines.push(c('Seeds:   ', CLIME) + c('\u25b2 ' + (data.seeds || '0'), CLIME) + c('   \u25bc ' + (data.leeches || '0'), CRED));
    if (data.uploader) lines.push(c('Subido:  ', CGOLD) + c(data.uploader, CGRAY));
    if (data.synopsis && data.synopsis.length > 10) { lines.push(''); lines.push(c(data.synopsis, CW)); }
    if (!lines.length) return null;
    return new RichText(lines.join('<br>'));
}

var LANG_TAG_MAP = {
    'lat':         'Español Latino',
    'latino':      'Español Latino',
    'latesp':      'Español Latino',
    'lat-esp':     'Español Latino',
    'esp':         'Español',
    'es':          'Español',
    'cast':        'Castellano',
    'castellano':  'Castellano',
    'eng':         'English',
    'en':          'English',
    'english':     'English',
    'dual':        'Dual',
    'sub':         'Subtitulado',
    'subesp':      'Subtitulado',
    'subtitulado': 'Subtitulado',
    'por':         'Português',
    'pt':          'Português',
    'ptbr':        'Português BR',
    'pt-br':       'Português BR',
    'ptpt':        'Português PT',
    'pt-pt':       'Português PT',
    'hi':          'Hindi',
    'hin':         'Hindi',
    'hindi':       'Hindi',
    'jap':         'Japanese',
    'ja':          'Japanese',
    'japanese':    'Japanese',
    'it':          'Italiano',
    'ita':         'Italiano',
    'italiano':    'Italiano',
    'italian':     'Italiano'
};

function extractLangTag(title) {
    var s = (title || '').replace(/\s+$/, '');
    var qualityRe = /\s*[\[({]\s*(?:4[kK]|2160[pP]|1080[pP]|720[pP]|480[pP]|HDTV|WEB-DL|WEBRip|BluRay|BDRip|BRRip|DVDRip|HDRip|MicroHD)\s*[\])}]$/i;
    var s2 = s.replace(qualityRe, '');
    var multiBracketRe = /\s*[\[({]\s*([a-zA-Z][a-zA-Z0-9\-]{0,14}(?:\s*[\/\\]\s*[a-zA-Z][a-zA-Z0-9\-]{0,14})+)\s*[\])}]$/;
    var mm = s2.match(multiBracketRe);
    if (mm) {
        var parts = mm[1].split(/\s*[\/\\]\s*/);
        var labels = [];
        for (var pi = 0; pi < parts.length; pi++) {
            var pk = parts[pi].toLowerCase();
            var pl = LANG_TAG_MAP[pk];
            if (pl && labels.indexOf(pl) === -1) labels.push(pl);
        }
        if (labels.length) {
            return { label: labels.join(' / '), clean: s2.substring(0, s2.length - mm[0].length).replace(/\s+$/, '') };
        }
    }
    var bracketRe = /\s*[\[({]\s*([a-zA-Z][a-zA-Z0-9\-]{0,14})\s*[\])}]$/;
    var m = s2.match(bracketRe);
    if (m) {
        var key = m[1].toLowerCase();
        if (LANG_TAG_MAP[key]) {
            return { label: LANG_TAG_MAP[key], clean: s2.substring(0, s2.length - m[0].length).replace(/\s+$/, '') };
        }
    }
    var bareRe = /\s+(lat|latino|lat-esp|latesp|esp|cast|castellano|eng|english|dual|sub|subesp|subtitulado|por|ptbr|pt-br|ptpt|pt-pt|hi|hin|hindi|jap|ja|japanese|ita|italiano|italian)$/i;
    m = s2.match(bareRe);
    if (m) {
        var key2 = m[1].toLowerCase();
        if (LANG_TAG_MAP[key2]) {
            return { label: LANG_TAG_MAP[key2], clean: s2.substring(0, s2.length - m[0].length).replace(/\s+$/, '') };
        }
    }
    return { label: null, clean: s2 };
}

function buildTmdbTVDesc(show) {
    var lines = [];
    var title    = show.name || show.original_name || '';
    var year     = show.first_air_date ? show.first_air_date.substring(0, 4) : '';
    var rating   = show.vote_average ? (Math.round(show.vote_average * 10) / 10).toString() : '';
    var seasons  = show.number_of_seasons ? show.number_of_seasons + ' temp.' : '';
    var synopsis = show.overview || '';
    if (title)   lines.push(c('T\u00edtulo:  ', CGOLD) + c(title, CW));
    if (year)    lines.push(c('A\u00f1o:     ', CGOLD) + c(year, CYELLOW));
    if (seasons) lines.push(c('Temp.:   ', CPURPLE) + c(seasons, CW));
    if (rating)  lines.push(c('Rating:  ', ratingColor(parseFloat(rating))) + c(rating + ' / 10', ratingColor(parseFloat(rating))));
    if (synopsis && synopsis.length > 10) { lines.push(''); lines.push(c(synopsis, CW)); }
    if (!lines.length) return null;
    return new RichText(lines.join('<br>'));
}

exports.RichText           = RichText;
exports.c                  = c;
exports.CW                 = CW;
exports.CGRAY              = CGRAY;
exports.CGOLD              = CGOLD;
exports.CCYAN              = CCYAN;
exports.CLIME              = CLIME;
exports.CGREEN             = CGREEN;
exports.CORANGE            = CORANGE;
exports.CRED               = CRED;
exports.CPURPLE            = CPURPLE;
exports.CYELLOW            = CYELLOW;
exports.CSKY               = CSKY;
exports.qualityColor       = qualityColor;
exports.ratingColor        = ratingColor;
exports.normalize          = normalize;
exports.normalizeFull      = normalizeFull;
exports.extractQuality     = extractQuality;
exports.extractYear        = extractYear;
exports.cleanMovieTitle    = cleanMovieTitle;
exports.stripTags          = stripTags;
exports.buildItemDesc      = buildItemDesc;
exports.buildRaveDesc      = buildRaveDesc;
exports.buildYtsDesc       = buildYtsDesc;
exports.buildTmdbMovieDesc = buildTmdbMovieDesc;
exports.buildTmdbTVDesc    = buildTmdbTVDesc;
exports.build1337xDesc     = build1337xDesc;
exports.extractLangTag     = extractLangTag;

var SEARCH_STOP = { 'de':1,'la':1,'el':1,'los':1,'las':1,'un':1,'una':1,'en':1,'y':1,'a':1,'the':1,'of':1,'and':1,'del':1,'le':1,'les':1,'des':1,'da':1,'o':1,'e':1,'al':1,'su':1,'se':1 };

function scoreSearch(query, title) {
    var qn = normalizeFull(query);
    var tn = normalizeFull(title);
    if (!tn) return 0;
    if (qn === tn) return 100;
    if (tn.indexOf(qn) === 0 && (tn.length === qn.length || tn.charAt(qn.length) === ' ')) return 90;
    var qRaw   = qn.split(' ');
    var qWords = [];
    for (var i = 0; i < qRaw.length; i++) {
        if (qRaw[i].length > 2 && !SEARCH_STOP[qRaw[i]]) qWords.push(qRaw[i]);
    }
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
                if (longer.indexOf(shorter) === 0 && shorter.length * 10 >= longer.length * 8) { matched++; break; }
            }
        }
    }
    return Math.floor(matched * 80 / qWords.length);
}

function filterSearch(items, query, titleFn, threshold) {
    if (!items || !items.length || !query) return items;
    var th     = threshold || 40;
    var scored = [];
    for (var i = 0; i < items.length; i++) {
        var score = scoreSearch(query, titleFn(items[i]) || '');
        if (score >= th) scored.push({ item: items[i], score: score });
    }
    scored.sort(function(a, b) { return b.score - a.score; });
    var out = [];
    for (var j = 0; j < scored.length; j++) out.push(scored[j].item);
    return out;
}

exports.scoreSearch  = scoreSearch;
exports.filterSearch = filterSearch;


var _omdbUA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
var OMDB_KEY = 'af04ad5c';

async function getOmdbInfo(title, year) {
    try {
        var cleanTitle = cleanMovieTitle(title);
        var url = 'https://www.omdbapi.com/?t=' + encodeURIComponent(cleanTitle) + '&apikey=' + OMDB_KEY + (year ? '&y=' + year : '');
        var result = JSON.parse((await _http.request(url, { headers: _omdbUA, caching: true, cacheTime: 3600, noFail: true })).toString());
        if (result.Response === 'True') return result;
        if (year) {
            url    = 'https://www.omdbapi.com/?t=' + encodeURIComponent(cleanTitle) + '&apikey=' + OMDB_KEY;
            result = JSON.parse((await _http.request(url, { headers: _omdbUA, caching: true, cacheTime: 3600, noFail: true })).toString());
            if (result.Response === 'True') return result;
        }
        url    = 'https://www.omdbapi.com/?s=' + encodeURIComponent(cleanTitle) + '&apikey=' + OMDB_KEY + (year ? '&y=' + year : '');
        result = JSON.parse((await _http.request(url, { headers: _omdbUA, caching: true, cacheTime: 3600, noFail: true })).toString());
        if (result.Response === 'True' && result.Search && result.Search.length) {
            var detail = JSON.parse((await _http.request('https://www.omdbapi.com/?i=' + result.Search[0].imdbID + '&apikey=' + OMDB_KEY, { headers: _omdbUA, caching: true, cacheTime: 3600, noFail: true })).toString());
            if (detail.Response === 'True') return detail;
        }
    } catch(e) {}
    return {};
}

function buildOmdbDesc(omdb) {
    var lines = [];
    if (omdb.Title)  lines.push(c('T\u00edtulo:   ', CGOLD)   + c(omdb.Title, CW));
    if (omdb.Year)   lines.push(c('A\u00f1o:      ', CGOLD)   + c(omdb.Year, CYELLOW));
    if (omdb.Rated)  lines.push(c('Clasif.:  ', CGRAY)        + c(omdb.Rated, CW));
    if (omdb.Genre)  lines.push(c('G\u00e9nero:   ', CPURPLE) + c(omdb.Genre, CW));
    if (omdb.Director && omdb.Director !== 'N/A')
                     lines.push(c('Director: ', CSKY)         + c(omdb.Director, CW));
    if (omdb.Actors && omdb.Actors !== 'N/A')
                     lines.push(c('Reparto:  ', CSKY)         + c(omdb.Actors, CGRAY));
    if (omdb.imdbRating && omdb.imdbRating !== 'N/A')
                     lines.push(c('IMDb:     ', ratingColor(parseFloat(omdb.imdbRating))) + c('\u2605 ' + omdb.imdbRating + ' / 10', ratingColor(parseFloat(omdb.imdbRating))));
    if (omdb.Plot && omdb.Plot !== 'N/A') { lines.push(''); lines.push(c(omdb.Plot, CW)); }
    return lines.length ? new RichText(lines.join('<br>')) : null;
}

function hex2a(hex) {
    var str = '';
    for (var i = 0; i < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
}

function unpackJs(p, a, c, k) {
    while (c--) if (k[c]) p = p.replace(new RegExp('\\b' + c.toString(a) + '\\b', 'g'), k[c]);
    return p;
}

function makeUrlCache(ttl) {
    var store = {};
    return {
        get: function(url, fn) {
            var now = Date.now();
            if (store[url] && (now - store[url].ts) < ttl) return store[url].data;
            var result = fn(url);
            if (!result.error) store[url] = { ts: now, data: result };
            return result;
        },
        invalidate: function(url) { delete store[url]; }
    };
}

exports.getOmdbInfo   = getOmdbInfo;
exports.buildOmdbDesc = buildOmdbDesc;
exports.hex2a         = hex2a;
exports.unpackJs      = unpackJs;
exports.makeUrlCache  = makeUrlCache;


