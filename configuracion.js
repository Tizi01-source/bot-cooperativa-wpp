const PasoMenu = require('./PasoMenu');

// Mensaje Inicial.
const menuBienvenida = new PasoMenu (
    "BIENVENIDA",   
    "¡Hola! 👋 Soy el asistente de la Cooperativa MAYCOOP.\n\nPor favor, *escribí tu DNI* para que pueda buscar tu información.", 
    [] 
);

// Validacion de dni y socio en excel.
const pasoConfirmarNumero = new PasoMenu ( "CONFIRMAR_NUMERO_DNI", "", [1, 2] );
const pasoConfirmarSocio = new PasoMenu ( "CONFIRMAR_SOCIO", "", [1, 2] );

// Menú inicial para deudores (REFI).
const menuInicialMora = new PasoMenu (
    "MENU_INICIAL_MORA",
    "",
    [1, 2, 3, 4, 5]
);

// Simulador de cuotas
const panelDeuda = new PasoMenu (
    "PANEL_DEUDA",
    "Elegí un plan de pago:\n",
    [1, 2, 3, 4, 0]
);

// Menú inicial para socios (ACTIVO).
const menuSocioActivo = new PasoMenu (
    "MENU_SOCIO_ACTIVO",
    "",
    [1, 2, 3, 4]
);

// Paso extra para después de mostrar el detalle del crédito al socio activo.
const pasoExtraActivo = new PasoMenu (
    "CONFIRMAR_EXTRA_ACTIVO",
    "",
    [1, 2, 3]
);

// Menú para socios con más de un crédito ACTIVO. 
const menuDosActivos = new PasoMenu("MENU_DOS_ACTIVOS", "", [1, 2, 3, 4]);

// Menú inicial para socios CANCELADOS o NUEVOS.
const menuNuevoSocio = new PasoMenu (
    "MENU_NUEVO_SOCIO",
    "¿En qué podemos ayudarte?\n\n1️⃣ Solicitar un crédito\n2️⃣ Otras consultas (asesor)\n3️⃣ Finalizar consulta",
    [1, 2, 3]
);

//Conexion de ID con Paneles.
const motorDelBot = {
    "BIENVENIDA": menuBienvenida,
    "CONFIRMAR_NUMERO_DNI": pasoConfirmarNumero,
    "CONFIRMAR_SOCIO": pasoConfirmarSocio,
    "CONFIRMAR_EXTRA_ACTIVO": pasoExtraActivo,
    "MENU_INICIAL_MORA": menuInicialMora,
    "PANEL_DEUDA": panelDeuda,
    "MENU_SOCIO_ACTIVO": menuSocioActivo,
    "MENU_DOS_ACTIVOS": menuDosActivos,
    "MENU_NUEVO_SOCIO": menuNuevoSocio
};

// No usamos conexiones automáticas pesadas porque la segmentación ocurre en el cerebro (index.js)
module.exports = motorDelBot;