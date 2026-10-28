// src/controllers/clienteController.js
// ==========================================
// Controlador del Módulo de Clientes
// ERP Data Technology
// ==========================================

const pool = require('../config/db');

//  GET: Obtener todos los clientes activos
exports.obtenerClientes = async (req, res) => {
  try {
    const query = `
      SELECT id, codigo_cliente, nombre_razon_social, cuit_dni, telefono, email, direccion, created_at
      FROM clientes
      WHERE activo = true
      ORDER BY codigo_cliente ASC
    `;
    const result = await pool.query(query);

    const clientes = result.rows.map(row => ({
      id: row.id,
      codigo: row.codigo_cliente,
      nombre: row.nombre_razon_social,
      cuit: row.cuit_dni,
      telefono: row.telefono,
      email: row.email,
      direccion: row.direccion
    }));

    res.json(clientes);
  } catch (error) {
    console.error(' Error al obtener clientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener los clientes',
      error: error.message
    });
  }
};

// 🟡 POST: Crear un nuevo cliente
exports.crearCliente = async (req, res) => {
  try {
    const { nombre, cuit, telefono, email, direccion } = req.body;

    // Validación
    if (!nombre || nombre.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'El nombre es obligatorio'
      });
    }

    // Generar código automático (CLI-0001, CLI-0002...)
    const countResult = await pool.query('SELECT COUNT(*) FROM clientes');
    const nuevoNumero = parseInt(countResult.rows[0].count) + 1;
    const codigoCliente = `CLI-${String(nuevoNumero).padStart(4, '0')}`;

    // Insertar en la base de datos
    const query = `
      INSERT INTO clientes (codigo_cliente, nombre_razon_social, cuit_dni, telefono, email, direccion, activo)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING id, codigo_cliente, nombre_razon_social
    `;
    const values = [codigoCliente, nombre.trim(), cuit || '', telefono || '', email || '', direccion || ''];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: `Cliente registrado correctamente con el código: ${codigoCliente}`,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error al crear cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear el cliente',
      error: error.message
    });
  }
};

// 🟠 PUT: Editar un cliente existente
exports.editarCliente = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, cuit, telefono, email, direccion } = req.body;

    // Verificar que el cliente existe y está activo
    const checkQuery = 'SELECT id FROM clientes WHERE id = $1 AND activo = true';
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado o inactivo'
      });
    }

    // Actualizar
    const query = `
      UPDATE clientes
      SET nombre_razon_social = $1, cuit_dni = $2, telefono = $3, email = $4, direccion = $5
      WHERE id = $6 AND activo = true
      RETURNING id, codigo_cliente, nombre_razon_social
    `;
    const values = [nombre.trim(), cuit || '', telefono || '', email || '', direccion || '', id];
    const result = await pool.query(query, values);

    res.json({
      success: true,
      message: 'Cliente actualizado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error al editar cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al editar el cliente',
      error: error.message
    });
  }
};

// 🔴 DELETE: Eliminar un cliente (Soft Delete)
exports.eliminarCliente = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que existe
    const checkQuery = 'SELECT id, codigo_cliente FROM clientes WHERE id = $1 AND activo = true';
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado o ya fue eliminado'
      });
    }

    // Soft delete (marcar como inactivo)
    const query = `
      UPDATE clientes
      SET activo = false
      WHERE id = $1
      RETURNING codigo_cliente
    `;
    const result = await pool.query(query, [id]);

    res.json({
      success: true,
      message: `Cliente ${result.rows[0].codigo_cliente} eliminado correctamente (Soft Delete)`
    });
  } catch (error) {
    console.error(' Error al eliminar cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar el cliente',
      error: error.message
    });
  }
};