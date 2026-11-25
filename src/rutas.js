// [PENDIENTE] contenido de commits anteriores no disponible (reconstruido desde parche)

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

  function veterinarioValido(v) {
    if (!cfg.veterinarios.includes(v)) {
      throw new HttpError(404, 'VETERINARIO_NO_ENCONTRADO', `No existe el veterinario ${v}`);
    }
    return v;
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

  const P = '/api/consultorio';
  return {
    barrido: async () => 0, // provisional: el barrido real llega con las ausentes automáticas
    rutas: [
      { metodo: 'GET', ruta: `${P}/horarios`, perfiles: TODOS, manejador: horarios }
    ]
  };
}

module.exports = { crearRutas, ESTADOS, TRANSICIONES };
