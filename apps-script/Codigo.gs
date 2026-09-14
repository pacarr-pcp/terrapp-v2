/**
 * TerrApp B2 — backend (Google Apps Script publicado como Web App).
 *
 * Reemplaza al componente Spreadsheet de App Inventor y a los scripts
 * antiguos terr2PDF() / copiar2() (que se disparaban escribiendo una
 * palabra clave en la celda I4).
 *
 * Cubre dos apps:
 *   - Inspección en terreno  -> reporte PDF + Archivo2
 *   - Mantención de clientes  -> hoja ListaOCP (varias ubicaciones por OTE)
 *
 * Flujo de inspección: la PWA envía una inspección completa por HTTPS ->
 * este script la vuelca en una copia desechable de "Plantilla", escribe los
 * datos de la ubicación elegida en el encabezado, deja calcular las fórmulas
 * NCh203, exporta esa copia a PDF, la archiva en "Archivo2" y borra la copia.
 * Todo dentro de un LockService: dos inspectores simultáneos se serializan.
 *
 * ─────────────────────────────────────────────────────────────────────
 * PUESTA EN MARCHA  (detalle en README.md)
 * 1. Extensiones -> Apps Script. Pega este archivo.
 * 2. Duplica "ReportPCP" -> renómbrala "Plantilla" -> ocúltala.
 * 3. En ListaOCP agrega dos columnas al final:  F = Sede   G = id
 *    (A..E quedan igual). Puedes ocultar G.
 * 4. Configuración del proyecto -> Propiedades del script:
 *      PINS  =  {"PCP":"4821","SRS":"7310","DPG":"5566","AVR":"9014"}
 * 5. Implementar -> Nueva implementación -> Aplicación web
 *      Ejecutar como: Yo (simet.pcp@usach.cl)
 *      Quién tiene acceso: Cualquier persona
 *    Copia la URL /exec  ->  pwa/app.js (BACKEND_URL).
 * 6. Cada cambio de código: Implementar -> Administrar implementaciones ->
 *    editar -> Versión: Nueva.
 * ─────────────────────────────────────────────────────────────────────
 */

// ===================== CONFIG — VERIFICAR CONTRA LA PLANILLA =====================
var CFG = {
  SPREADSHEET_ID : '1x2CUyhgkJj6EWEODDIGUSkcvwZTVBpyle3qRGK7JDMI',
  PLANTILLA      : 'Plantilla',
  ARCHIVO        : 'Archivo2',
  LISTA_OCP      : 'ListaOCP',
  CARPETA_PDF_ID : '1rg6bS_xQY4Xd6SjHOMmGZbu9TN2Nr0kf',

  // --- Fila KEY (encabezado de la inspección) en la plantilla ---
  // fila 8 = [RAM, AR, OTE, Fecha, nMuestras(E8), Inspector, Tonelaje(G8), Precio(H8)]
  FILA_KEY : 8,
  KEY_COLS : { ram:1, ar:2, ote:3, fecha:4, nMuestras:5, inspector:6, tonelaje:7, precio:8 },   // 1=A. E8 = total de muestras, G8 = Ton, H8 = precio UF (ambos calculados en la PWA)

  // --- Muestras ---
  FILA_MUESTRA_1 : 9,
  MAX_MUESTRAS   : 33,         // filas 9..41 en la plantilla
  ANCHO_FILA     : 10,         // se escriben las columnas A..J
  //  A = correlativo por muestra ("RAM"-01, -02…)   J = últimos 4 de B ("ídem": 0101, 0202…)
  MUESTRA_COLS   : { correl:1, muestra:2, tipo:3, dimension:4, grado:5, colada:6, peso:7, cantidad:8, loteId:9, idem:10 },

  // --- Auto-muestreo por colada (kg) ---
  //   identificada:  1 muestra por 40 t, tope 5  (200 t)
  //   no identificada: 1 por 20 t, tope 10
  MUESTREO : { kgId:40000, kgNoId:20000, topeId:5, topeNoId:10 },
  DITTO    : '"',              // marca de "ídem" en las filas 2ª+ de cada colada

  // --- Fase 2: precio por espesor (tabla pendiente) ---
  //   Cuña para la 2ª versión. Cuando exista la tabla:
  //     activo:true, definir origen ('Precios' hoja o data/precios.json),
  //     base ('kg' | 'unidad' | 'm2') y COL_PRECIO destino.
  PRECIO : { activo:false, moneda:'CLP', base:'kg', COL_PRECIO:null },

  // --- Celdas del encabezado del reporte que el backend rellena con la
  //     ubicación elegida de ListaOCP (sobrescribe el VLOOKUP en la copia).
  //     Mapeo confirmado por el usuario:
  //       Solicitante <- ListaOCP col C (Nombre / contacto)  -> combinada B3:C3
  //       Cliente     <- ListaOCP col B (Empresa)            -> combinada B4:C4
  //       Lugar       <- ListaOCP col D (Calle) + " " + col E (Comuna) -> combinada E4:H4
  //     Se escribe en la celda ancla (esquina sup. izq.) de cada rango combinado.
  REPORTE_CELLS : { solicitante:'B3', cliente:'B4', lugar:'E4' },

  // --- ListaOCP (con las 2 columnas nuevas) ---
  LISTA_COLS : { ote:1, cliente:2, nombre:3, calle:4, comuna:5, sede:6, id:7 },
  LISTA_ANCHO : 7,

  // --- Copia a Archivo2 (como copiar2: desde la fila 8, ancho hasta J) ---
  FILA_COPIA_DESDE : 8,
  COL_COPIA_HASTA  : 10
};

// ===================== HTTP =====================
function doGet() {
  return _json({ ok:true, servicio:'TerrApp B2', ts:new Date().toISOString() });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (body.accion) {
      case 'ping'         : _auth(body); return _json({ ok:true });
      case 'crear'        : return _json(crearInspeccion(body));
      case 'sedes'        : return _json(sedesDeOte(body));
      case 'ote_listar'   : return _json(oteListar(body));
      case 'ote_guardar'  : return _json(oteGuardar(body));
      case 'ote_eliminar' : return _json(oteEliminar(body));
      default             : return _json({ ok:false, error:'acción desconocida: ' + body.accion });
    }
  } catch (err) {
    return _json({ ok:false, error:_msg(err) });
  }
}

function _json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function _msg(e) { return String((e && e.message) || e); }
function _num(x) { var n = Number(String(x == null ? '' : x).replace(',', '.')); return isFinite(n) ? n : 0; }
function _pad2(x){ var v = String(x == null ? '' : x).replace(/\D/g, ''); return v ? ('0' + v).slice(-2) : '00'; }
function _nMuestras(kg, identificada) {
  var m = CFG.MUESTREO;
  var div = identificada ? m.kgId : m.kgNoId;
  var cap = identificada ? m.topeId : m.topeNoId;
  var n = Math.ceil(_num(kg) / div);
  if (!isFinite(n) || n < 1) n = 1;
  return Math.min(cap, n);
}

/**
 * Fase 2 (cuña). Espesor de la muestra. La posición depende del tipo:
 *   - Plancha        -> 1er número de "dimension" ("50x2440x12000" -> 50)
 *   - Viga HEB/HEA/IPE/... -> NO está en "dimension" (que es alto x largo);
 *                             se resuelve por tabla: tipo + alto (HEB 200)
 *   - Perfiles       -> otra posición, según el tipo
 * Hoy sólo cubre plancha; el resto devuelve null hasta tener las tablas.
 */
function _espesor(tipo, dimension) {
  var t = String(tipo || '').toLowerCase();
  var nums = String(dimension || '').split(/[x×\*\s]+/).map(function (s) {
    var n = Number(String(s).replace(',', '.')); return isFinite(n) ? n : null;
  }).filter(function (n) { return n != null; });

  if (t.indexOf('plancha') >= 0) return nums.length ? nums[0] : null;
  // TODO Fase 2: viga  -> tablaEspesorViga[tipo][ nums[0] /* alto */ ]
  // TODO Fase 2: perfil -> según tipo, elegir nums[k] o tabla
  return null;
}

/**
 * Fase 2 (cuña). Precio unitario de una muestra según tipo + espesor + grado.
 * Hoy devuelve null y no altera nada (CFG.PRECIO.activo === false).
 * Al activarlo: resolver espesor con _espesor(tipo, dimension), buscar
 * (grado, espesor) en la tabla y devolver el valor; en crearInspeccion, si
 * CFG.PRECIO.COL_PRECIO está definido, escribir la columna de precio + total.
 */
function precioMuestra(tipo, dimension, grado) {
  if (!CFG.PRECIO.activo) return null;
  var esp = _espesor(tipo, dimension);
  if (esp == null) return null;
  // TODO Fase 2: lookup en tabla de precios por (grado, esp) -> valor.
  return null;
}
function _ss()  { return SpreadsheetApp.openById(CFG.SPREADSHEET_ID); }
function _lista(){ var s = _ss().getSheetByName(CFG.LISTA_OCP); if (!s) throw new Error('Falta la hoja "' + CFG.LISTA_OCP + '"'); return s; }

function _auth(body) {
  var pins = JSON.parse(PropertiesService.getScriptProperties().getProperty('PINS') || '{}');
  var insp = String(body.inspector || '').trim();
  if (!insp || pins[insp] == null || String(pins[insp]) !== String(body.pin || '')) {
    throw new Error('Inspector o PIN inválido');
  }
  return insp;
}

function _lock() {
  var l = LockService.getScriptLock();
  if (!l.tryLock(30000)) throw new Error('Sistema ocupado, reintente en unos segundos');
  return l;
}

// ===================== ListaOCP (clientes / ubicaciones) =====================

// Ubica una fila por su id (uuid en col G) o por el token "row:<n>".
function _oteRowById(sh, id) {
  if (!id) return -1;
  var m = /^row:(\d+)$/.exec(String(id));
  if (m) return Number(m[1]);
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var col = sh.getRange(2, CFG.LISTA_COLS.id, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) if (String(col[i][0]) === String(id)) return i + 2;
  return -1;
}

function _rowToReg(vals, filaHoja) {
  var c = CFG.LISTA_COLS;
  return {
    id     : vals[c.id - 1] ? String(vals[c.id - 1]) : ('row:' + filaHoja),
    ote    : String(vals[c.ote - 1] || ''),
    cliente: String(vals[c.cliente - 1] || ''),
    nombre : String(vals[c.nombre - 1] || ''),
    calle  : String(vals[c.calle - 1] || ''),
    comuna : String(vals[c.comuna - 1] || ''),
    sede   : String(vals[c.sede - 1] || '')
  };
}

/**
 * Para el selector del encabezado. Devuelve nombre (solicitante), empresa,
 * sede y comuna — pero NO la calle (esa se arma en el backend al crear).
 */
function sedesDeOte(body) {
  _auth(body);
  var ote = String(body.ote || '').trim();
  if (!ote) return { ok:false, error:'OTE requerido' };

  var vals = _lista().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][CFG.LISTA_COLS.ote - 1]).trim() === ote) {
      var r = _rowToReg(vals[i], i + 1);
      out.push({ id:r.id, cliente:r.cliente, nombre:r.nombre, sede:r.sede, comuna:r.comuna });
    }
  }
  return { ok:true, sedes:out };
}

/** Para el editor de Clientes: filas completas (filtro libre por texto). */
function oteListar(body) {
  _auth(body);
  var q = String(body.q || '').trim().toLowerCase();
  var vals = _lista().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    if (!String(vals[i][CFG.LISTA_COLS.ote - 1]).trim()) continue;
    var r = _rowToReg(vals[i], i + 1);
    if (!q || (r.ote + ' ' + r.cliente + ' ' + r.nombre + ' ' + r.comuna + ' ' + r.sede)
              .toLowerCase().indexOf(q) >= 0) {
      out.push(r);
    }
    if (out.length >= 200) break;
  }
  return { ok:true, registros:out };
}

function oteGuardar(body) {
  _auth(body);
  var r = body.registro || {};
  if (!String(r.ote || '').trim()) return { ok:false, error:'OTE requerido' };
  if (!String(r.cliente || '').trim()) return { ok:false, error:'Empresa requerida' };

  var lock = _lock();
  try {
    var sh = _lista();
    var c = CFG.LISTA_COLS;
    var fila = _oteRowById(sh, r.id);
    var id = (r.id && !/^row:/.test(String(r.id))) ? String(r.id) : Utilities.getUuid();

    var vals = [];
    vals[c.ote - 1]     = String(r.ote).trim();
    vals[c.cliente - 1] = String(r.cliente).trim();
    vals[c.nombre - 1]  = String(r.nombre || '').trim();
    vals[c.calle - 1]   = String(r.calle || '').trim();
    vals[c.comuna - 1]  = String(r.comuna || '').trim();
    vals[c.sede - 1]    = String(r.sede || '').trim();
    vals[c.id - 1]      = id;

    if (fila > 1) sh.getRange(fila, 1, 1, CFG.LISTA_ANCHO).setValues([vals]);
    else          sh.getRange(sh.getLastRow() + 1, 1, 1, CFG.LISTA_ANCHO).setValues([vals]);

    return { ok:true, id:id };
  } catch (err) {
    return { ok:false, error:_msg(err) };
  } finally { lock.releaseLock(); }
}

function oteEliminar(body) {
  _auth(body);
  var lock = _lock();
  try {
    var sh = _lista();
    var fila = _oteRowById(sh, body.id);
    if (fila <= 1) return { ok:false, error:'Ubicación no encontrada' };
    sh.deleteRow(fila);
    return { ok:true };
  } catch (err) {
    return { ok:false, error:_msg(err) };
  } finally { lock.releaseLock(); }
}

// ===================== Inspección =====================
/**
 * body = {
 *   inspector, pin, ar, ote, ram, fecha, sedeId,
 *   coladas: [{ pos, tipo, dimension, grado, colada, cantidad, peso, identificada }]
 * }
 * El backend expande cada colada a N muestras (auto-muestreo) y escribe A..J:
 *   A = "RAM"-nn (correlativo)   B = notación AAAA-PP-nnTT   C..I = datos
 *   J = últimos 4 de B (para las fórmulas B6:F6 que cuentan "ídem")
 * E8 = total de muestras. Archivo2 recibe todo el rango A..J.
 */
function crearInspeccion(body) {
  var inspector = _auth(body);

  var ar    = String(body.ar || '').trim();
  var ote   = String(body.ote || '').trim();
  var ram   = String(body.ram || '').trim();
  var fecha = String(body.fecha || '').trim();
  var coladas = Array.isArray(body.coladas) ? body.coladas : [];

  if (!/^\d{4}$/.test(ar))    return { ok:false, error:'AR inválido (4 dígitos)' };
  if (!ote)                   return { ok:false, error:'OTE requerido' };
  if (!fecha)                 return { ok:false, error:'Fecha requerida' };
  if (coladas.length < 1)     return { ok:false, error:'Agregue al menos una colada' };

  // --- expandir coladas -> filas de muestra (columnas A..J) ---
  var mc = CFG.MUESTRA_COLS;
  var ANCHO = CFG.ANCHO_FILA;                                 // 10 (A..J)
  var prefA = ram || ar;                                      // prefijo de la col A
  var filas = [], dittoRel = [], idx = 0;                     // dittoRel: filas "ídem" (0-based)
  for (var ci = 0; ci < coladas.length; ci++) {
    var c = coladas[ci];
    var pp = _pad2(c.pos != null ? c.pos : (ci + 1));
    var n  = _nMuestras(c.peso, c.identificada);
    for (var kk = 1; kk <= n; kk++) {
      idx++;
      var code = ar + '-' + pp + '-' + _pad2(kk) + _pad2(n);
      var r = new Array(ANCHO).fill('');
      r[mc.correl    - 1] = prefA + '-' + _pad2(idx);           // A: correlativo por muestra
      r[mc.muestra   - 1] = code;                               // B: notación AAAA-PP-nnTT
      r[mc.tipo      - 1] = c.tipo      || '';                  // C
      r[mc.dimension - 1] = c.dimension || '';                  // D
      r[mc.grado     - 1] = c.grado     || '';                  // E
      r[mc.colada    - 1] = c.colada    || '';                  // F
      r[mc.peso      - 1] = _num(c.peso);                       // G
      r[mc.cantidad  - 1] = _num(c.cantidad);                   // H
      r[mc.loteId    - 1] = c.identificada ? 'Si' : 'No Id.';   // I
      r[mc.idem      - 1] = code.slice(-4);                     // J: últimos 4 de B ("ídem")
      filas.push(r);
      if (kk > 1) dittoRel.push(filas.length - 1);
    }
  }
  if (filas.length > CFG.MAX_MUESTRAS) {
    return { ok:false, error:'Resultan ' + filas.length + ' muestras; la plantilla admite ' + CFG.MAX_MUESTRAS };
  }

  var lock = _lock();
  var ss = _ss();
  var tmp = null;
  try {
    var plantilla = ss.getSheetByName(CFG.PLANTILLA);
    if (!plantilla) throw new Error('Falta la hoja "' + CFG.PLANTILLA + '"');

    tmp = plantilla.copyTo(ss);
    tmp.setName('tmp_' + Utilities.getUuid().slice(0, 8));
    tmp.showSheet();                     // si Plantilla está oculta, la copia también -> el PDF saldría en blanco

    var avisos = [];

    // asegurar que exista la columna J (si la plantilla venía recortada a 9 col.)
    if (tmp.getMaxColumns() < ANCHO) {
      tmp.insertColumnsAfter(tmp.getMaxColumns(), ANCHO - tmp.getMaxColumns());
      try { tmp.hideColumns(CFG.MUESTRA_COLS.idem); } catch (eh) {}
    }

    // fila KEY
    var k = CFG.KEY_COLS;
    tmp.getRange(CFG.FILA_KEY, k.ram).setValue(ram);
    tmp.getRange(CFG.FILA_KEY, k.ar).setValue(ar);
    tmp.getRange(CFG.FILA_KEY, k.ote).setValue(ote);
    tmp.getRange(CFG.FILA_KEY, k.fecha).setValue(fecha);
    tmp.getRange(CFG.FILA_KEY, k.inspector).setValue(inspector);

    // muestras: columnas B..I (rango probado)
    tmp.getRange(CFG.FILA_MUESTRA_1, CFG.MUESTRA_COLS.muestra, filas.length, 8)
       .setValues(filas.map(function (r) { return r.slice(1, 9); }));

    // extras — no deben impedir el PDF ni el archivado
    try {
      tmp.getRange(CFG.FILA_MUESTRA_1, CFG.MUESTRA_COLS.correl, filas.length, 1)
         .setValues(filas.map(function (r) { return [ r[0] ]; }));   // A: "RAM"-nn
    } catch (eA) { avisos.push('col A: ' + _msg(eA)); }
    try {
      var rngJ = tmp.getRange(CFG.FILA_MUESTRA_1, CFG.MUESTRA_COLS.idem, filas.length, 1);
      rngJ.setNumberFormat('@');                                     // texto: conserva el 0 inicial
      rngJ.setValues(filas.map(function (r) { return [ r[9] ]; }));  // J: últimos 4 de B ("0103"…)
    } catch (eJ) { avisos.push('col J: ' + _msg(eJ)); }
    try {
      tmp.getRange(CFG.FILA_KEY, k.nMuestras).setValue(filas.length); // E8
    } catch (eE) { avisos.push('E8: ' + _msg(eE)); }
    try {
      // Tonelaje total (Ton), calculado en la PWA a partir del peso de las coladas.
      // Fila 8 va oculta en la plantilla -> no aparece en el PDF, pero sí queda en Archivo2 (col G, A..J).
      if (typeof body.tonelaje === 'number' && isFinite(body.tonelaje)) {
        tmp.getRange(CFG.FILA_KEY, k.tonelaje).setValue(body.tonelaje);   // G8
      }
    } catch (eG) { avisos.push('G8 tonelaje: ' + _msg(eG)); }
    try {
      // Precio del servicio (UF), calculado en la PWA (calcularPrecioUF). Fila 8 va oculta
      // en la plantilla -> no aparece en el PDF, pero sí queda en Archivo2 (col H, A..J).
      if (typeof body.precio === 'number' && isFinite(body.precio)) {
        tmp.getRange(CFG.FILA_KEY, k.precio).setValue(body.precio);   // H8
      }
    } catch (eH) { avisos.push('H8 precio: ' + _msg(eH)); }

    // encabezado: datos de la ubicación elegida (sobrescribe el VLOOKUP en la copia)
    if (body.sedeId) {
      var sh = _lista();
      var fila = _oteRowById(sh, body.sedeId);
      if (fila > 1) {
        var v = sh.getRange(fila, 1, 1, CFG.LISTA_ANCHO).getValues()[0];
        var reg = _rowToReg(v, fila);
        var C = CFG.REPORTE_CELLS;
        tmp.getRange(C.solicitante).setValue(reg.nombre);   // ListaOCP col C
        tmp.getRange(C.cliente).setValue(reg.cliente);      // ListaOCP col B
        tmp.getRange(C.lugar).setValue((reg.calle + ' ' + reg.comuna).trim()); // col D + E
      }
    }

    SpreadsheetApp.flush();

    var enc = {
      totalTon    : tmp.getRange('G6').getDisplayValue(),
      solicitante : tmp.getRange(CFG.REPORTE_CELLS.solicitante).getDisplayValue(),
      cliente     : tmp.getRange(CFG.REPORTE_CELLS.cliente).getDisplayValue(),
      lugar       : tmp.getRange(CFG.REPORTE_CELLS.lugar).getDisplayValue(),
      nColadas    : coladas.length,
      nMuestras   : filas.length
    };

    // Archivo2 con VALORES REALES (antes de poner los "ídem")
    archivar(ss, tmp, filas.length);

    // "ídem": filas 2ª+ de cada colada -> comillas en Tipo..Lote (C..I)
    if (dittoRel.length) {
      for (var d = 0; d < dittoRel.length; d++) {
        var fr = CFG.FILA_MUESTRA_1 + dittoRel[d];
        tmp.getRange(fr, mc.tipo, 1, mc.loteId - mc.tipo + 1).setValue(CFG.DITTO);
      }
      SpreadsheetApp.flush();
    }

    var pdf = exportarPdf(ss, tmp.getSheetId(), 'Reporte ' + ar);

    return { ok:true, pdfUrl:pdf.url, pdfShared:pdf.shared, encabezado:enc, avisos:avisos };
  } catch (err) {
    return { ok:false, error:_msg(err) };
  } finally {
    if (tmp) { try { ss.deleteSheet(tmp); } catch (e2) {} }
    lock.releaseLock();
  }
}

/** Devuelve { url (enlace Drive), shared (bool) }. El enlace de Drive abre el PDF
 *  en el visor de Google en línea (sin descarga) en Android e iOS. */
function exportarPdf(ss, gid, nombre) {
  var base = ss.getUrl().replace(/\/edit.*$/, '');
  var url = base + '/export?exportFormat=pdf&format=pdf'
    + '&size=LETTER&portrait=false&fitw=true'
    + '&top_margin=0.5&bottom_margin=0.75&left_margin=1.0&right_margin=1.0'
    + '&sheetnames=false&printtitle=false&pagenum=UNDEFINED'
    + '&gridlines=true&fzr=FALSE&gid=' + gid;

  var resp = UrlFetchApp.fetch(url, {
    muteHttpExceptions : true,
    headers : { Authorization : 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  if (resp.getResponseCode() !== 200) throw new Error('No se pudo exportar el PDF (HTTP ' + resp.getResponseCode() + ')');

  var blob = resp.getBlob().setName(nombre + '.pdf');

  var out = { url:'', shared:false };
  try {
    var file = DriveApp.getFolderById(CFG.CARPETA_PDF_ID).createFile(blob);
    out.url = file.getUrl();
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); out.shared = true; }
    catch (e) {}
  } catch (e2) {}
  return out;
}

function archivar(ss, tmp, nMuestras) {
  var arch = ss.getSheetByName(CFG.ARCHIVO);
  if (!arch) throw new Error('Falta la hoja "' + CFG.ARCHIVO + '"');
  var nFilas = 1 + nMuestras;
  var datos = tmp.getRange(CFG.FILA_COPIA_DESDE, 1, nFilas, CFG.COL_COPIA_HASTA).getValues();
  if (datos.length < 1) return;                 // guarda: nunca getRange con 0 filas

  // asegurar 'ídem' como texto tal cual en Archivo2 (que no lo lea como número)
  var jRel = CFG.MUESTRA_COLS.idem;             // 10
  for (var i = 1; i < datos.length; i++) {      // fila 0 = KEY, no lleva ídem
    if (datos[i][jRel - 1] !== '' && datos[i][jRel - 1] != null) {
      datos[i][jRel - 1] = String(datos[i][jRel - 1]);
    }
  }
  var destino = arch.getRange(arch.getLastRow() + 1, 1, datos.length, CFG.COL_COPIA_HASTA);
  try { arch.getRange(destino.getRow(), jRel, datos.length, 1).setNumberFormat('@'); } catch (e) {}
  destino.setValues(datos);
}

// ===================== administración =====================

function setPinsDemo() {
  PropertiesService.getScriptProperties().setProperty(
    'PINS', JSON.stringify({ PCP:'0000', SRS:'0000', DPG:'0000', AVR:'0000' })
  );
}

/** Migra ListaOCP: pone un id (uuid) en la col G a toda fila que no lo tenga. Ejecutar una vez. */
function backfillIdsListaOCP() {
  var sh = _lista();
  var last = sh.getLastRow();
  if (last < 2) return;
  var rng = sh.getRange(2, CFG.LISTA_COLS.id, last - 1, 1);
  var col = rng.getValues();
  var n = 0;
  for (var i = 0; i < col.length; i++) {
    if (!col[i][0]) { col[i][0] = Utilities.getUuid(); n++; }
  }
  rng.setValues(col);
  Logger.log('ids agregados: ' + n);
}

/** Prueba sin la PWA. Toma el PIN real de la propiedad PINS (inspector PCP). */
function _test() {
  var pins = JSON.parse(PropertiesService.getScriptProperties().getProperty('PINS') || '{}');
  var r = crearInspeccion({
    inspector:'PCP', pin:pins.PCP, ar:'9999', ote:'216', ram:'99999', fecha:'05/09/2026', sedeId:'',
    coladas:[
      { pos:'01', tipo:'Plancha', dimension:'50x2440x12000', grado:'A36',
        colada:'TEST-A', peso:'34477', cantidad:'3', identificada:true },   // -> 1 muestra
      { pos:'02', tipo:'Plancha', dimension:'50x2440x12000', grado:'A36',
        colada:'TEST-B', peso:'103431', cantidad:'9', identificada:true }   // -> 3 muestras (ídem en 2ª y 3ª)
    ]
  });
  Logger.log(JSON.stringify(r, null, 2));
}
