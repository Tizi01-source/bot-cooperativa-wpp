const PasoMenu = require('./PasoMenu');

// MENÚ INICIAL DE ADMINISTRACIÓN.
const menuBienvenidaAdmin = new PasoMenu(
    "BIENVENIDA_ADMIN",
    "¡Hola! Te comunicaste con la *Administración* de MAYCOOP. 👋\n\n¿En qué podemos ayudarte hoy?\n1️⃣ Soy socio / Quiero hacer un trámite\n2️⃣ Envío de Legajo firmado\n3️⃣ Inversores, Proveedores u otros",
    [1, 2, 3]
);

const menuBienvenida = new PasoMenu(
    "BIENVENIDA",
    "Para poder acceder a tu perfil, por favor escribí tu *DNI* (solo números, sin puntos ni espacios):",
    [] 
);

const pasoConfirmarNumero = new PasoMenu("CONFIRMAR_NUMERO_DNI", "", [1, 2]);
const pasoConfirmarSocio = new PasoMenu("CONFIRMAR_SOCIO", "", [1, 2]);

// MENÚS DE SOCIOS.
const menuInicialMora = new PasoMenu("MENU_INICIAL_MORA", "", [1, 2, 3, 4, 5, 6]);
const panelDeuda = new PasoMenu("PANEL_DEUDA", "Podemos ofrecerte las siguientes opciones de pago:\n\n", [1, 2, 3, 4]);
const menuSocioActivo = new PasoMenu("MENU_SOCIO_ACTIVO", "", [1, 2, 3, 4, 5]);
const menuDosActivos = new PasoMenu("MENU_DOS_ACTIVOS", "", [1, 2, 3, 4, 5]);
const pasoExtraActivo = new PasoMenu("CONFIRMAR_EXTRA_ACTIVO", "", [1, 2, 3]);

const menuNuevoSocio = new PasoMenu(
    "MENU_NUEVO_SOCIO",
    "Actualmente no registramos créditos activos a tu nombre.\n\n¿En qué podemos ayudarte?\n1️⃣ Solicitar un crédito\n2️⃣ Hablar con un asesor\n3️⃣ Solicitar Libre de Deuda\n4️⃣ Salir",
    [1, 2, 3, 4]
);

// Conexion de ID con Paneles.
const motorDelBot = {
    "BIENVENIDA_ADMIN": menuBienvenidaAdmin,
    "BIENVENIDA": menuBienvenida,
    "CONFIRMAR_NUMERO_DNI": pasoConfirmarNumero,
    "CONFIRMAR_SOCIO": pasoConfirmarSocio,
    "MENU_INICIAL_MORA": menuInicialMora,
    "PANEL_DEUDA": panelDeuda,
    "MENU_SOCIO_ACTIVO": menuSocioActivo,
    "MENU_DOS_ACTIVOS": menuDosActivos,
    "CONFIRMAR_EXTRA_ACTIVO": pasoExtraActivo,
    "MENU_NUEVO_SOCIO": menuNuevoSocio
};

module.exports = motorDelBot;