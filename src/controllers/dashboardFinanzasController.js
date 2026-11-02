// src/controllers/dashboardFinanzasController.js
const pool = require('../config/db');

function buildWhere(params) {
  const conditions = [];
  const values = [];
  let idx = 1;
  if (params.anio) {
    conditions.push(`EXTRACT(YEAR FROM mf.fecha_movimiento) = $${idx}`);
    values.push(parseInt(params.anio));
    idx++;
  }
  if (params.mes) {
    conditions.push(`EXTRACT(MONTH FROM mf.fecha_movimiento) = $${idx}`);
    values.push(parseInt(params.mes));
    idx++;
  }
  if (params.fecha_inicio) {
    conditions.push(`mf.fecha_movimiento >= $${idx}::date`);
    values.push(params.fecha_inicio);
    idx++;
  }
  if (params.fecha_fin) {
    conditions.push(`mf.fecha_movimiento <= $${idx}::date`);
    values.push(params.fecha_fin);
    idx++;
  }
  if (params.ambito && params.ambito !== 'GENERAL') {
    conditions.push(`cf.ambito = $${idx}`);
    values.push(params.ambito);
    idx++;
  }
  if (!params.ambito || params.ambito === 'GENERAL') {
    conditions.push(`(mf.es_transferencia_interna = false OR mf.es_transferencia_interna IS NULL)`);
  }
  return {
    where: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '',
    values: values
  };
}

// 🟢 KPIs
exports.obtenerKPIs = async (req, res) => {
  try {
    const params = req.query;
    const { where, values } = buildWhere(params);
    const kpiQuery = `
      SELECT
        COALESCE(SUM(CASE WHEN mf.tipo = 'Ingreso' THEN mf.monto ELSE 0 END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Egreso' THEN mf.monto ELSE 0 END), 0) AS egresos,
        COUNT(*) AS operaciones,
        COUNT(DISTINCT mf.categoria_id) AS categorias_usadas
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      ${where}
    `;
    const kpiResult = await pool.query(kpiQuery, values);
    const kpis = kpiResult.rows[0];
    const ingresos = parseFloat(kpis.ingresos || 0);
    const egresos = parseFloat(kpis.egresos || 0);
    const balance = ingresos - egresos;
    const operaciones = parseInt(kpis.operaciones || 0);
    const ticketPromedio = operaciones > 0 ? egresos / operaciones : 0;

    let comparativa = {
      variacionIngresosPct: 0,
      variacionEgresosPct: 0,
      hayComparativa: false
    };
    if (params.anio && params.mes) {
      const anioAnt = parseInt(params.anio);
      const mesAnt = parseInt(params.mes) - 1;
      let anioComp = anioAnt;
      let mesComp = mesAnt;
      if (mesComp < 1) {
        mesComp = 12;
        anioComp = anioAnt - 1;
      }
      const paramsAnt = { ...params, anio: anioComp.toString(), mes: mesComp.toString() };
      const { where: whereAnt, values: valuesAnt } = buildWhere(paramsAnt);
      const kpiAntQuery = `
        SELECT
          COALESCE(SUM(CASE WHEN mf.tipo = 'Ingreso' THEN mf.monto ELSE 0 END), 0) AS ingresos,
          COALESCE(SUM(CASE WHEN mf.tipo = 'Egreso' THEN mf.monto ELSE 0 END), 0) AS egresos
        FROM movimientos_finanzas mf
        LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
        ${whereAnt}
      `;
      const kpiAntResult = await pool.query(kpiAntQuery, valuesAnt);
      if (kpiAntResult.rows[0]) {
        const ingAnt = parseFloat(kpiAntResult.rows[0].ingresos || 0);
        const egrAnt = parseFloat(kpiAntResult.rows[0].egresos || 0);
        if (ingAnt > 0) comparativa.variacionIngresosPct = ((ingresos - ingAnt) / ingAnt) * 100;
        if (egrAnt > 0) comparativa.variacionEgresosPct = ((egresos - egrAnt) / egrAnt) * 100;
        comparativa.hayComparativa = true;
        comparativa.ingresosAnteriores = ingAnt;
        comparativa.egresosAnteriores = egrAnt;
      }
    }

    res.json({
      success: true,
      data: {
        periodo: {
          anio: params.anio ? parseInt(params.anio) : null,
          mes: params.mes ? parseInt(params.mes) : null,
          fecha_inicio: params.fecha_inicio || null,
          fecha_fin: params.fecha_fin || null,
          ambito: params.ambito || 'GENERAL'
        },
        kpis: {
          ingresos: ingresos,
          egresos: egresos,
          balance: balance,
          operaciones: operaciones,
          ticketPromedio: ticketPromedio,
          categoriasUsadas: parseInt(kpis.categorias_usadas || 0)
        },
        comparativa: comparativa
      }
    });
  } catch (error) {
    console.error('Error en obtenerKPIs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 Evolución
exports.obtenerEvolucion = async (req, res) => {
  try {
    const { ambito, anio, meses } = req.query;
    const values = [];
    const conditions = [];
    let idx = 1;
    if (ambito && ambito !== 'GENERAL') {
      conditions.push(`cf.ambito = $${idx}`);
      values.push(ambito);
      idx++;
    } else {
      conditions.push(`(mf.es_transferencia_interna = false OR mf.es_transferencia_interna IS NULL)`);
    }
    const numMeses = meses ? parseInt(meses) : 24;
    if (anio) {
      conditions.push(`EXTRACT(YEAR FROM mf.fecha_movimiento) = $${idx}`);
      values.push(parseInt(anio));
      idx++;
    } else {
      conditions.push(`mf.fecha_movimiento >= CURRENT_DATE - INTERVAL '${numMeses} months'`);
    }
    const whereClause = 'WHERE ' + conditions.join(' AND ');
    const query = `
      SELECT
        DATE_TRUNC('month', mf.fecha_movimiento) AS mes,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Ingreso' THEN mf.monto ELSE 0 END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Egreso' THEN mf.monto ELSE 0 END), 0) AS egresos,
        COUNT(*) AS operaciones
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      ${whereClause}
      GROUP BY DATE_TRUNC('month', mf.fecha_movimiento)
      ORDER BY mes ASC
    `;
    const result = await pool.query(query, values);
    const evolucion = result.rows.map(row => {
      let mesStr = 'Sin fecha';
      let labelStr = 'N/A';
      let anioNum = 0;
      let mesNum = 0;
      try {
        if (row.mes) {
          const d = new Date(row.mes);
          if (!isNaN(d)) {
            mesStr = d.toISOString().split('T')[0].substring(0, 7);
            labelStr = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
            anioNum = d.getFullYear();
            mesNum = d.getMonth() + 1;
          }
        }
      } catch (e) {
        console.log('Fecha inválida en evolución');
      }
      return {
        mes: mesStr,
        mes_label: labelStr,
        anio: anioNum,
        mes_num: mesNum,
        ingresos: parseFloat(row.ingresos || 0),
        egresos: parseFloat(row.egresos || 0),
        balance: parseFloat(row.ingresos || 0) - parseFloat(row.egresos || 0),
        operaciones: parseInt(row.operaciones || 0)
      };
    });
    res.json({
      success: true,
      data: evolucion,
      total_meses: evolucion.length
    });
  } catch (error) {
    console.error('Error en obtenerEvolucion:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 Categorías
exports.obtenerDistribucionCategorias = async (req, res) => {
  try {
    const params = req.query;
    const { where, values } = buildWhere(params);
    const tipoFilter = params.tipo ? `AND mf.tipo = $${values.length + 1}` : '';
    const tipoValue = params.tipo ? [params.tipo] : [];
    const allValues = [...values, ...tipoValue];
    const query = `
      SELECT
        cf.id AS categoria_id,
        cf.nombre AS categoria,
        cf.icono,
        cf.color_hex,
        cf.ambito,
        COALESCE(SUM(mf.monto), 0) AS total,
        COUNT(*) AS cantidad,
        AVG(mf.monto) AS promedio
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      ${where}
      ${tipoFilter}
      GROUP BY cf.id, cf.nombre, cf.icono, cf.color_hex, cf.ambito
      ORDER BY total DESC
    `;
    const result = await pool.query(query, allValues);
    const total = result.rows.reduce((sum, row) => sum + parseFloat(row.total || 0), 0);
    const categorias = result.rows.map(row => ({
      id: row.categoria_id,
      nombre: row.categoria,
      icono: row.icono,
      color: row.color_hex,
      ambito: row.ambito,
      total: parseFloat(row.total || 0),
      cantidad: parseInt(row.cantidad || 0),
      promedio: parseFloat(row.promedio || 0),
      porcentaje: total > 0 ? (parseFloat(row.total || 0) / total) * 100 : 0
    }));
    res.json({ success: true, data: { total: total, categorias: categorias } });
  } catch (error) {
    console.error('Error en obtenerDistribucionCategorias:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 Métodos de pago
exports.obtenerDistribucionMetodosPago = async (req, res) => {
  try {
    const params = req.query;
    const { where, values } = buildWhere(params);
    const query = `
      SELECT
        mp.id AS metodo_id,
        mp.nombre AS metodo,
        mp.icono,
        mp.color_hex,
        COALESCE(SUM(mf.monto), 0) AS total,
        COUNT(*) AS cantidad
      FROM movimientos_finanzas mf
      LEFT JOIN metodos_pago mp ON mf.metodo_pago_id = mp.id
      ${where}
      GROUP BY mp.id, mp.nombre, mp.icono, mp.color_hex
      ORDER BY total DESC
    `;
    const result = await pool.query(query, values);
    const total = result.rows.reduce((sum, row) => sum + parseFloat(row.total || 0), 0);
    const metodos = result.rows.map(row => ({
      id: row.metodo_id,
      nombre: row.metodo,
      icono: row.icono,
      color: row.color_hex,
      total: parseFloat(row.total || 0),
      cantidad: parseInt(row.cantidad || 0),
      porcentaje: total > 0 ? (parseFloat(row.total || 0) / total) * 100 : 0
    }));
    res.json({ success: true, data: { total: total, metodos: metodos } });
  } catch (error) {
    console.error('Error en obtenerDistribucionMetodosPago:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 Alertas (simplificada para no fallar)
exports.obtenerAlertas = async (req, res) => {
  try {
    const { anio, mes, ambito } = req.query;
    const alertas = [];
    if (!anio || !mes) {
      return res.json({ success: true, data: [] });
    }
    const conditions = [];
    const values = [];
    let idx = 1;
    conditions.push(`EXTRACT(YEAR FROM mf.fecha_movimiento) = $${idx}`);
    values.push(parseInt(anio));
    idx++;
    conditions.push(`EXTRACT(MONTH FROM mf.fecha_movimiento) = $${idx}`);
    values.push(parseInt(mes));
    idx++;
    if (ambito && ambito !== 'GENERAL') {
      conditions.push(`cf.ambito = $${idx}`);
      values.push(ambito);
      idx++;
    } else {
      conditions.push(`(mf.es_transferencia_interna = false OR mf.es_transferencia_interna IS NULL)`);
    }
    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const balanceQuery = `
      SELECT
        COALESCE(SUM(CASE WHEN mf.tipo = 'Ingreso' THEN mf.monto ELSE 0 END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Egreso' THEN mf.monto ELSE 0 END), 0) AS egresos
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      ${whereClause}
    `;
    const balanceResult = await pool.query(balanceQuery, values);
    const ingresos = parseFloat(balanceResult.rows[0].ingresos || 0);
    const egresos = parseFloat(balanceResult.rows[0].egresos || 0);
    if (egresos > ingresos && ingresos > 0) {
      alertas.push({
        tipo: 'danger',
        mensaje: `Balance negativo: los egresos superan los ingresos en $${(egresos - ingresos).toLocaleString('es-AR')}`,
        monto: egresos - ingresos
      });
    }
    res.json({ success: true, data: alertas });
  } catch (error) {
    console.error('Error en obtenerAlertas:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 Análisis de categorías
exports.analizarCategorias = async (req, res) => {
  try {
    const { ids, fecha_inicio, fecha_fin, ambito } = req.query;
    if (!ids || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        success: false,
        message: 'ids, fecha_inicio y fecha_fin son obligatorios'
      });
    }
    const categoriaIds = ids.split(',');
    const values = [categoriaIds, fecha_inicio, fecha_fin];
    let ambitoFilter = '';
    if (ambito && ambito !== 'GENERAL') {
      ambitoFilter = 'AND cf.ambito = $4';
      values.push(ambito);
    } else if (ambito === 'GENERAL') {
      ambitoFilter = 'AND (mf.es_transferencia_interna = false OR mf.es_transferencia_interna IS NULL)';
    }
    const query = `
      SELECT
        cf.id AS categoria_id,
        cf.nombre AS categoria,
        cf.icono,
        cf.color_hex,
        cf.ambito,
        DATE_TRUNC('month', mf.fecha_movimiento) AS mes,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Ingreso' THEN mf.monto ELSE 0 END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Egreso' THEN mf.monto ELSE 0 END), 0) AS egresos,
        COUNT(*) AS operaciones
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      WHERE mf.categoria_id = ANY($1::uuid[])
        AND mf.fecha_movimiento >= $2::date
        AND mf.fecha_movimiento <= $3::date
        ${ambitoFilter}
      GROUP BY cf.id, cf.nombre, cf.icono, cf.color_hex, cf.ambito, DATE_TRUNC('month', mf.fecha_movimiento)
      ORDER BY cf.nombre, mes ASC
    `;
    const result = await pool.query(query, values);
    const analisis = {};
    result.rows.forEach(row => {
      const catId = row.categoria_id;
      if (!analisis[catId]) {
        analisis[catId] = {
          id: catId,
          nombre: row.categoria,
          icono: row.icono,
          color: row.color_hex,
          ambito: row.ambito,
          evolucion: []
        };
      }
      let mesStr = '';
      try {
        if (row.mes) {
          mesStr = new Date(row.mes).toISOString().split('T')[0].substring(0, 7);
        }
      } catch (e) {
        mesStr = '';
      }
      analisis[catId].evolucion.push({
        mes: mesStr,
        ingresos: parseFloat(row.ingresos || 0),
        egresos: parseFloat(row.egresos || 0),
        balance: parseFloat(row.ingresos || 0) - parseFloat(row.egresos || 0),
        operaciones: parseInt(row.operaciones || 0)
      });
    });
    res.json({ success: true, data: Object.values(analisis) });
  } catch (error) {
    console.error('Error en analizarCategorias:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟢 Top movimientos
exports.obtenerTopMovimientos = async (req, res) => {
  try {
    const params = req.query;
    const { where, values } = buildWhere(params);
    const query = `
      SELECT
        mf.id,
        mf.fecha_movimiento,
        mf.tipo,
        mf.descripcion,
        mf.monto,
        cf.nombre AS categoria,
        cf.icono AS categoria_icono,
        sf.nombre AS subcategoria,
        mp.nombre AS metodo_pago
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      LEFT JOIN subcategorias_finanzas sf ON mf.subcategoria_id = sf.id
      LEFT JOIN metodos_pago mp ON mf.metodo_pago_id = mp.id
      ${where}
      ORDER BY mf.monto DESC
      LIMIT 20
    `;
    const result = await pool.query(query, values);
    const movimientos = result.rows.map(row => ({
      id: row.id,
      fecha: row.fecha_movimiento ? new Date(row.fecha_movimiento).toISOString().split('T')[0] : null,
      tipo: row.tipo,
      descripcion: row.descripcion,
      monto: parseFloat(row.monto || 0),
      categoria: row.categoria,
      categoria_icono: row.categoria_icono,
      subcategoria: row.subcategoria,
      metodo_pago: row.metodo_pago
    }));
    res.json({ success: true, data: movimientos });
  } catch (error) {
    console.error('Error en obtenerTopMovimientos:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};