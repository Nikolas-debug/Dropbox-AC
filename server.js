
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PUERTO = process.env.PORT || 3000;

const CFG = {
  appKey:   process.env.DROPBOX_APP_KEY || '',
  appSecret: process.env.DROPBOX_APP_SECRET || '',
  refresh:  process.env.DROPBOX_REFRESH_TOKEN || '',
  usuario:  process.env.SUBIDA_USUARIO || 'calidad',
  clave:    process.env.SUBIDA_CLAVE || '',
  /* Solo hace falta si la pagina se sirve desde otro dominio. Vacio = mismo
     origen, que es lo normal aqui. */
  origen:   process.env.CORS_ORIGEN || ''
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon'
};

/* El token de Dropbox dura 4 h. Se guarda en memoria para no pedir uno nuevo
   en cada carga; si Railway reinicia el proceso, simplemente se vuelve a
   pedir. */
let cache = { token: null, vence: 0 };

/* Comparacion en tiempo constante: con === se podria adivinar el secreto
   caracter a caracter midiendo cuanto tarda en responder. */
function igualesSinFiltrar(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) {
    // Se compara igual contra si mismo para no delatar la longitud.
    let z = 0;
    for (let i = 0; i < x.length; i++) z |= x[i] ^ x[i];
    return false;
  }
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x[i] ^ y[i];
  return dif === 0;
}

async function tokenDeAcceso(forzar) {
  if (!forzar && cache.token && cache.vence > Date.now() + 300000) {
    return { token: cache.token, vence_en: Math.round((cache.vence - Date.now()) / 1000) };
  }
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: CFG.refresh,
      client_id: CFG.appKey,
      client_secret: CFG.appSecret
    })
  });
  const txt = await r.text();
  if (!r.ok) throw new Error('Dropbox ' + r.status + ': ' + txt.slice(0, 200));

  let d;
  try { d = JSON.parse(txt); }
  catch { throw new Error('Dropbox no devolvio JSON: ' + txt.slice(0, 200)); }
  if (!d.access_token) throw new Error('Dropbox no devolvio access_token.');

  cache = { token: d.access_token, vence: Date.now() + (d.expires_in || 14400) * 1000 };
  return { token: d.access_token, vence_en: d.expires_in || 14400 };
}

function responder(res, codigo, cuerpo) {
  const txt = JSON.stringify(cuerpo);
  const cab = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(txt)
  };
  if (CFG.origen) {
    cab['Access-Control-Allow-Origin'] = CFG.origen;
    cab['Vary'] = 'Origin';
  }
  res.writeHead(codigo, cab);
  res.end(txt);
}

async function leerCuerpo(req, tope = 64 * 1024) {
  let datos = '';
  for await (const trozo of req) {
    datos += trozo;
    if (datos.length > tope) throw new Error('cuerpo demasiado grande');
  }
  return datos;
}

/* El config se genera aqui, no se guarda en un archivo: asi no hay nada
   secreto que se pueda colar en un commit. */
function configDeLaPagina() {
  return '/* Generado por el servidor. No editar: sale de las variables de ' +
         'Railway. */\nwindow.SUBIDA_CFG = { REPARTIDOR: "/token" };\n';
}

function pideClave(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Subida a Dropbox", charset="UTF-8"',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify({ ok: false, error: 'Hace falta usuario y clave.' }));
}

function autorizado(req) {
  if (!CFG.clave) return false;             // sin clave puesta, no se sirve nada
  const cab = req.headers.authorization || '';
  if (!cab.startsWith('Basic ')) return false;
  let txt = '';
  try { txt = Buffer.from(cab.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const i = txt.indexOf(':');
  if (i < 0) return false;
  return igualesSinFiltrar(txt.slice(0, i), CFG.usuario) &&
         igualesSinFiltrar(txt.slice(i + 1), CFG.clave);
}

const servidor = createServer(async (req, res) => {
  const ruta = decodeURIComponent((req.url || '/').split('?')[0]);

  /* /salud queda abierto a proposito: solo dice si faltan variables, sin
     revelar ninguna, y es lo primero que uno mira cuando algo no arranca. */
  if (ruta !== '/salud' && !autorizado(req)) {
    if (!CFG.clave) {
      return responder(res, 500, { ok: false,
        error: 'Falta la variable SUBIDA_CLAVE en Railway. Sin ella no se sirve nada.' });
    }
    return pideClave(res);
  }

  /* Preflight, solo relevante si la pagina vive en otro dominio. */
  if (req.method === 'OPTIONS' && CFG.origen) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CFG.origen,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    });
    return res.end();
  }

  /* ---- estado, sin revelar ningun valor ---- */
  if (ruta === '/salud') {
    return responder(res, 200, {
      ok: true,
      variables: {
        DROPBOX_APP_KEY: !!CFG.appKey,
        DROPBOX_APP_SECRET: !!CFG.appSecret,
        DROPBOX_REFRESH_TOKEN: !!CFG.refresh,
        SUBIDA_CLAVE: !!CFG.clave
      },
      pagina: existsSync(join(RAIZ, 'Dropbox.html')),
      token_en_cache: !!cache.token
    });
  }

  /* ---- el token ---- */
  if (ruta === '/token') {
    if (req.method !== 'POST') return responder(res, 405, { ok: false, error: 'Use POST.' });

    for (const [k, v] of Object.entries({
      DROPBOX_APP_KEY: CFG.appKey, DROPBOX_APP_SECRET: CFG.appSecret,
      DROPBOX_REFRESH_TOKEN: CFG.refresh
    })) {
      if (!v) return responder(res, 500, { ok: false, error: 'Falta la variable ' + k + ' en Railway.' });
    }

    /* Quien llega aqui ya paso por Basic; no hace falta otro secreto. */
    let datos = {};
    try {
      const crudo = await leerCuerpo(req);
      if (crudo) datos = JSON.parse(crudo);
    } catch {
      return responder(res, 400, { ok: false, error: 'El cuerpo no es JSON valido.' });
    }

    try {
      const t = await tokenDeAcceso(datos.refrescar === true);
      return responder(res, 200, { ok: true, access_token: t.token, vence_en: t.vence_en });
    } catch (e) {
      return responder(res, 502, { ok: false, error: String(e.message).slice(0, 300) });
    }
  }

  /* ---- el config, generado al vuelo ---- */
  if (ruta === '/subida-config.js') {
    const txt = configDeLaPagina();
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      'Content-Length': Buffer.byteLength(txt)
    });
    return res.end(txt);
  }

  /* ---- la pagina ---- */
  const rel = ruta === '/' ? 'subida.html' : normalize(ruta).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const archivo = join(RAIZ, rel);
  if (!archivo.startsWith(RAIZ) || !existsSync(archivo)) {
    return responder(res, 404, { ok: false, error: 'No existe ' + ruta });
  }
  try {
    const datos = await readFile(archivo);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream',
      /* La pagina se reemplaza a menudo: que el navegador no se quede con
         una copia vieja y acabemos depurando un archivo que ya no existe. */
      'Cache-Control': 'no-store, must-revalidate',
      'Content-Length': datos.length
    });
    res.end(datos);
  } catch (e) {
    responder(res, 500, { ok: false, error: 'No se pudo leer ' + rel });
  }
});

servidor.listen(PUERTO, () => {
  console.log('Escuchando en el puerto ' + PUERTO);
  const faltan = Object.entries({
    DROPBOX_APP_KEY: CFG.appKey, DROPBOX_APP_SECRET: CFG.appSecret,
    DROPBOX_REFRESH_TOKEN: CFG.refresh, SUBIDA_CLAVE: CFG.clave
  }).filter(([, v]) => !v).map(([k]) => k);
  if (faltan.length) console.log('FALTAN variables en Railway: ' + faltan.join(', '));
  if (!existsSync(join(RAIZ, 'Dropbox.html'))) console.log('FALTA public/subida.html');
});
