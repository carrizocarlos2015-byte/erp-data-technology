// src/controllers/dashboardFinanzasController.js
const pool = require('../config/db');

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function buildWhere(params) {
  const conditions = [];
  const values = [];
  let idx = 1;
  if (params.tipo) {
    conditions.push(`UPPER(mf.tipo) = UPPER($${idx})`);
    values.push(params.tipo.toUpperCase());
    idx++;
  }
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
    conditions.push(`UPPER(cf.ambito_negocio) = UPPER($${idx})`);
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
    const { ambito, anio, meses, tipo } = req.query;
    const values = [];
    const conditions = [];
    let idx = 1;
    if (tipo) {
      conditions.push(`UPPER(mf.tipo) = UPPER($${idx})`);
      values.push(tipo.toUpperCase());
      idx++;
    }
    if (ambito && ambito !== 'GENERAL') {
      conditions.push(`UPPER(cf.ambito_negocio) = UPPER($${idx})`);
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
        EXTRACT(YEAR FROM mf.fecha_movimiento)::int AS anio,
        EXTRACT(MONTH FROM mf.fecha_movimiento)::int AS mes_num,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Ingreso' THEN mf.monto ELSE 0 END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Egreso' THEN mf.monto ELSE 0 END), 0) AS egresos,
        COUNT(*) AS operaciones
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      ${whereClause}
      GROUP BY EXTRACT(YEAR FROM mf.fecha_movimiento), EXTRACT(MONTH FROM mf.fecha_movimiento)
      ORDER BY anio ASC, mes_num ASC
    `;
    const result = await pool.query(query, values);
    const evolucion = result.rows.map(row => {
      const anioNum = parseInt(row.anio) || 0;
      const mesNum = parseInt(row.mes_num) || 0;
      let mesStr = 'Sin fecha';
      let labelStr = 'N/A';
      if (anioNum && mesNum) {
        mesStr = `${anioNum}-${String(mesNum).padStart(2, '0')}`;
        const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        labelStr = `${MESES_ES[(mesNum || 1) - 1]} ${String(anioNum).slice(-2)}`;
      }
      const ingresos = parseFloat(row.ingresos || 0);
      const egresos = parseFloat(row.egresos || 0);
      return {
        mes: mesStr,
        mes_label: labelStr,
        anio: anioNum,
        mes_num: mesNum,
        ingresos: ingresos,
        egresos: egresos,
        balance: ingresos - egresos,
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
    // buildWhere ya agrega el filtro de tipo con UPPER() (la BD guarda 'Egreso'/'Ingreso'
    // con mezcla de mayúsculas): agregarlo de nuevo con el valor crudo dejaba el gráfico vacío.
    const query = `
      SELECT
        cf.id AS categoria_id,
        cf.nombre AS categoria,
        cf.icono,
        cf.color_hex,
        cf.ambito,
        cf.ambito_negocio,
        COALESCE(SUM(mf.monto), 0) AS total,
        COUNT(*) AS cantidad,
        AVG(mf.monto) AS promedio
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      ${where}
      GROUP BY cf.id, cf.nombre, cf.icono, cf.color_hex, cf.ambito, cf.ambito_negocio
      ORDER BY total DESC
    `;
    const result = await pool.query(query, values);
    const total = result.rows.reduce((sum, row) => sum + parseFloat(row.total || 0), 0);
    const categorias = result.rows.map(row => ({
      id: row.categoria_id,
      nombre: row.categoria,
      icono: row.icono,
      color: row.color_hex,
      ambito: row.ambito,
      ambito_negocio: row.ambito_negocio,
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

// 🟢 Alertas del mes (útiles, no solo balance)
exports.obtenerAlertas = async (req, res) => {
  try {
    const { anio, mes, ambito, tipo } = req.query;
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
    if (tipo && tipo !== 'GENERAL') {
      conditions.push(`UPPER(mf.tipo) = UPPER($${idx})`);
      values.push(tipo.toUpperCase());
      idx++;
    }
    if (ambito && ambito !== 'GENERAL') {
      conditions.push(`UPPER(cf.ambito_negocio) = UPPER($${idx})`);
      values.push(ambito);
      idx++;
    } else {
      conditions.push(`(mf.es_transferencia_interna = false OR mf.es_transferencia_interna IS NULL)`);
    }
    const whereClause = 'WHERE ' + conditions.join(' AND ');
    const params = { anio: parseInt(anio), mes: parseInt(mes), ambito, tipo };

    // 1) Totales del mes
    const balanceQuery = `
      SELECT
        COALESCE(SUM(CASE WHEN mf.tipo = 'Ingreso' THEN mf.monto ELSE 0 END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Egreso' THEN mf.monto ELSE 0 END), 0) AS egresos,
        COUNT(*) AS operaciones
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      ${whereClause}
    `;
    const balanceResult = await pool.query(balanceQuery, values);
    const ingresos = parseFloat(balanceResult.rows[0].ingresos || 0);
    const egresos = parseFloat(balanceResult.rows[0].egresos || 0);
    const operaciones = parseInt(balanceResult.rows[0].operaciones || 0);

    if (operaciones === 0) {
      alertas.push({
        tipo: 'info',
        mensaje: `Sin movimientos registrados en ${MESES[parseInt(mes) - 1]} ${anio}.`
      });
      return res.json({ success: true, data: alertas, meta: { ingresos: 0, egresos: 0, operaciones: 0, periodo: `${MESES[parseInt(mes) - 1]} ${anio}` } });
    }

    // 2) Balance negativo (solo tiene sentido sin filtro de tipo)
    const sinFiltroTipo = !tipo || tipo === 'GENERAL';
    if (sinFiltroTipo && egresos > ingresos && ingresos > 0) {
      alertas.push({
        tipo: 'danger',
        mensaje: `Balance negativo: los egresos superan los ingresos en $${(egresos - ingresos).toLocaleString('es-AR')}`,
        monto: egresos - ingresos
      });
    } else if (sinFiltroTipo && egresos > 0 && ingresos === 0) {
      alertas.push({
        tipo: 'danger',
        mensaje: `Mes sin ingresos: se registraron $${egresos.toLocaleString('es-AR')} en egresos.`
      });
    }

    // 3) Comparativa de egresos contra el mes anterior
    const mAnt = parseInt(mes) - 1;
    const anioAnt = mAnt === 0 ? parseInt(anio) - 1 : parseInt(anio);
    const mesAnt = mAnt === 0 ? 12 : mAnt;
    try {
      const condAnt = [
        `EXTRACT(YEAR FROM mf.fecha_movimiento) = $1`,
        `EXTRACT(MONTH FROM mf.fecha_movimiento) = $2`
      ];
      const valAnt = [anioAnt, mesAnt];
      let iAnt = 3;
      if (tipo && tipo !== 'GENERAL') {
        condAnt.push(`UPPER(mf.tipo) = UPPER($${iAnt})`);
        valAnt.push(tipo.toUpperCase());
        iAnt++;
      }
      if (ambito && ambito !== 'GENERAL') {
        condAnt.push(`UPPER(cf.ambito_negocio) = UPPER($${iAnt})`);
        valAnt.push(ambito);
      } else {
        condAnt.push(`(mf.es_transferencia_interna = false OR mf.es_transferencia_interna IS NULL)`);
      }
      const rAnt = await pool.query(`
        SELECT COALESCE(SUM(CASE WHEN mf.tipo = 'Egreso' THEN mf.monto ELSE 0 END), 0) AS egresos
          FROM movimientos_finanzas mf
          LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
         WHERE ${condAnt.join(' AND ')}
      `, valAnt);
      const egresosAnt = parseFloat(rAnt.rows[0].egresos || 0);
      if (egresosAnt > 0) {
        const delta = (egresos - egresosAnt) / egresosAnt * 100;
        if (delta >= 20) {
          alertas.push({
            tipo: 'warning',
            mensaje: `Los egresos subieron ${delta.toFixed(1)}% respecto de ${MESES[mesAnt - 1]} ${anioAnt} ($${egresosAnt.toLocaleString('es-AR')} → $${egresos.toLocaleString('es-AR')}).`,
            monto: egresos - egresosAnt
          });
        } else if (delta <= -20) {
          alertas.push({
            tipo: 'success',
            mensaje: `Los egresos bajaron ${Math.abs(delta).toFixed(1)}% respecto de ${MESES[mesAnt - 1]} ${anioAnt}.`,
            monto: egresosAnt - egresos
          });
        }
      }
    } catch (e) {
      console.error('Error comparativa en alertas:', e.message);
    }

    // 4) Categoría que se lleva una parte grande del gasto
    try {
      const rCat = await pool.query(`
        SELECT cf.nombre, SUM(mf.monto) AS total
          FROM movimientos_finanzas mf
          JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
         ${whereClause.replace('WHERE', 'WHERE mf.tipo = \'Egreso\' AND')}
         GROUP BY cf.nombre
         ORDER BY total DESC
         LIMIT 1
      `, values);
      if (rCat.rows.length > 0 && egresos > 0) {
        const top = rCat.rows[0];
        const pct = parseFloat(top.total) / egresos * 100;
        if (pct >= 40) {
          alertas.push({
            tipo: 'warning',
            mensaje: `"${top.nombre}" concentra el ${pct.toFixed(0)}% de los egresos del mes ($${parseFloat(top.total).toLocaleString('es-AR')}).`,
            monto: parseFloat(top.total)
          });
        }
      }
    } catch (e) {
      console.error('Error top categoría en alertas:', e.message);
    }

    // 5) Movimiento inusualmente grande (más de 3 veces el ticket promedio)
    try {
      const rMax = await pool.query(`
        SELECT mf.monto, mf.descripcion, cf.nombre AS categoria
          FROM movimientos_finanzas mf
          LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
         ${whereClause}
         ORDER BY mf.monto DESC
         LIMIT 1
      `, values);
      if (rMax.rows.length > 0) {
        const maxMonto = parseFloat(rMax.rows[0].monto || 0);
        const promedio = (ingresos + egresos) / operaciones;
        if (promedio > 0 && maxMonto > promedio * 3 && operaciones >= 5) {
          alertas.push({
            tipo: 'info',
            mensaje: `Movimiento atípico: "${rMax.rows[0].descripcion || 'Sin descripción'}" (${rMax.rows[0].categoria || 'sin categoría'}) por $${maxMonto.toLocaleString('es-AR')} — ${Math.round(maxMonto / promedio)}x el promedio del mes.`,
            monto: maxMonto
          });
        }
      }
    } catch (e) {
      console.error('Error movimiento atípico en alertas:', e.message);
    }

    res.json({ success: true, data: alertas, meta: { ingresos, egresos, operaciones, periodo: `${MESES[parseInt(mes) - 1]} ${anio}` } });
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
      ambitoFilter = 'AND UPPER(cf.ambito_negocio) = UPPER($4)';
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
        EXTRACT(YEAR FROM mf.fecha_movimiento)::int AS anio,
        EXTRACT(MONTH FROM mf.fecha_movimiento)::int AS mes_num,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Ingreso' THEN mf.monto ELSE 0 END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN mf.tipo = 'Egreso' THEN mf.monto ELSE 0 END), 0) AS egresos,
        COUNT(*) AS operaciones
      FROM movimientos_finanzas mf
      LEFT JOIN categorias_finanzas cf ON mf.categoria_id = cf.id
      WHERE mf.categoria_id = ANY($1::uuid[])
        AND mf.fecha_movimiento >= $2::date
        AND mf.fecha_movimiento <= $3::date
        ${ambitoFilter}
      GROUP BY cf.id, cf.nombre, cf.icono, cf.color_hex, cf.ambito, EXTRACT(YEAR FROM mf.fecha_movimiento), EXTRACT(MONTH FROM mf.fecha_movimiento)
      ORDER BY cf.nombre, anio ASC, mes_num ASC
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
        if (row.mes_num) {
          mesStr = `${row.anio}-${String(row.mes_num).padStart(2, '0')}`;
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