const wppconnect = require('@wppconnect-team/wppconnect'); // Traemos API WPPConnect
const fs = require('fs'); // Traemos el modulo de Node para lee/escribir archivos (File System)
const motor = require('./configuracion'); // Traemos nuestro mapa de menus y conexiones
const dotenv = require('dotenv').config(); // Para cargar variables de entorno desde un .env
const obtenerDatosSocio = require('./baseDeDatos'); // Traemos la función para consultar datos de socios en Google Sheets

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
    // Esto es para que funcione en la VM de Azure, que no tiene navegador ni pantalla para mostrar el QR.
    puppeteerOptions: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
    //Esto te avisa si el bot está conectado o si se cayó el internet
    statusFind: (statusSession, session) => {
        console.log('Estado de la Sesión: ', statusSession);
    },
    catchQR: (base64Qrimg, asciiQR) => {
        console.log(asciiQR); // Dibuja el código QR en tu terminal para que lo escanees.
    },
})
.then((client) => start(client)) // Si sale bien, pasamos a la función principal.
.catch((error) => console.log(error)); // Si hay error al conectar, nos avisa.

// FUNCION PRINCIPAL DEL BOT ------------------------------------------------------------------------------------------

function start(client) {
    console.log("🤖 BOT INICIADO");
    
    client.onMessage(async (message) => {
        const telefono = message.from;   // Identificamos quien escribe

        // Si escribo yo, se silencia el bot
        if (message.fromMe) {
            estadoUsuarios[telefono] = { paso: "HUMANO" }; // Lo marcamos Humano.
            guardarEstados();
            return; // El bot no hace nada mas.
        }

        // Si el usuario ya está marcado como "HUMANO":
        if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") {
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
            estadoUsuarios[telefono] = { paso: "BIENVENIDA" };
            guardarEstados();
            return client.sendText(telefono, motor["BIENVENIDA"].mensaje); // Primer saludo.
        }

        let sesion = estadoUsuarios[telefono]; // Traemos la "sesión" o "estado" actual del usuario (lo que está haciendo)

        // Logica de validacion DNI
        if (sesion.paso === "BIENVENIDA") {
            // Filtro DNI: Solo números, entre 7 y 8 dígitos.
            const dniLimpio = textoRecibido.replace(/\D/g, ''); // Elimina todo lo que no sea número.

            if (dniLimpio.length < 7 || dniLimpio.length > 9) {
                return client.sendText(telefono, "⚠️ El DNI ingresado no parece válido. Por favor, escribí solo los números:");
            }

            const socio = await obtenerDatosSocio(dniLimpio); // Consultamos en la base de datos.

            if (socio) {
                sesion.paso = "MENU_SOCIO"; // Actualizamos el paso a MENU_SOCIO
                sesion.datosSocio = socio; // Guardamos los datos del socio en la sesión.
                guardarEstados();

                const saludoSocio = `¡Hola ${socio.nombre}! 👋\n\n` +
                                    `Registramos una deuda de: *$${socio.deuda}*\n\n` +
                                    `¿Qué deseás consultar?\n` +
                                    `1️⃣ Ver planes de pago\n` +
                                    `2️⃣ Métodos de pago (CBU/Alias)\n` +
                                    `3️⃣ Hablar con un asesor`;
                return client.sendText(telefono, saludoSocio);
            } else {
                return client.sendText(telefono, "❌ No encontré el DNI en nuestra base. Por favor, verificalo o pedí hablar con un asesor.");
            }
        }

        // Logica menus
        const menuActual = motor[sesion.paso]; // Trae las opciones de ese menú.
        const eleccion = parseInt(textoRecibido); // Intenta convertir la respuesta del cliente, de texto a número.


        // Si es un número y ese número es una opción válida del menú:
        if (!isNaN(eleccion) && menuActual.esValida(eleccion)) {

            // Caso especial, planes de pago opcion 1 de menu socio
            if (sesion.paso === "MENU_SOCIO" && eleccion === 1) {
                sesion.paso = "PLANES_DETALLE"; // Cambiamos a un sub paso nuevo
                guardarEstados();

                const monto = sesion.datosSocio.deuda;
                const msjPlanes = `📈 *Planes para tu deuda de $${monto}:*\n\n` +
                                  `1️⃣ 10 cuotas de *$${(monto / 10).toFixed(2)}*\n` +
                                  `2️⃣ 5 cuotas de *$${(monto / 5).toFixed(2)}*\n` +
                                  `3️⃣ 2 cuotas de *$${(monto / 2).toFixed(2)}*\n\n` +
                                  `0️⃣ Volver al menú anterior`;

                // conectamos manuamente a una funcion de volver
                return client.sendText(telefono, msjPlanes);
            }

            if (sesion.paso === "PLANES_DETALLE" && [1, 2, 3].includes(eleccion)) {
                const cuotas = eleccion === 1 ? "10" : eleccion === 2 ? "5" : "2";
                await client.sendText(telefono, `✅ ¡Excelente elección! Has seleccionado el plan de *${cuotas} cuotas*.\n\nEn breve un asesor te enviará el cupón de pago. El bot se desactivará para que puedas hablar con nosotros.`);

                //pasamos a modo humano
                sesion.paso = "HUMANO";
                guardarEstados();
                return;
            }

            // Caso especial, volver si marca 0
            if (eleccion === 0) {
                sesion.paso = "MENU_SOCIO"; // Volvemos al menú socio
                guardarEstados();
                const socio = sesion.datosSocio;
                const saludoSocio = `¿En qué más puedo ayudarte, ${socio.nombre}?\n\n` +
                                    `1️⃣ Ver planes de pago\n` +
                                    `2️⃣ Métodos de pago\n` +
                                    `3️⃣ Hablar con un asesor`;
                return client.sendText(telefono, saludoSocio);
            }

            // Navegación normal para el resto de opciones (CBU, Asesor, etc.)

            const proximoEstado = menuActual.conexiones[eleccion]; 
            if (proximoEstado) {
                if (proximoEstado === "BIENVENIDA") delete sesion.datosSocio; // Reset si vuelve al inicio
                guardarEstados();
                client.sendText(telefono, motor[proximoEstado].mensaje);
            }
        } else {
            // Si puso "Hola" o un número que no está en el menú:
            client.sendText(telefono, "⚠️ Opción no válida. Por favor, elegí un número de la lista.");
        }

        // 4. RESET POR INACTIVIDAD (Opcional: borra la sesión si no habla por 30 min)
        clearTimeout(sesion.timer);
        sesion.timer = setTimeout(() => {
            delete estadoUsuarios[telefono];
            guardarEstados();
        }, 30 * 60 * 1000);

    });
}



// Futura incorporacion
function esHorarioLaboral() {
    const ahora = new Date(); // Toma la fecha/hora actual del sistema.
    const hora = ahora.getHours(); // Saca solo la hora (0 a 23).
    return hora >= 10 && hora < 17; // Devuelve true si está en el rango, false si no.
}


