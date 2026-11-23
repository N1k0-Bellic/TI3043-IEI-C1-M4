'use strict';

/** Error controlado: lleva el código HTTP y el cuerpo estándar de la ficha. */
class HttpError extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

/** Se lanza desde el DAO cuando se viola el índice único (veterinario + bloque activo). */
class DuplicadoError extends Error {}

function enviarJson(res, status, cuerpo) {
  const s = JSON.stringify(cuerpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s)
  });
  res.end(s);
}

/** Valida un RUT chileno: sin puntos, con guión, dígito verificador correcto (misma regla del núcleo). */
function rutValido(rut) {
  if (typeof rut !== 'string') return false;
  const m = /^(\d{7,8})-([\dkK])$/.exec(rut.trim());
  if (!m) return false;
  const cuerpo = m[1];
  const dv = m[2].toUpperCase();
  let suma = 0;
  let mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === esperado;
}

/** Fecha ISO 8601 UTC sin milisegundos: 2026-11-27T11:30:00Z (comparable como texto). */
function iso(fecha) {
  return fecha.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Lee ?page=&limit= (page >= 1, limit 1..100, por defecto 20). `query` es un URLSearchParams. */
function paginacion(query) {
  let page = parseInt(query.get('page'), 10);
  let limit = parseInt(query.get('limit'), 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  return { page, limit, skip: (page - 1) * limit };
}

function respuestaPaginada(datos, total, page, limit) {
  return { page, limit, total, totalPaginas: Math.max(1, Math.ceil(total / limit)), datos };
}

/** Lee el cuerpo JSON (máx. 10 kb). Cuerpo vacío = {}. Solo se aceptan objetos. */
function leerJson(req, max = 10240) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let largo = 0;
    req.on('data', (t) => {
      largo += t.length;
      if (largo > max) {
        reject(new HttpError(413, 'CUERPO_DEMASIADO_GRANDE', 'El cuerpo supera el máximo permitido (10 kb)'));
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on('end', () => {
      const texto = Buffer.concat(trozos).toString('utf8').trim();
      if (!texto) return resolve({});
      try {
        const v = JSON.parse(texto);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
          return reject(new HttpError(400, 'JSON_INVALIDO', 'El cuerpo debe ser un objeto JSON'));
        }
        resolve(v);
      } catch (e) {
        reject(new HttpError(400, 'JSON_INVALIDO', 'El cuerpo de la petición no es JSON válido'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'SOLICITUD_INVALIDA', 'No se pudo leer la petición')));
  });
}

/** Valida un texto: tipo string, recortado, con largo máximo. Evita objetos tipo {"$ne": null} (inyección NoSQL). */
function texto(valor, campo, { min = 0, max = 500, obligatorio = false } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (obligatorio) throw new HttpError(400, 'DATOS_INVALIDOS', `${campo} es obligatorio`);
    return '';
  }
  if (typeof valor !== 'string') throw new HttpError(400, 'DATOS_INVALIDOS', `${campo} debe ser texto`);
  const t = valor.trim();
  if (obligatorio && t.length === 0) throw new HttpError(400, 'DATOS_INVALIDOS', `${campo} es obligatorio`);
  if (t.length > 0 && t.length < min) throw new HttpError(400, 'DATOS_INVALIDOS', `${campo} debe tener al menos ${min} caracteres`);
  if (t.length > max) throw new HttpError(400, 'DATOS_INVALIDOS', `${campo} no puede superar ${max} caracteres`);
  return t;
}

module.exports = { HttpError, DuplicadoError, enviarJson, rutValido, iso, paginacion, respuestaPaginada, leerJson, texto };
