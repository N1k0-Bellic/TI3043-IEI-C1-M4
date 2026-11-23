'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { HttpError, enviarJson, leerJson } = require('./util');
const { crearRutas } = require('./rutas');

const PUBLICO = path.join(__dirname, '..', 'public');
const ESTATICOS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/estilos.css': ['estilos.css', 'text/css; charset=utf-8']
};

function compilar(patron) {
  const nombres = [];
  const re = patron.replace(/:([A-Za-z]+)/g, (_, n) => { nombres.push(n); return '([^/]+)'; });
  return { regex: new RegExp(`^${re}$`), nombres };
}

function crearServidor({ cfg, dao, nucleo, m1, ahora = () => new Date() }) {
  const ctx = { cfg, dao, nucleo, m1, ahora };
  const { rutas, barrido } = crearRutas(ctx);
  const tabla = rutas.map((r) => ({ ...r, ...compilar(r.ruta) }));

  // Los archivos de la interfaz se leen una sola vez, de una lista cerrada (no se sirve nada que venga de la URL)
  const archivos = {};
  for (const [ruta, [nombre, tipo]] of Object.entries(ESTATICOS)) {
    archivos[ruta] = { tipo, contenido: fs.readFileSync(path.join(PUBLICO, nombre)) };
  }

  let origenNucleo = '';
  try { origenNucleo = new URL(cfg.nucleoUrl).origin; } catch (e) { /* URL inválida: la CSP queda solo con 'self' */ }

  // OWASP A05: encabezados de seguridad en TODAS las respuestas
  function encabezados(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    res.setHeader('Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${origenNucleo}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    res.setHeader('Cache-Control', 'no-store');
  }

  // OWASP A04/A07: límite simple de peticiones por IP y minuto
  const visitas = new Map();
  const limpiador = setInterval(() => visitas.clear(), 60000);
  limpiador.unref();
  function limitar(req) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const n = (visitas.get(ip) || 0) + 1;
    visitas.set(ip, n);
    if (n > cfg.limitePorMinuto) throw new HttpError(429, 'DEMASIADAS_PETICIONES', 'Demasiadas peticiones; espere un minuto');
  }

  function cors(req, res) {
    if (cfg.corsOrigin && req.headers.origin === cfg.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    }
  }

  /** Token válido en el núcleo (401 si falta o es inválido; 503 si el núcleo no responde). */
  async function autenticar(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    if (!m) throw new HttpError(401, 'TOKEN_REQUERIDO', 'Falta el encabezado Authorization: Bearer <token>');
    const token = m[1];
    const usuario = await nucleo.sesionActual(token);
    return { token, usuario };
  }

  async function manejar(req, res) {
    encabezados(res);
    cors(req, res);

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (e) {
      throw new HttpError(400, 'SOLICITUD_INVALIDA', 'URL mal formada');
    }
    const ruta = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    if (req.method === 'GET' && archivos[ruta]) {
      res.writeHead(200, { 'Content-Type': archivos[ruta].tipo });
      return res.end(archivos[ruta].contenido);
    }

    if (!ruta.startsWith('/api/consultorio')) {
      throw new HttpError(404, 'RUTA_NO_ENCONTRADA', `No existe ${req.method} ${ruta}`);
    }
    limitar(req);

    // Rutas públicas mínimas: salud (para Render) y configuración de la interfaz (URL del núcleo, no es secreto)
    if (req.method === 'GET' && ruta === '/api/consultorio/salud') {
      return enviarJson(res, 200, { estado: 'ok', servicio: 'consultorio-m4', almacenamiento: dao.tipo, hora: new Date().toISOString() });
    }
    if (req.method === 'GET' && ruta === '/api/consultorio/config') {
      return enviarJson(res, 200, { nucleoUrl: cfg.nucleoUrl });
    }

    let params = null;
    let def = null;
    for (const r of tabla) {
      if (r.metodo !== req.method) continue;
      const m = r.regex.exec(ruta);
      if (!m) continue;
      def = r;
      params = {};
      r.nombres.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      break;
    }
    if (!def) throw new HttpError(404, 'RUTA_NO_ENCONTRADA', `No existe ${req.method} ${ruta}`);

    // RN-05: primero token (401), luego perfil (403), y solo después se lee el cuerpo
    const { token, usuario } = await autenticar(req);
    if (!def.perfiles.includes(usuario.perfil)) {
      throw new HttpError(403, 'PERFIL_NO_AUTORIZADO', `Se requiere perfil: ${def.perfiles.join(', ')}`);
    }
    const body = (req.method === 'POST' || req.method === 'PATCH') ? await leerJson(req) : {};
    const r = await def.manejador({ req, usuario, token, params, query: url.searchParams, body });
    enviarJson(res, r.status, r.body);
  }

  const servidor = http.createServer((req, res) => {
    manejar(req, res).catch((e) => {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) {
        return enviarJson(res, e.status, { error: { codigo: e.codigo, mensaje: e.message } });
      }
      // OWASP A09/A05: el detalle se registra en el servidor, jamás se envía al cliente
      console.error(`${new Date().toISOString()} error no controlado en ${req.method} ${String(req.url).split('?')[0]}:`, e);
      enviarJson(res, 500, { error: { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error interno' } });
    });
  });
  servidor.barrido = barrido;
  return servidor;
}

module.exports = { crearServidor };
