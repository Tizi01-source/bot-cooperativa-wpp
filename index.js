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

        // Si escribo yo, se silencia el bot 30 min. a ese numero para no pisarnos.
        if (message.fromMe) {
            if (!estadoUsuarios[telefono]) estadoUsuarios[telefono] = {}; // <--- Asegura que no explote si no existe
            estadoUsuarios[telefono] = { paso: "HUMANO" }; 
            guardarEstados();
            activarModoHumano(telefono, 0.5);
            return; 
        }
        
        // Si el usuario ya está marcado como "HUMANO" el bot lo ignora.
        if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") { 
            console.log(`[SILENCIO] ${telefono} está en modo HUMANO. No responde el bot.`);
            return;
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
        
        // Si no lo conocemos (no está en el JSON) manda el panel de bienvenida.
        if (!estadoUsuarios[telefono]) {
            estadoUsuarios[telefono] = { paso: "BIENVENIDA" };
            guardarEstados();
            return client.sendText(telefono, motorDelBot["BIENVENIDA"].mensaje); 
        }
        
        // Traemos la "sesión" o "estado" actual del usuario.
        let sesion = estadoUsuarios[telefono]; 
        
        // --- PASO: BIENVENIDA (PROCESAR DNI) ---
        if (sesion.paso === "BIENVENIDA") {
            const dniLimpio = textoRecibido.replace(/\D/g, ''); // Elimina todo lo que no sea número.
            if (dniLimpio.length < 7 || dniLimpio.length > 9) {
                return client.sendText(telefono, "⚠️ El DNI ingresado no parece válido. Por favor, escribí solo los números:");
            }

            // Pasamos al panel de confirmacion por si el socio escribe mal.
            sesion.paso = "CONFIRMAR_NUMERO_DNI";
            sesion.dniTemporal = dniLimpio; // Guardamos el número temporalmente.
            guardarEstados();
            return client.sendText(telefono, `Confirmame, ¿ingresaste el DNI: *${dniLimpio}*?\n\n1️⃣ Sí, es correcto\n2️⃣ No, lo escribí mal`);
        }
        
        // --- PROCESAR MENÚS ---
        const menuActual = motorDelBot[sesion.paso]; // Trae las opciones de ese menú.
        const eleccion = parseInt(textoRecibido); // Intenta convertir la respuesta del cliente, de texto a número.

        if (!isNaN(eleccion) && menuActual.esValida(eleccion)) {

            // Lógica para confirmar el numero de DNI.
            if (sesion.paso === "CONFIRMAR_NUMERO_DNI") {
                if (eleccion === 1) {
                    // Si el socio confirma el DNI, buscamos en el excel
                    const socio = await obtenerDatosSocio(sesion.dniTemporal);
                    
                    // Buscamos su dni en el excel y consultamos si es el o hay un error.
                    if (socio) {
                        sesion.paso = "CONFIRMAR_SOCIO";
                        sesion.datosSocio = socio; 
                        guardarEstados();
                        return client.sendText(telefono, `He encontrado a: *${socio.nombre}*.\n\n¿Sos vos?\n1️⃣ Sí, soy yo\n2️⃣ No, me equivoqué de DNI`);
                    } else { // Si no lo encuentra, lo tratamos como nuevo socio.
                        sesion.paso = "MENU_NUEVO_SOCIO";
                        guardarEstados();
                        return client.sendText(telefono, "No te encontré en nuestra base de datos.\n\n" + motorDelBot["MENU_NUEVO_SOCIO"].mensaje);
                    }
                } else {
                    // Si el socio indica que escribio mal, volvemos al inicio.
                    sesion.paso = "BIENVENIDA";
                    delete sesion.dniTemporal;
                    guardarEstados();
                    return client.sendText(telefono, "Entendido. Por favor, volvé a escribir tu DNI correctamente:");
                }
            }

            // Si el socio confirma su identidad, chequeamos su estado, si tiene REFI, ACTIVO o CANCELADO.
            if (sesion.paso === "CONFIRMAR_SOCIO") {
                if (eleccion === 1) {
                    const socio = sesion.datosSocio;
                    // Caso REFI.
                    if (socio.estado === 'REFI') {
                        sesion.paso = "MENU_INICIAL_MORA";
                        guardarEstados();
                        const msjMora = `¡Perfecto ${socio.nombre}! 👋\n\nRegistramos una deuda de *$${socio.deuda.toFixed(2)}* correspondiente al crédito gestionado el día *${socio.fechaCredito || 'N/A'}*.\n\n` + motorDelBot["MENU_INICIAL_MORA"].mensaje;
                        return client.sendText(telefono, msjMora);
                    } 
                    // Caso ACTIVO.
                    else if (socio.estado === 'ACTIVO') {
                        sesion.paso = "MENU_SOCIO_ACTIVO"; // 
                        guardarEstados();
                        const msjActivo = `¡Perfecto ${socio.nombre}! 👋\n\nActualmente tenés un crédito *ACTIVO*:\n` +
                                            `💰 *Monto sacado:* $${socio.montoSacado}\n` +
                                            `📅 *Fecha:* ${socio.fechaCredito || 'N/A'}\n` +
                                            `📊 *Progreso:* Cuota ${socio.cuotasPagas} de ${socio.cuotasTotales}\n\n` +
                                            motorDelBot["MENU_SOCIO_ACTIVO"].mensaje;
                        return client.sendText(telefono, msjActivo);
                    } 
                    // CASO: NUEVO O CANCELADO
                    else {
                        sesion.paso = "MENU_NUEVO_SOCIO"; //
                        guardarEstados();
                        return client.sendText(telefono, `¡Perfecto ${socio.nombre}! 👋\n\n` + motorDelBot["MENU_NUEVO_SOCIO"].mensaje);
                    }
                } else {
                    sesion.paso = "BIENVENIDA";
                    delete sesion.datosSocio;
                    guardarEstados();
                    return client.sendText(telefono, "Entendido. Por favor, volvé a escribir tu DNI correctamente:");
                }
            }

            // Paneles de Deuda.
            if (sesion.paso === "MENU_INICIAL_MORA") {

                if (eleccion === 1) { // Primera opción: Pago por Alias (CBU)
                    await client.sendText(telefono, "🏦 *Datos para Transferencia:*\n\n*Alias:* MAYCOOPBAPRO\n*Banco:* Provincia\n\nPor favor, enviá el comprobante por acá.");
                    await client.addLabel(telefono, 'MORA');
                    activarModoHumano(telefono, 0.5);
                } 
                else if (eleccion === 2) { // Segunda opción: Armar plan de cuotas (Lo mandamos al panel matemático)

                    sesion.paso = "PANEL_DEUDA";
                    guardarEstados();
                    const socio = sesion.datosSocio;
                    const msjCuotas = `${motorDelBot["PANEL_DEUDA"].mensaje}` +
                                     `1️⃣ 10 cuotas de $${(socio.deuda / 10).toFixed(2)}\n` +
                                     `2️⃣ 5 cuotas de $${(socio.deuda / 5).toFixed(2)}\n` +
                                     `3️⃣ 2 cuotas de $${(socio.deuda / 2).toFixed(2)}\n` +
                                     `4️⃣ 1 pago de $${socio.deuda.toFixed(2)}`;
                    return client.sendText(telefono, msjCuotas);

                }
                else if (eleccion === 3) { // Tercera opcion: Tarjeta o link, A INCORPORAR

                    await client.sendText(telefono, "💳 ¡Perfecto! En instantes un asesor te enviará el *Link de Pago*.");
                    await client.addLabel(telefono, 'MORA');
                    activarModoHumano(telefono, 1);

                }

                else if (eleccion === 4) { // Asesor
                    await client.sendText(telefono, "Entendido. Un asesor se pondrá en contacto pronto.");
                    await client.addLabel(telefono, 'CONSULTA');
                    activarModoHumano(telefono, 1);

                }
                return;
            }

            // Lógica PANEL_DEUDA
            if (sesion.paso === "PANEL_DEUDA") {

                sesion.planElegido = eleccion === 1 ? "10 cuotas" : eleccion === 2 ? "5 cuotas" : eleccion === 3 ? "2 cuotas" : "1 pago";

                await client.sendText(telefono, `✅ Confirmado: Plan de *${sesion.planElegido}*.\n\n🏦 *Transferí al Alias:* MAYCOOPBAPRO\n\nUn asesor queda a cargo.`);

                await client.addLabel(telefono, 'MORA');
                activarModoHumano(telefono, 1);
                return;
            }

            // Lógica MENU_SOCIO_ACTIVO
            if (sesion.paso === "MENU_SOCIO_ACTIVO") {

                if (eleccion === 1) { // Consultar crédito actual

                    const socio = sesion.datosSocio;
                    
                    const msjDetalle = `📄 *Detalle de tu crédito:* \n\n` +
                                       `📅 *Fecha de gestión:* ${socio.fechaCredito || 'N/A'}\n` +
                                       `💰 *Monto original:* $${socio.montoSacado}\n` +
                                       `📊 *Estado de cuotas:* ${socio.cuotasPagas} de ${socio.cuotasTotales}\n\n` +
                                       `¿Necesitás algo más?\n` +
                                       `1️⃣ Hablar con un asesor\n` +
                                       `2️⃣ Finalizar consulta`;

                    sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                    guardarEstados();
                    return client.sendText(telefono, msjDetalle);

                } else if (eleccion === 2) { // Crédito paralelo

                    await client.sendText(telefono, "🚀 ¡Excelente! Para evaluar un *Crédito Paralelo*, por favor enviá tu *Recibo de Haberes y Movimientos Bancarios*.");
                    await client.addLabel(telefono, 'CREDITO');
                    activarModoHumano(telefono, 1);

                } else if (eleccion === 3) { // Asesor

                    await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                    await client.addLabel(telefono, 'CONSULTA');
                    activarModoHumano(telefono, 1);

                } else if (eleccion === 4) { // FINALIZAR

                    await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                    delete estadoUsuarios[telefono]; 
                    guardarEstados();
                }
                return;
            }

            // Menu extra para socios activos que quieren hablar con asesor o finalizar después de consultar su crédito.
            if (sesion.paso === "CONFIRMAR_EXTRA_ACTIVO") {

                if (eleccion === 1) { // Quiere hablar con asesor
                    await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                    await client.addLabel(telefono, 'CONSULTA');
                    activarModoHumano(telefono, 2);

                } else { // Quiere finalizar
                    
                    await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                    delete estadoUsuarios[telefono]; 
                    guardarEstados();
                }
                return;
            }

            // Lógica MENU_NUEVO_SOCIO
            if (sesion.paso === "MENU_NUEVO_SOCIO") {

                if (eleccion === 1) { // Solicitar crédito
                    await client.sendText(telefono, "🚀 ¡Perfecto! Para iniciar tu solicitud, por favor enviá tu *Recibo de Haberes y Movimientos Bancarios*.\n\nUn asesor evaluará tu perfil.");
                    await client.addLabel(telefono, 'CREDITO');
                    activarModoHumano(telefono, 1);

                } else if (eleccion === 2) { // Otras consultas

                    await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                    await client.addLabel(telefono, 'CONSULTA');
                    activarModoHumano(telefono, 1);

                } else if (eleccion === 3) { // FINALIZAR

                    await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                    delete estadoUsuarios[telefono]; 
                    guardarEstados();
                }
                return;
            }

        } else if (menuActual) {
            client.sendText(telefono, "⚠️ Opción no válida.");
        }

        // Timer de inactividad (30 min)
        resetearPorInactividad(telefono);
    });
}

// FUNCIONES AUXILIARES ------------------------------------------------------------------------------------------

let timers = {}; 

function resetearPorInactividad(telefono) {
    if (timers[telefono]) clearTimeout(timers[telefono]);
    timers[telefono] = setTimeout(() => {
        console.log(`[LIMPIEZA] Sesión expirada para ${telefono}`);
        delete estadoUsuarios[telefono];
        delete timers[telefono];
        guardarEstados();
    }, 30 * 60 * 1000);
}

function activarModoHumano(telefono, horas) {
    if (timers[telefono]) clearTimeout(timers[telefono]);
    estadoUsuarios[telefono].paso = "HUMANO";
    guardarEstados();
    timers[telefono] = setTimeout(() => {
        if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") {
            delete estadoUsuarios[telefono];
            delete timers[telefono];
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


