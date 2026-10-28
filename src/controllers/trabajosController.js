// src/controllers/trabajosController.js
// Controlador del Módulo de Trabajos (Servicio Técnico)

const pool = require('../config/db');

// 🟢 GET: Obtener todos los trabajos
exports.obtenerTrabajos = async (req, res) => {
  try {
    const query = `
      SELECT 
        t.id,
        t.codigo_orden,
        t.cliente_id,
        t.fecha_ingreso,
        t.tipo_equipo,
        t.marca_modelo,
        t.numero_serie,
        t.falla,
        t.monto_diagnostico,
        t.monto_reparacion,
        t.estado,
        t.fecha_estimada_entrega,
        t.observaciones,
        t.pagado,
        t.created_at,
        c.codigo_cliente,
        c.nombre_razon_social AS cliente_nombre
      FROM trabajos t
      LEFT JOIN clientes c ON t.cliente_id = c.id
      ORDER BY t.created_at DESC
    `;
    const result = await pool.query(query);

    const trabajos = result.rows.map(row => ({
      id: row.id,
      codigo_orden: row.codigo_orden,
      cliente_id: row.cliente_id,
      fecha_ingreso: row.fecha_ingreso,
      tipo_equipo: row.tipo_equipo,
      marca_modelo: row.marca_modelo,
      numero_serie: row.numero_serie,
      falla: row.falla,
      monto_diagnostico: parseFloat(row.monto_diagnostico),
      monto_reparacion: parseFloat(row.monto_reparacion),
      monto_total: parseFloat(row.monto_diagnostico) + parseFloat(row.monto_reparacion),
      estado: row.estado,
      fecha_estimada_entrega: row.fecha_estimada_entrega,
      observaciones: row.observaciones,
      pagado: row.pagado,
      cliente: row.cliente_id ? {
        id: row.cliente_id,
        codigo: row.codigo_cliente,
        nombre: row.cliente_nombre
      } : null
    }));

    res.json(trabajos);
  } catch (error) {
    console.error('Error al obtener trabajos:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los trabajos', error: error.message });
  }
};

//  GET: Obtener resumen (KPIs)
exports.obtenerResumen = async (req, res) => {
  try {
    const query = `
      SELECT
        estado,
        COUNT(*) AS cantidad,
        COALESCE(SUM(monto_diagnostico + monto_reparacion), 0) AS total
      FROM trabajos
      GROUP BY estado
    `;
    const result = await pool.query(query);

    const resumen = {
      pendiente: { cantidad: 0, total: 0 },
      en_diagnostico: { cantidad: 0, total: 0 },
      en_reparacion: { cantidad: 0, total: 0 },
      terminado: { cantidad: 0, total: 0 },
      entregado: { cantidad: 0, total: 0 },
      total_general: 0,
      cantidad_general: 0,
      pagados: { cantidad: 0, total: 0 },
      pendientes_cobro: { cantidad: 0, total: 0 }
    };

    result.rows.forEach(row => {
      const estado = row.estado.toLowerCase().replace(' ', '_');
      if (resumen[estado]) {
        resumen[estado].cantidad = parseInt(row.cantidad);
        resumen[estado].total = parseFloat(row.total);
      }
      resumen.cantidad_general += parseInt(row.cantidad);
      resumen.total_general += parseFloat(row.total);
    });

    // Calcular pagados y pendientes de cobro
    const queryPagados = `
      SELECT
        pagado,
        COUNT(*) AS cantidad,
        COALESCE(SUM(monto_diagnostico + monto_reparacion), 0) AS total
      FROM trabajos
      GROUP BY pagado
    `;
    const resultPagados = await pool.query(queryPagados);

    resultPagados.rows.forEach(row => {
      if (row.pagado) {
        resumen.pagados = { cantidad: parseInt(row.cantidad), total: parseFloat(row.total) };
      } else {
        resumen.pendientes_cobro = { cantidad: parseInt(row.cantidad), total: parseFloat(row.total) };
      }
    });

    res.json(resumen);
  } catch (error) {
    console.error('Error al obtener resumen:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el resumen', error: error.message });
  }
};

// 🟢 GET: Obtener clientes para el dropdown
exports.obtenerClientes = async (req, res) => {
  try {
    const query = `
      SELECT id, codigo_cliente, nombre_razon_social
      FROM clientes
      WHERE activo = true
      ORDER BY codigo_cliente ASC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los clientes', error: error.message });
  }
};

//  POST: Crear un nuevo trabajo
exports.crearTrabajo = async (req, res) => {
  try {
    const {
      cliente_id, fecha_ingreso, tipo_equipo, marca_modelo,
      numero_serie, falla, monto_diagnostico, monto_reparacion,
      estado, fecha_estimada_entrega, observaciones
    } = req.body;

    if (!cliente_id || !fecha_ingreso || !tipo_equipo || !falla) {
      return res.status(400).json({ success: false, message: 'Cliente, fecha de ingreso, tipo de equipo y falla son obligatorios' });
    }

    // Generar código automático de orden (OT-0001, OT-0002...)
    const countResult = await pool.query('SELECT COUNT(*) FROM trabajos');
    const nuevoNumero = parseInt(countResult.rows[0].count) + 1;
    const codigoOrden = `OT-${String(nuevoNumero).padStart(4, '0')}`;

    const query = `
      INSERT INTO trabajos 
      (codigo_orden, cliente_id, fecha_ingreso, tipo_equipo, marca_modelo, numero_serie, falla, 
       monto_diagnostico, monto_reparacion, estado, fecha_estimada_entrega, observaciones, pagado)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false)
      RETURNING id, codigo_orden, cliente_id, estado
    `;
    const values = [
      codigoOrden,
      cliente_id,
      fecha_ingreso,
      tipo_equipo,
      marca_modelo || null,
      numero_serie || null,
      falla,
      monto_diagnostico || 0,
      monto_reparacion || 0,
      estado || 'Pendiente',
      fecha_estimada_entrega || null,
      observaciones || null
    ];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: `Trabajo registrado correctamente con código: ${codigoOrden}`,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al crear trabajo:', error);
    res.status(500).json({ success: false, message: 'Error al crear el trabajo', error: error.message });
  }
};

// 🟠 PUT: Editar un trabajo
exports.editarTrabajo = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      cliente_id, fecha_ingreso, tipo_equipo, marca_modelo,
      numero_serie, falla, monto_diagnostico, monto_reparacion,
      estado, fecha_estimada_entrega, observaciones, pagado
    } = req.body;

    // Verificar que el trabajo existe y obtener estado anterior
    const checkQuery = 'SELECT id, estado, pagado FROM trabajos WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Trabajo no encontrado' });
    }

    const estadoAnterior = checkResult.rows[0].estado;
    const pagadoAnterior = checkResult.rows[0].pagado;

    const query = `
      UPDATE trabajos
      SET cliente_id = $1, fecha_ingreso = $2, tipo_equipo = $3, marca_modelo = $4,
          numero_serie = $5, falla = $6, monto_diagnostico = $7, monto_reparacion = $8,
          estado = $9, fecha_estimada_entrega = $10, observaciones = $11, pagado = $12
      WHERE id = $13
      RETURNING id, codigo_orden, estado, pagado
    `;
    const values = [
      cliente_id, fecha_ingreso, tipo_equipo, marca_modelo,
      numero_serie, falla, monto_diagnostico || 0, monto_reparacion || 0,
      estado, fecha_estimada_entrega, observaciones, pagado || false,
      id
    ];
    const result = await pool.query(query, values);

    // ✅ INTEGRACIÓN: Si se marcó como pagado, registrar en Finanzas
    if (pagado && !pagadoAnterior) {
      const trabajo = result.rows[0];
      const montoTotal = (monto_diagnostico || 0) + (monto_reparacion || 0);

      // Buscar categoría "Cobro Servicios"
      const catQuery = 'SELECT id FROM categorias_finanzas WHERE nombre = $1';
      const catResult = await pool.query(catQuery, ['Cobro Servicios']);

      if (catResult.rows.length > 0) {
        const insertFinanzas = `
          INSERT INTO movimientos_finanzas 
          (fecha_movimiento, tipo, categoria_id, descripcion, monto)
          VALUES ($1, $2, $3, $4, $5)
        `;
        const valoresFinanzas = [
          new Date().toISOString().split('T')[0],
          'Ingreso',
          catResult.rows[0].id,
          `Cobro de trabajo ${trabajo.codigo_orden}`,
          montoTotal
        ];
        await pool.query(insertFinanzas, valoresFinanzas);
      }
    }

    res.json({ success: true, message: 'Trabajo actualizado correctamente', data: result.rows[0] });
  } catch (error) {
    console.error('Error al editar trabajo:', error);
    res.status(500).json({ success: false, message: 'Error al editar el trabajo', error: error.message });
  }
};

// 🔴 DELETE: Eliminar un trabajo
exports.eliminarTrabajo = async (req, res) => {
  try {
    const { id } = req.params;

    const checkQuery = 'SELECT id, codigo_orden FROM trabajos WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Trabajo no encontrado' });
    }

    await pool.query('DELETE FROM trabajos WHERE id = $1', [id]);

    res.json({ success: true, message: 'Trabajo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar trabajo:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el trabajo', error: error.message });
  }
};