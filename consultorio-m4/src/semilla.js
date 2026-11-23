'use strict';

const { DuplicadoError, iso } = require('./util');

// Cita de demostración con fecha FIJA en el pasado. Sirve para que las peticiones de verificación de
// entrega.json sean repetibles: sobre ella, cancelar siempre da 409 (ya pasó su hora) y el estado
// siempre es el mismo. No afecta la agenda real (su bloque ya pasó).
async function sembrarDemo(dao, cfg) {
  const inicio = new Date('2026-11-02T13:00:00Z');
  const ahoraIso = iso(new Date());
  try {
    await dao.insertarCita({
      citaId: 'C-DEMO-0001',
      animalId: 'SIM-000001',
      solicitanteRut: '11111111-1',
      veterinarioId: cfg.veterinarios[0],
      inicio: iso(inicio),
      fin: iso(new Date(inicio.getTime() + 30 * 60000)),
      motivo: 'Cita de demostración (no modificar)',
      estado: 'agendada',
      activa: true,
      creada: ahoraIso,
      actualizada: ahoraIso,
      historial: [{ estado: 'agendada', fecha: ahoraIso, por: 'semilla' }]
    });
  } catch (e) {
    if (!(e instanceof DuplicadoError)) throw e; // ya existía: nada que hacer
  }
}

module.exports = { sembrarDemo };
