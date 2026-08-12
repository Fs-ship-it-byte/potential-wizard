
var http = require('../http');

var E69_UA = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var out = '';
    for (var i = 0; i < s.length; i += 4) {
        var a = B64_CHARS.indexOf(s[i]);
        var b = B64_CHARS.indexOf(s[i+1]);
        var c = B64_CHARS.indexOf(s[i+2]);
        var d = B64_CHARS.indexOf(s[i+3]);
        var n = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
        out += String.fromCharCode((n >> 16) & 0xff);
        if (s[i+2] !== '=') out += String.fromCharCode((n >> 8) & 0xff);
        if (s[i+3] !== '=') out += String.fromCharCode(n & 0xff);
    }
    return out;
}

function decodeJwtLink(token) {
    try {
        var parts = token.split('.');
        if (parts.length < 2) return null;
        var decoded = JSON.parse(base64urlDecode(parts[1]));
        return decoded.link || null;
    } catch(e) { return null; }
}

async function extractBalancedJson(html, keyword) {
    var ki = html.indexOf(keyword);
    if (ki === -1) return null;
    var start = html.indexOf('{', ki);
    if (start === -1) return null;
    var depth = 0;
    var inStr = false;
    var esc = false;
    for (var i = start; i < html.length; i++) {
        var c = html[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') { if (--depth === 0) return html.substring(start, i + 1); }
    }
    return null;
}

function normalizeEmbedUrl(url) {
    if (!url) return null;
    if (/\/download\//i.test(url)) {
        if (/minochinos\.com/i.test(url))   return url.replace(/\/download\//i, '/e/');
        if (/bysedikamoum\.com/i.test(url)) return url.replace(/\/download\//i, '/e/');
        if (/filemoon\./i.test(url))        return url.replace(/\/download\//i, '/e/');
    }
    if (/voe\.sx\//i.test(url))             return url.replace(/\/download$/i, '');
    if (/ghbrisk\.com\/d\//i.test(url))     return url.replace(/\/d\//, '/e/');
    return url;
}

async function getEmbed69Links(url) {
    var html;
    try { html = (await http.request(url, { headers: E69_UA, noFail: true })).toString(); } catch(e) { return []; }
    if (!html) return [];

    var jsonStr = await extractBalancedJson(html, 'dataLink');
    if (!jsonStr) return [];

    var data;
    try { data = JSON.parse(jsonStr); } catch(e) { return []; }

    var embeds = data && data.data && data.data.embeds;
    if (!embeds || !embeds.length) return [];

    var results = [];
    for (var i = 0; i < embeds.length; i++) {
        var e = embeds[i];
        if (!e.link || !e.servername) continue;
        var link = decodeJwtLink(e.link);
        if (!link) link = typeof e.link === 'string' && /^https?:\/\//i.test(e.link) ? e.link : null;
        if (!link) continue;
        link = normalizeEmbedUrl(link);
        if (link) results.push({ name: e.servername, url: link });
    }
    return results;
}

exports.getEmbed69Links = getEmbed69Links;


