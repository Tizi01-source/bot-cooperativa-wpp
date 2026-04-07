const wppconnect = require('@wppconnect-team/wppconnect'); 
const fs = require('fs'); 
const motorDelBot = require('./configuracion-admin'); 
const dotenv = require('dotenv').config(); 
const obtenerDatosSocio = require('./baseDeDatos');

// LOGICA DE PERSISTENCIA----------------------------------------------------------------------------------------

const ARCHIVO_ESTADOS = './estados-admin.json'; 
let estadoUsuarios = cargarEstados(); 

function guardarEstados() {
    fs.writeFileSync(ARCHIVO_ESTADOS, JSON.stringify(estadoUsuarios, null, 2));
}   

function cargarEstados() {
    if (fs.existsSync(ARCHIVO_ESTADOS)) {
        return JSON.parse(fs.readFileSync(ARCHIVO_ESTADOS, 'utf-8'));
    }
    return {}; 
}

// ARRANQUE DE WHATSAPP BOT ------------------------------------------------------------------------------------------

wppconnect.create({
    session: 'sesion-admin', 
    puppeteerOptions: {
        args: ['--no-sandbox', 
            '--disable-accelerated-2d-canvas', 
            '--no-first-run', 
            '--no-zygote', 
            '--single-process', 
            '--disable-dev-shm-usage', 
            '--disable-setuid-sandbox']
    },
    statusFind: (statusSession, session) => {
        console.log('Estado de la Sesión Admin: ', statusSession);
    },
    catchQR: (base64Qrimg, asciiQR) => {
        console.log(asciiQR); 
    },
})
.then((client) => start(client)) 
.catch((error) => console.log(error)); 


// FUNCION PRINCIPAL DEL BOT ------------------------------------------------------------------------------------------

function start(client) {
    console.log("🤖 BOT DE ADMINISTRACIÓN INICIADO");

    const sendTextOriginal = client.sendText.bind(client);
    client.sendText = async (to, content, options) => {
        return sendTextOriginal(to, content + '\u200D', options); 
    };
    
    client.onAnyMessage(async (message) => {
        const telefono = message.fromMe ? message.to : message.from;   
        const textoRecibido = typeof message.body === 'string' ? message.body.trim() : "";

        if (message.fromMe) {
            if (typeof message.body === 'string' && message.body.includes('\u200D')) {
                return; 
            }

            if (!estadoUsuarios[telefono]) estadoUsuarios[telefono] = {};
            estadoUsuarios[telefono].paso = "HUMANO"; 
            guardarEstados();
            activarModoHumano(telefono, 0.5); 
            console.log(`👤 MODO HUMANO activado con: ${telefono}`);
            return; 
        }
        
        if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") { 
            return;
        }

        if (
            message.isGroupMsg || 
            message.from === 'status@broadcast' || 
            message.type === 'newsletter' || 
            !message.body ||
            message.from.includes('@g.us') 
        ) {
            return; 
        }
        
        if (!estadoUsuarios[telefono]) {
            estadoUsuarios[telefono] = { paso: "BIENVENIDA_ADMIN" };
            guardarEstados();
            return client.sendText(telefono, motorDelBot["BIENVENIDA_ADMIN"].mensaje); 
        }
        
        let sesion = estadoUsuarios[telefono]; 
        
        if (sesion.paso === "BIENVENIDA") {
            const dniLimpio = textoRecibido.replace(/\D/g, ''); 
            if (dniLimpio.length < 7 || dniLimpio.length > 9) {
                return client.sendText(telefono, "⚠️ El DNI ingresado no parece válido. Por favor, escribí solo los números:");
            }
            sesion.paso = "CONFIRMAR_NUMERO_DNI";
            sesion.dniTemporal = dniLimpio; 
            guardarEstados();
            return client.sendText(telefono, `Confirmame, ¿ingresaste el DNI: *${dniLimpio}*?\n\n1️⃣ Sí, es correcto\n2️⃣ No, lo escribí mal`);
        }
        
        const menuActual = motorDelBot[sesion.paso]; 
        const eleccion = parseInt(textoRecibido); 

        if (isNaN(eleccion) || !menuActual || !menuActual.esValida(eleccion)) {
             return client.sendText(telefono, "⚠️ Opción no válida. Por favor elegí un número de la lista.");
        }

        try {
            switch (sesion.paso) {

                case "BIENVENIDA_ADMIN":
                    if (eleccion === 1) { 
                        sesion.paso = "BIENVENIDA";
                        guardarEstados();
                        return client.sendText(telefono, motorDelBot["BIENVENIDA"].mensaje);
                    } else if (eleccion === 2) { 
                        await client.sendText(telefono, "📁 Perfecto. Por favor, enviá tu *Legajo firmado* (en formato PDF o fotos claras) por este medio.\n\nUn operador lo descargará y procesará tu solicitud a la brevedad.");
                        agregarEtiquetaSegura(client, telefono, 'LEGAJO');
                        activarModoHumano(telefono, 2);
                    } else if (eleccion === 3) { 
                        await client.sendText(telefono, "🤝 Entendido. Un operador de administración te atenderá a la brevedad.\n\nPor favor, dejanos tu mensaje o propuesta acá abajo:");
                        agregarEtiquetaSegura(client, telefono, 'TERCEROS');
                        activarModoHumano(telefono, 2);
                    }
                    break;

                case "CONFIRMAR_NUMERO_DNI":
                    if (eleccion === 1) {
                        const socio = await obtenerDatosSocio(sesion.dniTemporal);
                        if (socio) {
                            sesion.paso = "CONFIRMAR_SOCIO";
                            sesion.datosSocio = socio; 
                            guardarEstados();
                            return client.sendText(telefono, `He encontrado a: *${socio.nombre}*.\n\n¿Sos vos?\n1️⃣ Sí, soy yo\n2️⃣ No, me equivoqué de DNI`);
                        } else { 
                            sesion.paso = "MENU_NUEVO_SOCIO";
                            guardarEstados();
                            return client.sendText(telefono, "Hola! Bienvenido a la Administración de MAYCOOP.\n\n" + motorDelBot["MENU_NUEVO_SOCIO"].mensaje);
                        }
                    } else { 
                        sesion.paso = "BIENVENIDA";
                        delete sesion.dniTemporal;
                        guardarEstados();
                        return client.sendText(telefono, "Entendido. Por favor, volvé a escribir tu DNI correctamente:");
                    }

                case "CONFIRMAR_SOCIO":
                    if (eleccion === 1) {
                        const socio = sesion.datosSocio;
                        let msjRespuesta = `¡Perfecto ${socio.nombre}! 👋\n\n`;
                        
                        if (socio.estado === 'REFI') {
                            sesion.paso = "MENU_INICIAL_MORA";
                            const moraHab = socio.haberes?.esMora;
                            const moraCbu = socio.cbu?.esMora;

                            if (moraHab && moraCbu) { 
                                msjRespuesta += `⚠️ Registramos deuda en tus créditos por *CBU y Haberes*.\n💰 *Deuda Total:* $${socio.deudaTotal.toFixed(2)}\n`;
                            } else { 
                                const creditoMora = moraHab ? socio.haberes : socio.cbu;
                                msjRespuesta += `⚠️ Registramos deuda en tu crédito por *${creditoMora.metodo}*.\n💰 *Monto:* $${creditoMora.deuda.toFixed(2)}\n`;
                            }
                            msjRespuesta += `\n¿Cómo preferís seguir?\n1️⃣ Ver opciones de pago\n2️⃣ Detalle deuda CBU\n3️⃣ Detalle deuda Haberes\n4️⃣ Solicitar Libre de Deuda\n5️⃣ Hablar con un asesor\n6️⃣ Salir`;
                        
                        } else if (socio.estado === 'ACTIVO') {
                            if (socio.haberes?.esActivo && socio.cbu?.esActivo) {
                                sesion.paso = "MENU_DOS_ACTIVOS"; 
                                msjRespuesta += `✅ Tenés dos créditos *ACTIVOS* con nosotros.\n\n¿Qué detalle necesitás ver?\n1️⃣ Ver crédito CBU\n2️⃣ Ver crédito Haberes\n3️⃣ Solicitar Libre de Deuda\n4️⃣ Hablar con asesor\n5️⃣ Salir`;
                            } else { 
                                sesion.paso = "MENU_SOCIO_ACTIVO";
                                const activo = socio.haberes?.esActivo ? socio.haberes : socio.cbu;
                                msjRespuesta += `✅ Tenés un crédito *ACTIVO* por *${activo.metodo}*.\n📊 *Progreso:* Cuota ${activo.cuotasPagas} de ${activo.cuotasTotales}\n\n`;
                                msjRespuesta += `¿En qué podemos ayudarte?\n1️⃣ Solicitar otra línea de crédito\n2️⃣ Ver más detalles\n3️⃣ Solicitar Libre de Deuda\n4️⃣ Hablar con asesor\n5️⃣ Salir`;
                            }
                        } else {
                            sesion.paso = "MENU_NUEVO_SOCIO";
                            msjRespuesta += motorDelBot["MENU_NUEVO_SOCIO"].mensaje;
                        }

                        guardarEstados();
                        return client.sendText(telefono, msjRespuesta);
                    } else { 
                        sesion.paso = "BIENVENIDA";
                        delete sesion.datosSocio;
                        guardarEstados();
                        return client.sendText(telefono, "Entendido. Por favor, volvé a escribir tu DNI correctamente:");
                    }

                case "MENU_INICIAL_MORA":
                    const socioMora = sesion.datosSocio;
                    if (eleccion === 1) { 
                        sesion.paso = "PANEL_DEUDA";
                        guardarEstados();
                        const d = socioMora.deudaTotal;
                        return client.sendText(telefono, `${motorDelBot["PANEL_DEUDA"].mensaje}1️⃣ 10 cuotas de $${(d/10).toFixed(2)}\n2️⃣ 5 cuotas de $${(d/5).toFixed(2)}\n3️⃣ 2 cuotas de $${(d/2).toFixed(2)}\n4️⃣ 1 pago de $${d.toFixed(2)}`);
                    } else if (eleccion === 2 || eleccion === 3) { 
                        const credito = eleccion === 2 ? socioMora.cbu : socioMora.haberes;
                        if (!credito) return client.sendText(telefono, "No registramos esa línea de crédito. Elegí otra opción:");
                        sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                        guardarEstados();
                        return client.sendText(telefono, `📄 *Detalle ${credito.metodo}:*\nEstado: ${credito.estadoOriginal}\nDeuda: $${credito.deuda.toFixed(2)}\nCuotas: ${credito.cuotasPagas}/${credito.cuotasTotales}\n\n1️⃣ Volver a opciones de pago\n2️⃣ Salir`);
                    } else if (eleccion === 4) { 
                        await client.sendText(telefono, "✅ Solicitud registrada.\n\nUn operador validará tu estado de cuenta y te enviará tu *Libre de Deuda* por este medio.");
                        agregarEtiquetaSegura(client, telefono, 'LIBRE_DEUDA');
                        activarModoHumano(telefono, 2);
                    } else if (eleccion === 5) { 
                        await client.sendText(telefono, "Entendido. Un asesor se pondrá en contacto pronto.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 6) { 
                        await client.sendText(telefono, "¡Gracias por contactarnos! 👋");
                        delete estadoUsuarios[telefono]; 
                        guardarEstados();
                    }
                    break;

                case "PANEL_DEUDA":
                    sesion.planElegido = eleccion === 1 ? "10 cuotas" : eleccion === 2 ? "5 cuotas" : eleccion === 3 ? "2 cuotas" : "1 pago";
                    await client.sendText(telefono, `✅ Confirmado: Plan de *${sesion.planElegido}*.\n\n🏦 *Transferí al Alias:* MAYCOOPBAPRO\n\nUn asesor queda a cargo.`);
                    agregarEtiquetaSegura(client, telefono, 'MORA');
                    activarModoHumano(telefono, 1);
                    break;

                case "MENU_SOCIO_ACTIVO":
                    const sActivo = sesion.datosSocio;
                    const credActivo = (sActivo.haberes && sActivo.haberes.esActivo) ? sActivo.haberes : sActivo.cbu;

                    if (eleccion === 1) {       
                        await client.sendText(telefono, "🚀 ¡Excelente! Para evaluar tu nueva solicitud enviá tu *Recibo de Haberes y Movimientos Bancarios*.");
                        agregarEtiquetaSegura(client, telefono, 'CREDITO');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 2) { 
                        const msjDetalle = `📄 *Detalle de tu crédito:* \n📅 *Fecha:* ${credActivo.fecha}\n💰 *Monto:* $${credActivo.montoSacado}\n📊 *Cuotas:* ${credActivo.cuotasPagas}/${credActivo.cuotasTotales}\n\n1️⃣ Hablar con asesor\n2️⃣ Finalizar consulta`;
                        sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                        guardarEstados();
                        return client.sendText(telefono, msjDetalle);
                    } else if (eleccion === 3) { 
                        await client.sendText(telefono, "✅ Solicitud registrada.\n\nUn operador validará tu estado de cuenta y te enviará tu *Libre de Deuda* por este medio.");
                        agregarEtiquetaSegura(client, telefono, 'LIBRE_DEUDA');
                        activarModoHumano(telefono, 2);
                    } else if (eleccion === 4) { 
                        await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 5) { 
                        await client.sendText(telefono, "¡Gracias por contactarnos! 👋");
                        delete estadoUsuarios[telefono];
                        guardarEstados();
                    }
                    break;

                case "MENU_DOS_ACTIVOS":
                    const sDos = sesion.datosSocio;
                    if (eleccion === 1 || eleccion === 2) { 
                        const credito = eleccion === 1 ? sDos.cbu : sDos.haberes;
                        const msj = `📄 *Detalle crédito ${credito.metodo}:*\n💰 Sacado: $${credito.montoSacado}\n📊 Cuota: ${credito.cuotasPagas}/${credito.cuotasTotales}\n💵 Valor cuota: $${credito.montoCuota}\n\n1️⃣ Ver el otro crédito\n2️⃣ Hablar con asesor\n3️⃣ Salir`;
                        sesion.paso = "CONFIRMAR_EXTRA_ACTIVO";
                        guardarEstados();
                        return client.sendText(telefono, msj);
                    } else if (eleccion === 3) { 
                        await client.sendText(telefono, "✅ Solicitud registrada.\n\nUn operador validará tu estado de cuenta y te enviará tu *Libre de Deuda* por este medio.");
                        agregarEtiquetaSegura(client, telefono, 'LIBRE_DEUDA');
                        activarModoHumano(telefono, 2);
                    } else if (eleccion === 4) { 
                        await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 5) { 
                        await client.sendText(telefono, "¡Gracias por contactarnos! 👋");
                        delete estadoUsuarios[telefono]; 
                        guardarEstados();
                    }
                    break;

                case "CONFIRMAR_EXTRA_ACTIVO":
                    const sExtraAdmin = sesion.datosSocio;
                    
                    if (sExtraAdmin.estado === 'REFI') { 
                        if (eleccion === 1) {
                            sesion.paso = "MENU_INICIAL_MORA";
                            guardarEstados();
                            return client.sendText(telefono, "¿Cómo preferís seguir?\n1️⃣ Ver opciones de pago\n2️⃣ Detalle deuda CBU\n3️⃣ Detalle deuda Haberes\n4️⃣ Solicitar Libre de Deuda\n5️⃣ Hablar con un asesor\n6️⃣ Salir");
                        } else if (eleccion === 2) {
                            await client.sendText(telefono, "¡Gracias por contactarnos! 👋");
                            delete estadoUsuarios[telefono]; 
                            guardarEstados();
                        }
                    } else if (sExtraAdmin.haberes?.esActivo && sExtraAdmin.cbu?.esActivo) { 
                        if (eleccion === 1) {
                            sesion.paso = "MENU_DOS_ACTIVOS";
                            guardarEstados();
                            return client.sendText(telefono, "¿Qué detalle necesitás ver?\n1️⃣ Ver crédito CBU\n2️⃣ Ver crédito Haberes\n3️⃣ Solicitar Libre de Deuda\n4️⃣ Hablar con asesor\n5️⃣ Salir");
                        } else if (eleccion === 2) {
                            await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                            agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                            activarModoHumano(telefono, 1);
                        } else if (eleccion === 3) {
                            await client.sendText(telefono, "¡Gracias por contactarnos! 👋");
                            delete estadoUsuarios[telefono]; 
                            guardarEstados();
                        }
                    } else { 
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

                case "MENU_NUEVO_SOCIO":
                    if (eleccion === 1) {        
                        await client.sendText(telefono, "🚀 ¡Perfecto! Para iniciar tu solicitud, por favor enviá tu *Recibo de Haberes y Movimientos Bancarios*.\n\nUn asesor evaluará tu perfil.");
                        agregarEtiquetaSegura(client, telefono, 'CREDITO');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 2) { 
                        await client.sendText(telefono, "Entendido. Un asesor te atenderá a la brevedad.");
                        agregarEtiquetaSegura(client, telefono, 'CONSULTA');
                        activarModoHumano(telefono, 1);
                    } else if (eleccion === 3) { 
                        await client.sendText(telefono, "✅ Solicitud registrada.\n\nUn operador validará tu estado de cuenta y te enviará tu *Libre de Deuda* por este medio.");
                        agregarEtiquetaSegura(client, telefono, 'LIBRE_DEUDA');
                        activarModoHumano(telefono, 2);
                    } else if (eleccion === 4) { 
                        await client.sendText(telefono, "¡Gracias por contactarnos! 👋");
                        delete estadoUsuarios[telefono]; 
                        guardarEstados();
                    }
                    break;
            }
        } catch (error) { 
            console.error("Error procesando menú:", error);
            client.sendText(telefono, "⚠️ Ocurrió un error. Por favor, enviá tu DNI de nuevo para reiniciar.");
            delete estadoUsuarios[telefono];
            guardarEstados();
        }
        
        resetearPorInactividad(telefono);
    });
}

let timers = {}; 

function resetearPorInactividad(telefono) {
    if (estadoUsuarios[telefono] && estadoUsuarios[telefono].paso === "HUMANO") return;

    if (timers[telefono]) clearTimeout(timers[telefono]);
    timers[telefono] = setTimeout(() => {
        delete estadoUsuarios[telefono];
        delete timers[telefono];
        guardarEstados();
    }, 30 * 60 * 1000);
}

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

async function agregarEtiquetaSegura(client, telefono, nombreEtiqueta) {
    try {
        const etiquetas = await client.getAllLabels();
        
        let etiquetaEncontrada = etiquetas.find(e => e.name.toUpperCase() === nombreEtiqueta.toUpperCase());
        
        if (!etiquetaEncontrada) {
            console.log(`[ETIQUETAS] Creando nueva etiqueta: ${nombreEtiqueta}`);
            etiquetaEncontrada = await client.addNewLabel(nombreEtiqueta);
        }
        
        if (etiquetaEncontrada && etiquetaEncontrada.id) {
            await client.addOrRemoveLabels([telefono], [{ labelId: etiquetaEncontrada.id, type: 'add' }]);
            console.log(`✅ Etiqueta '${nombreEtiqueta}' agregada con éxito a ${telefono}`);
        }
    } catch (error) {
        console.log(`[AVISO] Error al gestionar la etiqueta '${nombreEtiqueta}'. Detalle:`, error.message);
    }
}