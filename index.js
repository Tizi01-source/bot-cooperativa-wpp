const wppconnect = require('@wppconnect-team/wppconnect'); // Traemos API WPPConnect
const fs = require('fs'); // Traemos el modulo de Node para lee/escribir archivos (File System)
const motorDelBot = require('./configuracion'); // Traemos nuestro mapa de menus y conexiones
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
    session: 'sesion-cooperativa', // Nombre de la carpeta donde se guardará la sesión (tokens).

    // Esto es para que funcione en la VM de Azure.
    puppeteerOptions: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
    //Esto te avisa si el bot está conectado o si se cayó el internet.
    statusFind: (statusSession, session) => {
        console.log('Estado de la Sesión: ', statusSession);
    },
    catchQR: (base64Qrimg, asciiQR) => {
        console.log(asciiQR); // Dibuja el código QR en la terminal para escanear.
    },
})
.then((client) => start(client)) // Si sale bien, pasamos a la función principal.
.catch((error) => console.log(error)); // Si hay error al conectar, nos avisa.

// FUNCION PRINCIPAL DEL BOT ------------------------------------------------------------------------------------------

function start(client) {
    console.log("🤖 BOT INICIADO");
    
    client.onMessage(async (message) => {
        const telefono = message.from;   // Identificamos quien escribe, su numero.
        const textoRecibido = (message.body || "").trim(); // Limpiamos espacios de la respuesta a opciones(ej: " 1 " -> "1").

        // Si escribo yo, se silencia el bot a ese numero para no pisarnos.
        if (message.fromMe) {
            if (!estadoUsuarios[telefono]) estadoUsuarios[telefono] = {}; // <--- Asegura que no explote si no existe
            estadoUsuarios[telefono] = { paso: "HUMANO" }; 
            guardarEstados();
            activarModoHumano(telefono, 0.5);
            return; 
        }

        if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") { // Si el usuario ya está marcado como "HUMANO":
            console.log(`[SILENCIO] ${telefono} está en modo HUMANO. No responde el bot.`);
            return; // CORTA ACÁ. El bot ignora el mensaje para no interrumpirte.
        }

        //FILTRO DE SEGURIDAD (Ignora grupos, comunidades, estados y mensajes vacíos)
        if (
            message.isGroupMsg || 
            message.from === 'status@broadcast' || 
            message.type === 'newsletter' || // Para ignorar Canales de WhatsApp
            !message.body ||
            message.from.includes('@g.us') // Refuerzo para cualquier tipo de grupo/comunidad
        ) {
        return; 
        }
        
        // Si no lo conocemos (no está en el JSON):
        if (!estadoUsuarios[telefono]) {
            estadoUsuarios[telefono] = { paso: "BIENVENIDA" };
            guardarEstados();
            return client.sendText(telefono, motorDelBot["BIENVENIDA"].mensaje); // Primer saludo.
        }
        
        let sesion = estadoUsuarios[telefono]; // Traemos la "sesión" o "estado" actual del usuario (lo que está haciendo)
        


        // --- PASO: BIENVENIDA (PROCESAR DNI) ---
        if (sesion.paso === "BIENVENIDA") {
            const dniLimpio = textoRecibido.replace(/\D/g, ''); // Elimina todo lo que no sea número.
            if (dniLimpio.length < 7 || dniLimpio.length > 9) {
                return client.sendText(telefono, "⚠️ El DNI ingresado no parece válido. Por favor, escribí solo los números:");
            }

            const socio = await obtenerDatosSocio(dniLimpio); // Consultamos en la base de datos.
            
            if (socio && socio.estado === 'REFI') {
                // CASO: SOCIO EN MORA
                sesion.paso = "PANEL_DEUDA"; 
                sesion.datosSocio = socio; 
                guardarEstados();
                
                const msjDeuda = `¡Hola ${socio.nombre}! 👋\n\nRegistramos una deuda de *$${socio.deuda}*.\n\nElegí un plan de pago:\n` +
                                                                                  `1️⃣ 10 cuotas de $${(socio.deuda / 10).toFixed(2)}\n` +
                                                                                  `2️⃣ 5 cuotas de $${(socio.deuda / 5).toFixed(2)}\n` +
                                                                                  `3️⃣ 2 cuotas de $${(socio.deuda / 2).toFixed(2)}\n` +
                                                                                  `4️⃣ 1 pago de $${socio.deuda.toFixed(2)}`;
                return client.sendText(telefono, msjDeuda);
            } else if (socio && socio.estado === 'ACTIVO') {
                // CASO: SOCIO AL DÍA O NUEVO
                sesion.paso = "PANEL_INFO_ACTIVO";
                sesion.datosSocio = socio;
                guardarEstados();

                const msjActivo = `¡Hola ${socio.nombre}! 👋\n\nActualmente tenés un crédito *ACTIVO*:\n` +
                                                        `💰 *Monto:* $${socio.montoSacado}\n` +
                                                        `📅 *Progreso:* Cuota ${socio.cuotasPagas} de ${socio.cuotasTotales}\n\n` +
                                                        motorDelBot["PANEL_INFO_ACTIVO"].mensaje;
                return client.sendText(telefono, msjActivo);   
            }

            else {
                // CASO: SOCIO CANCELADO O NUEVO SIN CRÉDITO
                sesion.paso = "PANEL_CREDITO";
                if (socio) sesion.datosSocio = socio;
                guardarEstados();
                return client.sendText(telefono, motorDelBot["PANEL_CREDITO"].mensaje);
            }
        }
        
        // --- PROCESAR MENÚS ---
        const menuActual = motorDelBot[sesion.paso]; // Trae las opciones de ese menú.
        const eleccion = parseInt(textoRecibido); // Intenta convertir la respuesta del cliente, de texto a número.

        if (!isNaN(eleccion) && menuActual.esValida(eleccion)) {

            // Lógica PANEL_CREDITO
            if (sesion.paso === "PANEL_CREDITO") {
                if (eleccion === 1) { // Solicitar crédito
                    await client.sendText(telefono, "🚀 ¡Perfecto! Por favor enviá tu *Recibo de Haberes y Movimientos Bancarios*.\n\nUn asesor evaluará tu perfil.");
                    await client.addLabel(telefono, "PROCESO DE CREDITO");
                    activarModoHumano(telefono, 3); // 3 horas
                } else { // Otras consultas
                    await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                    activarModoHumano(telefono, 3);
                }
                return;
            }

            // Lógica PANEL_DEUDA (Cuotas)
            if (sesion.paso === "PANEL_DEUDA") {
                if (eleccion === 0) { /* Lógica volver si existiera bienvenida manual */}
                sesion.paso = "METODOS_PAGO";
                sesion.planElegido = eleccion === 1 ? "10 cuotas" : eleccion === 2 ? "5 cuotas" : eleccion === 3 ? "2 cuotas" : "1 pago";
                guardarEstados();
                return client.sendText(telefono, motorDelBot["METODOS_PAGO"].mensaje);
            }

            // Lógica METODOS_PAGO
            if (sesion.paso === "METODOS_PAGO") {
                    if (eleccion === 0) {
                        sesion.paso = "PANEL_DEUDA";
                        guardarEstados();
                        return client.sendText(telefono, "Volviendo... por favor seleccioná el plan nuevamente.");
                    }

                    const msjFinal = eleccion === 1 ? "🏦 *Alias:* MAYCOOPBAPRO\n*Banco:* Provincia" : "Has elegido otro método.";
                    await client.sendText(telefono, `${msjFinal}\n\nGracias por confirmar tu plan de *${sesion.planElegido}*. Un asesor queda a cargo.`);
                    await client.addLabel(telefono, "MORA");
                    activarModoHumano(telefono, 4);
                    return;
            }

            // Lógica PANEL_INFO_ACTIVO
            if (sesion.paso === "PANEL_INFO_ACTIVO") {
                if (eleccion === 1) { 
                    await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                    activarModoHumano(telefono, 3);
                } else { 
                    await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                    delete estadoUsuarios[telefono]; // Resetea el bot para este usuario
                    guardarEstados();
                }
                return;
            }

        } else {
            client.sendText(telefono, "⚠️ Opción no válida.");
        }

        // Timer de inactividad (30 min)
        resetearPorInactividad(telefono);
    });
}

// FUNCIONES AUXILIARES ------------------------------------------------------------------------------------------

function resetearPorInactividad(telefono) {
    // Si ya existe un timer para este número, lo borramos para reiniciarlo
    if (estadoUsuarios[telefono] && estadoUsuarios[telefono].timer) {
        clearTimeout(estadoUsuarios[telefono].timer);
    }

    // Creamos un nuevo timer de 30 minutos (30 * 60 * 1000 ms)
    estadoUsuarios[telefono].timer = setTimeout(() => {
        console.log(`[LIMPIEZA] Sesión expirada por inactividad para ${telefono}`);
        delete estadoUsuarios[telefono];
        guardarEstados();
    }, 30 * 60 * 1000);
}


function activarModoHumano(telefono, horas) {
    // 1. Si ya había un timer de humano para este número, lo borramos (para que reinicie el conteo)
    if (estadoUsuarios[telefono] && estadoUsuarios[telefono].timer) {
        clearTimeout(estadoUsuarios[telefono].timer);
    }

    estadoUsuarios[telefono].paso = "HUMANO";
    guardarEstados();

    estadoUsuarios[telefono].timer = setTimeout(() => {
        if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") {
            console.log(`[REGRESO] El bot vuelve a activarse para ${telefono}`);
            delete estadoUsuarios[telefono];
            guardarEstados();
        }
    }, horas * 60 * 60 * 1000);
}


// Futura incorporacion
function esHorarioLaboral() {
    const ahora = new Date(); // Toma la fecha/hora actual del sistema.
    const hora = ahora.getHours(); // Saca solo la hora (0 a 23).
    return hora >= 10 && hora < 17; // Devuelve true si está en el rango, false si no.
}


