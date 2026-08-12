
var http = require('../http');
var U    = require('./utils');

var TMDB_KEY = process.env.TMDB_API_KEY || 'b9896a58cdbfa6752a420e406877d1a5';
var TMDB_TTL = 30 * 60 * 1000;
var cache    = {};

async function cachedGet(url) {
    var now = Date.now();
    if (cache[url] && (now - cache[url].ts) < TMDB_TTL) return cache[url].data;
    var data = (await http.request(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).toString();
    cache[url] = { data: data, ts: now };
    return data;
}

function clearCache() { cache = {}; }

async function getTmdbBackdrop(title, year) {
    try {
        var url  = 'https://api.themoviedb.org/3/search/movie?api_key=' + TMDB_KEY + '&query=' + encodeURIComponent(title) + (year ? '&year=' + year : '') + '&language=en-US';
        var data = JSON.parse(await cachedGet(url));
        if (data.results) {
            for (var i = 0; i < data.results.length; i++) {
                if (data.results[i].backdrop_path)
                    return 'https://image.tmdb.org/t/p/original' + data.results[i].backdrop_path;
            }
        }
    } catch(e) {}
    return null;
}

async function getTmdbActorImage(name) {
    try {
        var res = JSON.parse(await cachedGet('https://api.themoviedb.org/3/search/person?api_key=' + TMDB_KEY + '&query=' + encodeURIComponent(name)));
        if (res.results && res.results.length && res.results[0].profile_path)
            return 'https://image.tmdb.org/t/p/w185' + res.results[0].profile_path;
    } catch(e) {}
    return null;
}

async function getTmdbTranslationTitles(tmdbId) {
    try {
        var data         = JSON.parse(await cachedGet('https://api.themoviedb.org/3/movie/' + tmdbId + '/translations?api_key=' + TMDB_KEY));
        var translations = data.translations || [];
        var result       = { esES: '', esMX: '', ptBR: '', ptPT: '', ja: '', it: '', hi: '', frFR: '' };
        for (var i = 0; i < translations.length; i++) {
            var t = translations[i];
            if (!t.data || !t.data.title) continue;
            if      (t.iso_639_1 === 'es' && t.iso_3166_1 === 'ES') result.esES = t.data.title;
            else if (t.iso_639_1 === 'es' && t.iso_3166_1 === 'MX') result.esMX = t.data.title;
            else if (t.iso_639_1 === 'pt' && t.iso_3166_1 === 'BR') result.ptBR = t.data.title;
            else if (t.iso_639_1 === 'pt' && t.iso_3166_1 === 'PT') result.ptPT = t.data.title;
            else if (t.iso_639_1 === 'ja') result.ja = t.data.title;
            else if (t.iso_639_1 === 'it') result.it = t.data.title;
            else if (t.iso_639_1 === 'hi') result.hi = t.data.title;
            else if (t.iso_639_1 === 'fr' && t.iso_3166_1 === 'FR') result.frFR = t.data.title;
        }
        return result;
    } catch(e) { return { esES: '', ptBR: '', ptPT: '', frFR: '' }; }
}

async function getFullMovieData(tmdbId, lang) {
    try {
        var d = JSON.parse(await cachedGet(
            'https://api.themoviedb.org/3/movie/' + tmdbId +
            '?api_key=' + TMDB_KEY +
            '&language=' + (lang || 'en-US') +
            '&append_to_response=credits,translations'
        ));
        var trans  = (d.translations && d.translations.translations) || [];
        var titles = { enUS: '', esES: '', esMX: '', ptBR: '', ptPT: '', ja: '', it: '', hi: '', frFR: '' };
        for (var i = 0; i < trans.length; i++) {
            var t = trans[i];
            if (!t.data || !t.data.title) continue;
            if      (t.iso_639_1 === 'en' && t.iso_3166_1 === 'US') titles.enUS = t.data.title;
            else if (t.iso_639_1 === 'es' && t.iso_3166_1 === 'ES') titles.esES = t.data.title;
            else if (t.iso_639_1 === 'es' && t.iso_3166_1 === 'MX') titles.esMX = t.data.title;
            else if (t.iso_639_1 === 'pt' && t.iso_3166_1 === 'BR') titles.ptBR = t.data.title;
            else if (t.iso_639_1 === 'pt' && t.iso_3166_1 === 'PT') titles.ptPT = t.data.title;
            else if (t.iso_639_1 === 'ja') titles.ja = t.data.title;
            else if (t.iso_639_1 === 'it') titles.it = t.data.title;
            else if (t.iso_639_1 === 'hi') titles.hi = t.data.title;
            else if (t.iso_639_1 === 'fr' && t.iso_3166_1 === 'FR') titles.frFR = t.data.title;
        }
        return {
            data:     d,
            imdbId:   d.imdb_id || '',
            backdrop: d.backdrop_path ? 'https://image.tmdb.org/t/p/original' + d.backdrop_path : null,
            titles:   titles
        };
    } catch(e) { return null; }
}

function tmdbMatchScore(query, candidate) {
    if (!query || !candidate) return 0;
    var q    = U.normalizeFull(query);
    var cand = U.normalizeFull(candidate);
    if (!q || !cand) return 0;
    if (q === cand) return 100;
    if (cand.indexOf(q) !== -1) return 90;
    var qWords    = q.split(' ');
    var candWords = cand.split(' ');
    var sig       = [];
    for (var i = 0; i < qWords.length; i++) { if (qWords[i].length > 3) sig.push(qWords[i]); }
    if (!sig.length) return 0;
    var candSet = {};
    for (var k = 0; k < candWords.length; k++) { candSet[candWords[k]] = true; }
    var hits = 0;
    for (var j = 0; j < sig.length; j++) { if (candSet[sig[j]]) hits++; }
    if (hits === sig.length) return 80;
    if (sig.length >= 3 && hits >= sig.length - 1) return 60;
    return 0;
}

async function getTmdbMovieInfo(title, year) {
    try {
        var url  = 'https://api.themoviedb.org/3/search/movie?api_key=' + TMDB_KEY + '&query=' + encodeURIComponent(title) + (year ? '&year=' + year : '') + '&language=en-US';
        var data = JSON.parse(await cachedGet(url));
        if (!data.results || !data.results.length) return null;
        var r        = data.results[0];
        var tmdbId   = r.id;
        var enTitle  = r.title || r.original_title || '';
        var backdrop = r.backdrop_path ? 'https://image.tmdb.org/t/p/original' + r.backdrop_path : null;
        var ids      = JSON.parse(await cachedGet('https://api.themoviedb.org/3/movie/' + tmdbId + '/external_ids?api_key=' + TMDB_KEY));
        return { tmdbId: tmdbId, imdbId: ids.imdb_id || '', enTitle: enTitle, backdrop: backdrop };
    } catch(e) { return null; }
}

async function getActorFilms(name) {
    try {
        var res = JSON.parse(await cachedGet('https://api.themoviedb.org/3/search/person?api_key=' + TMDB_KEY + '&query=' + encodeURIComponent(name)));
        if (!res.results || !res.results.length) return null;
        var person  = res.results[0];
        var credits = JSON.parse(await cachedGet('https://api.themoviedb.org/3/person/' + person.id + '/movie_credits?api_key=' + TMDB_KEY));
        var cast    = credits.cast || [];
        cast.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
        return {
            personId:   person.id,
            name:       person.name,
            profileImg: person.profile_path ? 'https://image.tmdb.org/t/p/w185' + person.profile_path : null,
            movies:     cast
        };
    } catch(e) { return null; }
}

async function getTmdbTVInfo(title, year) {
    try {
        var url  = 'https://api.themoviedb.org/3/search/tv?api_key=' + TMDB_KEY + '&query=' + encodeURIComponent(title) + (year ? '&first_air_date_year=' + year : '') + '&language=en-US';
        var data = JSON.parse(await cachedGet(url));
        if (!data.results || !data.results.length) return null;
        var r        = data.results[0];
        var tmdbId   = r.id;
        var enTitle  = r.name || r.original_name || '';
        var backdrop = r.backdrop_path ? 'https://image.tmdb.org/t/p/original' + r.backdrop_path : null;
        var ids      = JSON.parse(await cachedGet('https://api.themoviedb.org/3/tv/' + tmdbId + '/external_ids?api_key=' + TMDB_KEY));
        return { tmdbId: tmdbId, imdbId: ids.imdb_id || '', enTitle: enTitle, backdrop: backdrop };
    } catch(e) { return null; }
}

async function getFullTVData(tmdbId, lang) {
    try {
        var d = JSON.parse(await cachedGet(
            'https://api.themoviedb.org/3/tv/' + tmdbId +
            '?api_key=' + TMDB_KEY +
            '&language=' + (lang || 'en-US') +
            '&append_to_response=credits,translations,external_ids'
        ));
        var trans  = (d.translations && d.translations.translations) || [];
        var titles = { enUS: '', esES: '', esMX: '', ptBR: '', ptPT: '', ja: '', it: '', hi: '', frFR: '' };
        for (var i = 0; i < trans.length; i++) {
            var t = trans[i];
            if (!t.data || !t.data.name) continue;
            if      (t.iso_639_1 === 'en' && t.iso_3166_1 === 'US') titles.enUS = t.data.name;
            else if (t.iso_639_1 === 'es' && t.iso_3166_1 === 'ES') titles.esES = t.data.name;
            else if (t.iso_639_1 === 'es' && t.iso_3166_1 === 'MX') titles.esMX = t.data.name;
            else if (t.iso_639_1 === 'pt' && t.iso_3166_1 === 'BR') titles.ptBR = t.data.name;
            else if (t.iso_639_1 === 'pt' && t.iso_3166_1 === 'PT') titles.ptPT = t.data.name;
            else if (t.iso_639_1 === 'ja') titles.ja = t.data.name;
            else if (t.iso_639_1 === 'it') titles.it = t.data.name;
            else if (t.iso_639_1 === 'hi') titles.hi = t.data.name;
            else if (t.iso_639_1 === 'fr' && t.iso_3166_1 === 'FR') titles.frFR = t.data.name;
        }
        return {
            data:     d,
            imdbId:   (d.external_ids && d.external_ids.imdb_id) || '',
            backdrop: d.backdrop_path ? 'https://image.tmdb.org/t/p/original' + d.backdrop_path : null,
            titles:   titles
        };
    } catch(e) { return null; }
}

async function getTmdbSeason(tmdbId, seasonNum, lang) {
    try {
        return JSON.parse(await cachedGet(
            'https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + seasonNum +
            '?api_key=' + TMDB_KEY + '&language=' + (lang || 'en-US')
        ));
    } catch(e) { return null; }
}

async function getActorTV(name) {
    try {
        var res = JSON.parse(await cachedGet('https://api.themoviedb.org/3/search/person?api_key=' + TMDB_KEY + '&query=' + encodeURIComponent(name)));
        if (!res.results || !res.results.length) return null;
        var person  = res.results[0];
        var credits = JSON.parse(await cachedGet('https://api.themoviedb.org/3/person/' + person.id + '/tv_credits?api_key=' + TMDB_KEY));
        var cast    = credits.cast || [];
        cast.sort(function(a, b) { return (b.popularity || 0) - (a.popularity || 0); });
        return { personId: person.id, name: person.name, profileImg: person.profile_path ? 'https://image.tmdb.org/t/p/w185' + person.profile_path : null, shows: cast };
    } catch(e) { return null; }
}

exports.TMDB_KEY                 = TMDB_KEY;
exports.cachedGet                = cachedGet;
exports.clearCache               = clearCache;
exports.getTmdbBackdrop          = getTmdbBackdrop;
exports.getTmdbActorImage        = getTmdbActorImage;
exports.getTmdbTranslationTitles = getTmdbTranslationTitles;
exports.getFullMovieData         = getFullMovieData;
exports.getTmdbMovieInfo         = getTmdbMovieInfo;
exports.tmdbMatchScore           = tmdbMatchScore;
exports.getActorFilms            = getActorFilms;
exports.getActorTV               = getActorTV;
exports.getTmdbTVInfo            = getTmdbTVInfo;
exports.getFullTVData            = getFullTVData;
exports.getTmdbSeason            = getTmdbSeason;


