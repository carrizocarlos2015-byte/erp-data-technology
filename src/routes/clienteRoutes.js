// src/routes/clienteRoutes.js
// ==========================================
// Rutas del Módulo de Clientes
// ERP Data Technology
// ==========================================

const express = require('express');
const router = express.Router();
const clienteController = require('../controllers/clienteController');

// GET: Obtener todos los clientes activos
router.get('/', clienteController.obtenerClientes);

// GET: Obtener clientes inactivos (eliminados / soft delete)
router.get('/inactivos', clienteController.obtenerClientesInactivos);

// POST: Crear un nuevo cliente
router.post('/', clienteController.crearCliente);

// PUT: Editar un cliente existente
router.put('/:id', clienteController.editarCliente);

// DELETE: Eliminar un cliente (Soft Delete)
router.delete('/:id', clienteController.eliminarCliente);

// PATCH: Restaurar un cliente eliminado (reactivar)
router.patch('/:id/restaurar', clienteController.restaurarCliente);

module.exports = router;