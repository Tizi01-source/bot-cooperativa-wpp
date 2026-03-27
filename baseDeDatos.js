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

        const hoja = doc.sheetsByIndex[0]; // Seleccionamos la primera hoja del documento.
        await hoja.loadHeaderRow(2); // Seleccionamos la fila 2.
        const filas = await hoja.getRows(); // Obtenemos todas las filas de la hoja.

        const dniLimpio = dniBuscado.toString().replace(/\D/g, ''); // Pasamos a limpio el dniBuscado.

        // Buscamos filas que contengan el DNI dentro del CUIL.
        const coinciden = filas.filter(f => {
            const cuilExcel = (f.get('CUIL') || "").toString().replace(/\D/g, '');
            return cuilExcel.includes(dniLimpio);
        });

        if (coinciden.length > 0) {
            // Estados válidos de Mora
            const estadosMora = ['REFINANCIACION', 'REFINANCIACION V', 'SOTANO', 'MOROSO', 'ANALISIS MOV', 'INCOBRABLE']; // Guardamos los estados que consideramos como "Mora"
            
            // Funcion para limpiar y convertir montos a números.
            const limpiarMonto = (valor) => {
                if (!valor) return 0;
                let limpio = valor.toString().replace('$', '').replace(/\s/g, '').replace(/,/g, '');
                return parseFloat(limpio) || 0;
            };

            // Mapeamos una fila a un formato más amigable, identificando si está en mora o activo y el metodo.
            const mapear = (fila) => {
                if (!fila) return null;
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

            // Identificamos el tipo de crédito
            const esHaberes = (m) => m.includes('HABERES') || m.includes('AMPEAL');
            const esCBU = (m) => m.includes('CBU') || m.includes('ONLINE');

            const filasHaberes = coinciden.filter(f => esHaberes((f.get('METODO') || "").toString().trim().toUpperCase()));
            const filasCBU = coinciden.filter(f => esCBU((f.get('METODO') || "").toString().trim().toUpperCase()));

            // Filtro de prioridad: Mora > Activo > Otro
            const buscarMejor = (lista) => {
                if (!lista || lista.length === 0) return null;
                const mora = lista.find(f => estadosMora.includes((f.get('ESTADO') || "").toString().trim().toUpperCase()));
                if (mora) return mora;
                
                const activo = lista.find(f => (f.get('ESTADO') || "").toString().trim().toUpperCase() === 'ACTIVO');
                if (activo) return activo;
                
                return lista[lista.length - 1]; 
            };

            // Información final para haberes y cbu, aplicando el filtro de prioridad.
            const infoHaberes = mapear(buscarMejor(filasHaberes));
            const infoCBU = mapear(buscarMejor(filasCBU));

            // Si hay un crédito en mora, obliga el estado "REFI"
            let estadoGlobal = 'CANCELADO';
            if ((infoHaberes && infoHaberes.esMora) || (infoCBU && infoCBU.esMora)) {
                estadoGlobal = 'REFI';
            } else if ((infoHaberes && infoHaberes.esActivo) || (infoCBU && infoCBU.esActivo)) {
                estadoGlobal = 'ACTIVO';
            }

            // Suma la deuda si tiene deuda en ambos créditos, o toma la deuda del que tenga si solo tiene uno.
            const deudaTotal = (infoHaberes?.esMora ? infoHaberes.deuda : 0) + (infoCBU?.esMora ? infoCBU.deuda : 0);
            
            // Une las columnas de Nombre y Apellido.
            const nombreSocio = `${coinciden[0].get('NOMBRE') || ""} ${coinciden[0].get('APELLIDO') || ""}`.trim();

            return {
                nombre: nombreSocio || "Socio",
                dni: dniBuscado,
                estado: estadoGlobal,
                deudaTotal: deudaTotal,
                haberes: infoHaberes,
                cbu: infoCBU,
                tieneAmbos: infoHaberes !== null && infoCBU !== null
            };
        }
        return null;
    } catch (error) {
        console.error("Error en DB:", error);
        return null;
    }
}

module.exports = obtenerDatosSocio;