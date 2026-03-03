const PasoMenu = require('./PasoMenu');

// Punto de entrada para todos.
const menuBienvenida = new PasoMenu (
    "BIENVENIDA",   
    "¡Hola! 👋 Soy el asistente de la Cooperativa.\n\nPor favor, *escribí tu DNI* (solo números) para que pueda buscar tu información.", 
    [] 
)

// Panel de Crédito: Socios nuevos o al día, 0 deuda.
const panelCredito = new PasoMenu (
    "PANEL_CREDITO",
    "¿En qué podemos ayudarte?\n\n1️⃣ Solicitar un crédito\n2️⃣ Otras consultas",
    [1, 2]
)

// Panel de Deudas: Socios en Mora, mensaje dinamico en index.js segun deuda.
const panelDeuda = new PasoMenu (
    "PANEL_DEUDA",
    "",
    [1, 2, 3, 4, 0] // 10, 5, 2, 1, volver??????
);

// Panel metodos de pago: segunda instancia de panel de deudas.
const metodosPago = new PasoMenu(
    "METODOS_PAGO",
    "¿Cómo preferís abonar?\n\n1️⃣ Transferencia por Alias\n2️⃣ Otros métodos de pago\n\n0️⃣ Volver a planes de pago",
    [0, 1, 2]
);

const motorDelBot = {
    "BIENVENIDA": menuBienvenida,
    "PANEL_CREDITO": panelCredito,
    "PANEL_DEUDA": panelDeuda,
    "METODOS_PAGO": metodosPago
};

// No usamos conexiones automáticas pesadas porque la segmentación ocurre en el cerebro (index.js)

//Exportacion del modulo del motor del bot.
module.exports = motorDelBot;