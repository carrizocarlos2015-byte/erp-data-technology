// src/controllers/empresaController.js
// Controlador del Módulo de Configuración Empresa

const pool = require('../config/db');

//  GET: Obtener datos de la empresa
exports.obtenerDatos = async (req, res) => {
  try {
    const query = 'SELECT * FROM configuracion_empresa LIMIT 1';
    const result = await pool.query(query);

    if (result.rows.length === 0) {
      return res.json({
        nombre: 'Data Technology',
        cuit: '',
        direccion: 'Jujuy 1156 - Ciudad',
        telefono: '261-6080860',
        email: '',
        sitio_web: '',
        logo_base64: ''
      });
    }

    const data = result.rows[0];
    res.json({
      id: data.id,
      nombre: data.nombre,
      cuit: data.cuit,
      direccion: data.direccion,
      telefono: data.telefono,
      email: data.email,
      sitio_web: data.sitio_web,
      logo_base64: data.logo_base64 || ''
    });
  } catch (error) {
    console.error('Error al obtener datos empresa:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los datos', error: error.message });
  }
};

// 🟡 POST/PUT: Guardar datos de la empresa
exports.guardarDatos = async (req, res) => {
  try {
    const { nombre, cuit, direccion, telefono, email, sitio_web, logo_base64 } = req.body;

    if (!nombre) {
      return res.status(400).json({ success: false, message: 'El nombre de la empresa es obligatorio' });
    }

    // Verificar si ya existe una fila
    const checkResult = await pool.query('SELECT id FROM configuracion_empresa LIMIT 1');

    if (checkResult.rows.length > 0) {
      // UPDATE
      const id = checkResult.rows[0].id;
      const query = `
        UPDATE configuracion_empresa
        SET nombre = $1, cuit = $2, direccion = $3, telefono = $4,
            email = $5, sitio_web = $6, logo_base64 = $7, updated_at = CURRENT_TIMESTAMP
        WHERE id = $8
        RETURNING id, nombre
      `;
      const values = [nombre, cuit || '', direccion || '', telefono || '', email || '', sitio_web || '', logo_base64 || '', id];
      const result = await pool.query(query, values);

      res.json({ success: true, message: 'Datos de empresa actualizados correctamente', data: result.rows[0] });
    } else {
      // INSERT
      const query = `
        INSERT INTO configuracion_empresa (nombre, cuit, direccion, telefono, email, sitio_web, logo_base64)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, nombre
      `;
      const values = [nombre, cuit || '', direccion || '', telefono || '', email || '', sitio_web || '', logo_base64 || ''];
      const result = await pool.query(query, values);

      res.status(201).json({ success: true, message: 'Datos de empresa guardados correctamente', data: result.rows[0] });
    }
  } catch (error) {
    console.error('Error al guardar datos empresa:', error);
    res.status(500).json({ success: false, message: 'Error al guardar los datos', error: error.message });
  }
};

// 🔴 DELETE: Eliminar logo (opcional)
exports.eliminarLogo = async (req, res) => {
  try {
    const query = `
      UPDATE configuracion_empresa
      SET logo_base64 = '', updated_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT id FROM configuracion_empresa LIMIT 1)
    `;
    await pool.query(query);
    res.json({ success: true, message: 'Logo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar logo:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el logo', error: error.message });
  }
};