'use strict';

// DAO en memoria: misma interfaz que dao/mongo.js. Sirve para pruebas y desarrollo sin Atlas.
// En producción NO se usa (los datos se pierden al reiniciar).

const { DuplicadoError } = require('../util');

function cumple(c, f) {
  if (f.solicitanteRut && c.solicitanteRut !== f.solicitanteRut) return false;
  if (f.estado && c.estado !== f.estado) return false;
  if (f.veterinarioId && c.veterinarioId !== f.veterinarioId) return false;
  if (f.animalId && c.animalId !== f.animalId) return false;
  if (f.desde && c.inicio < f.desde) return false;
  if (f.hasta && c.inicio >= f.hasta) return false;
  return true;
}

class DAOMemoria {
  constructor() {
    this.tipo = 'memoria';
    this.citas = [];
    this.fichas = [];
    this.bitacora = [];
  }

  async init() {}
  async cerrar() {}

  async insertarCita(c) {
    const choca = this.citas.some((x) => x.citaId === c.citaId ||
      (c.activa && x.activa && x.veterinarioId === c.veterinarioId && x.inicio === c.inicio));
    if (choca) throw new DuplicadoError();
    this.citas.push(structuredClone(c));
    return structuredClone(c);
  }

  async obtenerCita(id) {
    const c = this.citas.find((x) => x.citaId === id);
    return c ? structuredClone(c) : null;
  }

  async listarCitas(filtro, skip, limit) {
    const l = this.citas.filter((c) => cumple(c, filtro))
      .sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
    return { total: l.length, datos: l.slice(skip, skip + limit).map((c) => structuredClone(c)) };
  }

  async inicioOcupados(veterinarioId, desde, hasta) {
    return this.citas
      .filter((c) => c.activa && c.veterinarioId === veterinarioId && c.inicio >= desde && c.inicio < hasta)
      .map((c) => c.inicio);
  }

  /** Cambio atómico: solo si la cita sigue en uno de los estados esperados. Devuelve la cita nueva o null. */
  async actualizarCita(id, estadosPermitidos, cambios, evento, ahoraIso) {
    const c = this.citas.find((x) => x.citaId === id);
    if (!c || !estadosPermitidos.includes(c.estado)) return null;
    const nuevo = { ...c, ...cambios };
    const choca = nuevo.activa && this.citas.some((x) => x !== c && x.activa &&
      x.veterinarioId === nuevo.veterinarioId && x.inicio === nuevo.inicio);
    if (choca) throw new DuplicadoError();
    Object.assign(c, cambios, { actualizada: ahoraIso });
    c.historial.push(evento);
    return structuredClone(c);
  }

  async marcarAusentes(ahoraIso) {
    let n = 0;
    for (const c of this.citas) {
      if (c.activa && c.fin <= ahoraIso) {
        c.estado = 'ausente';
        c.activa = false;
        c.actualizada = ahoraIso;
        c.historial.push({ estado: 'ausente', fecha: ahoraIso, por: 'sistema' });
        n++;
      }
    }
    return n;
  }

  async insertarFicha(f) {
    this.fichas.push(structuredClone(f));
    return structuredClone(f);
  }

  async borrarFicha(fichaId) {
    this.fichas = this.fichas.filter((f) => f.fichaId !== fichaId);
  }

  async listarFichas(animalId, skip, limit) {
    const l = this.fichas.filter((f) => f.animalId === animalId)
      .sort((a, b) => (a.creada < b.creada ? 1 : a.creada > b.creada ? -1 : 0));
    return { total: l.length, datos: l.slice(skip, skip + limit).map((f) => structuredClone(f)) };
  }

  async insertarBitacora(b) {
    this.bitacora.push(structuredClone(b));
  }

  async listarBitacora(skip, limit) {
    const l = [...this.bitacora].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
    return { total: l.length, datos: l.slice(skip, skip + limit) };
  }
}

module.exports = { DAOMemoria };
