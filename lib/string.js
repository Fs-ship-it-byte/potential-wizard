// Shim de "native/string" del plugin original — solo se usa entityDecode().

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'",
  '&nbsp;': ' ', '&apos;': "'", '&aacute;': 'á', '&eacute;': 'é',
  '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú', '&ntilde;': 'ñ',
  '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í', '&Oacute;': 'Ó',
  '&Uacute;': 'Ú', '&Ntilde;': 'Ñ'
};

function entityDecode(s) {
  if (!s) return s;
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  return s.replace(/&[a-zA-Z#0-9]+;/g, (m) => (ENTITIES[m] !== undefined ? ENTITIES[m] : m));
}

module.exports = { entityDecode };
