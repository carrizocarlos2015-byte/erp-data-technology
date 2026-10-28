// src/routes/trabajosRoutes.js
// Rutas del Módulo de Trabajos

const express = require('express');
const router = express.Router();
const trabajosController = require('../controllers/trabajosController');

// GET: Obtener todos los trabajos
router.get('/', trabajosController.obtenerTrabajos);

// GET: Obtener resumen (KPIs)
router.get('/resumen', trabajosController.obtenerResumen);

// GET: Obtener clientes para dropdown
router.get('/clientes', trabajosController.obtenerClientes);

// POST: Crear un nuevo trabajo
router.post('/', trabajosController.crearTrabajo);

// PUT: Editar un trabajo
router.put('/:id', trabajosController.editarTrabajo);

// DELETE: Eliminar un trabajo
router.delete('/:id', trabajosController.eliminarTrabajo);

module.exports = router;