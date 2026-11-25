'use strict';

// Lógica de negocio del consultorio. Cada ruta declara qué perfiles pueden usarla; el servidor
// valida el token y el perfil ANTES de llamar al manejador (RN-05).
// Esqueleto: los manejadores se agregan en los commits siguientes.

function crearRutas(ctx) {
  return { barrido: async () => 0, rutas: [] };
}

module.exports = { crearRutas };