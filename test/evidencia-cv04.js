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

  // ---------- Evidencia tarea #85 · CV-04 Historial clínico ----------
  // Se crea una ficha clínica de ejemplo para que el animal SIM-000001 tenga historial.
  await dao.insertarFicha({ fichaId: 'F-DEMO-1', citaId: 'C-DEMO-1', animalId: 'SIM-000001', veterinarioRut: '15555555-6', diagnostico: 'Otitis leve', tratamiento: 'Gotas óticas 7 días', receta: 'Otomax', creada: iso(new Date()) });

  const URL_HISTORIAL = '/api/consultorio/animales/SIM-000001/historial';
  const casos = [
    { n: 1, titulo: 'SIN TOKEN', token: null, esperado: 401 },
    { n: 2, titulo: 'OTRO VECINO (Marcelo, que no es el tutor de SIM-000001)', token: 'tok-vecino2', esperado: 403 },
    { n: 3, titulo: 'CASO CORRECTO (Carolina, tutora de SIM-000001)', token: 'tok-vecino1', esperado: 200 }
  ];
  console.log('==============================================================');
  console.log(' EVIDENCIA TAREA #85 - CV-04 Consultar el historial clínico');
  console.log(' Endpoint: GET ' + URL_HISTORIAL);
  console.log(' Práctica OWASP: A01 Broken Access Control (token -> perfil -> dueño)');
  console.log('==============================================================');
  let todosOk = true;
  for (const c of casos) {
    const r = await pedir('GET', URL_HISTORIAL, c.token);
    const ok = r.status === c.esperado;
    todosOk = todosOk && ok;
    console.log(`\n[${ok ? 'OK' : 'FALLA'}] Caso ${c.n}: ${c.titulo}`);
    console.log(`  Authorization: ${c.token ? 'Bearer ' + c.token : '(sin encabezado)'}`);
    console.log(`  Esperado: HTTP ${c.esperado}   Obtenido: HTTP ${r.status}`);
    console.log('  Respuesta: ' + JSON.stringify(r.datos).slice(0, 260));
  }
  console.log('\n' + (todosOk ? 'RESULTADO: los 3 casos se comportan como se esperaba.' : 'RESULTADO: hay casos que NO coinciden.'));
  nucleo.close(); m1.close(); app.close(); process.exit(todosOk ? 0 : 1);
})();
