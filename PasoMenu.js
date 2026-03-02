class PasoMenu {

    constructor(id, mensaje, opcionesValidas) {
        this.id = id;
        this.mensaje = mensaje;
        this.opcionesValidas = opcionesValidas;
        this.conexiones = {};
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