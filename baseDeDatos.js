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
        const hojaCashflow = doc.sheetsByIndex[0]; // Selecciona la primera hoja del documento.
        await hojaCashflow.loadHeaderRow(2); // Selecciona la fila 2.
        const filasCashflow = await hojaCashflow.getRows(); // Obtiene todas las filas de la hoja.

        // Hoja REFINANCIACION para deudas actualizadas.
        const hojaRefi = doc.sheetsByTitle['REFINANCIACION'] || doc.sheetsByIndex[1];
        await hojaRefi.loadHeaderRow(3);
        const filasRefi = await hojaRefi.getRows();

        const dniLimpio = dniBuscado.toString().replace(/\D/g, ''); // Pasa a limpio el dniBuscado.

        // Busca filas que contengan el DNI dentro del CUIL en ambas hojas.
        const coincidenCashflow = filasCashflow.filter(f => (f.get('CUIL') || "").toString().replace(/\D/g, '').includes(dniLimpio));
        const coincidenRefi = filasRefi.filter(f => (f.get('CUIL') || "").toString().replace(/\D/g, '').includes(dniLimpio));

        // Si no existe en ninguna hoja, retorna null.
        if (coincidenCashflow.length === 0 && coincidenRefi.length === 0) {
            return null;
        }

            const estadosMora = ['REFINANCIACION', 'REFINANCIACION V', 'SOTANO', 'MOROSO', 'ANALISIS MOV', 'INCOBRABLE', "CONHER", "DIAGRAMAS", "SOTEIN"]; // Guardamos los estados que se consideran como "Mora"
            
            // Funcion para limpiar y convertir montos a numeros.
            const limpiarMonto = (valor) => {
                if (!valor) return 0;
                let limpio = valor.toString().replace('$', '').replace(/\s/g, '').replace(/,/g, '');
                return parseFloat(limpio) || 0;
            };

            // Identifica el tipo de credito
            const esHaberes = (m) => m.includes('HABERES') || m.includes('AMPEAL');
            const esCBU = (m) => m.includes('CBU') || m.includes('CBU C') || m.includes('SOTANO') || m.includes('SOTEIN') || m.includes('INCOBRABLE');

            // Mapeo de datos de CASHFLOW, con identificacion de estado y metodo.
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

            // Mapeo de datos de REFINANCIACION, con identificacion de estado y metodo.
            const mapearRefi = (fila) => {
                const est = (fila.get('ESTADO') || "").toString().trim().toUpperCase();
                const met = (fila.get('METODO') || "").toString().trim().toUpperCase();
            
                // Si esta fallecido o es de Anses, lo ignora.
                if (est.includes('FALLECIDO') || est.includes('ANSES')) return null;

                    return {
                        metodo: met,
                        estadoOriginal: est,
                        esMora: est !== 'CANCELADO',
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

            // Procesa los datos encontrados.
            const registrosRefi = coincidenRefi.map(mapearRefi).filter(r => r !== null);

            const refiHaberes = registrosRefi.filter(r => esHaberes(r.metodo));
            const refiCBU = registrosRefi.filter(r => esCBU(r.metodo));

            const cashHaberes = coincidenCashflow.filter(f => esHaberes((f.get('METODO') || "").toString().trim().toUpperCase()));
            const cashCBU = coincidenCashflow.filter(f => esCBU((f.get('METODO') || "").toString().trim().toUpperCase()));

            const determinarMejorEstado = (listaRefi, listaCash) => {
                // Si debe plata en Refi, es prioridad.
                const refiEnDeuda = listaRefi.find(r => r.estadoOriginal !== 'CANCELADO');
                if (refiEnDeuda) return refiEnDeuda;

                // Si no tiene deuda en Refi, buscamos si saco un crédito ACTIVO nuevo en Cashflow
                const cashActivo = buscarMejorCashflow(listaCash);
                if (cashActivo && cashActivo.esActivo) return cashActivo;

                // Si no hay credito nuevo activo, pero tiene uno CANCELADO en Refi, devolvemos el cancelado
                const refiCancelado = listaRefi.find(r => r.estadoOriginal === 'CANCELADO');
                if (refiCancelado) return refiCancelado;

                // Sino, el ultimo registro viejo del Cashflow
                return cashActivo;
            };

            // Si tiene una refi, usamos los datos de la refi. 
            // Si no tiene refi, buscamos si tiene algun credito activo en Cashflow.
            let infoHaberes = determinarMejorEstado(refiHaberes, cashHaberes);
            let infoCBU = determinarMejorEstado(refiCBU, cashCBU);

            // Determina el estado global del socio.
            let estadoGlobal = 'CANCELADO';
            if ((infoHaberes && infoHaberes.esMora) || (infoCBU && infoCBU.esMora)) {
                estadoGlobal = 'REFI';
            } else if ((infoHaberes && infoHaberes.esActivo) || (infoCBU && infoCBU.esActivo)) {
                estadoGlobal = 'ACTIVO';
            }

            // Suma la deuda si tiene deuda en ambos creditos, o toma la deuda del que tenga si solo tiene uno.
            const deudaTotal = (infoHaberes?.esMora ? infoHaberes.deuda : 0) + (infoCBU?.esMora ? infoCBU.deuda : 0);
            
            // Formatea el nombre buscando primero en Cashflow y sino en Refi.
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
        console.error("Error:", error);
        return null;
    }
}

module.exports = obtenerDatosSocio;