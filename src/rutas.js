'use strict';

// Lógica de negocio del consultorio. Cada ruta declara qué perfiles pueden usarla; el servidor
// valida el token y el perfil ANTES de llamar al manejador (RN-05).

/** Tutor (o responsable, si es comunitario) del animal según el M1. */
function responsableDe(animal) {
  return animal.comunitario ? animal.responsableRut : animal.tutorRut;
}

// ---------- POST /citas (CV-01 y CV-05) ----------
function validarResponsableComunitario(animal, animalId, HttpError) {
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
  return responsable;
}

function crearRutas(ctx) {
  return { barrido: async () => 0, rutas: [] };
}

module.exports = { crearRutas, responsableDe, validarResponsableComunitario };