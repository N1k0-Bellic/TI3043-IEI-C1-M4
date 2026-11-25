'use strict';

// Los bloques se definen en hora local de la clínica (America/Santiago) y se guardan/entregan en ISO 8601 UTC.
// Se usa Intl para respetar el horario de verano sin depender de librerías.

const { iso } = require('./util');

// Bloques de 30 minutos (RN-06): 09:00-13:00 y 14:00-17:00, de lunes a viernes.
const HORAS_INICIO = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
];
const MINUTOS_BLOQUE = 30;

function partes(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return o;
}

/** Diferencia (ms) entre la hora local de la zona y UTC en ese instante. */
function offsetMs(date, tz) {
  const p = partes(date, tz);
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** '2026-11-27' + '09:30' (hora local) -> Date en UTC. */
function localAUtc(fecha, hhmm, tz) {
  const [y, m, d] = fecha.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const supuesto = Date.UTC(y, m - 1, d, hh, mm);
  let t = supuesto - offsetMs(new Date(supuesto), tz);
  t = supuesto - offsetMs(new Date(t), tz); // segunda pasada por si cruza un cambio de hora
  return new Date(t);
}

/** Instante UTC -> fecha local 'YYYY-MM-DD'. */
function fechaLocal(date, tz) {
  const p = partes(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

function fechaValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function sumaDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Bloques del día (vacío si es sábado o domingo): [{inicio, fin}] en ISO UTC. */
function bloquesDelDia(fecha, tz) {
  if (!fechaValida(fecha)) return [];
  const [y, m, d] = fecha.split('-').map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 domingo, 6 sábado
  if (dia === 0 || dia === 6) return [];
  return HORAS_INICIO.map((h) => {
    const ini = localAUtc(fecha, h, tz);
    return { inicio: iso(ini), fin: iso(new Date(ini.getTime() + MINUTOS_BLOQUE * 60000)) };
  });
}

module.exports = { MINUTOS_BLOQUE, localAUtc, fechaLocal, fechaValida, sumaDias, bloquesDelDia };
