# TerrApp V2

> **Fork de desarrollo.** Nace el 2026-09-13 a partir de TerrApp B2 (V1),
> que sigue en producción tal cual, sin tocar, en
> `C:\Users\pacar\proyectos\terrapp`. Esta carpeta es un repo Git
> independiente (mismo historial hasta el fork) todavía **no publicado**:
> no tiene remoto de GitHub propio ni deploy propio. Mientras V2 no esté
> lista y probada, la app en uso sigue siendo V1
> (https://pacarr-pcp.github.io/terrapp/) — nada de lo que se haga aquí la
> afecta.

Migración de la app de inspección en terreno (App Inventor + componente
Spreadsheet) a **PWA + backend Apps Script**, manteniendo la misma Google
Sheet, el mismo formato de reporte y `Archivo2`.

**Ubicación del proyecto:** `C:\Users\pacar\proyectos\terrapp-v2` (repo Git local, sin remoto aún).
**V1 (producción):** https://pacarr-pcp.github.io/terrapp/ · repo GitHub Pages:
`pacarr-pcp/terrapp`.

```
terrapp-v2/
├── apps-script/      backend (Web App)
│   ├── Codigo.gs
│   └── appsscript.json
├── pwa/              cliente (se sube a GitHub Pages)
│   ├── index.html  styles.css  app.js
│   ├── manifest.webmanifest  sw.js  icon.svg
└── README.md
```

---

## 0. Antes que nada — rotar credenciales expuestas

Los `.aia` de **TerrApp** y de **OTE** traían empaquetadas claves privadas de
cuentas de servicio (`ocp1-482316-108b734f4ce3.json` en ambas y
`bdsheet-ocp-68e54174d25a.json` en OTE). Cualquiera con un APK podía
extraerlas.

**✅ Resuelto (2026-09-12):** ambas claves fueron eliminadas en Google Cloud
Console (IAM y administración → Cuentas de servicio → pestaña Claves →
borrar). `bdsheet-ocp-68e54174d25a` se borró en el proyecto `bdsheet-ocp`;
`ocp1-482316-108b734f4ce3` vivía en otra cuenta de Google y se borró desde
ahí. Ya no son válidas.

El backend nuevo no usa cuentas de servicio: corre como
`simet.pcp@usach.cl` con el token del propio script.

**✅ Además (2026-09-12):** en el proyecto `Simet00` (cuenta de servicio
`pcpsimetapp@simet00.iam.gserviceaccount.com`, la que usa la app de origen
para escribir los datos crudos en la Sheet) el Recomendador de IAM detectó
que el rol **Editor** llevaba 90 días sin usar ninguno de sus ~12.000
permisos — el acceso real a la Sheet es por "Compartir" del archivo, no por
IAM del proyecto. Se aplicó la recomendación (se quitó el rol Editor) y se
confirmó que la app de origen sigue escribiendo datos sin problema. Así, si
esa clave se filtrara, ya no daría acceso de administrador a todo el
proyecto GCP.

---

## 1. Preparar la planilla

### 1a. Hoja Plantilla
1. Clic derecho sobre la pestaña **`ReportPCP`** → **Duplicar**.
2. Renombra la copia a **`Plantilla`** → clic derecho → **Ocultar hoja**.

`Plantilla` conserva formato y fórmulas. El backend la copia por cada envío,
escribe los datos, exporta el PDF y borra la copia. Las celdas
`C3` (Solicitante), `C4` (Cliente) y `F4` (Lugar) las **sobrescribe el
backend** con la ubicación elegida — su VLOOKUP deja de usarse en la copia.

### 1b. ListaOCP: una fila por ubicación
Hoy `ListaOCP` tiene una sola fila por OTE, y por eso hay que editarla cada
vez que el cliente cambia de sede. El modelo nuevo admite **varias filas por
OTE** (una por ubicación/nombre).

1. En `ListaOCP`, deja las columnas **A–E como están**
   (`OTE · Cliente · Nombre · Calle · Comuna`).
2. Agrega dos columnas:
   - **F = `Sede`** — etiqueta libre para distinguir ubicaciones
     ("Planta Maipú", "Bodega San Bernardo"…).
   - **G = `id`** — se llena solo; puedes **ocultarla**.
3. En Apps Script ejecuta una vez **`backfillIdsListaOCP`** para poner un id a
   las filas que ya existen.

A partir de ahí, la sección **Clientes** de la PWA crea / edita / borra
ubicaciones, y en la inspección el inspector elige con qué nombre y dirección
sigue.

---

## 2. Backend (Apps Script)

1. En la planilla: **Extensiones → Apps Script**.
2. Pega `apps-script/Codigo.gs`. (Opcional: en `appsscript.json`, "Mostrar
   manifiesto" y pega el de este repo.)
3. **Verifica el bloque `CFG`** contra tu planilla. Lo más importante:
   - `FILA_KEY` (8) y `KEY_COLS` — dónde van RAM / AR / OTE / Fecha / Inspector
     en la fila de encabezado.
   - `FILA_MUESTRA_1` (9) y `MUESTRA_COLS` — columnas de cada muestra.
   - `REPORTE_CELLS` — celdas destino en el encabezado (celdas combinadas,
     se escribe en la ancla): Solicitante/Nombre = **`B3`** (B3:C3),
     Cliente = **`B4`** (B4:C4), Lugar/Dirección = **`E4`** (E4:H4).
     Origen en `ListaOCP`: Solicitante ← col C, Cliente ← col B,
     Lugar ← col D + " " + col E.
   - `LISTA_COLS` — asume `Sede` en F e `id` en G (ver paso 1b).
4. **Propiedades del script** (⚙ Configuración del proyecto → Propiedades del
   script) → agrega:
   - clave `PINS`, valor `{"PCP":"1111","SRS":"2222","DPG":"3333","AVR":"4444"}`
     (usa PINs reales).
5. Ejecuta una vez `_test` (ajusta el PIN dentro de la función) y autoriza los
   permisos. Revisa que:
   - se cree el PDF en la carpeta de Drive,
   - se agreguen filas a `Archivo2`,
   - la hoja `tmp_...` se borre sola.
6. **Implementar → Nueva implementación → Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier persona**
   - Copia la **URL `/exec`**.
7. Cada cambio de código: **Implementar → Administrar implementaciones →
   ✏️ → Versión: Nueva**. (La URL no cambia.)

---

## 3. PWA

1. En `pwa/app.js`, línea `BACKEND_URL`, pega la URL `/exec` del paso 2.6.
2. Prueba local:
   ```bash
   cd pwa
   python -m http.server 8080
   ```
   Abre `http://localhost:8080` y valida el flujo completo.
3. Ajusta si hace falta las listas `TIPOS` / `GRADOS` en `app.js`.

### Publicar en GitHub Pages (gratis)

Repo: **https://github.com/pacarr-pcp/terrapp** — la app quedará en
**https://pacarr-pcp.github.io/terrapp/**

**Opción web (sin instalar nada):**
1. Abre el repo → **Add file → Upload files**.
2. Arrastra **todos los archivos que están dentro de `pwa/`**
   (`index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`,
   `icon.svg`, `.nojekyll`) — que `index.html` quede en la raíz del repo.
3. Escribe un mensaje ("PWA TerrApp B2") → **Commit changes**.
4. **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)` →
   Save.** En 1–2 min la URL responde.

**Opción git (desde tu PC):**
```bash
git clone https://github.com/pacarr-pcp/terrapp.git
# copia dentro los archivos de pwa/  (index.html en la raíz)
cd terrapp
git add .
git commit -m "PWA TerrApp B2"
git push
```

Luego, en el teléfono: abre la URL → menú del navegador → **Agregar a
pantalla de inicio**.

> Las rutas del `manifest` y del `sw` son relativas, así que funciona igual
> aunque el repo se llame distinto.

---

## 4. Puesta en producción

1. Corre en paralelo con la app vieja unos días, con un inspector.
2. Compara PDFs y filas de `Archivo2` con los de la app actual.
3. Cuando cuadre: avisa al resto, retira la app de App Inventor.
4. En Apps Script de la planilla: elimina/《desactiva》 los disparadores de
   `terr2PDF` y `copiar2` (Activadores → borrar). Puedes dejar las funciones
   como respaldo, pero sin trigger.
5. ~~Rota las credenciales (paso 0).~~ Hecho.

---

## Qué cambia respecto de la app actual

| Antes | Ahora (B2) |
|---|---|
| Componente Spreadsheet con clave de servicio dentro del APK | PWA sin credenciales; la clave vive sólo en el servidor |
| `ReportPCP` es un borrador global compartido | Cada inspector tiene su borrador en su teléfono |
| Escritura celda a celda + `Pausa` (bucle que congela la UI) | Un `setValues` por inspección, con `LockService` |
| Trigger por palabra en `I4` → pila de ejecuciones | Un `doPost` por inspección |
| `getRange(..., muestras, ...)` con `muestras` vacío → error | Validación + guarda `if (filas < 1) return` |
| Errores silenciosos (sólo 4401) | Respuesta JSON `{ok:false, error}` legible en pantalla |
| Semáforo/`B8` + Reset para que dos usuarios no se pisen | Ya no hace falta: cada inspección va en su copia |
| App OTE: 1 fila por OTE → editar a mano al cambiar de sede | `ListaOCP` multi‑fila + selector de ubicación en la inspección |
| Clave de servicio en el APK de OTE (más una 2.ª clave) | La edición de clientes pasa por el backend; nada viaja en APK |

## Auto-muestreo por colada

El inspector ingresa **una colada** (tipo, dimensiones, grado, N° de hornada,
unidades, peso en kg, identificada sí/no). El sistema:

- calcula las muestras: identificada `techo(kg/40000)` tope **5**;
  no identificada `techo(kg/20000)` tope **10**;
- genera N filas con notación **`AAAA-PP-nnTT`**
  (AR · pos. colada · n° muestra · total muestras),
  p. ej. `0812-03-0103`, `0812-03-0203`, `0812-03-0303`;
- pone peso y unidades sólo en la 1ª fila; en el PDF las filas 2ª+ quedan
  como `"` (ídem). En `Archivo2` van los valores reales (sin `"`), porque el
  reemplazo por comillas ocurre recién antes de exportar el PDF.

Constantes en `CFG.MUESTREO` del backend. La plantilla admite
`CFG.MAX_MUESTRAS` (33) filas — si una inspección genera más, hay que agregar
filas a `Plantilla`.

## Sección "Clientes" (reemplaza la app OTE)

Cualquier inspector con PIN válido puede, desde el menú → **Clientes (OTE)**:
crear, editar y borrar ubicaciones de `ListaOCP`. Cada ubicación es una fila
(`OTE · Empresa · Contacto · Calle · Comuna · Sede`). En la inspección, tras
"Buscar" el OTE, si hay más de una ubicación aparece un selector.

## Fase 2 — Kg+ y Precio / Estado de Pago (EP)

Cuñas ya dejadas en el código para que esto entre sin rediseñar:

**Peso automático (Kg+ portado).** Con `tipo + dimensiones + cantidad` el peso
de la colada se calcula solo. El campo *Peso colada (kg)* queda editable: se
autocompleta y el inspector confirma o corrige (si lo escribe a mano, deja de
recalcular; si lo borra, vuelve).

- **Tablas** → `pwa/data/pesos.json` (14 tablas de Kg+, valor = **kg/m**;
  `peso = valor · largo_m · cantidad`, con `largo_m` = último número de
  *dimensiones* / 1000). Servido por Pages, cacheado offline por el SW.
  Claves: rectangular/canal/costanera `AxBxeE`; cuadrado `LADOxE`; ángulo
  `ALAxE`; vigas UPN/IPE/IPN/HEA/HEB `ALTO`; WF `HxW`; cañería `DIAsSCH`
  (tabla `caneria`, unificada A-53/A-106 — API no está tabulado por falta de
  producto; sin XXS por decisión de PCP). Serie de espesor fijo (9,52mm,
  Sch "std") exclusiva de A53 → sólo diámetro sin schedule (`DIA`, tabla
  `caneria_std_a53`); en A106 esa misma entrada (sin schedule) da blanco.
- **Fórmula** (plancha, sin tabla): `e·A·L·7,85e-6` (mm).
- El resolver está en `app.js`: `pesoColada(tipo, dimension, cantidad)` +
  el mapa `TABLA_TIPO`. Tipos aún sin tabla (Redondo, Pletina, Bobina,
  Ángulo plegado, Perfil Especial) → peso manual.
- `pesos.json` tiene un bloque `revisar` con valores sospechosos heredados
  del original (p. ej. cuadrado `30x1`, `40x1`).

**Precio por espesor.** El precio depende del **espesor de cada muestra**,
tabulado por espesor y probablemente por grado. El espesor **no** está siempre
en `dimensiones`:
- Plancha → 1er número (`50x2440x12000` → 50).
- Viga (HEB/HEA/IPE…) → `dimensiones` es `alto x largo`; el espesor sale de una
  tabla por `tipo + alto` (HEB 200).
- Perfiles → otra posición según el tipo.

`_espesor(tipo, dimension)` en el backend hoy sólo resuelve plancha; las tablas
de viga/perfil son parte de la Fase 2.
- Datos → `pwa/data/precios.json` **o** una hoja `Precios` en la planilla:
  ```json
  {
    "version": "",
    "moneda": "CLP",
    "base": "kg",                      // kg | unidad | m2  — a definir con la tabla
    "porEspesor": {
      "A36":  { "6": 0, "8": 0, "10": 0, "12.5": 0 },
      "A572": { "6": 0, "8": 0 }
    }
  }
  ```
- Backend: `CFG.PRECIO` (`activo:false` hoy) + `precioMuestra(dimension, grado)`
  (stub que devuelve `null`). Al activarlo y definir `CFG.PRECIO.COL_PRECIO`,
  `crearInspeccion` llena la columna de precio por fila y un total.
- Salida: columna Precio en `Archivo2` + reporte valorizado / EP (export aparte).

**App OTE** ya está integrada (sección Clientes). Kg+ portado a
`data/pesos.json` + `pesoColada()`.

## Pendientes (act. 2026-09-12, PWA v17)

### Hecho
- ✅ **Rotación de credenciales** — las dos claves de cuenta de servicio
  filtradas en los `.aia` viejos (`ocp1-482316-108b734f4ce3` y
  `bdsheet-ocp-68e54174d25a`) fueron eliminadas en Google Cloud Console.
- ✅ **Solicitante por separado** — `sedesDeOte` manda el nombre; el encabezado
  lista `solicitante · sede · comuna · empresa` con filtro por texto.
- ✅ **Correlativo de coladas** — al pulsar PDF se exige 01…N → aviso
  "Revisar correlativo de coladas". Botón "Ordenar" + "Col. ##" en fucsia.
- ✅ **Kg+ portado** — `data/pesos.json` (14 tablas) + `pesoColada()` con
  búsqueda tolerante al orden y fórmulas de respaldo (plegados, redondo…).
- ✅ **PDF — col A / col J / E8** — por muestra el backend escribe col A =
  `"RAM"-nn`, col J = últimos 4 de B (para las fórmulas `B6:F6`), E8 = total de
  muestras. `Archivo2` recibe A..J. Los `"` (ídem) sólo en C..I.
- ✅ **PDF en blanco** — la copia temporal nacía oculta (Plantilla oculta) y el
  `/export` renderizaba vacío. Fix: `tmp.showSheet()` antes de exportar.
- ✅ **Feedback al generar** — velo con spinner "Generando el reporte…".
- ✅ Rondas de cambios visuales (títulos, colores, layout, modal de resumen,
  checkbox/marco identificada, etc.).

### Abierto
1. **Pesos "calculados" (sin tabla).** Revisar tipo por tipo: espesor por
   perfil (viga = tabla por `tipo+alto`; perfil = otra posición) y dimensiones
   incompletas tipo `0x0x…`.
2. **Fase 2 — Precio por espesor / EP.** Falta la tabla de precios (la prepara
   PCP) → `data/precios.json` o hoja `Precios`. Cuñas ya puestas:
   `CFG.PRECIO`, `precioMuestra()`, `_espesor(tipo, dimension)`.
3. **Repo por Git.** Hoy se sube por "Upload files". Para pasar a `git push`:
   mover `pwa/` a la raíz del repo, o renombrar `pwa` → `docs` y poner Pages
   en `/docs`.
