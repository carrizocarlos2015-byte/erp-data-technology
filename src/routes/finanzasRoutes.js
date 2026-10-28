// src/routes/finanzasRoutes.js
const express = require('express');
const router = express.Router();

const finanzasController = require('../controllers/finanzasController');
const categoriasController = require('../controllers/categoriasController');
const dashboardFinanzasController = require('../controllers/dashboardFinanzasController');

// RUTAS DE MOVIMIENTOS
router.get('/', finanzasController.obtenerMovimientos);
router.get('/categorias', finanzasController.obtenerCategorias);
router.get('/metodos-pago', finanzasController.obtenerMetodosPago);
router.get('/resumen', finanzasController.obtenerResumen);
router.post('/', finanzasController.crearMovimiento);
router.put('/:id', finanzasController.editarMovimiento);
router.delete('/:id', finanzasController.eliminarMovimiento);

// RUTAS DE GESTIÓN DE CATEGORÍAS
router.get('/categorias-gestion', categoriasController.obtenerCategorias);
router.post('/categorias', categoriasController.crearCategoria);
router.put('/categorias/:id', categoriasController.editarCategoria);
router.delete('/categorias/:id', categoriasController.eliminarCategoria);
router.post('/subcategorias', categoriasController.crearSubcategoria);
router.put('/subcategorias/:id', categoriasController.editarSubcategoria);
router.delete('/subcategorias/:id', categoriasController.eliminarSubcategoria);

// RUTAS DEL DASHBOARD FINANCIERO
router.get('/dashboard/kpis', dashboardFinanzasController.obtenerKPIs);
router.get('/dashboard/evolucion', dashboardFinanzasController.obtenerEvolucion);
router.get('/dashboard/categorias', dashboardFinanzasController.obtenerDistribucionCategorias);
router.get('/dashboard/metodos-pago', dashboardFinanzasController.obtenerDistribucionMetodosPago);
router.get('/dashboard/alertas', dashboardFinanzasController.obtenerAlertas);
router.get('/dashboard/analisis-categorias', dashboardFinanzasController.analizarCategorias);
router.get('/dashboard/top-movimientos', dashboardFinanzasController.obtenerTopMovimientos);

module.exports = router;