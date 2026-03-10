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

        const doc = new GoogleSpreadsheet('1GzkaIqymkmuuRORXqwqiWl2kWS_2h1qoA3HCwd5DW6E', serviceAccountAuth);
        await doc.loadInfo();
        
        const hoja = doc.sheetsByIndex[0];
        const filas = await hoja.getRows();

        // Buscamos al socio por DNI
        const socio = filas.find(f => f.get('DNI') === dniBuscado);

        if (socio) {
            return {
                socio: socio.get('SOCIO') ,
                nombre: socio.get('NOMBRE'),
                dni : socio.get('DNI'),
                estado: socio.get('ESTADO'),
                fechaCredito: socio.get('FECHA_CREDITO'),
                montoSacado: socio.get('MONTO_SACADO'),
                cuotasTotales: socio.get('CUOTAS_TOTALES'),
                cuotasPagas: socio.get('CUOTAS_PAGAS'),
                deuda: parseFloat(socio.get('DEUDA').toString().replace(/[$.]/g, '').replace(',', '.')),
            };
        }
        return null;
    } catch (error) {
        console.error("Error en DB:", error);
        return null;
    }
}

module.exports = obtenerDatosSocio;