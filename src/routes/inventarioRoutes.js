// src/routes/inventarioRoutes.js
const express = require('express');
const router = express.Router();
const inventarioController = require('../controllers/inventarioController');

router.get('/', inventarioController.obtenerInventario);
router.get('/categorias', inventarioController.obtenerCategorias);
router.post('/', inventarioController.agregarArticulo);
router.put('/:id', inventarioController.editarArticulo);
router.delete('/:id', inventarioController.eliminarArticulo);

module.exports = router;