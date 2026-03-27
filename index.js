const wppconnect = require('@wppconnect-team/wppconnect'); // Traemos API WPPConnect.
const fs = require('fs'); // Traemos el modulo de Node para leer/escribir archivos. (File System). 
const motorDelBot = require('./configuracion'); // Traemos nuestro mapa de menus y conexiones.
const dotenv = require('dotenv').config(); // Para cargar variables de entorno desde un .env.
const obtenerDatosSocio = require('./baseDeDatos'); // Traemos la función para consultar datos de socios en Google Sheets.

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
    // Si no existe, devuelve un objeto vacío.
    return {}; 
}

// ARRANQUE DE WHATSAPP BOT ------------------------------------------------------------------------------------------

/* DEBUG
console.log("📂 Cargando configuración...");
console.log("✅ Menús disponibles:", Object.keys(motorDelBot));
*/

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
        const textoRecibido = (message.body || "").trim(); // Limpiamos espacios de la respuesta a opciones.

        // Si escribo yo, se silencia el bot 30 min. a ese numero para no pisarnos.
        if (message.fromMe) {
            if (!estadoUsuarios[telefono]) estadoUsuarios[telefono] = {};
            estadoUsuarios[telefono] = { paso: "HUMANO" }; 
            guardarEstados();
            activarModoHumano(telefono, 0.5); // 30 min de silencio si escribo yo.
            return; 
        }
        
        // Si el usuario ya está marcado como "HUMANO" el bot lo ignora.
        if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") { 
            return;
        }

        // Filtro de seguridad. (Ignora grupos, comunidades, estados y mensajes vacíos).
        if (
            message.isGroupMsg || 
            message.from === 'status@broadcast' || 
            message.type === 'newsletter' || // Para ignorar Canales de WhatsApp.
            !message.body ||
            message.from.includes('@g.us') // Refuerzo para cualquier tipo de grupo/comunidad.
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
        
        // Envia el mensaje de bienvenida y pide el DNI.
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
        
        // Segun el paso en el que esté, el bot interpreta la respuesta del usuario y decide qué hacer.
        const menuActual = motorDelBot[sesion.paso]; // Trae las opciones de ese menú.
        const eleccion = parseInt(textoRecibido); // Intenta convertir la respuesta del cliente, de texto a número.

        // Si la respuesta no es un número o no es una opción válida para ese menú, le avisa y no hace nada más.
        if (isNaN(eleccion) || !menuActual || !menuActual.esValida(eleccion)) {
             return client.sendText(telefono, "⚠️ Opción no válida. Por favor elegí un número válido de las opciones.");
        }

        try {
            // PANELES Y LÓGICA ----------------------------------------------------------------------------------
            switch (sesion.paso) {

                // PANEL DE CONFIRMACION DE DNI.
                case "CONFIRMAR_NUMERO_DNI":
                    if (eleccion === 1) {
                        const socio = await obtenerDatosSocio(sesion.dniTemporal);
                        if (socio) {
                            sesion.paso = "CONFIRMAR_SOCIO";
                            sesion.datosSocio = socio; 
                            guardarEstados();
                            return client.sendText(telefono, `He encontrado a: *${socio.nombre}*.\n\n¿Sos vos?\n1️⃣ Sí, soy yo\n2️⃣ No, me equivoqué de DNI`);
                        } else { // Si no encuentra el DNI, lo manda al menú de nuevo socio.
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
                    if (eleccion === 1) {
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
                            if (socio.haberes?.esActivo && socio.cbu?.esActivo) {
                                sesion.paso = "MENU_DOS_ACTIVOS"; // Si tiene ambos créditos activos.
                                msjRespuesta += `✅ Tenés dos créditos *ACTIVOS* con nosotros.\n\n¿Qué detalle necesitás ver?\n1️⃣ Ver datos crédito CBU\n2️⃣ Ver datos crédito Haberes\n3️⃣ Hablar con un asesor\n4️⃣ Salir`;
                            } else { // Si tiene solo uno de los dos créditos activos.
                                sesion.paso = "MENU_SOCIO_ACTIVO";
                                const activo = socio.haberes?.esActivo ? socio.haberes : socio.cbu;
                                msjRespuesta += `✅ Tenés un crédito *ACTIVO* por *${activo.metodo}*.\n📊 *Progreso:* Cuota ${activo.cuotasPagas} de ${activo.cuotasTotales}\n\n`;

                                // Segun el crédito activo, le ofrece la opción de solicitar el otro.
                                let oferta = "";
                                if (socio.haberes && !socio.cbu) oferta = `2️⃣ Solicitar crédito por CBU\n`;
                                else if (socio.cbu && !socio.haberes) oferta = `2️⃣ Solicitar crédito Haberes\n`;

                                msjRespuesta += `¿En qué podemos ayudarte?\n1️⃣ Hablar con un asesor\n${oferta}`;
                                msjRespuesta += oferta !== "" ? `3️⃣ Ver más detalles\n4️⃣ Salir` : `2️⃣ Ver más detalles\n3️⃣ Salir`;
                            }
                        } 
                        // PANEL CANCELADO O SIN CRÉDITOS.
                        else {
                            sesion.paso = "MENU_NUEVO_SOCIO";
                            msjRespuesta += motorDelBot["MENU_NUEVO_SOCIO"].mensaje;
                        }

                        guardarEstados();
                        return client.sendText(telefono, msjRespuesta);
                    } else { // Si elige que no es él, lo regresa al paso inicial.
                        sesion.paso = "BIENVENIDA";
                        delete sesion.datosSocio;
                        guardarEstados();
                        return client.sendText(telefono, "Entendido. Por favor, volvé a escribir tu DNI correctamente:");
                    }

                // FUNCIONALIDAD DE LOS MENÚS SEGÚN EL ESTADO DEL SOCIO.
                case "MENU_INICIAL_MORA":
                    const socioMora = sesion.datosSocio;
                    if (eleccion === 1) { // Si elige ver opciones de pago.
                        sesion.paso = "PANEL_DEUDA";
                        guardarEstados();

                        // Calculamos los planes de pago según la deuda total, y se los mostramos al socio.
                        const d = socioMora.deudaTotal;
                        return client.sendText(telefono, `${motorDelBot["PANEL_DEUDA"].mensaje}1️⃣ 10 cuotas de $${(d/10).toFixed(2)}\n2️⃣ 5 cuotas de $${(d/5).toFixed(2)}\n3️⃣ 2 cuotas de $${(d/2).toFixed(2)}\n4️⃣ 1 pago de $${d.toFixed(2)}`);

                    } else if (eleccion === 2 || eleccion === 3) { // Si elige ver detalle de alguno de los créditos.
                        const credito = eleccion === 2 ? socioMora.cbu : socioMora.haberes;

                        // Verificamos que el crédito que quiere ver sea el que tiene en mora.
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

                // PANEL PARA SOCIOS CON UN CRÉDITO ACTIVO.
                case "MENU_SOCIO_ACTIVO":
                    // Para no repetir código, identificamos cuál es el crédito activo (si solo tiene uno) y guardamos esa info en una variable.
                    const sActivo = sesion.datosSocio;
                    const tieneSoloUno = !sActivo.tieneAmbos;
                    const credActivo = (sActivo.haberes && sActivo.haberes.esActivo) ? sActivo.haberes : sActivo.cbu;

                    
                    if (eleccion === 1) {        // Eligió hablar con asesor.
                        await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 2) { // Eligió solicitar el otro crédito o ver más detalles.
                        if (tieneSoloUno) { // Si solo tiene un crédito activo, la opción 2 es para solicitar el otro.
                            await client.sendText(telefono, "🚀 ¡Excelente elección! Para evaluar tu nueva solicitud enviá tu *Recibo de Haberes y Movimientos Bancarios*.");
                            agregarEtiquetaSegura(client, telefono, 'CREDITO');
                            activarModoHumano(telefono, 1);
                        } else {            // Si tiene ambos créditos activos, la opción 2 es para ver más detalles.
                            const msjDetalle = `📄 *Detalle de tu crédito:* \n📅 *Fecha:* ${credActivo.fecha}\n💰 *Monto:* $${credActivo.montoSacado}\n📊 *Cuotas:* ${credActivo.cuotasPagas}/${credActivo.cuotasTotales}\n\n1️⃣ Hablar con asesor\n2️⃣ Finalizar consulta`;
                            sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                            guardarEstados();
                            return client.sendText(telefono, msjDetalle);
                        }
                    } else if (eleccion === 3) { // Eligió ver más detalles o salir.
                        if (tieneSoloUno) { // Si solo tiene un crédito activo, la opción 3 es para salir.
                            const msjDetalle = `📄 *Detalle de tu crédito:* \n📅 *Fecha:* ${credActivo.fecha}\n💰 *Monto:* $${credActivo.montoSacado}\n📊 *Cuotas:* ${credActivo.cuotasPagas}/${credActivo.cuotasTotales}\n\n1️⃣ Hablar con asesor\n2️⃣ Finalizar consulta`;
                            sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                            guardarEstados();
                            return client.sendText(telefono, msjDetalle);
                        } else {            // Si tiene ambos créditos activos, la opción 3 es para hablar con asesor.
                            await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                            delete estadoUsuarios[telefono];
                            guardarEstados();
                        }
                    } else if (eleccion === 4 && tieneSoloUno) { // Eligió salir (solo aparece si tiene uno).
                        await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                        delete estadoUsuarios[telefono];
                        guardarEstados();
                    }
                    break;

                // PANEL PARA SOCIOS CON DOS CRÉDITOS ACTIVOS.
                case "MENU_DOS_ACTIVOS":
                    // Para no repetir código, identificamos cuál es cada crédito y guardamos esa info en variables.
                    const sDos = sesion.datosSocio;

                    if (eleccion === 1 || eleccion === 2) { // Eligió ver detalle de alguno de los créditos.

                        const credito = eleccion === 1 ? sDos.cbu : sDos.haberes;
                        const msj = `📄 *Detalle crédito ${credito.metodo}:*\n💰 Sacado: $${credito.montoSacado}\n📊 Cuota: ${credito.cuotasPagas}/${credito.cuotasTotales}\n💵 Valor cuota: $${credito.montoCuota}\n\n1️⃣ Ver el otro crédito\n2️⃣ Hablar con asesor\n3️⃣ Salir`;

                        sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                        guardarEstados();
                        return client.sendText(telefono, msj);

                    } else if (eleccion === 3) { // Eligió hablar con asesor.
                        await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 4) { // Eligió salir.
                        await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                        delete estadoUsuarios[telefono]; 
                        guardarEstados();
                    }
                    break;

                // PANEL EXTRA DESPUES DE VER A DETALLE UN CRÉDITO ACTIVO, DONDE SE LE DA LA OPCIÓN DE VER EL OTRO CRÉDITO O HABLAR CON ASESOR.
                case "CONFIRMAR_EXTRA_ACTIVO":
                    const sExtra = sesion.datosSocio;
                    if (eleccion === 1) { // Eligió ver opciones de pago o ver el otro crédito.
                        if (sExtra.estado === 'REFI') { // Si el socio está en mora, lo lleva al menú de mora.
                            sesion.paso = "MENU_INICIAL_MORA";
                            guardarEstados();
                            return client.sendText(telefono, "¿Cómo preferís seguir?\n1️⃣ Ver opciones de pago\n2️⃣ Detalle CBU\n3️⃣ Detalle Haberes\n4️⃣ Asesor\n5️⃣ Salir");
                        } else if (sExtra.haberes?.esActivo && sExtra.cbu?.esActivo) { // Si el socio tiene ambos créditos activos, lo regresa al menú de activos para que elija qué crédito quiere ver.
                            sesion.paso = "MENU_DOS_ACTIVOS";
                            guardarEstados();
                            return client.sendText(telefono, "¿Qué detalle necesitás ver?\n1️⃣ Ver datos crédito CBU\n2️⃣ Ver datos crédito Haberes\n3️⃣ Asesor\n4️⃣ Salir");
                        } else { // Eligio hablar con asesor.
                            await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                            agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                            activarModoHumano(telefono, 2);
                        }
                    } else if (eleccion === 2) { // Eligió salir.
                        await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                        delete estadoUsuarios[telefono]; 
                        guardarEstados();
                    }
                    break;

                // MENU PARA NUEVOS SOCIOS O SOCIOS SIN CRÉDITOS.
                case "MENU_NUEVO_SOCIO":
                    if (eleccion === 1) {        // Eligió solicitar crédito.
                        await client.sendText(telefono, "🚀 ¡Perfecto! Para iniciar tu solicitud, por favor enviá tu *Recibo de Haberes y Movimientos Bancarios*.\n\nUn asesor evaluará tu perfil.");
                        agregarEtiquetaSegura(client, telefono, 'CREDITO');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 2) { // Eligió hablar con asesor.
                        await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 3) { // Eligió salir.
                        await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                        delete estadoUsuarios[telefono]; 
                        guardarEstados();
                    }
                    break;
            }
        } catch (error) { // Atrapamos cualquier error inesperado.
            console.error("Error procesando menú:", error);
            client.sendText(telefono, "⚠️ Ocurrió un error. Por favor, enviá tu DNI de nuevo para reiniciar.");
            delete estadoUsuarios[telefono];
            guardarEstados();
        }

        // Cada vez que el usuario interactúa, reseteamos el timer de inactividad.
        resetearPorInactividad(telefono);
    });
}

// FUNCIONES AUXILIARES ------------------------------------------------------------------------------------------

// Variable global para guardar los timers de inactividad de cada usuario.
let timers = {}; 

// Funcion para resetear el timer de inactividad cada vez que el usuario interactúa.
function resetearPorInactividad(telefono) {
    // Si está en modo humano, el bot no lo borra por inactividad.
    if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") return;

    if (timers[telefono]) clearTimeout(timers[telefono]);
    timers[telefono] = setTimeout(() => {
        console.log(`[LIMPIEZA] Sesión expirada para ${telefono}`);
        delete estadoUsuarios[telefono];
        delete timers[telefono];
        guardarEstados();
    }, 30 * 60 * 1000);
}

// Funcion para activar el modo humano por un tiempo determinado (en horas).
function activarModoHumano(telefono, horas) {
    if (timers[telefono]) clearTimeout(timers[telefono]);

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

// Función segura para agregar etiquetas sin romper el bot
async function agregarEtiquetaSegura(client, telefono, etiqueta) {
    try {
        await client.addLabel(telefono, etiqueta);
    } catch (error) {
        console.log(`[AVISO] No se pudo agregar la etiqueta '${etiqueta}' a ${telefono}. Verifica si usas WA Business o si la etiqueta existe.`);
    }
}

// Futura incorporacion a agregar de establecer horario de funcion el bot, a analizar.
function esHorarioLaboral() {
    const ahora = new Date(); // Toma la fecha/hora actual del sistema.
    const hora = ahora.getHours(); // Saca solo la hora (0 a 23).
    return hora >= 10 && hora < 17; // Devuelve true si está en el rango, false si no.
}


