
// Clase para representar cada menu del bot.
class PasoMenu { 

    constructor(id, mensaje, opcionesValidas) { 
        this.id = id; // Identificacion para cada panel, como "BIENVENIDA", "PANEL_CREDITO", etc.
        this.mensaje = mensaje; // El mensaje que el bot muestra al usuario en este paso.
        this.opcionesValidas = opcionesValidas; // Las opciones que puede responder el usuario.
        this.conexiones = {}; // Conexiones entre paneles.
    }

    presentar() {
        console.log("----------------------------");
        console.log("BOT DICE: " + this.mensaje);
        console.log("----------------------------");
    }

    esValida(eleccion) {
        return this.opcionesValidas.includes(eleccion);
    }

    conectar(opcion, idDestino) {
        this.conexiones[opcion] = idDestino;
    }
}

module.exports = PasoMenu;