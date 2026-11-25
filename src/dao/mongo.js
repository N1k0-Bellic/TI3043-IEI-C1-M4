'use strict';

// DAO de MongoDB (patrón DAO de la ES2, sección 5.2): TODAS las consultas a la base viven aquí;
// la lógica de negocio (rutas.js) no sabe nada de Mongo.
// Los valores que llegan aquí ya fueron validados como texto en rutas.js (nunca objetos del cliente).

const { DuplicadoError } = require('../util');

const SIN_ID = { projection: { _id: 0 } };

function filtroMongo(f) {
  const q = {};
  if (f.solicitanteRut) q.solicitanteRut = f.solicitanteRut;
  if (f.estado) q.estado = f.estado;
  if (f.veterinarioId) q.veterinarioId = f.veterinarioId;
  if (f.animalId) q.animalId = f.animalId;
  if (f.desde || f.hasta) {
    q.inicio = {};
    if (f.desde) q.inicio.$gte = f.desde;
    if (f.hasta) q.inicio.$lt = f.hasta;
  }
  return q;
}

function aDuplicado(e) {
  if (e && e.code === 11000) return new DuplicadoError();
  return e;
}

class DAOMongo {
  constructor(uri, nombreDb) {
    this.tipo = 'mongodb';
    this.uri = uri;
    this.nombreDb = nombreDb;
  }

  async init() {
    const { MongoClient } = require('mongodb');
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 8000 });
    await this.client.connect();
    const db = this.client.db(this.nombreDb);
    this.citas = db.collection('citas');
    this.fichas = db.collection('fichas');
    this.bitacora = db.collection('bitacora');

    await this.citas.createIndex({ citaId: 1 }, { unique: true });
    // RN-06: un bloque horario no puede tener más de una cita ACTIVA. El índice parcial lo garantiza
    // en la base, aunque dos personas reserven el mismo bloque al mismo tiempo.
    await this.citas.createIndex(
      { veterinarioId: 1, inicio: 1 },
      { unique: true, partialFilterExpression: { activa: true } }
    );
    await this.citas.createIndex({ solicitanteRut: 1, inicio: 1 });
    await this.citas.createIndex({ activa: 1, fin: 1 });
    await this.fichas.createIndex({ animalId: 1, creada: -1 });
    // RNF-02: la bitácora se conserva 12 meses y luego Mongo la elimina sola (índice TTL)
    await this.bitacora.createIndex({ fechaTTL: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });
  }

  async cerrar() {
    if (this.client) await this.client.close();
  }

  async insertarCita(c) {
    try {
      await this.citas.insertOne({ ...c });
    } catch (e) {
      throw aDuplicado(e);
    }
    return c;
  }

  async obtenerCita(id) {
    return this.citas.findOne({ citaId: id }, SIN_ID);
  }

  async listarCitas(filtro, skip, limit) {
    const q = filtroMongo(filtro);
    const [total, datos] = await Promise.all([
      this.citas.countDocuments(q),
      this.citas.find(q, SIN_ID).sort({ inicio: 1 }).skip(skip).limit(limit).toArray()
    ]);
    return { total, datos };
  }

  async inicioOcupados(veterinarioId, desde, hasta) {
    const docs = await this.citas
      .find({ veterinarioId, activa: true, inicio: { $gte: desde, $lt: hasta } }, { projection: { _id: 0, inicio: 1 } })
      .toArray();
    return docs.map((d) => d.inicio);
  }

  /** Cambio atómico: el filtro exige que la cita siga en un estado esperado (evita carreras). */
  async actualizarCita(id, estadosPermitidos, cambios, evento, ahoraIso) {
    try {
      return await this.citas.findOneAndUpdate(
        { citaId: id, estado: { $in: estadosPermitidos } },
        { $set: { ...cambios, actualizada: ahoraIso }, $push: { historial: evento } },
        { returnDocument: 'after', projection: { _id: 0 } }
      );
    } catch (e) {
      throw aDuplicado(e);
    }
  }

  /** RF-06: toda cita activa cuya hora ya terminó pasa a "ausente". Atendidas y canceladas no se tocan (activa=false). */
  async marcarAusentes(ahoraIso) {
    const r = await this.citas.updateMany(
      { activa: true, fin: { $lte: ahoraIso } },
      {
        $set: { estado: 'ausente', activa: false, actualizada: ahoraIso },
        $push: { historial: { estado: 'ausente', fecha: ahoraIso, por: 'sistema' } }
      }
    );
    return r.modifiedCount;
  }

  async insertarFicha(f) {
    await this.fichas.insertOne({ ...f });
    return f;
  }

  async borrarFicha(fichaId) {
    await this.fichas.deleteOne({ fichaId });
  }

  async listarFichas(animalId, skip, limit) {
    const [total, datos] = await Promise.all([
      this.fichas.countDocuments({ animalId }),
      this.fichas.find({ animalId }, SIN_ID).sort({ creada: -1 }).skip(skip).limit(limit).toArray()
    ]);
    return { total, datos };
  }

  async insertarBitacora(b) {
    await this.bitacora.insertOne({ ...b });
  }

  async listarBitacora(skip, limit) {
    const [total, datos] = await Promise.all([
      this.bitacora.countDocuments({}),
      this.bitacora.find({}, { projection: { _id: 0, fechaTTL: 0 } }).sort({ fecha: -1 }).skip(skip).limit(limit).toArray()
    ]);
    return { total, datos };
  }
}

module.exports = { DAOMongo };
