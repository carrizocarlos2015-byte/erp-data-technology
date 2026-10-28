// src/controllers/cajaChicaController.js
// Controlador del Módulo de Caja Chica
const pool = require('../config/db');

// 🟢 GET: Obtener estado actual de la caja chica
exports.obtenerEstado = async (req, res) => {
  try {
    const { anio, mes } = req.query;
    
    if (!anio || !mes) {
      return res.status(400).json({
        success: false,
        message: 'anio y mes son obligatorios'
      });
    }

    // Obtener configuración
    const configQuery = `
      SELECT monto_convenido, periodo, activo
      FROM configuracion_caja_chica
      WHERE activo = true
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const configResult = await pool.query(configQuery);
    const config = configResult.rows[0];

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'No hay configuración de caja chica activa'
      });
    }

    // Calcular total aportado en el mes (Ingresos a Casa con método Caja Chica)
    const aportadoQuery = `
      SELECT COALESCE(SUM(mf.monto), 0) AS total_aportado
      FROM movimientos_finanzas mf
      LEFT JOIN metodos_pago mp ON mf.metodo_pago_id = mp.id
      WHERE mp.nombre = 'Caja Chica'
        AND mf.tipo = 'Ingreso'
        AND EXTRACT(YEAR FROM mf.fecha_movimiento) = $1
        AND EXTRACT(MONTH FROM mf.fecha_movimiento) = $2
        AND (mf.es_transferencia_interna = true OR mf.es_transferencia_interna IS NULL)
    `;
    const aportadoResult = await pool.query(aportadoQuery, [parseInt(anio), parseInt(mes)]);
    const totalAportado = parseFloat(aportadoResult.rows[0].total_aportado);

    // Calcular total gastado de caja chica en el mes (Egresos de Casa con método Caja Chica)
    const gastadoQuery = `
      SELECT COALESCE(SUM(mf.monto), 0) AS total_gastado
      FROM movimientos_finanzas mf
      LEFT JOIN metodos_pago mp ON mf.metodo_pago_id = mp.id
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      WHERE mp.nombre = 'Caja Chica'
        AND mf.tipo = 'Egreso'
        AND cf.ambito = 'CASA'
        AND EXTRACT(YEAR FROM mf.fecha_movimiento) = $1
        AND EXTRACT(MONTH FROM mf.fecha_movimiento) = $2
    `;
    const gastadoResult = await pool.query(gastadoQuery, [parseInt(anio), parseInt(mes)]);
    const totalGastado = parseFloat(gastadoResult.rows[0].total_gastado);

    const montoConvenido = parseFloat(config.monto_convenido);
    const saldoDisponible = totalAportado - totalGastado;
    const porcentajeUsado = montoConvenido > 0 ? (totalGastado / montoConvenido) * 100 : 0;
    const porcentajeAportado = montoConvenido > 0 ? (totalAportado / montoConvenido) * 100 : 0;

    res.json({
      success: true,
      data: {
        configuracion: {
          monto_convenido: montoConvenido,
          periodo: config.periodo
        },
        estado: {
          total_aportado: totalAportado,
          total_gastado: totalGastado,
          saldo_disponible: saldoDisponible,
          porcentaje_usado: porcentajeUsado,
          porcentaje_aportado: porcentajeAportado
        },
        periodo: {
          anio: parseInt(anio),
          mes: parseInt(mes)
        }
      }
    });
  } catch (error) {
    console.error('Error en obtenerEstado:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟡 POST: Actualizar monto convenido
exports.actualizarConfiguracion = async (req, res) => {
  try {
    const { monto_convenido } = req.body;

    if (!monto_convenido || monto_convenido <= 0) {
      return res.status(400).json({
        success: false,
        message: 'El monto convenido debe ser mayor a 0'
      });
    }

    const query = `
      UPDATE configuracion_caja_chica
      SET monto_convenido = $1, updated_at = CURRENT_TIMESTAMP
      WHERE activo = true
      RETURNING id, monto_convenido, periodo
    `;
    const result = await pool.query(query, [monto_convenido]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No se encontró configuración activa'
      });
    }

    res.json({
      success: true,
      message: 'Configuración actualizada correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error en actualizarConfiguracion:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 GET: Obtener historial de aportes y gastos
exports.obtenerHistorial = async (req, res) => {
  try {
    const { anio, mes } = req.query;

    if (!anio || !mes) {
      return res.status(400).json({
        success: false,
        message: 'anio y mes son obligatorios'
      });
    }

    // Aportes (Ingresos a Casa con método Caja Chica)
    const aportesQuery = `
      SELECT 
        mf.id,
        mf.fecha_movimiento,
        mf.monto,
        mf.descripcion,
        mp.nombre AS metodo_pago
      FROM movimientos_finanzas mf
      LEFT JOIN metodos_pago mp ON mf.metodo_pago_id = mp.id
      WHERE mp.nombre = 'Caja Chica'
        AND mf.tipo = 'Ingreso'
        AND EXTRACT(YEAR FROM mf.fecha_movimiento) = $1
        AND EXTRACT(MONTH FROM mf.fecha_movimiento) = $2
      ORDER BY mf.fecha_movimiento DESC
    `;
    const aportesResult = await pool.query(aportesQuery, [parseInt(anio), parseInt(mes)]);

    // Gastos (Egresos de Casa con método Caja Chica)
    const gastosQuery = `
      SELECT 
        mf.id,
        mf.fecha_movimiento,
        mf.monto,
        mf.descripcion,
        cf.nombre AS categoria,
        mp.nombre AS metodo_pago
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      LEFT JOIN metodos_pago mp ON mf.metodo_pago_id = mp.id
      WHERE mp.nombre = 'Caja Chica'
        AND mf.tipo = 'Egreso'
        AND EXTRACT(YEAR FROM mf.fecha_movimiento) = $1
        AND EXTRACT(MONTH FROM mf.fecha_movimiento) = $2
      ORDER BY mf.fecha_movimiento DESC
    `;
    const gastosResult = await pool.query(gastosQuery, [parseInt(anio), parseInt(mes)]);

    res.json({
      success: true,
      data: {
        aportes: aportesResult.rows.map(row => ({
          id: row.id,
          fecha: row.fecha_movimiento,
          monto: parseFloat(row.monto),
          descripcion: row.descripcion,
          metodo_pago: row.metodo_pago
        })),
        gastos: gastosResult.rows.map(row => ({
          id: row.id,
          fecha: row.fecha_movimiento,
          monto: parseFloat(row.monto),
          descripcion: row.descripcion,
          categoria: row.categoria,
          metodo_pago: row.metodo_pago
        }))
      }
    });
  } catch (error) {
    console.error('Error en obtenerHistorial:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};