const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const credenciales = require('./google-keys.json');

async function obtenerDatosSocio(dniBuscado) {
    try {
        const serviceAccountAuth = new JWT({
            email: credenciales.client_email,
            key: credenciales.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet('1bJi4trILW9hz8vjuswIM7DQ8a2KKABBJd0NB_jLShkM', serviceAccountAuth);
        await doc.loadInfo();

        // Seleccionamos la hoja y cargamos las filas.
        const hoja = doc.sheetsByIndex[0];
        await hoja.loadHeaderRow(2); 
        const filas = await hoja.getRows();

        // Buscamos todas las filas que coincidan con el DNI dentro del CUIL.
        const coinciden = filas.filter(f => {
            const cuilExcel = f.get('CUIL') ? f.get('CUIL').toString().replace(/\D/g, '') : "";
            const dniLimpio = dniBuscado.toString().replace(/\D/g, '');
            return cuilExcel.includes(dniLimpio);
        });

        // --- LÓGICA DE PRIORIDAD DE CRÉDITOS ---
        if (coinciden.length > 0) {

            // Clasificamos cualquier estado de refinaciación.
            const estadosMora = ['REFINANCIACION', 'REFINANCIACION V', 'SOTANO', 'MOROSO', 'ANALISIS MOV'];

            const limpiarMonto = (valor) => {
                if (!valor) return 0;
                let limpio = valor.toString().replace('$', '').replace(/\s/g, '').replace(/,/g, '');
                return parseFloat(limpio) || 0;
            };

            // 2. SEPARACIÓN DE REGISTROS POR MÉTODO
            const filasHaberes = coinciden.filter(f => ['HABERES', 'AMPEAL'].includes((f.get('METODO') || "").toUpperCase()));
            const filasCBU = coinciden.filter(f => ['CBU', 'CBU C'].includes((f.get('METODO') || "").toUpperCase()));

            // 3. PRIORIZACIÓN (Mora > Activo > Otros)
            const buscarMejorFila = (filas) => {
                if (filas.length === 0) return null;
                return filas.find(f => estadosMora.includes(f.get('ESTADO'))) || 
                       filas.find(f => f.get('ESTADO') === 'ACTIVO') || 
                       filas[filas.length - 1];
            };

            const haberesData = buscarMejorFila(filasHaberes);
            const cbuData = buscarMejorFila(filasCBU);

            // 4. MAPEO DE OBJETOS DE CRÉDITO
            const mapearCredito = (fila) => {
                if (!fila) return null;
                // .trim() elimina espacios y .toUpperCase() asegura la coincidencia
                let est = (fila.get('ESTADO') || "").toString().trim().toUpperCase(); 
                return {
                    metodo: fila.get('METODO'),
                    estadoOriginal: est,
                    esMora: estadosMora.includes(est),
                    esActivo: est === 'ACTIVO',
                    fecha: fila.get('FECHA'),
                    montoSacado: limpiarMonto(fila.get('MONTO')),
                    cuotasTotales: fila.get('PLAZO'),
                    cuotasPagas: fila.get('CTAS. PAGAS'),
                    montoCuota: limpiarMonto(fila.get('MONTO_CTA')),
                    deuda: limpiarMonto(fila.get('DEUDA'))
                };
            };

            const infoHaberes = mapearCredito(haberesData);
            const infoCBU = mapearCredito(cbuData);

            // 5. DETERMINACIÓN DEL ESTADO GLOBAL PARA EL INDEX.JS
            let estadoGlobal = 'CANCELADO'; // Por defecto
            
            // Si cualquiera de los dos está en mora, mandamos a REFI (Prioridad absoluta)
            if ((infoHaberes && infoHaberes.esMora) || (infoCBU && infoCBU.esMora)) {
                estadoGlobal = 'REFI';
            } 
            // Si no hay mora pero hay alguno activo, mandamos a ACTIVO
            else if ((infoHaberes && infoHaberes.esActivo) || (infoCBU && infoCBU.esActivo)) {
                estadoGlobal = 'ACTIVO';
            }

            // 6. CÁLCULO DE DEUDA TOTAL (Solo suma las que están en mora)
            const deudaTotal = (infoHaberes?.esMora ? infoHaberes.deuda : 0) + 
                              (infoCBU?.esMora ? infoCBU.deuda : 0);

            // 7. RETORNO DE OBJETO FINAL
            return {
                nombre: `${coinciden[0].get('NOMBRE')} ${coinciden[0].get('APELLIDO')}`.trim(),
                dni: dniBuscado,
                estado: estadoGlobal, // 'REFI', 'ACTIVO' o 'CANCELADO'
                deudaTotal: deudaTotal,
                haberes: infoHaberes,
                cbu: infoCBU,
                tieneAmbos: infoHaberes !== null && infoCBU !== null
            };
        }
        return null; // No se encontró el socio
    } catch (error) {
        console.error("Error en DB:", error);
        return null;
    }
}

module.exports = obtenerDatosSocio;


