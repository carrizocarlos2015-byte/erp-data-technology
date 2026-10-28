// src/routes/presupuestosRoutes.js
const express = require('express');
const router = express.Router();
const presupuestosController = require('../controllers/presupuestosController');

router.get('/', presupuestosController.obtenerHistorial);
router.get('/:numero', presupuestosController.obtenerPresupuesto);
router.post('/', presupuestosController.guardarPresupuesto);
router.put('/:numero/estado', presupuestosController.actualizarEstado);
router.delete('/:numero', presupuestosController.eliminarPresupuesto);

module.exports = router;