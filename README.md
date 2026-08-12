# BFlix Stremio Addon

Addon de Stremio no oficial, portado desde el plugin de Movian **BFlix**.
Agrega estas 5 fuentes (más 2 resolvers): **Cinecalidad, GNULA, Poseidon HD,
PelisGo, Refugio**, con **Earnvids** y **Embed69** como resolvers de enlaces
embebidos, y **TMDB** para catálogo/metadata.

## Estado actual (v1)

- ✅ Manifest + catálogo (populares y búsqueda) vía TMDB.
- ✅ Meta de películas vía TMDB.
- ✅ Stream handler: busca el título en las 5 fuentes en paralelo, arma la
  lista de enlaces (magnets → torrent, embeds → link directo cuando se puede
  resolver, o enlace externo si no).
- ⚠️ Solo **películas** por ahora (el plugin original también scrapea series/anime,
  pero no se pidieron para esta primera versión).
- ⚠️ La resolución de embeds a link directo es "best effort": VidHide/StreamWish
  se intentan resolver vía Earnvids; otros hosts se entregan como enlace externo
  (Stremio los abre igual, pero no siempre en el reproductor interno).
- ⚠️ Portado de forma semi-automática desde el JS síncrono de Movian a async/await
  de Node — la lógica de parsing (regex/HTML) es la original intacta, pero conviene
  probar cada fuente contra tráfico real antes de confiar 100% en el resultado.

## Variables de entorno

| Variable       | Descripción                                  | Requerida |
|----------------|-----------------------------------------------|-----------|
| `TMDB_API_KEY` | Tu API key de TMDB (v3 auth)                  | Sí        |
| `PORT`         | Puerto HTTP (Railway lo inyecta solo)         | No        |

## Desplegar en Railway

1. Crea un repo nuevo en GitHub con el contenido de esta carpeta y súbelo.
2. En Railway: **New Project → Deploy from GitHub repo**, elige el repo.
3. Railway detecta el `Dockerfile` automáticamente (o usa `railway.json`).
4. En **Variables**, agrega `TMDB_API_KEY` con tu clave de TMDB.
5. Railway te da una URL pública tipo `https://tuapp.up.railway.app`.
6. La URL del manifest del addon es:
   `https://tuapp.up.railway.app/manifest.json`
7. En Stremio: **Addons → Community Addons → pega esa URL → Install**.

## Desarrollo local

```bash
npm install
export TMDB_API_KEY=tu_clave
node addon.js
# abre http://localhost:7000/manifest.json
```

## Estructura

```
addon.js              # servidor Stremio (manifest, catalog, meta, stream)
lib/http.js            # shim de movian/http usando axios
lib/string.js           # shim de native/string (entityDecode)
lib/aggregator.js       # agrega resultados de las 5 fuentes y normaliza a streams
lib/sources/            # scrapers portados 1:1 desde el plugin original
  cinecalidad.js
  gnula.js
  poseidon.js
  pelisgo.js
  refugio.js
  earnvids.js           # resolver de embeds (vidhide/streamwish/filemoon...)
  embed69.js             # resolver alterno
  utils.js               # utilidades compartidas (normalización, scoring)
  tmdb.js                 # cliente TMDB con tu API key
```

## Próximos pasos sugeridos

- Portar el resto de fuentes de `extras.txt` que quieras sumar (hay ~60 más).
- Agregar soporte de series (`type: 'series'` en el manifest + lógica de
  temporada/episodio, que el plugin original ya resuelve por fuente).
- Cachear resultados de búsqueda por fuente (Redis o `node-cache`) para no
  golpear cada sitio en cada request de Stremio.
- Sumar más resolvers de embeds (uqload, okru, luluvdo, vidmoly, etc. — ya
  están portados como módulos individuales en el `extras.txt` original si
  quieres que los integre).
