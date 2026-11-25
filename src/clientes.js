'use strict';

// Clientes HTTP hacia los otros módulos: núcleo (identidad) y M1 (animales).
// Si un servicio externo falla, este módulo responde 503 en pocos segundos y NO deja pasar la petición (RNF-04).

const { HttpError } = require('./util');

async function pedir(url, opciones, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opciones, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function crearClienteNucleo(cfg) {
  const base = `${cfg.nucleoUrl}/api/nucleo`;
  // Caché corta de tokens ya validados: baja la carga sobre el núcleo (RNF-03). 30 s es poco comparado con las 8 h del token.
  const cache = new Map();
  const TTL_MS = 30000;

  async function llamar(ruta, token) {
    try {
      return await pedir(`${base}${ruta}`, { headers: { Authorization: `Bearer ${token}` } }, cfg.nucleoTimeoutMs);
    } catch (e) {
      throw new HttpError(503, 'NUCLEO_NO_DISPONIBLE', 'No se pudo validar la sesión con el núcleo; intente nuevamente');
    }
  }

  return {
    /** Valida el token en el núcleo: devuelve {rut, perfil, nombre} o lanza 401/503. */
    async sesionActual(token) {
      const hit = cache.get(token);
      if (hit && hit.hasta > Date.now()) return hit.usuario;
      const r = await llamar('/sesiones/actual', token);
      if (r.status === 401) throw new HttpError(401, 'TOKEN_INVALIDO', 'El token no es válido o expiró');
      if (r.status !== 200) throw new HttpError(503, 'NUCLEO_NO_DISPONIBLE', 'El núcleo respondió de forma inesperada');
      const d = await r.json();
      const usuario = { rut: d.rut, perfil: d.perfil, nombre: d.nombre };
      if (cache.size > 1000) cache.clear();
      cache.set(token, { usuario, hasta: Date.now() + TTL_MS });
      return usuario;
    },

    /** Datos básicos de una persona (lo usa el funcionario al agendar a nombre de un vecino). */
    async usuario(rut, token) {
      const r = await llamar(`/usuarios/${encodeURIComponent(rut)}`, token);
      if (r.status === 200) return r.json();
      if (r.status === 404) throw new HttpError(404, 'USUARIO_NO_ENCONTRADO', `No existe una persona con RUT ${rut}`);
      if (r.status === 401) throw new HttpError(401, 'TOKEN_INVALIDO', 'El token no es válido o expiró');
      if (r.status === 403) throw new HttpError(403, 'PERFIL_NO_AUTORIZADO', 'No puede consultar a esa persona');
      throw new HttpError(503, 'NUCLEO_NO_DISPONIBLE', 'El núcleo respondió de forma inesperada');
    }
  };
}

function crearClienteM1(cfg) {
  return {
    /**
     * GET /animales/{id} del M1 con el MISMO token del usuario: así el propio M1 aplica RN-05
     * (un vecino solo ve sus animales). Devuelve el animal o lanza 404/403/401/503.
     */
    async animal(animalId, token) {
      let r;
      try {
        r = await pedir(`${cfg.m1Url}/animales/${encodeURIComponent(animalId)}`,
          { headers: { Authorization: `Bearer ${token}` } }, cfg.m1TimeoutMs);
      } catch (e) {
        throw new HttpError(503, 'M1_NO_DISPONIBLE', 'El registro de animales (M1) no responde; no se agendó nada, intente más tarde');
      }
      if (r.status === 200) return r.json();
      if (r.status === 404) throw new HttpError(404, 'ANIMAL_NO_ENCONTRADO', `El animal ${animalId} no existe en el registro (M1)`);
      if (r.status === 403) throw new HttpError(403, 'PERFIL_NO_AUTORIZADO', 'El animal no está a su nombre');
      if (r.status === 401) throw new HttpError(401, 'TOKEN_INVALIDO', 'El token no es válido o expiró');
      throw new HttpError(503, 'M1_NO_DISPONIBLE', 'El registro de animales (M1) respondió de forma inesperada');
    }
  };
}

module.exports = { crearClienteNucleo, crearClienteM1 };
