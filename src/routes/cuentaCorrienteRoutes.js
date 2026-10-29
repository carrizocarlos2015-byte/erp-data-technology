// src/routes/cuentaCorrienteRoutes.js
// Rutas del Módulo de Cuenta Corriente
const express = require('express');
const router = express.Router();
const cuentaCorrienteController = require('../controllers/cuentaCorrienteController');

// GET: Obtener todos los movimientos
router.get('/', cuentaCorrienteController.obtenerMovimientos);

// GET: Obtener movimientos de un cliente específico
router.get('/cliente/:clienteId', cuentaCorrienteController.obtenerMovimientosPorCliente);

// GET: Obtener saldo de un cliente
router.get('/saldo/:clienteId', cuentaCorrienteController.obtenerSaldoCliente);

// GET: Obtener saldo de todos los clientes
router.get('/saldos', cuentaCorrienteController.obtenerSaldosTodos);

// GET: Obtener saldo pendiente de una factura específica
router.get('/factura/:facturaId/saldo', cuentaCorrienteController.obtenerSaldoFactura);

// POST: Crear un nuevo movimiento
router.post('/', cuentaCorrienteController.crearMovimiento);

// PUT: Editar un movimiento existente
router.put('/:id', cuentaCorrienteController.editarMovimiento);

// DELETE: Eliminar un movimiento
router.delete('/:id', cuentaCorrienteController.eliminarMovimiento);

// ✅ NUEVA RUTA: Registrar Pago Específico (Para el botón de pago)
router.post('/pago', cuentaCorrienteController.registrarPago);

module.exports = router;