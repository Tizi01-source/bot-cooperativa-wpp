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
            const estadosMora = ['REFINANCIACION', 'REFINANCIACION V', 'SOTANO', 'MOROSO', 'ANALISIS MOV'];
            
            const limpiarMonto = (valor) => {
                if (!valor) return 0;
                let limpio = valor.toString().replace('$', '').replace(/\s/g, '').replace(/,/g, '');
                return parseFloat(limpio) || 0;
            };

            // Función interna para mapear datos de una fila
            const mapear = (fila) => {
                if (!fila) return null;
                const est = (fila.get('ESTADO') || "").toString().trim().toUpperCase();
                return {
                    metodo: (fila.get('METODO') || "").toString().trim().toUpperCase(),
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

            // 1. Clasificamos las filas por tipo de método
            const filasHaberes = coinciden.filter(f => ['HABERES', 'AMPEAL'].includes((f.get('METODO') || "").toString().trim().toUpperCase()));
            const filasCBU = coinciden.filter(f => ['CBU', 'CBU C'].includes((f.get('METODO') || "").toString().trim().toUpperCase()));

            // 2. Buscamos la mejor fila de cada tipo (Prioridad: Mora > Activo > Cancelado)
            const buscarMejor = (lista) => {
                if (lista.length === 0) return null;
                return lista.find(f => {
                    const est = (f.get('ESTADO') || "").toString().trim().toUpperCase();
                    return estadosMora.includes(est);
                }) || 
                lista.find(f => (f.get('ESTADO') || "").toString().trim().toUpperCase() === 'ACTIVO') || 
                lista[lista.length - 1];
            };

            const infoHaberes = mapear(buscarMejor(filasHaberes));
            const infoCBU = mapear(buscarMejor(filasCBU));

            // 3. DETERMINAMOS EL ESTADO GLOBAL (Prioridad absoluta a REFI si hay mora en alguno)
            let estadoGlobal = 'CANCELADO';
            if ((infoHaberes && infoHaberes.esMora) || (infoCBU && infoCBU.esMora)) {
                estadoGlobal = 'REFI';
            } else if ((infoHaberes && infoHaberes.esActivo) || (infoCBU && infoCBU.esActivo)) {
                estadoGlobal = 'ACTIVO';
            }

            // 4. Calculamos deuda total real
            const deudaTotal = (infoHaberes?.esMora ? infoHaberes.deuda : 0) + (infoCBU?.esMora ? infoCBU.deuda : 0);

            return {
                nombre: `${coinciden[0].get('NOMBRE')} ${coinciden[0].get('APELLIDO')}`.trim(),
                dni: dniBuscado,
                estado: estadoGlobal,
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


