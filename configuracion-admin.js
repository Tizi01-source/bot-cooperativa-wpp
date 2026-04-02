const PasoMenu = require('./PasoMenu');

const motorDelBot = {
    // NUEVO MENÚ INICIAL DE ADMINISTRACIÓN
    "BIENVENIDA_ADMIN": new PasoMenu(
        "¡Hola! Te comunicaste con la *Administración* de MAYCOOP. 👋\n\n¿En qué podemos ayudarte hoy?\n1️⃣ Soy socio / Quiero hacer un trámite\n2️⃣ Envío de Legajo firmado\n3️⃣ Inversores, Proveedores u otros",
        [1, 2, 3]
    ),
    
    "BIENVENIDA": new PasoMenu(
        "Para poder acceder a tu perfil, por favor escribí tu *DNI* (solo números, sin puntos ni espacios):",
        [] 
    ),

    "CONFIRMAR_NUMERO_DNI": new PasoMenu("", [1, 2]),
    "CONFIRMAR_SOCIO": new PasoMenu("", [1, 2]),
    
    // MENÚS DE SOCIOS CON LA OPCIÓN "LIBRE DE DEUDA" AGREGADA
    "MENU_INICIAL_MORA": new PasoMenu("", [1, 2, 3, 4, 5, 6]),
    "PANEL_DEUDA": new PasoMenu("Podemos ofrecerte las siguientes opciones de pago:\n\n", [1, 2, 3, 4]),
    "MENU_SOCIO_ACTIVO": new PasoMenu("", [1, 2, 3, 4, 5]),
    "MENU_DOS_ACTIVOS": new PasoMenu("", [1, 2, 3, 4, 5]),
    "CONFIRMAR_EXTRA_ACTIVO": new PasoMenu("", [1, 2]),
    
    "MENU_NUEVO_SOCIO": new PasoMenu(
        "Actualmente no registramos créditos activos a tu nombre.\n\n¿En qué podemos ayudarte?\n1️⃣ Solicitar un crédito\n2️⃣ Hablar con un asesor\n3️⃣ Solicitar Libre de Deuda\n4️⃣ Salir",
        [1, 2, 3, 4]
    )
};

module.exports = motorDelBot;