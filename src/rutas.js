'use strict';

// Lógica de negocio del consultorio. Cada ruta declara qué perfiles pueden usarla; el servidor
// valida el token y el perfil ANTES de llamar al manejador (RN-05).

const crypto = require('crypto');
const {
  HttpError, DuplicadoError, rutValido, iso, paginacion, respuestaPaginada, texto
} = require('./util');
const T = require('./tiempo');

const ESTADOS = ['agendada', 'confirmada', 'cancelada', 'atendida', 'ausente'];
// Diagrama de estados de la ES2 (Figura 4). "ausente" no está aquí: lo asigna solo el sistema (RF-06).
const TRANSICIONES = {
  agendada: ['confirmada', 'cancelada', 'atendida'],
  confirmada: ['cancelada', 'atendida'],
  cancelada: [],
  atendida: [],
  ausente: []
};
const ACTIVAS = ['agendada', 'confirmada'];
const RE_ID = /^[A-Za-z0-9-]{1,40}$/;
const RE_RUT_FILTRO = /^[0-9]{7,8}-[0-9Kk]$/;

const TODOS = ['vecino', 'comunitario', 'veterinario', 'funcionario', 'jefatura', 'admin'];
const SOLICITANTES = ['vecino', 'comunitario', 'funcionario'];
const DUENOS = ['vecino', 'comunitario'];

function publica(c) {
  const { activa, ...resto } = c;
  return resto;
}

function idUnico(prefijo) {
  return `${prefijo}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function crearRutas(ctx) {
  const { cfg, dao, nucleo, m1 } = ctx;
  const tz = cfg.tz;
  const MIN = 60000;

  // ---------- utilidades internas ----------

  async function bitacora(usuario, accion, recurso) {
    try {
      const f = ctx.ahora();
      await dao.insertarBitacora({ fecha: iso(f), fechaTTL: f, rut: usuario.rut, perfil: usuario.perfil, accion, recurso });
    } catch (e) {
      console.error('No se pudo escribir la bitácora:', e.message);
    }
  }

  function idDe(valor, campo) {
    if (typeof valor !== 'string' || !RE_ID.test(valor)) {
      throw new HttpError(400, 'ID_INVALIDO', `${campo} solo admite letras, números y guiones (máx. 40)`);
    }
    return valor;
  }

  function veterinarioValido(v) {
    if (!cfg.veterinarios.includes(v)) {
      throw new HttpError(404, 'VETERINARIO_NO_ENCONTRADO', `No existe el veterinario ${v}`);
    }
    return v;
  }

  /** Revisa que `inicio` sea un bloque real del horario, futuro y dentro del horizonte. */
  function validarBloque(inicio) {
    if (typeof inicio !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(inicio)) {
      throw new HttpError(400, 'INICIO_INVALIDO', 'inicio debe ser una fecha ISO 8601 UTC, ej. 2026-11-27T12:00:00Z');
    }
    const d = new Date(inicio);
    if (Number.isNaN(d.getTime()) || iso(d) !== inicio) {
      throw new HttpError(400, 'INICIO_INVALIDO', 'inicio no es una fecha válida');
    }
    const ahora = ctx.ahora();
    if (d <= ahora) throw new HttpError(400, 'BLOQUE_FUERA_DE_RANGO', 'El bloque debe estar en el futuro');
    if (d > new Date(ahora.getTime() + cfg.horizonteDias * 24 * 60 * MIN)) {
      throw new HttpError(400, 'BLOQUE_FUERA_DE_RANGO', `Solo se agenda hasta ${cfg.horizonteDias} días adelante`);
    }
    const existe = T.bloquesDelDia(T.fechaLocal(d, tz), tz).some((b) => b.inicio === inicio);
    if (!existe) {
      throw new HttpError(400, 'BLOQUE_INVALIDO', 'Ese horario no es un bloque de 30 minutos de atención (lunes a viernes, 09:00-13:00 y 14:00-17:00)');
    }
    return { inicio, fin: iso(new Date(d.getTime() + T.MINUTOS_BLOQUE * MIN)) };
  }

  /** Tutor (o responsable, si es comunitario) del animal según el M1. */
  function responsableDe(animal) {
    return animal.comunitario ? animal.responsableRut : animal.tutorRut;
  }

  function esSuya(cita, usuario) {
    return cita.solicitanteRut.toUpperCase() === usuario.rut.toUpperCase();
  }

  // ---------- GET /horarios ----------
  async function horarios({ query }) {
    const fecha = query.get('fecha');
    if (!T.fechaValida(fecha)) throw new HttpError(400, 'FECHA_INVALIDA', 'fecha es obligatoria con formato YYYY-MM-DD');
    const pedido = query.get('veterinarioId');
    const vets = pedido ? [veterinarioValido(pedido)] : cfg.veterinarios;
    const { page, limit, skip } = paginacion(query);

    const ahoraIso = iso(ctx.ahora());
    const limite = iso(new Date(ctx.ahora().getTime() + cfg.horizonteDias * 24 * 60 * MIN));
    const bloques = T.bloquesDelDia(fecha, tz).filter((b) => b.inicio > ahoraIso && b.inicio <= limite);

    const libres = [];
    if (bloques.length > 0) {
      const desde = bloques[0].inicio;
      const hasta = bloques[bloques.length - 1].fin;
      for (const v of vets) {
        const ocupados = new Set(await dao.inicioOcupados(v, desde, hasta));
        for (const b of bloques) if (!ocupados.has(b.inicio)) libres.push({ veterinarioId: v, ...b });
      }
    }
    libres.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
    return { status: 200, body: respuestaPaginada(libres.slice(skip, skip + limit), libres.length, page, limit) };
  }

  // ---------- POST /citas (CV-01 y CV-05) ----------
  async function crearCita({ usuario, token, body }) {
    // 1) Validar entradas (antes de llamar a ningún otro servicio)
    const animalId = texto(body.animalId, 'animalId', { obligatorio: true, max: 40 });
    idDe(animalId, 'animalId');
    const motivo = texto(body.motivo, 'motivo', { max: 200 });
    const vetPedido = body.veterinarioId === undefined ? null : veterinarioValido(texto(body.veterinarioId, 'veterinarioId', { obligatorio: true, max: 20 }));
    const bloque = body.inicio === undefined ? null : validarBloque(body.inicio);

    let solicitanteRut = usuario.rut;
    if (usuario.perfil === 'funcionario') {
      // El funcionario agenda a nombre de un tutor: debe indicarlo y la persona debe existir en el núcleo
      if (typeof body.solicitanteRut !== 'string' || !rutValido(body.solicitanteRut)) {
        throw new HttpError(400, 'RUT_INVALIDO', 'solicitanteRut es obligatorio para el funcionario (formato 12345678-9)');
      }
      solicitanteRut = body.solicitanteRut.trim().toUpperCase();
      await nucleo.usuario(solicitanteRut, token);
    }

    // 2) RF-02: el animal debe existir en el M1 y no estar fallecido. Si el M1 no responde -> 503 y no se crea nada (RNF-04)
    const animal = await m1.animal(animalId, token);
    if (animal.estado === 'fallecido') {
      throw new HttpError(409, 'ANIMAL_FALLECIDO', `El animal ${animalId} figura como fallecido: no se puede agendar`);
    }
    // RF-08: animal comunitario -> agenda su responsable adulto registrado en el M1
    if (animal.comunitario && !animal.responsableRut) {
      throw new HttpError(409, 'RESPONSABLE_NO_REGISTRADO', 'El animal comunitario no tiene responsable registrado en el M1: no se agenda');
    }
    const responsable = responsableDe(animal);
    if (!responsable) {
      throw new HttpError(409, 'TUTOR_NO_REGISTRADO', 'El animal no tiene tutor registrado en el M1');
    }
    if (responsable.toUpperCase() !== solicitanteRut.toUpperCase()) {
      throw new HttpError(403, 'PERFIL_NO_AUTORIZADO', 'Solo el tutor (o el responsable, si es comunitario) puede agendar para este animal');
    }
    // (No se exige microchip: lo confirmó el cliente en la pregunta 4 de la ES2.)

    // 3) RN-06: un bloque, una cita activa. El índice único de la base evita dobles reservas aunque haya carreras.
    const ahora = ctx.ahora();
    const construir = (veterinarioId, b) => ({
      citaId: idUnico('C'),
      animalId,
      solicitanteRut,
      veterinarioId,
      inicio: b.inicio,
      fin: b.fin,
      motivo,
      estado: 'agendada',
      activa: true,
      creada: iso(ahora),
      actualizada: iso(ahora),
      historial: [{ estado: 'agendada', fecha: iso(ahora), por: usuario.rut }]
    });
    const candidatos = vetPedido ? [vetPedido] : cfg.veterinarios;

    async function intentar(b) {
      for (const v of candidatos) {
        try {
          return await dao.insertarCita(construir(v, b));
        } catch (e) {
          if (!(e instanceof DuplicadoError)) throw e;
        }
      }
      return null;
    }

    let cita = null;
    if (bloque) {
      cita = await intentar(bloque);
      if (!cita) throw new HttpError(409, 'BLOQUE_OCUPADO', 'Ese bloque ya tiene una cita activa');
    } else {
      // Sin horario explícito: se asigna el primer bloque libre (así la petición de verificación es repetible)
      const ahoraIso = iso(ahora);
      let dia = T.fechaLocal(ahora, tz);
      for (let i = 0; i <= 14 && !cita; i++, dia = T.sumaDias(dia, 1)) {
        const bloques = T.bloquesDelDia(dia, tz).filter((b) => b.inicio > ahoraIso);
        if (bloques.length === 0) continue;
        const ocupados = {};
        for (const v of candidatos) {
          ocupados[v] = new Set(await dao.inicioOcupados(v, bloques[0].inicio, bloques[bloques.length - 1].fin));
        }
        for (const b of bloques) {
          if (candidatos.every((v) => ocupados[v].has(b.inicio))) continue;
          cita = await intentar(b);
          if (cita) break;
        }
      }
      if (!cita) throw new HttpError(409, 'SIN_HORARIOS', 'No hay bloques libres en los próximos 14 días');
    }

    await bitacora(usuario, 'CITA_CREAR', cita.citaId);
    return { status: 201, body: publica(cita) };
  }

  // ---------- GET /citas ----------
  async function listarCitas({ usuario, query }) {
    await barrido();
    const { page, limit, skip } = paginacion(query);
    const filtro = {};
    const estado = query.get('estado');
    if (estado) {
      if (!ESTADOS.includes(estado)) throw new HttpError(400, 'ESTADO_INVALIDO', `estado debe ser uno de: ${ESTADOS.join(', ')}`);
      filtro.estado = estado;
    }
    const fecha = query.get('fecha');
    if (fecha) {
      if (!T.fechaValida(fecha)) throw new HttpError(400, 'FECHA_INVALIDA', 'fecha debe tener formato YYYY-MM-DD');
      filtro.desde = iso(T.localAUtc(fecha, '00:00', tz));
      filtro.hasta = iso(T.localAUtc(T.sumaDias(fecha, 1), '00:00', tz));
    }
    const vet = query.get('veterinarioId');
    if (vet) {
      if (!RE_RUT_FILTRO.test(vet)) throw new HttpError(400, 'RUT_INVALIDO', 'veterinarioId debe ser un RUT (12345678-9)');
      filtro.veterinarioId = vet;
    }
    const animalId = query.get('animalId');
    if (animalId) filtro.animalId = idDe(animalId, 'animalId');

    // RF-07: tutores y responsables solo ven sus citas; veterinario, funcionario, jefatura y admin ven la agenda general
    if (DUENOS.includes(usuario.perfil)) filtro.solicitanteRut = usuario.rut;

    const { total, datos } = await dao.listarCitas(filtro, skip, limit);
    return { status: 200, body: respuestaPaginada(datos.map(publica), total, page, limit) };
  }

  // ---------- GET /citas/{citaId} ----------
  async function obtenerCita({ usuario, params }) {
    const id = idDe(params.citaId, 'citaId');
    await barrido();
    const cita = await dao.obtenerCita(id);
    if (!cita) throw new HttpError(404, 'CITA_NO_ENCONTRADA', `No existe la cita ${id}`);
    if (DUENOS.includes(usuario.perfil) && !esSuya(cita, usuario)) {
      throw new HttpError(403, 'PERFIL_NO_AUTORIZADO', 'Esa cita no es suya');
    }
    return { status: 200, body: publica(cita) };
  }

  // ---------- PATCH /citas/{citaId}/estado (CV-02) ----------
  async function cambiarEstado({ usuario, params, body }) {
    const id = idDe(params.citaId, 'citaId');
    const destino = body.estado;
    if (typeof destino !== 'string' || !ESTADOS.includes(destino)) {
      throw new HttpError(400, 'ESTADO_INVALIDO', `estado debe ser uno de: ${ESTADOS.join(', ')}`);
    }
    // RN-08: "ausente" lo asigna solo el sistema; "atendida" solo el veterinario municipal
    if (destino === 'ausente') {
      throw new HttpError(403, 'PERFIL_NO_AUTORIZADO', 'El estado "ausente" lo asigna solo el sistema (RN-08)');
    }
    if (destino === 'atendida' && usuario.perfil !== 'veterinario') {
      throw new HttpError(403, 'PERFIL_NO_AUTORIZADO', 'Solo el veterinario municipal puede marcar una cita como atendida (RN-08)');
    }
    if (destino !== 'atendida' && !SOLICITANTES.includes(usuario.perfil)) {
      throw new HttpError(403, 'PERFIL_NO_AUTORIZADO', `El perfil ${usuario.perfil} no puede pasar una cita a "${destino}"`);
    }

    await barrido();
    const cita = await dao.obtenerCita(id);
    if (!cita) throw new HttpError(404, 'CITA_NO_ENCONTRADA', `No existe la cita ${id}`);
    if (DUENOS.includes(usuario.perfil) && !esSuya(cita, usuario)) {
      throw new HttpError(403, 'PERFIL_NO_AUTORIZADO', 'Esa cita no es suya');
    }
    if (!TRANSICIONES[cita.estado].includes(destino)) {
      throw new HttpError(409, 'TRANSICION_INVALIDA', `No se puede pasar una cita "${cita.estado}" a "${destino}"`);
    }

    const ahora = ctx.ahora();

    if (destino === 'cancelada') {
      // RN-07: al menos 24 horas de anticipación
      const faltan = new Date(cita.inicio).getTime() - ahora.getTime();
      if (faltan < cfg.plazoCancelacionHoras * 60 * MIN) {
        throw new HttpError(409, 'CANCELACION_FUERA_DE_PLAZO', `Solo se puede cancelar con al menos ${cfg.plazoCancelacionHoras} horas de anticipación (RN-07)`);
      }
    }

    const evento = { estado: destino, fecha: iso(ahora), por: usuario.rut };
    const cambios = { estado: destino, activa: ACTIVAS.includes(destino) };

    const nueva = await dao.actualizarCita(id, [cita.estado], cambios, evento, iso(ahora));
    if (!nueva) {
      throw new HttpError(409, 'CONFLICTO_DE_ESTADO', 'La cita cambió mientras se procesaba; vuelva a consultarla');
    }

    await bitacora(usuario, `CITA_${destino.toUpperCase()}`, id);
    return { status: 200, body: publica(nueva) };
  }

  // ---------- PATCH /citas/{citaId}/horario (reagendar) ----------
  async function reagendar({ usuario, params, body }) {
    const id = idDe(params.citaId, 'citaId');
    const nuevo = validarBloque(body.inicio);
    await barrido();
    const cita = await dao.obtenerCita(id);
    if (!cita) throw new HttpError(404, 'CITA_NO_ENCONTRADA', `No existe la cita ${id}`);
    if (DUENOS.includes(usuario.perfil) && !esSuya(cita, usuario)) {
      throw new HttpError(403, 'PERFIL_NO_AUTORIZADO', 'Esa cita no es suya');
    }
    if (cita.estado !== 'agendada') {
      throw new HttpError(409, 'TRANSICION_INVALIDA', 'Solo se puede reagendar una cita en estado "agendada"');
    }
    const ahora = ctx.ahora();
    if (new Date(cita.inicio).getTime() - ahora.getTime() < cfg.plazoCancelacionHoras * 60 * MIN) {
      throw new HttpError(409, 'REAGENDAMIENTO_FUERA_DE_PLAZO', `Solo se puede reagendar con al menos ${cfg.plazoCancelacionHoras} horas de anticipación`);
    }
    let nueva;
    try {
      nueva = await dao.actualizarCita(id, ['agendada'], { inicio: nuevo.inicio, fin: nuevo.fin },
        { estado: 'agendada', fecha: iso(ahora), por: usuario.rut, nota: 'reagendada' }, iso(ahora));
    } catch (e) {
      if (e instanceof DuplicadoError) throw new HttpError(409, 'BLOQUE_OCUPADO', 'Ese bloque ya tiene una cita activa');
      throw e;
    }
    if (!nueva) throw new HttpError(409, 'CONFLICTO_DE_ESTADO', 'La cita cambió mientras se procesaba; vuelva a consultarla');
    await bitacora(usuario, 'CITA_REAGENDAR', id);
    return { status: 200, body: publica(nueva) };
  }

  const P = '/api/consultorio';
  return {
    barrido: async () => 0, // provisional: el barrido real llega con las ausentes automáticas
    rutas: [
      { metodo: 'GET', ruta: `${P}/horarios`, perfiles: TODOS, manejador: horarios },
      { metodo: 'POST', ruta: `${P}/citas`, perfiles: SOLICITANTES, manejador: crearCita },
      { metodo: 'GET', ruta: `${P}/citas`, perfiles: TODOS, manejador: listarCitas },
      { metodo: 'GET', ruta: `${P}/citas/:citaId`, perfiles: TODOS, manejador: obtenerCita },
      { metodo: 'PATCH', ruta: `${P}/citas/:citaId/estado`, perfiles: SOLICITANTES, manejador: cambiarEstado },
      { metodo: 'PATCH', ruta: `${P}/citas/:citaId/horario`, perfiles: SOLICITANTES, manejador: reagendar }
    ]
  };
}

module.exports = { crearRutas, ESTADOS, TRANSICIONES };
