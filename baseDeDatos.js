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

        // Hoja CASHFLOW para ACTIVOS e historial de creditos.
        const hojaCashflow = doc.sheetsByIndex[0]; // Seleccionamos la primera hoja del documento.
        await hojaCashflow.loadHeaderRow(2); // Seleccionamos la fila 2.
        const filasCashflow = await hojaCashflow.getRows(); // Obtenemos todas las filas de la hoja.

        // Hoja REFINANCIACION para deudas actualizadas.
        const hojaRefi = doc.sheetsByTitle['REFINANCIACION'] || doc.sheetsByIndex[1];
        await hojaRefi.loadHeaderRow(3);
        const filasRefi = await hojaRefi.getRows();

        const dniLimpio = dniBuscado.toString().replace(/\D/g, ''); // Pasamos a limpio el dniBuscado.

        // Buscamos filas que contengan el DNI dentro del CUIL en ambas hojas.
        const coincidenCashflow = filasCashflow.filter(f => (f.get('CUIL') || "").toString().replace(/\D/g, '').includes(dniLimpio));
        const coincidenRefi = filasRefi.filter(f => (f.get('CUIL') || "").toString().replace(/\D/g, '').includes(dniLimpio));

        // Si no existe en ninguna hoja, retorna null.
        if (coincidenCashflow.length === 0 && coincidenRefi.length === 0) {
            return null;
        }

            const estadosMora = ['REFINANCIACION', 'REFINANCIACION V', 'SOTANO', 'MOROSO', 'ANALISIS MOV', 'INCOBRABLE', "CONHER", "DIAGRAMAS", "SOTEIN"]; // Guardamos los estados que consideramos como "Mora"
            
            // Funcion para limpiar y convertir montos a números.
            const limpiarMonto = (valor) => {
                if (!valor) return 0;
                let limpio = valor.toString().replace('$', '').replace(/\s/g, '').replace(/,/g, '');
                return parseFloat(limpio) || 0;
            };

            // Identificamos el tipo de crédito
            const esHaberes = (m) => m.includes('HABERES') || m.includes('AMPEAL');
            const esCBU = (m) => m.includes('CBU') || m.includes('CBU C') || m.includes('SOTANO') || m.includes('SOTEIN') || m.includes('INCOBRABLE');

            // Mapeo de datos de CASHFLOW, con identificación de estado y método.
            const mapearCashflow = (fila) => {
                const est = (fila.get('ESTADO') || "").toString().trim().toUpperCase();
                const met = (fila.get('METODO') || "").toString().trim().toUpperCase();
                return {
                    metodo: met,
                    estadoOriginal: est,
                    esMora: estadosMora.includes(est),
                    esActivo: est === 'ACTIVO',
                    fecha: fila.get('FECHA') || "N/A",
                    montoSacado: limpiarMonto(fila.get('MONTO')),
                    cuotasTotales: fila.get('PLAZO') || "0",
                    cuotasPagas: fila.get('CTAS. PAGAS') || "0",
                    montoCuota: limpiarMonto(fila.get('MONTO_CTA')),
                    deuda: limpiarMonto(fila.get('DEUDA'))
                };
            };

            // Mapeo de datos de REFINANCIACION, con identificación de estado y método, pero asumiendo que si está en esta hoja, está en mora (salvo que diga fallecido o anses).
            const mapearRefi = (fila) => {
                const est = (fila.get('ESTADO') || "").toString().trim().toUpperCase();
                const met = (fila.get('METODO') || "").toString().trim().toUpperCase();
            
                // Filtro indicado: Si está fallecido o es Anses, lo ignoramos.
                if (est.includes('FALLECIDO') || est.includes('ANSES')) return null;

                    return {
                        metodo: met,
                        estadoOriginal: est,
                        esMora: true,
                        esActivo: false,
                        fecha: fila.get('FECHA') || "N/A",
                        montoSacado: limpiarMonto(fila.get('MONTO')), 
                        cuotasTotales: fila.get('PLAZO') || "0", 
                        cuotasPagas: fila.get('CTAS PAGAS') || "0",
                        montoCuota: limpiarMonto(fila.get('MONTO_CTA')),
                        deuda: limpiarMonto(fila.get('DEUDA ACTUAL'))
                    };
            };
            // Filtro del Cashflow
            const buscarMejorCashflow = (lista) => {
                if (!lista || lista.length === 0) return null;
                const activo = lista.find(f => (f.get('ESTADO') || "").toString().trim().toUpperCase() === 'ACTIVO');
                if (activo) return mapearCashflow(activo);
                return mapearCashflow(lista[lista.length - 1]); 
            };

            // Procesamos los datos encontrados.
            const registrosRefi = coincidenRefi.map(mapearRefi).filter(r => r !== null);

            const refiHaberes = registrosRefi.filter(r => esHaberes(r.metodo));
            const refiCBU = registrosRefi.filter(r => esCBU(r.metodo));

            const cashHaberes = coincidenCashflow.filter(f => esHaberes((f.get('METODO') || "").toString().trim().toUpperCase()));
            const cashCBU = coincidenCashflow.filter(f => esCBU((f.get('METODO') || "").toString().trim().toUpperCase()));

            // Si tiene una Refi, usamos los datos reales de la Refi. 
            // Si no tiene Refi, buscamos si tiene algún crédito activo en Cashflow.
            let infoHaberes = refiHaberes.length > 0 ? refiHaberes[0] : buscarMejorCashflow(cashHaberes);
            let infoCBU = refiCBU.length > 0 ? refiCBU[0] : buscarMejorCashflow(cashCBU);

            // Determinamos el estado global del socio.
            let estadoGlobal = 'CANCELADO';
            if ((infoHaberes && infoHaberes.esMora) || (infoCBU && infoCBU.esMora)) {
                estadoGlobal = 'REFI';
            } else if ((infoHaberes && infoHaberes.esActivo) || (infoCBU && infoCBU.esActivo)) {
                estadoGlobal = 'ACTIVO';
            }

            // Suma la deuda si tiene deuda en ambos créditos, o toma la deuda del que tenga si solo tiene uno.
            const deudaTotal = (infoHaberes?.esMora ? infoHaberes.deuda : 0) + (infoCBU?.esMora ? infoCBU.deuda : 0);
            
            // Formateamos el nombre buscando primero en Cashflow y sino en Refi.
            let nombreSocio = "Socio";
            if (coincidenCashflow.length > 0) {
                nombreSocio = `${coincidenCashflow[0].get('NOMBRE') || ""} ${coincidenCashflow[0].get('APELLIDO') || ""}`.trim();
            } else if (coincidenRefi.length > 0) {
                nombreSocio = (coincidenRefi[0].get('APELLIDO Y NOMBRE') || "").trim();
            }

            return {
                nombre: nombreSocio,
                dni: dniBuscado,
                estado: estadoGlobal,
                deudaTotal: deudaTotal,
                haberes: infoHaberes,
                cbu: infoCBU,
                tieneAmbos: infoHaberes !== null && infoCBU !== null
            };
    } catch (error) {
        console.error("Error en DB:", error);
        return null;
    }
}

module.exports = obtenerDatosSocio;