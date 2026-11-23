'use strict';

// Pruebas de extremo a extremo SIN red ni Atlas: levanta un núcleo y un M1 simulados (http nativo),
// el módulo con el DAO en memoria, y le hace peticiones reales. Ejecutar: npm test

const http = require('http');
const assert = require('assert');
const { cargarConfig } = require('../src/config');
const { crearClienteNucleo, crearClienteM1 } = require('../src/clientes');
const { crearServidor } = require('../src/app');
const { DAOMemoria } = require('../src/dao/memoria');
const { sembrarDemo } = require('../src/semilla');
const { iso } = require('../src/util');
const T = require('../src/tiempo');

// ---------- Núcleo y M1 simulados ----------
const TOKENS = {
  'tok-vecino1': { rut: '11111111-1', perfil: 'vecino', nombre: 'Carolina Rojas Pizarro' },
  'tok-vecino2': { rut: '12222222-5', perfil: 'vecino', nombre: 'Marcelo Araya Soto' },
  'tok-com1': { rut: '13333333-9', perfil: 'comunitario', nombre: 'Patricia Muñoz Lagos' },
  'tok-com2': { rut: '14444444-2', perfil: 'comunitario', nombre: 'Jorge Tapia Cortés' },
  'tok-vet': { rut: '15555555-6', perfil: 'veterinario', nombre: 'Dra. Valentina Herrera Díaz' },
  'tok-func': { rut: '17777777-3', perfil: 'funcionario', nombre: 'Claudia Vega Morales' },
  'tok-jef': { rut: '19999999-0', perfil: 'jefatura', nombre: 'María José Salinas Ruiz' },
  'tok-admin': { rut: '21222222-4', perfil: 'admin', nombre: 'Admin Sistema' }
};
const ANIMALES = {
  'SIM-000001': { animalId: 'SIM-000001', nombre: 'Cholito', estado: 'con_microchip', tutorRut: '11111111-1', comunitario: false, responsableRut: null },
  'SIM-000002': { animalId: 'SIM-000002', nombre: 'Misha', estado: 'registrado', tutorRut: '11111111-1', comunitario: false, responsableRut: null },
  'SIM-000003': { animalId: 'SIM-000003', nombre: 'Rocky', estado: 'inscrito', tutorRut: '12222222-5', comunitario: false, responsableRut: null },
  'SIM-000004': { animalId: 'SIM-000004', nombre: 'Kaiser', estado: 'fallecido', tutorRut: '12222222-5', comunitario: false, responsableRut: null },
  'SIM-000005': { animalId: 'SIM-000005', nombre: 'Negro', estado: 'con_microchip', tutorRut: null, comunitario: true, responsableRut: '13333333-9' },
  'SIM-000099': { animalId: 'SIM-000099', nombre: 'Sin responsable', estado: 'registrado', tutorRut: null, comunitario: true, responsableRut: null }
};
let m1Caido = false;

function mock(manejador) {
  return new Promise((resolve) => {
    const s = http.createServer(manejador);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
function json(res, status, cuerpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}
function usuarioDe(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
  return m ? TOKENS[m[1]] : null;
}

const nucleoMock = () => mock((req, res) => {
  const u = usuarioDe(req);
  if (req.url === '/api/nucleo/sesiones/actual') return u ? json(res, 200, u) : json(res, 401, { error: { codigo: 'TOKEN_INVALIDO', mensaje: 'x' } });
  const m = /^\/api\/nucleo\/usuarios\/(.+)$/.exec(req.url);
  if (m) {
    if (!u) return json(res, 401, {});
    const e = Object.values(TOKENS).find((t) => t.rut === decodeURIComponent(m[1]));
    return e ? json(res, 200, e) : json(res, 404, {});
  }
  json(res, 404, {});
});
const m1Mock = () => mock((req, res) => {
  if (m1Caido) return req.socket.destroy();
  const u = usuarioDe(req);
  if (!u) return json(res, 401, {});
  const m = /^\/animales\/([^/?]+)$/.exec(req.url);
  if (!m) return json(res, 404, {});
  const a = ANIMALES[decodeURIComponent(m[1])];
  if (!a) return json(res, 404, {});
  if (['vecino', 'comunitario'].includes(u.perfil) && (a.comunitario ? a.responsableRut : a.tutorRut) !== u.rut) return json(res, 403, {});
  json(res, 200, a);
});

// ---------- Cliente de pruebas ----------
let base = '';
async function pedir(metodo, ruta, token, cuerpo) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const datos = await r.json().catch(() => ({}));
  return { status: r.status, datos, headers: r.headers };
}

let ok = 0;
let fallos = 0;
async function prueba(nombre, fn) {
  try { await fn(); ok++; console.log(`  ✔ ${nombre}`); } catch (e) { fallos++; console.log(`  ✘ ${nombre}\n      ${e.message}`); }
}
function esperar(r, status, codigo) {
  assert.strictEqual(r.status, status, `esperaba ${status}, llegó ${r.status} ${JSON.stringify(r.datos)}`);
  if (codigo) assert.strictEqual(r.datos.error && r.datos.error.codigo, codigo);
}

// Próximo día hábil (en hora local) con al menos `dias` días de distancia
function diaHabil(dias, tz) {
  let f = T.sumaDias(T.fechaLocal(new Date(), tz), dias);
  while (T.bloquesDelDia(f, tz).length === 0) f = T.sumaDias(f, 1);
  return f;
}

(async () => {
  const nucleo = await nucleoMock();
  const m1 = await m1Mock();
  const cfg = cargarConfig({
    NUCLEO_URL: `http://127.0.0.1:${nucleo.address().port}`,
    M1_URL: `http://127.0.0.1:${m1.address().port}/animales`.replace(/\/animales$/, ''),
    M1_TIMEOUT_MS: '1500'
  });
  const dao = new DAOMemoria();
  await dao.init();
  await sembrarDemo(dao, cfg);
  const app = crearServidor({ cfg, dao, nucleo: crearClienteNucleo(cfg), m1: crearClienteM1(cfg) });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
  const tz = cfg.tz;

  console.log('\nConvenciones y sesión (núcleo)');
  await prueba('GET /salud es público', async () => esperar(await pedir('GET', '/api/consultorio/salud'), 200));
  await prueba('sin token -> 401 con formato de error', async () => {
    const r = await pedir('GET', '/api/consultorio/citas');
    esperar(r, 401, 'TOKEN_REQUERIDO');
    assert.ok(r.datos.error.mensaje);
  });
  await prueba('token inválido -> 401', async () => esperar(await pedir('GET', '/api/consultorio/citas', 'basura'), 401, 'TOKEN_INVALIDO'));
  await prueba('con token -> 200 y paginado {page,limit,total,totalPaginas,datos}', async () => {
    const r = await pedir('GET', '/api/consultorio/citas?page=1&limit=5', 'tok-vet');
    esperar(r, 200);
    for (const k of ['page', 'limit', 'total', 'totalPaginas', 'datos']) assert.ok(k in r.datos, `falta ${k}`);
  });
  await prueba('ruta inexistente -> 404 con formato de la ficha', async () => esperar(await pedir('GET', '/api/consultorio/nada', 'tok-vet'), 404, 'RUTA_NO_ENCONTRADA'));
  await prueba('cita inexistente -> 404', async () => esperar(await pedir('GET', '/api/consultorio/citas/C-NOEXISTE', 'tok-vet'), 404, 'CITA_NO_ENCONTRADA'));
  await prueba('JSON mal formado -> 400', async () => {
    const r = await fetch(`${base}/api/consultorio/citas`, { method: 'POST', headers: { Authorization: 'Bearer tok-vecino1', 'Content-Type': 'application/json' }, body: '{malo' });
    assert.strictEqual(r.status, 400);
  });
  await prueba('encabezados de seguridad presentes', async () => {
    const r = await pedir('GET', '/api/consultorio/salud');
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('content-security-policy'));
  });
  await prueba('la interfaz se sirve en /', async () => {
    const r = await fetch(base + '/');
    assert.strictEqual(r.status, 200);
    assert.match(await r.text(), /Consultorio veterinario/);
  });
  await prueba('no se puede recorrer directorios (/../package.json)', async () => {
    const r = await fetch(base + '/..%2fpackage.json');
    assert.strictEqual(r.status, 404);
  });

  console.log('\nCV-01 Agendar (RF-01, RF-02, RN-06)');
  let citaId;
  const fechaFutura = diaHabil(3, tz);
  let bloque;
  await prueba('GET /horarios lista bloques libres de 30 min', async () => {
    const r = await pedir('GET', `/api/consultorio/horarios?fecha=${fechaFutura}&limit=100`, 'tok-vecino1');
    esperar(r, 200);
    assert.ok(r.datos.total > 0);
    bloque = r.datos.datos[0];
    assert.strictEqual(new Date(bloque.fin) - new Date(bloque.inicio), 30 * 60000);
  });
  await prueba('fin de semana no tiene bloques', async () => {
    let f = T.sumaDias(T.fechaLocal(new Date(), tz), 1);
    while (new Date(f + 'T00:00:00Z').getUTCDay() !== 6) f = T.sumaDias(f, 1);
    const r = await pedir('GET', `/api/consultorio/horarios?fecha=${f}`, 'tok-vecino1');
    assert.strictEqual(r.datos.total, 0);
  });
  await prueba('fecha mal formada -> 400', async () => esperar(await pedir('GET', '/api/consultorio/horarios?fecha=hoy', 'tok-vecino1'), 400, 'FECHA_INVALIDA'));
  await prueba('POST /citas en un bloque elegido -> 201, estado agendada', async () => {
    const r = await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001', inicio: bloque.inicio, veterinarioId: bloque.veterinarioId, motivo: 'Control' });
    esperar(r, 201);
    assert.strictEqual(r.datos.estado, 'agendada');
    assert.strictEqual(r.datos.inicio, bloque.inicio);
    citaId = r.datos.citaId;
  });
  await prueba('el bloque ocupado deja de aparecer en /horarios', async () => {
    const r = await pedir('GET', `/api/consultorio/horarios?fecha=${fechaFutura}&veterinarioId=${bloque.veterinarioId}&limit=100`, 'tok-vecino1');
    assert.ok(!r.datos.datos.some((b) => b.inicio === bloque.inicio));
  });
  await prueba('mismo bloque y veterinario -> 409 BLOQUE_OCUPADO (RN-06)', async () => {
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino2', { animalId: 'SIM-000003', inicio: bloque.inicio, veterinarioId: bloque.veterinarioId }), 409, 'BLOQUE_OCUPADO');
  });
  await prueba('sin horario: asigna el primer bloque libre (repetible) -> 201', async () => {
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001' }), 201);
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001' }), 201);
  });
  await prueba('animal fallecido -> 409 ANIMAL_FALLECIDO (RF-02)', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino2', { animalId: 'SIM-000004' }), 409, 'ANIMAL_FALLECIDO'));
  await prueba('animal inexistente -> 404', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-777777' }), 404, 'ANIMAL_NO_ENCONTRADO'));
  await prueba('animal sin microchip SÍ se puede agendar (respuesta 4 del cliente)', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000002' }), 201));
  await prueba('animal de otro vecino -> 403', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000003' }), 403));
  await prueba('bloque que no existe (09:15) -> 400 BLOQUE_INVALIDO', async () => {
    const d = new Date(bloque.inicio); d.setUTCMinutes(d.getUTCMinutes() + 15);
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001', inicio: iso(d) }), 400, 'BLOQUE_INVALIDO');
  });
  await prueba('bloque en el pasado -> 400', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001', inicio: '2020-01-06T12:00:00Z' }), 400, 'BLOQUE_FUERA_DE_RANGO'));
  await prueba('animalId con caracteres raros o como objeto -> 400 (no llega a Mongo)', async () => {
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: { $ne: null } }), 400);
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: '../../etc' }), 400, 'ID_INVALIDO');
  });
  await prueba('veterinario no puede agendar -> 403', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vet', { animalId: 'SIM-000001' }), 403, 'PERFIL_NO_AUTORIZADO'));
  await prueba('funcionario agenda a nombre de un tutor (solicitanteRut)', async () => {
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-func', { animalId: 'SIM-000003' }), 400, 'RUT_INVALIDO');
    const r = await pedir('POST', '/api/consultorio/citas', 'tok-func', { animalId: 'SIM-000003', solicitanteRut: '12222222-5' });
    esperar(r, 201);
    assert.strictEqual(r.datos.solicitanteRut, '12222222-5');
  });
  await prueba('RNF-04: M1 caído -> 503 en menos de 5 s y no se crea nada', async () => {
    const antes = dao.citas.length;
    m1Caido = true;
    const t0 = Date.now();
    const r = await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001' });
    m1Caido = false;
    esperar(r, 503, 'M1_NO_DISPONIBLE');
    assert.ok(Date.now() - t0 < 5000, 'tardó más de 5 s');
    assert.strictEqual(dao.citas.length, antes);
  });

  console.log('\nCV-05 Animal comunitario (RF-08)');
  await prueba('responsable registrado agenda -> 201', async () => {
    const r = await pedir('POST', '/api/consultorio/citas', 'tok-com1', { animalId: 'SIM-000005' });
    esperar(r, 201);
    assert.strictEqual(r.datos.solicitanteRut, '13333333-9');
  });
  await prueba('otro comunitario -> 403', async () => esperar(await pedir('POST', '/api/consultorio/citas', 'tok-com2', { animalId: 'SIM-000005' }), 403));
  await prueba('animal comunitario sin responsable (agenda un funcionario) -> 409', async () => {
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-func', { animalId: 'SIM-000099', solicitanteRut: '13333333-9' }), 409, 'RESPONSABLE_NO_REGISTRADO');
  });

  console.log('\nCV-02 Cancelar (RF-04, RN-07)');
  await prueba('un vecino no puede tocar la cita de otro -> 403', async () => esperar(await pedir('PATCH', `/api/consultorio/citas/${citaId}/estado`, 'tok-vecino2', { estado: 'cancelada' }), 403));
  await prueba('con menos de 24 h -> 409 CANCELACION_FUERA_DE_PLAZO', async () => {
    const ini = new Date(Date.now() + 2 * 3600000);
    await dao.insertarCita({ citaId: 'C-CERCA', animalId: 'SIM-000001', solicitanteRut: '11111111-1', veterinarioId: cfg.veterinarios[0], inicio: iso(ini), fin: iso(new Date(ini.getTime() + 1800000)), motivo: '', estado: 'agendada', activa: true, creada: iso(new Date()), actualizada: iso(new Date()), historial: [] });
    esperar(await pedir('PATCH', '/api/consultorio/citas/C-CERCA/estado', 'tok-vecino1', { estado: 'cancelada' }), 409, 'CANCELACION_FUERA_DE_PLAZO');
  });
  await prueba('cita de demostración: cancelar siempre da 409 (verificación repetible)', async () => {
    esperar(await pedir('PATCH', '/api/consultorio/citas/C-DEMO-0001/estado', 'tok-vecino1', { estado: 'cancelada' }), 409);
    esperar(await pedir('PATCH', '/api/consultorio/citas/C-DEMO-0001/estado', 'tok-vecino1', { estado: 'cancelada' }), 409);
  });
  await prueba('con más de 24 h -> 200 cancelada y el bloque queda libre al instante', async () => {
    const r = await pedir('PATCH', `/api/consultorio/citas/${citaId}/estado`, 'tok-vecino1', { estado: 'cancelada' });
    esperar(r, 200);
    assert.strictEqual(r.datos.estado, 'cancelada');
    const h = await pedir('GET', `/api/consultorio/horarios?fecha=${fechaFutura}&veterinarioId=${bloque.veterinarioId}&limit=100`, 'tok-vecino1');
    assert.ok(h.datos.datos.some((b) => b.inicio === bloque.inicio), 'el bloque no se liberó');
    esperar(await pedir('POST', '/api/consultorio/citas', 'tok-vecino2', { animalId: 'SIM-000003', inicio: bloque.inicio, veterinarioId: bloque.veterinarioId }), 201);
  });
  await prueba('una cancelada no vuelve a cambiar -> 409 TRANSICION_INVALIDA', async () => esperar(await pedir('PATCH', `/api/consultorio/citas/${citaId}/estado`, 'tok-vecino1', { estado: 'confirmada' }), 409, 'TRANSICION_INVALIDA'));
  await prueba('estado desconocido -> 400', async () => esperar(await pedir('PATCH', `/api/consultorio/citas/${citaId}/estado`, 'tok-vecino1', { estado: 'volando' }), 400, 'ESTADO_INVALIDO'));
  await prueba('agendada -> confirmada -> reagendar no corresponde si está confirmada', async () => {
    const n = await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001' });
    const id = n.datos.citaId;
    esperar(await pedir('PATCH', `/api/consultorio/citas/${id}/estado`, 'tok-vecino1', { estado: 'confirmada' }), 200);
    esperar(await pedir('PATCH', `/api/consultorio/citas/${id}/horario`, 'tok-vecino1', { inicio: bloque.inicio }), 409, 'TRANSICION_INVALIDA');
  });
  await prueba('reagendar una cita agendada a otro bloque libre -> 200', async () => {
    const f2 = diaHabil(5, tz);
    const hs = await pedir('GET', `/api/consultorio/horarios?fecha=${f2}&limit=100`, 'tok-vecino1');
    const b2 = hs.datos.datos[0];
    const n = await pedir('POST', '/api/consultorio/citas', 'tok-vecino2', { animalId: 'SIM-000003', inicio: b2.inicio, veterinarioId: b2.veterinarioId });
    const b3 = hs.datos.datos[1];
    const r = await pedir('PATCH', `/api/consultorio/citas/${n.datos.citaId}/horario`, 'tok-vecino2', { inicio: b3.inicio });
    esperar(r, 200);
    assert.strictEqual(r.datos.inicio, b3.inicio);
  });

  console.log('\nCV-03 Atender (RF-03, RF-05, RN-08)');
  let citaAtender;
  await prueba('preparar cita a atender', async () => {
    const r = await pedir('POST', '/api/consultorio/citas', 'tok-vecino1', { animalId: 'SIM-000001', motivo: 'Vacuna' });
    esperar(r, 201);
    citaAtender = r.datos.citaId;
  });
  await prueba('vecino no puede marcar atendida -> 403', async () => esperar(await pedir('PATCH', `/api/consultorio/citas/${citaAtender}/estado`, 'tok-vecino1', { estado: 'atendida' }), 403, 'PERFIL_NO_AUTORIZADO'));
  await prueba('funcionario no puede marcar atendida -> 403', async () => esperar(await pedir('PATCH', `/api/consultorio/citas/${citaAtender}/estado`, 'tok-func', { estado: 'atendida' }), 403));
  await prueba('nadie puede marcar "ausente" a mano -> 403', async () => esperar(await pedir('PATCH', `/api/consultorio/citas/${citaAtender}/estado`, 'tok-vet', { estado: 'ausente' }), 403));
  await prueba('sin ficha -> 400', async () => esperar(await pedir('PATCH', `/api/consultorio/citas/${citaAtender}/estado`, 'tok-vet', { estado: 'atendida' }), 400, 'FICHA_REQUERIDA'));
  await prueba('sin diagnóstico o sin tratamiento -> 400 y la cita NO cambia', async () => {
    esperar(await pedir('PATCH', `/api/consultorio/citas/${citaAtender}/estado`, 'tok-vet', { estado: 'atendida', ficha: { diagnostico: '', tratamiento: 'reposo' } }), 400, 'DATOS_INVALIDOS');
    esperar(await pedir('PATCH', `/api/consultorio/citas/${citaAtender}/estado`, 'tok-vet', { estado: 'atendida', ficha: { diagnostico: 'otitis', tratamiento: {} } }), 400);
    assert.strictEqual((await pedir('GET', `/api/consultorio/citas/${citaAtender}`, 'tok-vet')).datos.estado, 'agendada');
    assert.strictEqual(dao.fichas.length, 0);
  });
  await prueba('veterinario con ficha completa -> 200 atendida + ficha guardada', async () => {
    const r = await pedir('PATCH', `/api/consultorio/citas/${citaAtender}/estado`, 'tok-vet', { estado: 'atendida', ficha: { diagnostico: 'Otitis leve', tratamiento: 'Gotas óticas 7 días', receta: 'Otomax' } });
    esperar(r, 200);
    assert.strictEqual(r.datos.estado, 'atendida');
    assert.strictEqual(r.datos.ficha.veterinarioRut, '15555555-6');
    assert.strictEqual(dao.fichas.length, 1);
  });
  await prueba('una atendida no se puede cancelar -> 409', async () => esperar(await pedir('PATCH', `/api/consultorio/citas/${citaAtender}/estado`, 'tok-vecino1', { estado: 'cancelada' }), 409, 'TRANSICION_INVALIDA'));

  console.log('\nCV-04 Historial clínico (RF-07, RNF-02)');
  await prueba('tutor ve el historial de su animal -> 200 con la ficha', async () => {
    const r = await pedir('GET', '/api/consultorio/animales/SIM-000001/historial', 'tok-vecino1');
    esperar(r, 200);
    assert.strictEqual(r.datos.total, 1);
    assert.strictEqual(r.datos.datos[0].diagnostico, 'Otitis leve');
  });
  await prueba('otro vecino -> 403', async () => esperar(await pedir('GET', '/api/consultorio/animales/SIM-000001/historial', 'tok-vecino2'), 403));
  await prueba('funcionario solo ve agenda -> 403 en historial', async () => esperar(await pedir('GET', '/api/consultorio/animales/SIM-000001/historial', 'tok-func'), 403, 'PERFIL_NO_AUTORIZADO'));
  await prueba('veterinario -> 200', async () => esperar(await pedir('GET', '/api/consultorio/animales/SIM-000001/historial', 'tok-vet'), 200));
  await prueba('animal que no existe -> 404', async () => esperar(await pedir('GET', '/api/consultorio/animales/SIM-777777/historial', 'tok-vet'), 404));
  await prueba('la bitácora registró usuario, fecha, hora y acción (solo jefatura/admin la leen)', async () => {
    esperar(await pedir('GET', '/api/consultorio/bitacora', 'tok-vecino1'), 403);
    const r = await pedir('GET', '/api/consultorio/bitacora?limit=100', 'tok-jef');
    esperar(r, 200);
    const consulta = r.datos.datos.find((b) => b.accion === 'HISTORIAL_CONSULTA' && b.rut === '11111111-1');
    assert.ok(consulta && consulta.fecha && consulta.perfil === 'vecino');
    assert.ok(r.datos.datos.some((b) => b.accion === 'FICHA_CREAR'));
  });
  await prueba('tutor solo ve SUS citas; funcionario ve la agenda general', async () => {
    const v = await pedir('GET', '/api/consultorio/citas?limit=100', 'tok-vecino2');
    assert.ok(v.datos.datos.every((c) => c.solicitanteRut === '12222222-5'));
    const f = await pedir('GET', '/api/consultorio/citas?limit=100', 'tok-func');
    assert.ok(f.datos.total > v.datos.total);
    assert.ok(f.datos.datos.every((c) => !('diagnostico' in c)), 'la agenda no debe traer datos clínicos');
  });

  console.log('\nCV-06 Ausentes automáticas (RF-06, RN-08)');
  await prueba('cita activa vencida pasa a ausente; atendida y cancelada no cambian', async () => {
    const pasado = new Date(Date.now() - 3 * 3600000);
    const base = { animalId: 'SIM-000001', solicitanteRut: '11111111-1', veterinarioId: cfg.veterinarios[1], motivo: '', creada: iso(new Date()), actualizada: iso(new Date()), historial: [] };
    await dao.insertarCita({ ...base, citaId: 'C-VENCIDA', inicio: iso(pasado), fin: iso(new Date(pasado.getTime() + 1800000)), estado: 'confirmada', activa: true });
    const p2 = new Date(pasado.getTime() - 3600000);
    await dao.insertarCita({ ...base, citaId: 'C-OLD-ATENDIDA', inicio: iso(p2), fin: iso(new Date(p2.getTime() + 1800000)), estado: 'atendida', activa: false });
    await dao.insertarCita({ ...base, citaId: 'C-OLD-CANCELADA', inicio: iso(new Date(p2.getTime() - 3600000)), fin: iso(new Date(p2.getTime() - 1800000)), estado: 'cancelada', activa: false });
    esperar(await pedir('POST', '/api/consultorio/citas/ausentes', 'tok-vecino1'), 403);
    esperar(await pedir('POST', '/api/consultorio/citas/ausentes', 'tok-func'), 403);
    const r = await pedir('POST', '/api/consultorio/citas/ausentes', 'tok-vet');
    esperar(r, 200);
    assert.ok(r.datos.marcadas >= 1);
    assert.strictEqual((await pedir('GET', '/api/consultorio/citas/C-VENCIDA', 'tok-vet')).datos.estado, 'ausente');
    assert.strictEqual((await pedir('GET', '/api/consultorio/citas/C-OLD-ATENDIDA', 'tok-vet')).datos.estado, 'atendida');
    assert.strictEqual((await pedir('GET', '/api/consultorio/citas/C-OLD-CANCELADA', 'tok-vet')).datos.estado, 'cancelada');
    const otra = await pedir('POST', '/api/consultorio/citas/ausentes', 'tok-vet');
    assert.strictEqual(otra.datos.marcadas, 0, 'debe ser idempotente');
  });

  console.log('\nVerificaciones declaradas en entrega.json');
  const entrega = require('../entrega.json');
  const tokenPorPerfil = { vecino: 'tok-vecino1', comunitario: 'tok-com1', veterinario: 'tok-vet', funcionario: 'tok-func' };
  for (const hu of entrega.historias) {
    await prueba(`${hu.id} ${hu.verificacion.metodo} ${hu.verificacion.ruta} (${hu.verificacion.perfil}) -> ${hu.verificacion.esperado}`, async () => {
      const v = hu.verificacion;
      const r = await pedir(v.metodo, v.ruta, tokenPorPerfil[v.perfil], v.cuerpo);
      assert.strictEqual(r.status, v.esperado, `llegó ${r.status} ${JSON.stringify(r.datos)}`);
    });
  }
  await prueba('las verificaciones se pueden repetir y dan lo mismo', async () => {
    for (const hu of entrega.historias) {
      const v = hu.verificacion;
      const r = await pedir(v.metodo, v.ruta, tokenPorPerfil[v.perfil], v.cuerpo);
      assert.strictEqual(r.status, v.esperado, `${hu.id}: llegó ${r.status}`);
    }
  });

  console.log(`\n${ok} pruebas OK, ${fallos} con fallos`);
  app.close(); nucleo.close(); m1.close();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
