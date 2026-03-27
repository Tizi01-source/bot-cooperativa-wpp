const wppconnect = require('@wppconnect-team/wppconnect'); // Traemos API WPPConnect
const fs = require('fs'); // Traemos el modulo de Node para leer/escribir archivos (File System)
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
            console.log("🚫 Mensaje enviado por mí (Bot). Ignoro.");

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
        
        // --- PASO: BIENVENIDA: PROCESAR DNI ---
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
        
        // --- PROCESA MENÚS ---
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
                        return client.sendText(telefono, "Hola! Bienvenido a la Cooperativa MAYCOOP.\n\n" + motorDelBot["MENU_NUEVO_SOCIO"].mensaje);
                    }
                } else {
                    // Si el socio indica que escribio mal, volvemos al inicio.
                    sesion.paso = "BIENVENIDA";
                    delete sesion.dniTemporal;
                    guardarEstados();
                    return client.sendText(telefono, "Entendido. Por favor, volvé a escribir tu DNI correctamente:");
                }
            }

            // Si el socio confirma su identidad, chequeamos su estado y cruzamos CBU/Haberes
            if (sesion.paso === "CONFIRMAR_SOCIO") {
                if (eleccion === 1) {
                    const socio = sesion.datosSocio;
                    let msjRespuesta = `¡Perfecto ${socio.nombre}! 👋\n\n`;
                    
                    // --- ESCENARIO 1: TIENE DEUDA (EN UNO O EN AMBOS) ---
                    if (socio.estado === 'REFI') {
                        sesion.paso = "MENU_INICIAL_MORA";
                        
                        // Si tiene deuda en ambos, mostramos el total
                        if (socio.haberes?.esMora && socio.cbu?.esMora) {
                            msjRespuesta += `⚠️ *Atención:* Registramos deuda en tus créditos por *CBU y Haberes*.\n`;
                            msjRespuesta += `💰 *Deuda Total:* $${socio.deudaTotal.toFixed(2)}\n`;
                        } else {
                            // Buscamos cuál es el que tiene la deuda específicamente
                            const creditoMora = socio.haberes?.esMora ? socio.haberes : socio.cbu;
                            
                            // Si por alguna razón técnica creditoMora es null pero el estado es REFI, 
                            // usamos una descripción genérica para no romper el bot
                            const metodoNombre = creditoMora?.metodo || "tu cuenta";
                            const montoDeuda = creditoMora?.deuda || socio.deudaTotal;

                            msjRespuesta += `⚠️ *Atención:* Registramos una deuda pendiente en tu crédito por *${metodoNombre}*.\n`;
                            msjRespuesta += `💰 *Monto adeudado:* $${montoDeuda.toFixed(2)}\n`;
                            
                            if (socio.tieneAmbos && !creditoMora?.esMora) {
                                msjRespuesta += `✅ Tu otra línea de crédito se encuentra al día.\n`;
                            }
                        }

                        msjRespuesta += `\n¿Cómo preferís seguir?\n\n`;
                        msjRespuesta += `1️⃣ Ver opciones de pago (Panel)\n`;
                        msjRespuesta += `2️⃣ Detalle deuda CBU\n`;
                        msjRespuesta += `3️⃣ Detalle deuda Haberes\n`;
                        msjRespuesta += `4️⃣ Hablar con un asesor\n`;
                        msjRespuesta += `5️⃣ Salir`;
                    } 
                    
                    // --- ESCENARIO 2: ESTÁ AL DÍA (ACTIVO) ---
                    else if (socio.estado === 'ACTIVO') {
                        if (socio.tieneAmbos && socio.haberes?.esActivo && socio.cbu?.esActivo) {
                            // CASO DOBLE ACTIVO
                            sesion.paso = "MENU_DOS_ACTIVOS"; 
                            msjRespuesta += `✅ Tenés dos créditos *ACTIVOS* con nosotros.\n\n`;
                            msjRespuesta += `¿Qué detalle necesitás ver?\n\n`;
                            msjRespuesta += `1️⃣ Ver datos crédito CBU\n`;
                            msjRespuesta += `2️⃣ Ver datos crédito Haberes\n`;
                            msjRespuesta += `3️⃣ Hablar con un asesor\n`;
                            msjRespuesta += `4️⃣ Salir`;
                        } else {
                            // CASO UN SOLO ACTIVO (con o sin oferta comercial)
                            sesion.paso = "MENU_SOCIO_ACTIVO";
                            const activo = socio.haberes?.esActivo ? socio.haberes : socio.cbu;
                            msjRespuesta += `✅ Tenés un crédito *ACTIVO* por *${activo.metodo}*.\n`;
                            msjRespuesta += `📊 *Progreso:* Cuota ${activo.cuotasPagas} de ${activo.cuotasTotales}\n\n`;

                            let oferta = "";
                            if (socio.haberes && !socio.cbu) {
                                msjRespuesta += `💡 *Dato:* ¿Sabías que también podés solicitar un crédito por *CBU*?\n\n`;
                                oferta = `2️⃣ Solicitar crédito por CBU\n`;
                            } else if (socio.cbu && !socio.haberes) {
                                msjRespuesta += `💡 *Dato:* ¡También tenemos disponible la línea por *Haberes/Ampeal*!\n\n`;
                                oferta = `2️⃣ Solicitar crédito Haberes\n`;
                            }

                            msjRespuesta += `¿En qué podemos ayudarte?\n1️⃣ Hablar con un asesor\n${oferta}`;
                            msjRespuesta += oferta !== "" ? `3️⃣ Ver más detalles\n4️⃣ Salir` : `2️⃣ Ver más detalles\n3️⃣ Salir`;
                        }
                    } 
                    else {
                        sesion.paso = "MENU_NUEVO_SOCIO";
                        msjRespuesta += motorDelBot["MENU_NUEVO_SOCIO"].mensaje;
                    }

                    guardarEstados();
                    return client.sendText(telefono, msjRespuesta);
                }
            }


            // Paneles de Deuda.
            if (sesion.paso === "MENU_INICIAL_MORA") {
                const socio = sesion.datosSocio;

                if (eleccion === 1) { // Panel de pagos
                    sesion.paso = "PANEL_DEUDA";
                    guardarEstados();
                    const msjCuotas = `${motorDelBot["PANEL_DEUDA"].mensaje}` +
                                     `1️⃣ 10 cuotas de $${(socio.deudaTotal / 10).toFixed(2)}\n` +
                                     `2️⃣ 5 cuotas de $${(socio.deudaTotal / 5).toFixed(2)}\n` +
                                     `3️⃣ 2 cuotas de $${(socio.deudaTotal / 2).toFixed(2)}\n` +
                                     `4️⃣ 1 pago de $${socio.deudaTotal.toFixed(2)}`;
                    return client.sendText(telefono, msjCuotas);
                } 
                else if (eleccion === 2 || eleccion === 3) { // Detalle CBU o Haberes
                    const credito = eleccion === 2 ? socio.cbu : socio.haberes;
                    if (!credito) return client.sendText(telefono, "No registramos esa línea de crédito. Elegí otra opción:");
                    
                    const msj = `📄 *Detalle crédito ${credito.metodo}:*\n\n` +
                                `Estado: ${credito.estadoOriginal}\n` +
                                `Deuda: $${credito.deuda.toFixed(2)}\n` +
                                `Cuotas: ${credito.cuotasPagas}/${credito.cuotasTotales}\n\n` +
                                `1️⃣ Volver a opciones de pago\n2️⃣ Salir`;
                    sesion.paso = "CONFIRMAR_EXTRA_ACTIVO"; // Reusamos este paso para volver o salir
                    guardarEstados();
                    return client.sendText(telefono, msj);
                }
                // ... (tus opciones de asesor y salir igual)
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
                const socio = sesion.datosSocio;
                const tieneSoloUno = !socio.tieneAmbos;
                // Buscamos el que esté activo para mostrarlo en "Ver Detalles"
                const activo = (socio.haberes && socio.haberes.esActivo) ? socio.haberes : socio.cbu;

                if (eleccion === 1) { // 1 siempre es ASESOR
                    await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                    await client.addLabel(telefono, 'CONSULTA');
                    activarModoHumano(telefono, 1);
                } 
                
                else if (eleccion === 2) {
                    if (tieneSoloUno) {
                        // Caso 1 crédito: El 2 es SOLICITAR
                        await client.sendText(telefono, "🚀 ¡Excelente elección! Para evaluar tu nueva solicitud, por favor enviá tu *Recibo de Haberes y Movimientos Bancarios*.");
                        await client.addLabel(telefono, 'CREDITO');
                        activarModoHumano(telefono, 1);
                    } else {
                        // Caso 2 créditos: El 2 es DETALLES
                        const msjDetalle = `📄 *Detalle de tu crédito:* \n\n` +
                                        `💰 *Monto:* $${activo.montoSacado}\n` +
                                        `📅 *Fecha:* ${activo.fecha || 'N/A'}\n` +
                                        `📊 *Progreso:* Cuota ${activo.cuotasPagas} de ${activo.cuotasTotales}\n\n` +
                                        `1️⃣ Hablar con un asesor\n2️⃣ Finalizar consulta`;
                        sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                        guardarEstados();
                        return client.sendText(telefono, msjDetalle);
                    }
                } 
                
                else if (eleccion === 3) {
                    if (tieneSoloUno) {
                        // Caso 1 crédito: El 3 es DETALLES
                        const msjDetalle = `📄 *Detalle de tu crédito:* \n\n` +
                                        `💰 *Monto:* $${activo.montoSacado}\n` +
                                        `📅 *Fecha:* ${activo.fecha || 'N/A'}\n` +
                                        `📊 *Progreso:* Cuota ${activo.cuotasPagas} de ${activo.cuotasTotales}\n\n` +
                                        `1️⃣ Hablar con un asesor\n2️⃣ Finalizar consulta`;
                        sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                        guardarEstados();
                        return client.sendText(telefono, msjDetalle);
                    } else {
                        // Caso 2 créditos: El 3 es SALIR
                        await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                        delete estadoUsuarios[telefono];
                        guardarEstados();
                    }
                } 
                
                else if (eleccion === 4 && tieneSoloUno) { 
                    // Caso 1 crédito: El 4 es SALIR
                    await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                    delete estadoUsuarios[telefono];
                    guardarEstados();
                }
                return;
            }

            if (sesion.paso === "MENU_DOS_ACTIVOS") {
                const socio = sesion.datosSocio;
                if (eleccion === 1 || eleccion === 2) {
                    const credito = eleccion === 1 ? socio.cbu : socio.haberes;
                    const msj = `📄 *Detalle crédito ${credito.metodo}:*\n\n` +
                                `💰 Sacado: $${credito.montoSacado}\n` +
                                `📊 Cuota: ${credito.cuotasPagas} de ${credito.cuotasTotales}\n` +
                                `💵 Valor cuota: $${credito.montoCuota}\n\n` +
                                `1️⃣ Ver el otro crédito\n2️⃣ Hablar con asesor\n3️⃣ Salir`;
                    sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                    guardarEstados();
                    return client.sendText(telefono, msj);
                } 
                else if (eleccion === 3) { // ASESOR
                    await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                    await client.addLabel(telefono, 'CONSULTA');
                    activarModoHumano(telefono, 1);
                } 
                else if (eleccion === 4) { // SALIR
                    await client.sendText(telefono, "¡Gracias por consultarnos! 👋");
                    delete estadoUsuarios[telefono]; 
                    guardarEstados();
                }
                return;
            }

            // Menu extra para socios activos que quieren hablar con asesor o finalizar después de consultar su crédito.
            if (sesion.paso === "CONFIRMAR_EXTRA_ACTIVO") {
                const socio = sesion.datosSocio;

                if (eleccion === 1) { 
                    // Si viene de MORA, vuelve al menú de mora
                    if (socio.estado === 'REFI') {
                        sesion.paso = "MENU_INICIAL_MORA";
                        guardarEstados();
                        // Re-enviamos el menú de mora (puedes copiar el texto del bloque REFI)
                        return client.sendText(telefono, "¿Cómo preferís seguir?\n1️⃣ Ver opciones de pago\n2️⃣ Detalle CBU\n3️⃣ Detalle Haberes\n4️⃣ Asesor\n5️⃣ Salir");
                    } 
                    // Si tiene dos activos, vuelve al menú de selección de activos
                    else if (socio.haberes?.esActivo && socio.cbu?.esActivo) {
                        sesion.paso = "MENU_DOS_ACTIVOS";
                        guardarEstados();
                        return client.sendText(telefono, "¿Qué detalle necesitás ver?\n1️⃣ Ver datos crédito CBU\n2️⃣ Ver datos crédito Haberes\n3️⃣ Asesor\n4️⃣ Salir");
                    }
                    // Si solo tiene uno, lo mandamos con un asesor (porque ya vio sus detalles)
                    else {
                        await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                        await client.addLabel(telefono, 'CONSULTA');
                        activarModoHumano(telefono, 2);
                    }
                } else if (eleccion === 2) { 
                    // Finalizar consulta
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

// Futura incorporacion a agregar de establecer horario de funcion el bot, a analizar.
function esHorarioLaboral() {
    const ahora = new Date(); // Toma la fecha/hora actual del sistema.
    const hora = ahora.getHours(); // Saca solo la hora (0 a 23).
    return hora >= 10 && hora < 17; // Devuelve true si está en el rango, false si no.
}


