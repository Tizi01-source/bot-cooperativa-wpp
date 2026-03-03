const wppconnect = require('@wppconnect-team/wppconnect'); // Traemos API WPPConnect
const fs = require('fs'); // Traemos el modulo de Node para lee/escribir archivos (File System)
const motorDelBot = require('./configuracion'); // Traemos nuestro mapa de menus y conexiones
const dotenv = require('dotenv').config(); // Para cargar variables de entorno desde un .env
const { obtenerDatosSocio } = require('./baseDeDatos'); // Traemos la función para consultar datos de socios en Google Sheets

// LOGICA DE PERSISTENCIA----------------------------------------------------------------------------------------

const ARCHIVO_ESTADOS = './estados.json'; // Nombre del archivo donde guardamos la memoria del bot.
let estadoUsuarios = cargarEstados(); // Al arrancar, llena esta variable con lo que hay en el JSON.

function guardarEstados() {
    // Convierte el objeto JS a texto plano (JSON) y lo guarda físicamente en el disco.
    fs.writeFileSync(ARCHIVO_ESTADOS, JSON.stringify(estadoUsuarios, null, 2));
}   

function cargarEstados() {
    // Si el archivo existe, lo lee y lo convierte de texto a un objeto JS que podamos usar.
    if (fs.existsSync(ARCHIVO_ESTADOS)) {
        return JSON.parse(fs.readFileSync(ARCHIVO_ESTADOS, 'utf-8'));
    }
    // Si no existe (primera vez), devuelve un objeto vacío.
    return {}; 
}

// ARRANQUE DE WHATSAPP BOT ------------------------------------------------------------------------------------------

wppconnect.create({
    session: 'sesion-cooperativa', // Nombre de la carpeta donde se guardará tu sesión (tokens).
    // Arrancamos codigo QR
    catchQR: (base64Qrimg, asciiQR) => {
        console.log(asciiQR); // Dibuja el código QR en tu terminal para que lo escanees.
    },
})
.then((client) => start(client)) // Si sale bien, pasamos a la función principal.
.catch((error) => console.log(error)); // Si hay error al conectar, nos avisa.

// FUNCION PRINCIPAL DEL BOT ------------------------------------------------------------------------------------------

function start(client) {
    console.log("🤖 BOT INICIADO");


    
    client.onMessage((message) => {
        const telefono = message.from;   // Identificamos quien escribe

        // Si escribo yo, se silencia el bot
        if (message.fromMe) {
            estadoUsuarios[telefono] = "HUMANO"; // Lo marcamos Humano.
            guardarEstados();
            return; // El bot no hace nada mas.
        }

        // Si el usuario ya está marcado como "HUMANO":
        if (estadoUsuarios[telefono] === "HUMANO") {
            console.log(`[SILENCIO] ${telefono} está en modo HUMANO. No responde el bot.`);
            return; // CORTA ACÁ. El bot ignora el mensaje para no interrumpirte.
        }
        

        // 1. FILTRO DE SEGURIDAD (Ignora grupos, comunidades, estados y mensajes vacíos)
    if (
        message.isGroupMsg || 
        message.from === 'status@broadcast' || 
        message.type === 'newsletter' || // Para ignorar Canales de WhatsApp
        !message.body ||
        message.from.includes('@g.us') // Refuerzo para cualquier tipo de grupo/comunidad
    ) {
        return; 
    }


        const textoRecibido = message.body.trim(); // Limpiamos espacios (ej: " 1 " -> "1").


        // Si no lo conocemos (no está en el JSON):
        if (!estadoUsuarios[telefono]) {
            estadoUsuarios[telefono] = "INICIO";
            guardarEstados();
            return client.sendText(telefono, motorDelBot["INICIO"].mensaje); // Primer saludo.
        }

        const estadoActual = estadoUsuarios[telefono]; // Ej: "VENTAS"
        const menuActual = motorDelBot[estadoActual]; // Trae las opciones de ese menú.
        const eleccion = parseInt(textoRecibido); // Intenta convertir la respuesta del cliente, de texto a número.


        // Si es un número y ese número es una opción válida del menú:
        if (!isNaN(eleccion) && menuActual.esValida(eleccion)) {
            const proximoEstado = menuActual.conexiones[eleccion]; // Ej: "SOPORTE"

            if (proximoEstado) {
                //actualizamos estado del usuario
                estadoUsuarios[telefono] = proximoEstado; // Actualizamos memoria.
                guardarEstados();

                const nuevoMenu = motorDelBot[proximoEstado];
                client.sendText(telefono, nuevoMenu.mensaje); // Mandamos el nuevo menú.
            }
        } else {
            // Si puso "Hola" o un número que no está en el menú:
            client.sendText(telefono, "No entendí esa opción. Recordá:\n\n" + menuActual.mensaje);
        }
    });
}

function esHorarioLaboral() {
    const ahora = new Date(); // Toma la fecha/hora actual del sistema.
    const hora = ahora.getHours(); // Saca solo la hora (0 a 23).
    return hora >= 10 && hora < 17; // Devuelve true si está en el rango, false si no.
}


