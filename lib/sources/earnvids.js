
var http = require('../http');
var U    = require('./utils');

var UA_HDR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

var unpackJs = U.unpackJs;

function getBase(url) {
    var m = url.match(/^(https?:\/\/[^\/]+)/i);
    return m ? m[1] : 'https://earnvids.com';
}

function makeAbsolute(url, base) {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.indexOf('//') === 0)   return 'https:' + url;
    if (url.indexOf('/') === 0)    return base + url;
    return base + '/' + url;
}

function parseJsObj(str) {
    try {
        var clean = str
            .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
            .replace(/:\s*'([^']*)'/g, ':"$1"')
            .replace(/,\s*\}/g, '}');
        return JSON.parse(clean);
    } catch(e) {}
    return null;
}

function extractM3u8FromObj(obj, base) {
    if (!obj) return null;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
        var v = obj[keys[i]];
        if (v && typeof v === 'string' && v.indexOf('master.m3u8') !== -1)
            return makeAbsolute(v, base);
    }
    for (var j = 0; j < keys.length; j++) {
        var v2 = obj[keys[j]];
        if (v2 && typeof v2 === 'string' && v2.indexOf('.m3u8') !== -1)
            return makeAbsolute(v2, base);
    }
    for (var k = 0; k < keys.length; k++) {
        var v3 = obj[keys[k]];
        if (v3 && typeof v3 === 'string' && (v3.indexOf('/hls/') !== -1 || v3.indexOf('.mp4') !== -1))
            return makeAbsolute(v3, base);
    }
    return null;
}

function findHlsInCode(code, base) {
    var sourceRefM = code.match(/(?:sources?|file)\s*:\s*(?:\[?\s*\{[^}]*(?:file|src)\s*:\s*)?([a-zA-Z_$][a-zA-Z0-9_$]{0,4})\s*\.\s*([a-zA-Z0-9_]+)\s*\|\|\s*\1\s*\.\s*([a-zA-Z0-9_]+)(?:\s*\|\|\s*\1\s*\.\s*([a-zA-Z0-9_]+))?/i);
    if (sourceRefM) {
        var varName = sourceRefM[1];
        var keys = [sourceRefM[2], sourceRefM[3]];
        if (sourceRefM[4]) keys.push(sourceRefM[4]);
        var varRe = new RegExp('var\\s+' + varName.replace('$', '\\$') + '\\s*=\\s*(\\{[\\s\\S]{1,800}?\\})', 'i');
        var vm = code.match(varRe);
        if (vm) {
            var vo = parseJsObj(vm[1]);
            if (vo) {
                for (var ki = 0; ki < keys.length; ki++) {
                    var kv = vo[keys[ki]];
                    if (kv && kv.indexOf('.m3u8') !== -1) return makeAbsolute(kv, base);
                }
                var fallback = extractM3u8FromObj(vo, base);
                if (fallback) return fallback;
            }
        }
    }

    var lm = code.match(/var\s+links\s*=\s*(\{[^}]+\})/i);
    if (lm) {
        var lo = parseJsObj(lm[1]);
        if (lo) {
            var lcandidates = [lo.hls4, lo.hls3, lo.hls2];
            var lu = null;
            for (var ci = 0; ci < lcandidates.length; ci++) {
                if (lcandidates[ci] && lcandidates[ci].indexOf('.m3u8') !== -1) {
                    lu = lcandidates[ci];
                    break;
                }
            }
            if (!lu) lu = lo.hls4 || lo.hls3 || lo.hls2 || null;
            if (lu) return makeAbsolute(lu, base);
        }
    }

    var anyVarM = code.match(/var\s+([a-zA-Z_$][a-zA-Z0-9_$]{0,4})\s*=\s*(\{[^{}]{10,800}\})/g);
    if (anyVarM) {
        for (var vi = 0; vi < anyVarM.length; vi++) {
            var vm2 = anyVarM[vi].match(/var\s+([a-zA-Z_$][a-zA-Z0-9_$]{0,4})\s*=\s*(\{[^{}]{10,800}\})/);
            if (!vm2) continue;
            if (vm2[2].indexOf('m3u8') === -1 && vm2[2].indexOf('/hls/') === -1) continue;
            var vo2 = parseJsObj(vm2[2]);
            if (!vo2) continue;
            var found = extractM3u8FromObj(vo2, base);
            if (found) return found;
        }
    }

    var om = code.match(/var\s+o\s*=\s*(\{[^}]+\})/i);
    if (om) {
        var oo = parseJsObj(om[1]);
        if (oo) {
            var sm = code.match(/(?:sources|1o)\s*:\s*\[\s*\{\s*(?:file|1o)\s*:\s*o\.(\w+)\s*\|\|\s*o\.(\w+)(?:\s*\|\|\s*o\.(\w+))?/i);
            if (sm) {
                var su = oo[sm[1]] || oo[sm[2]] || (sm[3] ? oo[sm[3]] : null);
                if (su) return makeAbsolute(su, base);
            }
            var ores = extractM3u8FromObj(oo, base);
            if (ores) return ores;
        }
    }

    var fm = code.match(/(?:file|1o)\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/i);
    if (fm) return makeAbsolute(fm[1], base);

    var am = code.match(/(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/i);
    if (am) return am[1];

    var rm = code.match(/["'](\/?[^"'\s]+\.m3u8[^"'\s]*?)["']/i);
    if (rm) return makeAbsolute(rm[1], base);

    return null;
}

function resolveFilelionsUrl(rawUrl) {
    var m = rawUrl.match(/filelions\.(?:to|tv|com)\/v\/([a-zA-Z0-9]+)/i);
    if (!m) return [rawUrl];
    var id = m[1];
    return ['https://callistanise.com/embed/' + id, 'https://callistanise.com/v/' + id];
}

async function extractHlsUrl(embedUrl) {
    if (/ghbrisk\.com\/d\//i.test(embedUrl)) embedUrl = embedUrl.replace(/\/d\//, '/e/');
    if (/morencius\.com\/download\//i.test(embedUrl))  embedUrl = embedUrl.replace('/download/', '/embed/');
    if (/minochinos\.com\/download\//i.test(embedUrl)) embedUrl = embedUrl.replace('/download/', '/embed/');
    var candidates = /filelions\.(?:to|tv|com)\/v\//i.test(embedUrl) ? resolveFilelionsUrl(embedUrl) : [embedUrl];
    for (var ci = 0; ci < candidates.length; ci++) {
        try {
            var candidate = candidates[ci];
            var base = getBase(candidate);
            var html = (await http.request(candidate, { headers: UA_HDR, noFail: true })).toString();
            if (!html) continue;
            var em = html.match(/}\s*\(\s*'([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)\s*\)/im);
            if (em) {
                var decoded = unpackJs(em[1], parseInt(em[2], 10), parseInt(em[3], 10), em[4].split('|'));
                var found = findHlsInCode(decoded, base);
                if (found) return found;
            }
            var found2 = findHlsInCode(html, base);
            if (found2) return found2;
        } catch(e) {}
    }
    return null;
}

exports.extractHlsUrl = extractHlsUrl;


