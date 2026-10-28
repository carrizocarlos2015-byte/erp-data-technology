// src/routes/agendaRoutes.js
const express = require('express');
const router = express.Router();
const agendaController = require('../controllers/agendaController');

router.get('/', agendaController.obtenerEventos);
router.get('/resumen', agendaController.obtenerResumen);
router.get('/clientes', agendaController.obtenerClientes);
router.post('/', agendaController.crearEvento);
router.put('/:id', agendaController.editarEvento);
router.delete('/:id', agendaController.eliminarEvento);

module.exports = router;