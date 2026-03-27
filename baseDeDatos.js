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

        const doc = new GoogleSpreadsheet('1g3l0zGMm3FOCN7RCY7ZP3PSEubeRD9OK', serviceAccountAuth);
        await doc.loadInfo();

        // Seleccionamos la hoja y cargamos las filas.
        const hoja = doc.sheetsByIndex[0];
        
        // Empieza a leer desde la fila 2 para saltar el encabezado.
        const filas = await hoja.getRows({ offset: 1 });

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

            // Primero buscamos si hay alguno en mora o refinanciación.
            let socioFila = coinciden.find(f => estadosMora.includes(f.get('ESTADO')));

            // Si no hay ninguno en mora, buscamos si hay alguno activo.
            if (!socioFila) {
                socioFila = coinciden.find(f => f.get('ESTADO') === 'ACTIVO');
            }

            // Si no hay ninguno en mora ni activo, tomamos el último que coincida (que debería ser el más reciente).
            if (!socioFila) {
                socioFila = coinciden[coinciden.length - 1]; 
            }

            // Clasificamos el estado para el bot según lo que el index.js ya sabe manejar.
            let estadoReal = socioFila.get('ESTADO');
            let estadoBot = 'NUEVO';
            
            if (estadoReal === 'ACTIVO') {
                estadoBot = 'ACTIVO';
            } else if (estadosMora.includes(estadoReal)) {
                estadoBot = 'REFI';
            } else if (estadoReal === 'CANCELADO' || estadoReal === 'REFINANCIACION CAN') {
                estadoBot = 'CANCELADO';
            };

            // Limpiamos los montos para que sean números y no strings con formato.
            const limpiarMonto = (valor) => {
                if (!valor) return 0;
                let limpio = valor.toString()
                    .replace('$', '')
                    .replace(/\s/g, '')
                    .replace(/,/g, '');
                return parseFloat(limpio) || 0;
            };

            return {
                nombre: `${socioFila.get('NOMBRE')} ${socioFila.get('APELLIDO')}`.trim(),
                dni: dniBuscado,
                estado: estadoBot,
                estadoOriginal: estadoReal, 
                fechaCredito: socioFila.get('FECHA'),
                montoSacado: limpiarMonto(socioFila.get('MONTO')), 
                cuotasTotales: socioFila.get('PLAZO'), 
                cuotasPagas: socioFila.get('CTAS. PAGAS'), 
                montoCuota: limpiarMonto(socioFila.get('MONTO_CTA')),
                deuda: limpiarMonto(socioFila.get('DEUDA'))
            };
        }
        return null;
    } catch (error) {
        console.error("Error en DB:", error);
        return null;
    }
}

module.exports = obtenerDatosSocio;