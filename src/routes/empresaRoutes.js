// src/routes/empresaRoutes.js
// Rutas del Módulo de Configuración Empresa

const express = require('express');
const router = express.Router();
const empresaController = require('../controllers/empresaController');

// GET: Obtener datos de la empresa
router.get('/', empresaController.obtenerDatos);

// POST: Guardar/Actualizar datos de la empresa
router.post('/', empresaController.guardarDatos);

// DELETE: Eliminar logo
router.delete('/logo', empresaController.eliminarLogo);

module.exports = router;