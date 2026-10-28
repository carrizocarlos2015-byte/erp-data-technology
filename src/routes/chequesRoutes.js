// src/routes/chequesRoutes.js
// Rutas del Módulo de Cheques

const express = require('express');
const router = express.Router();
const chequesController = require('../controllers/chequesController');

// GET: Obtener todos los cheques
router.get('/', chequesController.obtenerCheques);

// GET: Obtener resumen (KPIs)
router.get('/resumen', chequesController.obtenerResumen);

// POST: Crear un nuevo cheque
router.post('/', chequesController.crearCheque);

// PUT: Editar un cheque
router.put('/:id', chequesController.editarCheque);

// DELETE: Eliminar un cheque
router.delete('/:id', chequesController.eliminarCheque);

module.exports = router;