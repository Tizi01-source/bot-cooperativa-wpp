const PasoMenu = require('./PasoMenu');

const menuBienvenida = new PasoMenu (
    "BIENVENIDA",   
    "¡Hola! 👋 Soy el asistente de la Cooperativa.\n\nPor favor, *escribí tu DNI* (solo números) para que pueda buscar tu información.", 
    [] 
)

const menuSocio = new PasoMenu (
    "MENU_SOCIO",
    "", // El mensaje lo armaremos dinámicamente en el index.js
    [0, 1, 2, 3]
)

const menuMetodos = new PasoMenu (
    "METODOS",
    "🏦 *Datos para transferencia:*\n\n*Alias:* MAYCOOPBAPRO\n*Banco:* Banco Provincia\n\nMarcá 0 para volver al menú anterior.",
    [0]
);

const menuPlanesDetalle = new PasoMenu(
    "PLANES_DETALLE",
    "", // Se arma dinámicamente
    [0, 1, 2, 3]
);


const motorDelBot = {
    "BIENVENIDA": menuBienvenida,
    "MENU_SOCIO": menuSocio,
    "METODOS": menuMetodos,
    "PLANES_DETALLE": menuPlanesDetalle
};



// Conexiones
menuSocio.conectar(2, "METODOS");
menuMetodos.conectar(0, "MENU_SOCIO");

module.exports = motorDelBot;