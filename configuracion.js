const PasoMenu = require('./PasoMenu');

const menuPrincipal = new PasoMenu (
    "INICIO",   
    "Hola! Marcá 1 para Ventas o 2 para Soporte", 
    [1, 2] 
)

const menuVentas = new PasoMenu (
    "VENTAS",
    "Has ingresado a Ventas. 1. Comprar Software, 2. Comprar Hardware, 0. Volver",
    [0, 1, 2]
)

const menuSoporte = new PasoMenu (
    "SOPORTE",
    "Área de Soporte: 1. Reclamos, 0. Volver",
    [0,1]
);

const menuCompras = new PasoMenu (
    "COMPRAS",
    "Has ingresado a Compras. 1. Comprar Software, 2. Comprar Hardware, 0. Volver",
    [0, 1, 2]
)

const motorDelBot = {
    "INICIO": menuPrincipal,
    "VENTAS": menuVentas,
    "SOPORTE" : menuSoporte,
    "COMPRAS" : menuCompras
}

menuPrincipal.conectar(1, "VENTAS"); 
menuPrincipal.conectar(2, "SOPORTE");
menuVentas.conectar(0, "INICIO");
menuSoporte.conectar(0, "INICIO");
menuCompras.conectar(0, "INICIO");
menuVentas.conectar(1, "COMPRAS");
menuVentas.conectar(2, "COMPRAS");

module.exports = motorDelBot;