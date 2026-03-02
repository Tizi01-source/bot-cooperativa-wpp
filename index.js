const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const motorDelBot = require('./configuracion');

// Logica de persistencia

const ARCHIVO_ESTADOS = './estados.json';

let estadoUsuarios = cargarEstados();

//funcion para guardar datos en el disco
function guardarEstados() {
    fs.writeFileSync(ARCHIVO_ESTADOS, JSON.stringify(estadoUsuarios, null, 2));
}   

//funcion para cargar datos desde el disco al arrancar
function cargarEstados() {
    if (fs.existsSync(ARCHIVO_ESTADOS)) {
        return JSON.parse(fs.readFileSync(ARCHIVO_ESTADOS, 'utf-8'));
    }
    return {}; //si el archivo no existe, retornamos un objeto vacío
}

// Arranque de Whatsapp

wppconnect.create({
    session: 'sesion-cooperativa',
    // Arrancamos codigo QR
    catchQR: (base64Qrimg, asciiQR) => {
        console.log(asciiQR);
    },
})
.then((client) => start(client))
.catch((error) => console.log(error));

function start(client) {
    console.log("🤖 BOT INICIADO");

    client.onMessage((message) => {
        // ignoramos grupos y mensajemos que mandamos nosotros
        if (message.isGroupMsg || message.fromMe) return;

        if (!message.body) return; // si el mensaje no tiene texto, lo ignoramos

        const telefono = message.from;
        const textoRecibido = message.body.trim();

        // si es nuevo o no tiene estado, va a inicio
        if (!estadoUsuarios[telefono]) {
            estadoUsuarios[telefono] = "INICIO";
            guardarEstados();
            // Mandamos mensaje
            return client.sendText(telefono, motorDelBot["INICIO"].mensaje);
        }

        const estadoActual = estadoUsuarios[telefono];
        const menuActual = motorDelBot[estadoActual];

        // Procesamos respuesta del socio como numero
        const eleccion = parseInt(textoRecibido);

        if (!isNaN(eleccion) && menuActual.esValida(eleccion)) {
            const proximoEstado = menuActual.conexiones[eleccion];

            if (proximoEstado) {
                //actualizamos estado del usuario
                estadoUsuarios[telefono] = proximoEstado;
                guardarEstados();

                // buscamos el nuevo menu y mandamos
                const nuevoMenu = motorDelBot[proximoEstado];
                client.sendText(telefono, nuevoMenu.mensaje);
            }
        } else {
            // si la respuesta no es válida, mandamos mensaje de error
            client.sendText(telefono, "No entendí esa opción. Recordá:\n\n" + menuActual.mensaje);
        }
    });
}




