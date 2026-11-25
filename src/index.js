'use strict';

const { cargarConfig } = require('./config');
const { crearClienteNucleo, crearClienteM1 } = require('./clientes');
const { crearServidor } = require('./app');

async function main() {
  const cfg = cargarConfig();

  let dao;
  if (cfg.mongoUri) {
    const { DAOMongo } = require('./dao/mongo');
    dao = new DAOMongo(cfg.mongoUri, cfg.mongoDb);
  } else if (cfg.permitirMemoria) {
    const { DAOMemoria } = require('./dao/memoria');
    dao = new DAOMemoria();
    console.warn('ATENCIÓN: sin MONGODB_URI, usando memoria (los datos se pierden al reiniciar).');
  } else {
    console.error('Falta la variable de entorno MONGODB_URI. (Para desarrollo sin Atlas: ALLOW_MEMORY=1)');
    process.exit(1);
  }
  await dao.init();

  const servidor = crearServidor({ cfg, dao, nucleo: crearClienteNucleo(cfg), m1: crearClienteM1(cfg) });

  // Reloj del sistema (actor del caso de uso "Marcar cita como ausente automáticamente")
  const reloj = setInterval(() => servidor.barrido(true).catch((e) => console.error('barrido:', e.message)), 60000);
  reloj.unref();

  servidor.listen(cfg.puerto, () => {
    console.log(`Consultorio M4 escuchando en el puerto ${cfg.puerto} · almacenamiento: ${dao.tipo} · núcleo: ${cfg.nucleoUrl}`);
  });

  const cerrar = async () => { servidor.close(); await dao.cerrar(); process.exit(0); };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}

main().catch((e) => {
  console.error('No se pudo iniciar:', e.message);
  process.exit(1);
});
