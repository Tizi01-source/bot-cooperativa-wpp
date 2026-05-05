// IMPORTACIONES Y CONFIGURACIONES INICIALES ------------------------------------------------------------------------------

const wppconnect = require('@wppconnect-team/wppconnect'); // API WPPConnect.
const fs = require('fs'); // Modulo de Node para leer/escribir archivos. (File System) 
const motorDelBot = require('./configuracion'); // Mapa de menus y conexiones.
const dotenv = require('dotenv').config();
const obtenerDatosSocio = require('./baseDeDatos'); // Funcion para consultar datos de socios en Excel.

// LOGICA DE MEMORIA -----------------------------------------------------------------------------------------------

const ARCHIVO_ESTADOS = './estados.json'; // Archivo donde guarda la memoria del bot.
let estadoUsuarios = cargarEstados(); // Al arrancar, llena esta variable con lo que hay en el JSON.

function guardarEstados() {
    // Convierte el objeto JS a texto plano (JSON) y lo guarda fisicamente en el disco.
    fs.writeFileSync(ARCHIVO_ESTADOS, JSON.stringify(estadoUsuarios, null, 2));
}   

function cargarEstados() {
    // Si el archivo existe, lo lee y lo convierte de texto a un objeto JS.
    if (fs.existsSync(ARCHIVO_ESTADOS)) {
        return JSON.parse(fs.readFileSync(ARCHIVO_ESTADOS, 'utf-8'));
    }
    // Si no existe, devuelve un objeto vacio.
    return {}; 
}

// ARRANQUE DE WHATSAPP BOT --------------------------------------------------------------------------------------------

/* DEBUG
console.log("Cargando configuracion...");
console.log("Menus disponibles:", Object.keys(motorDelBot));
*/

wppconnect.create({
    session: 'sesion-cooperativa', // Nombre de la carpeta donde se guardará la sesion (tokens). 
    autoClose: 0,

    // Esto es para que funcione en la VM de Azure.
    puppeteerOptions: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            ],
        protocolTimeout: 240000
    },
    //Esto avisa si el bot esta conectado.
    statusFind: (statusSession, session) => {
        console.log('Estado de la Sesión: ', statusSession);
        if (statusSession === 'browserClose' || statusSession === 'autocloseCalled') {
            console.log('Navegador cerrado. Forzando reinicio automático...');
            process.exit(1); 
        }
    },
    catchQR: (base64Qrimg, asciiQR) => {
        console.log(asciiQR); // Codigo QR en la terminal para escanear.
    },
})
.then((client) => start(client)) // Si sale bien, pasa a la funcion principal.
.catch((error) => console.log(error)); // Si hay error al conectar, atrapa el error.

// FUNCION PRINCIPAL DEL BOT ------------------------------------------------------------------------------------------

function start(client) {
    console.log("BOT INICIADO");
    
    // Funcion para desactivar el bot cuando un humano escribe.
    const sendTextOriginal = client.sendText.bind(client);
    client.sendText = async (to, content, options) => {
        // Le pega un Zero Width Joiner a todos los mensajes del bot.
        return sendTextOriginal(to, content + '\u200D', options); 
    };
       
    client.onAnyMessage(async (message) => {
        const telefono = message.fromMe ? message.to : message.from;   // Identificamos quien escribe.
        const textoRecibido = typeof message.body === 'string' ? message.body.trim() : ""; // Limpia espacios de la respuesta a opciones.

        // Si escribo yo, se silencia el bot 30 min. a ese numero para no pisar con el bot.
        if (message.fromMe) {
            // Si el mensaje tiene el caracter invisible, ignora.
            if (typeof message.body === 'string' && message.body.includes('\u200D')) {
                return; 
            }

            // Si no lo tiene, lo escribio un humano.
            if (!estadoUsuarios[telefono]) estadoUsuarios[telefono] = {};
            estadoUsuarios[telefono].paso = "HUMANO"; 
            guardarEstados();
            activarModoHumano(telefono, 0.5); 
            console.log(`MODO HUMANO activado con: ${telefono}`);
            return; 
        }
        
        // Si el usuario ya está marcado como "HUMANO" el bot lo ignora.
        if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") { 
            return;
        }

        // Filtro de seguridad. (Ignora grupos, comunidades, estados y mensajes vacios).
        if (
            message.isGroupMsg || 
            message.from === 'status@broadcast' || 
            message.type === 'newsletter' || // Para ignorar Canales de WhatsApp.
            !message.body ||
            message.from.includes('@g.us') // Refuerzo para cualquier tipo de grupo o comunidad.
        ) {
        return; 
        }
        
        // Si no esta en el JSON, manda el panel de bienvenida.
        if (!estadoUsuarios[telefono]) {
            estadoUsuarios[telefono] = { paso: "BIENVENIDA" };
            guardarEstados();
            return client.sendText(telefono, motorDelBot["BIENVENIDA"].mensaje); 
        }
        
        // Trae el estado actual del usuario.
        let sesion = estadoUsuarios[telefono]; 
        
        // Envia el mensaje de bienvenida y pide el DNI.
        if (sesion.paso === "BIENVENIDA") {
            const dniLimpio = textoRecibido.replace(/\D/g, ''); // Elimina todo lo que no sea numero.
            if (dniLimpio.length < 7 || dniLimpio.length > 9) {
                return client.sendText(telefono, "⚠️ El DNI ingresado no parece válido. Por favor, escribí solo los números:");
            }

            // Pasa al panel de confirmacion por si el socio escribe mal.
            sesion.paso = "CONFIRMAR_NUMERO_DNI";
            sesion.dniTemporal = dniLimpio; // Guarda el numero temporalmente.
            guardarEstados();
            return client.sendText(telefono, `Confirmame, ¿ingresaste el DNI: *${dniLimpio}*?\n\n1️⃣ Sí, es correcto\n2️⃣ No, lo escribí mal`);
        }
        
        // Segun el paso en el que este, el bot interpreta la respuesta del usuario y decide que hacer.
        const menuActual = motorDelBot[sesion.paso]; // Trae las opciones de ese menu.
        const eleccion = parseInt(textoRecibido); // Intenta convertir la respuesta del cliente, de texto a numero.

        // Si la respuesta no es un numero o no es una opcion valida para ese menu, le avisa y no hace nada mas.
        if (isNaN(eleccion) || !menuActual || !menuActual.esValida(eleccion)) {
             return client.sendText(telefono, "⚠️ Opción no válida. Por favor elegí un número válido de las opciones.");
        }

        try {
            // PANELES Y LOGICA ----------------------------------------------------------------------------------
            switch (sesion.paso) {

                // PANEL DE CONFIRMACION DE DNI.
                case "CONFIRMAR_NUMERO_DNI":
                    if (eleccion === 1) { // Si confirma que el DNI es correcto, lo buscamos en la base de datos.
                        const socio = await obtenerDatosSocio(sesion.dniTemporal);
                        if (socio) {
                            sesion.paso = "CONFIRMAR_SOCIO";
                            sesion.datosSocio = socio; 
                            guardarEstados();
                            return client.sendText(telefono, `He encontrado a: *${socio.nombre}*.\n\n¿Sos vos?\n1️⃣ Sí, soy yo\n2️⃣ No, me equivoqué de DNI`);
                        } else { // Si no encuentra el DNI, lo manda al menu de nuevo socio.
                            sesion.paso = "MENU_NUEVO_SOCIO";
                            guardarEstados();
                            return client.sendText(telefono, "Hola! Bienvenido a la Cooperativa MAYCOOP.\n\n" + motorDelBot["MENU_NUEVO_SOCIO"].mensaje);
                        }
                    } else { // Si elige que no es correcto, lo regresa al paso inicial.
                        sesion.paso = "BIENVENIDA";
                        delete sesion.dniTemporal;
                        guardarEstados();
                        return client.sendText(telefono, "Entendido. Por favor, volvé a escribir tu DNI correctamente:");
                    }

                // PANEL DE CONFIRMACION DE SOCIO ENCONTRADO.
                case "CONFIRMAR_SOCIO":
                    if (eleccion === 1) { // Si confirma su identidad, lo lleva al menu principal segun su estado.
                        const socio = sesion.datosSocio;
                        let msjRespuesta = `¡Perfecto ${socio.nombre}! 👋\n\n`;
                        
                        // PANEL DE MORA.
                        if (socio.estado === 'REFI') {
                            sesion.paso = "MENU_INICIAL_MORA";
                            
                            const moraHab = socio.haberes?.esMora;
                            const moraCbu = socio.cbu?.esMora;

                            if (moraHab && moraCbu) { // Si tiene en mora CBU y HABERES.
                                msjRespuesta += `⚠️ *Atención:* Registramos deuda en tus créditos por *CBU y Haberes*.\n💰 *Deuda Total:* $${socio.deudaTotal.toFixed(2)}\n`;
                            } else { // Si tiene en mora solo uno de los dos.
                                const creditoMora = moraHab ? socio.haberes : socio.cbu;
                                msjRespuesta += `⚠️ *Atención:* Registramos una deuda pendiente en tu crédito por *${creditoMora.metodo}*.\n💰 *Monto adeudado:* $${creditoMora.deuda.toFixed(2)}\n`;
                                if (socio.tieneAmbos) msjRespuesta += `✅ Tu otra línea de crédito se encuentra al día.\n`;
                            }

                            msjRespuesta += `\n¿Cómo preferís seguir?\n1️⃣ Ver opciones de pago\n2️⃣ Detalle deuda CBU\n3️⃣ Detalle deuda Haberes\n4️⃣ Hablar con un asesor\n5️⃣ Salir`;
                        } 
                        // PANEL ACTIVO.
                        else if (socio.estado === 'ACTIVO') {
                            if (socio.haberes?.esActivo && socio.cbu?.esActivo) { // Si tiene ambos creditos activos.
                                sesion.paso = "MENU_DOS_ACTIVOS"; 
                                msjRespuesta += `✅ Tenés dos créditos *ACTIVOS* con nosotros.\n\n¿Qué detalle necesitás ver?\n1️⃣ Ver datos crédito CBU\n2️⃣ Ver datos crédito Haberes\n3️⃣ Hablar con un asesor\n4️⃣ Salir`;
                            } else { // Si tiene solo uno de los dos creditos activos.
                                sesion.paso = "MENU_SOCIO_ACTIVO";
                                const activo = socio.haberes?.esActivo ? socio.haberes : socio.cbu;
                                msjRespuesta += `✅ Tenés un crédito *ACTIVO* por *${activo.metodo}*.\n📊 *Progreso:* Cuota ${activo.cuotasPagas} de ${activo.cuotasTotales}\n\n`;

                                // Segun el credito activo, le ofrece la opcion de solicitar el otro.
                                let oferta = "";
                                if (socio.haberes && !socio.cbu) oferta = `2️⃣ Solicitar crédito por CBU\n`;
                                else if (socio.cbu && !socio.haberes) oferta = `2️⃣ Solicitar crédito Haberes\n`;

                                msjRespuesta += `¿En qué podemos ayudarte?\n1️⃣ Hablar con un asesor\n${oferta}`;
                                msjRespuesta += oferta !== "" ? `3️⃣ Ver más detalles\n4️⃣ Salir` : `2️⃣ Ver más detalles\n3️⃣ Salir`;
                            }
                        } 
                        // PANEL CANCELADO O SIN CREDITOS.
                        else {
                            sesion.paso = "MENU_NUEVO_SOCIO";
                            msjRespuesta += motorDelBot["MENU_NUEVO_SOCIO"].mensaje;
                        }

                        guardarEstados();
                        return client.sendText(telefono, msjRespuesta);
                    } else { // Si elige que no es el, lo regresa al paso inicial.
                        sesion.paso = "BIENVENIDA";
                        delete sesion.datosSocio;
                        guardarEstados();
                        return client.sendText(telefono, "Entendido. Por favor, volvé a escribir tu DNI correctamente:");
                    }

                // FUNCIONALIDAD DE LOS MENUS SEGUN EL ESTADO DEL SOCIO.
                case "MENU_INICIAL_MORA":
                    const socioMora = sesion.datosSocio;
                    if (eleccion === 1) { // Si elige ver opciones de pago.
                        sesion.paso = "PANEL_DEUDA";
                        guardarEstados();

                        // Calculamos los planes de pago segun la deuda total, y se los mostramos al socio.
                        const d = socioMora.deudaTotal;
                        return client.sendText(telefono, `${motorDelBot["PANEL_DEUDA"].mensaje}1️⃣ 10 cuotas de $${(d/10).toFixed(2)}\n2️⃣ 5 cuotas de $${(d/5).toFixed(2)}\n3️⃣ 2 cuotas de $${(d/2).toFixed(2)}\n4️⃣ 1 pago de $${d.toFixed(2)}`);

                    } else if (eleccion === 2 || eleccion === 3) { // Si elige ver detalle de alguno de los creditos.
                        const credito = eleccion === 2 ? socioMora.cbu : socioMora.haberes;

                        // Verificamos que el credito que quiere ver sea el que tiene en mora.
                        if (!credito) return client.sendText(telefono, "No registramos esa línea de crédito. Elegí otra opción:");
                        sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                        guardarEstados();

                        return client.sendText(telefono, `📄 *Detalle ${credito.metodo}:*\nEstado: ${credito.estadoOriginal}\nDeuda: $${credito.deuda.toFixed(2)}\nCuotas: ${credito.cuotasPagas}/${credito.cuotasTotales}\n\n1️⃣ Volver a opciones de pago\n2️⃣ Salir`);

                    } else if (eleccion === 4) { // Si elige hablar con un asesor.
                        await client.sendText(telefono, "Entendido. Un asesor se pondrá en contacto pronto.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 5) { // Si elige salir.
                        await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                        delete estadoUsuarios[telefono]; 
                        guardarEstados();
                    }
                    break;

                // PANEL DE PLAN DE PAGO PARA SOCIOS EN MORA.
                case "PANEL_DEUDA":
                    // Cuando elige un plan de pago, se lo confirmamos.
                    sesion.planElegido = eleccion === 1 ? "10 cuotas" : eleccion === 2 ? "5 cuotas" : eleccion === 3 ? "2 cuotas" : "1 pago";
                    await client.sendText(telefono, `✅ Confirmado: Plan de *${sesion.planElegido}*.\n\n🏦 *Transferí al Alias:* MAYCOOPBAPRO\n\nUn asesor queda a cargo.`);
                    agregarEtiquetaSegura(client, telefono, 'MORA');
                    activarModoHumano(telefono, 1);
                    break;

                // PANEL PARA SOCIOS CON UN CREDITO ACTIVO.
                case "MENU_SOCIO_ACTIVO":
                    // Identificamos cual es el credito activo y guardamos esa info en una variable.
                    const sActivo = sesion.datosSocio;
                    const tieneSoloUno = !sActivo.tieneAmbos;
                    const credActivo = (sActivo.haberes && sActivo.haberes.esActivo) ? sActivo.haberes : sActivo.cbu;

                    
                    if (eleccion === 1) {        // Eligio hablar con asesor.
                        await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 2) { // Eligio solicitar otro credito o ver mas detalles.
                        if (tieneSoloUno) { // Si solo tiene un credito activo, la opcion 2 es para solicitar otro.
                            await client.sendText(telefono, "🚀 ¡Excelente elección! Para evaluar tu nueva solicitud enviá tu *Recibo de Haberes y Movimientos Bancarios*.");
                            agregarEtiquetaSegura(client, telefono, 'CREDITO');
                            activarModoHumano(telefono, 1);
                        } else {            // Si tiene ambos creditos activos, la opcion 2 es para ver mas detalles.
                            const msjDetalle = `📄 *Detalle de tu crédito:* \n📅 *Fecha:* ${credActivo.fecha}\n💰 *Monto:* $${credActivo.montoSacado}\n📊 *Cuotas:* ${credActivo.cuotasPagas}/${credActivo.cuotasTotales}\n\n1️⃣ Hablar con asesor\n2️⃣ Finalizar consulta`;
                            sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                            guardarEstados();
                            return client.sendText(telefono, msjDetalle);
                        }
                    } else if (eleccion === 3) { // Eligio ver mas detalles o salir.
                        if (tieneSoloUno) { // Si solo tiene un credito activo, la opcion 3 es para salir.
                            const msjDetalle = `📄 *Detalle de tu crédito:* \n📅 *Fecha:* ${credActivo.fecha}\n💰 *Monto:* $${credActivo.montoSacado}\n📊 *Cuotas:* ${credActivo.cuotasPagas}/${credActivo.cuotasTotales}\n\n1️⃣ Hablar con asesor\n2️⃣ Finalizar consulta`;
                            sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                            guardarEstados();
                            return client.sendText(telefono, msjDetalle);
                        } else {            // Si tiene ambos creditos activos, la opcion 3 es para hablar con asesor.
                            await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                            delete estadoUsuarios[telefono];
                            guardarEstados();
                        }
                    } else if (eleccion === 4 && tieneSoloUno) { // Eligio salir (solo aparece si tiene uno activo).
                        await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                        delete estadoUsuarios[telefono];
                        guardarEstados();
                    }
                    break;

                // PANEL PARA SOCIOS CON DOS CREDITOS ACTIVOS.
                case "MENU_DOS_ACTIVOS":
                    // Identificamos cual es cada credito y guardamos esa info en variables.
                    const sDos = sesion.datosSocio;

                    if (eleccion === 1 || eleccion === 2) { // Eligio ver detalle de alguno de los creditos.

                        const credito = eleccion === 1 ? sDos.cbu : sDos.haberes;
                        const msj = `📄 *Detalle crédito ${credito.metodo}:*\n💰 Sacado: $${credito.montoSacado}\n📊 Cuota: ${credito.cuotasPagas}/${credito.cuotasTotales}\n💵 Valor cuota: $${credito.montoCuota}\n\n1️⃣ Ver el otro crédito\n2️⃣ Hablar con asesor\n3️⃣ Salir`;

                        sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                        guardarEstados();
                        return client.sendText(telefono, msj);

                    } else if (eleccion === 3) { // Eligio hablar con asesor.
                        await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 4) { // Eligio salir.
                        await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                        delete estadoUsuarios[telefono]; 
                        guardarEstados();
                    }
                    break;

                // PANEL EXTRA DESPUES DE VER A DETALLE UN CRÉDITO ACTIVO, DONDE SE LE DA LA OPCION DE VER EL OTRO CREDITO O HABLAR CON ASESOR.
                case "CONFIRMAR_EXTRA_ACTIVO":
                    const sExtra = sesion.datosSocio;
                    
                    if (sExtra.estado === 'REFI') { // SOCIO EN MORA (1: Volver, 2: Salir)
                        if (eleccion === 1) {
                            sesion.paso = "MENU_INICIAL_MORA";
                            guardarEstados();
                            return client.sendText(telefono, "¿Cómo preferís seguir?\n1️⃣ Ver opciones de pago\n2️⃣ Detalle CBU\n3️⃣ Detalle Haberes\n4️⃣ Hablar con un asesor\n5️⃣ Salir");
                        } else if (eleccion === 2) {
                            await client.sendText(telefono, "¡Gracias por contactarnos! 👋");
                            delete estadoUsuarios[telefono]; 
                            guardarEstados();
                        }
                    } else if (sExtra.haberes?.esActivo && sExtra.cbu?.esActivo) { // SOCIO 2 ACTIVOS (1: Volver, 2: Asesor, 3: Salir)
                        
                        if (eleccion === 1) {
                            sesion.paso = "MENU_DOS_ACTIVOS";
                            guardarEstados();
                            return client.sendText(telefono, "¿Qué detalle necesitás ver?\n1️⃣ Ver datos crédito CBU\n2️⃣ Ver datos crédito Haberes\n3️⃣ Hablar con un asesor\n4️⃣ Salir");
                        } else if (eleccion === 2) {
                            await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                            agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                            activarModoHumano(telefono, 1);
                        } else if (eleccion === 3) {
                            await client.sendText(telefono, "¡Gracias por contactarnos! 👋");
                            delete estadoUsuarios[telefono]; 
                            guardarEstados();
                        }
                    } else { // SOCIO 1 ACTIVO (1: Asesor, 2: Salir)
                        if (eleccion === 1) {
                            await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                            agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                            activarModoHumano(telefono, 1);
                        } else if (eleccion === 2) {
                            await client.sendText(telefono, "¡Gracias por contactarnos! 👋");
                            delete estadoUsuarios[telefono]; 
                            guardarEstados();
                        }
                    }
                    break;

                // MENU PARA NUEVOS SOCIOS O SOCIOS SIN CREDITOS.
                case "MENU_NUEVO_SOCIO":
                    if (eleccion === 1) {        // Eligio solicitar credito.

                        await client.sendText(telefono, "🚀 ¡Perfecto! Para iniciar tu solicitud, por favor enviá tu *Recibo de Haberes y Movimientos Bancarios*.\n\nUn asesor evaluará tu perfil.");
                        agregarEtiquetaSegura(client, telefono, 'CREDITO');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 2) { // Eligio hablar con asesor.

                        await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 3) { // Eligio salir.

                        await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                        delete estadoUsuarios[telefono]; 
                        guardarEstados();
                    }
                    break;
            }
        } catch (error) { // Atrapamos cualquier error.

            console.error("ERROR procesando menu:", error);
            client.sendText(telefono, "⚠️ Ocurrió un error. Por favor, enviá tu DNI de nuevo para reiniciar.");
            delete estadoUsuarios[telefono];
            guardarEstados();
        }

        // Cada vez que el usuario interactua, reseteamos el timer de inactividad.
        resetearPorInactividad(telefono);
    });
}

// FUNCIONES AUXILIARES ------------------------------------------------------------------------------------------

// Variable global para guardar los timers de inactividad de cada usuario.
let timers = {}; 

// Funcion para resetear el timer de inactividad cada vez que el usuario interactúa.
function resetearPorInactividad(telefono) {
    // Si esta en modo humano, el bot no lo borra por inactividad.
    if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") return;

    if (timers[telefono]) clearTimeout(timers[telefono]);
    timers[telefono] = setTimeout(() => {
        console.log(`Sesión expirada para ${telefono}`);
        delete estadoUsuarios[telefono];
        delete timers[telefono];
        guardarEstados();
    }, 30 * 60 * 1000);
}

// Funcion para activar el modo humano por un tiempo determinado en horas.
function activarModoHumano(telefono, horas) {
    if (timers[telefono]) clearTimeout(timers[telefono]); // Vacia el timer de inactividad normal, si es que existe.

    if (!estadoUsuarios[telefono]) estadoUsuarios[telefono] = {};
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

// Funcion para agregar etiquetas. (Solo WhatsApp Business)
async function agregarEtiquetaSegura(client, telefono, nombreEtiqueta) {
    try {
        // Trae todas las etiquetas que existen en el WhatsApp.
        const etiquetas = await client.getAllLabels();
        
        // Busca si la etiqueta ya existe.
        let etiquetaEncontrada = etiquetas.find(e => e.name.toUpperCase() === nombreEtiqueta.toUpperCase());
        
        // Si la etiqueta no existe en el WhatsApp, el bot la crea.
        if (!etiquetaEncontrada) {
            console.log(`Creando nueva ETIQUETA: ${nombreEtiqueta}`);
            etiquetaEncontrada = await client.addNewLabel(nombreEtiqueta);
        }
        
        // Le asignamos la etiqueta al chat.
        if (etiquetaEncontrada && etiquetaEncontrada.id) {
            await client.addOrRemoveLabels([telefono], [{ labelId: etiquetaEncontrada.id, type: 'add' }]);
            console.log(`ETIQUETA '${nombreEtiqueta}' agregada con éxito a ${telefono}`);
        }
    } 
    catch (error) {
        console.log(`ERROR al gestionar la etiqueta '${nombreEtiqueta}'. Detalle:`, error.message);
    }
}

// Futura funcion a agregar para establecer horario de funcion al bot.
function esHorarioLaboral() {
    const ahora = new Date(); // Toma la fecha/hora actual del sistema.
    const hora = ahora.getHours(); // Saca solo la hora (0 a 23).
    return hora >= 10 && hora < 17; // Devuelve true si esta en el rango, false si no.
}


