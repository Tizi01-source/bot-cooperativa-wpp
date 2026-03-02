const fs = require('fs');

const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
});

const motorDelBot = require('./configuracion');

// Logica de persistencia

const ARCHIVO_ESTADOS = './estados.json';

//funcion para guardar datos en el disco
function guardarEstados() {
    const datosEnTexto = JSON.stringify(estadoUsuarios, null, 2);
    fs.writeFileSync(ARCHIVO_ESTADOS, datosEnTexto);
}   

//funcion para cargar datos desde el disco al arrancar
function cargarEstados() {
    if (fs.existsSync(ARCHIVO_ESTADOS)) {
        const contenido = fs.readFileSync(ARCHIVO_ESTADOS);
        return JSON.parse(contenido);
    }
    return {}; //si el archivo no existe, retornamos un objeto vacío
}

let estadoUsuarios = cargarEstados();


function iniciarChat(){
    // Preguntemos quien es el que escribe
    readline.question("¿Quién está enviando un mensaje? (Nombre): ", (nombreUsuario) => {

        // si escribe 'salir', cerramos programa
        if (nombreUsuario.toLowerCase() === 'salir') {
            console.log("Simulador de Bot finalizado. ¡Hasta luego!");
            process.exit();
        }

        //ejecutamos logica de bot para ESE usuario
        // Pero necesitamos que después de responder, vuelva a preguntar "¿Quién habla?"
        ejecutarFlujoBot(nombreUsuario);
    });
}

function ejecutarFlujoBot(telefono) {

    if (!estadoUsuarios[telefono]) {
        estadoUsuarios[telefono] = "INICIO";
        guardarEstados();
    }

    const estadoActual = estadoUsuarios[telefono];
    const menuMenu = motorDelBot[estadoActual];

    menuMenu.presentar();

    readline.question(`[Chat con ${telefono}] Tu respuesta: `, (entrada) => {
        const eleccion = parseInt(entrada);

        if (menuMenu.esValida(eleccion)) {
            const proximoEstado = menuMenu.conexiones[eleccion];

            if (proximoEstado) {
                estadoUsuarios[telefono] = proximoEstado;
                console.log(`>>> ${telefono} se movió a ${proximoEstado}`);
                guardarEstados();
            }
        } else {
            console.log("Opción no válida.");
        }

        // 4. ¡LA CLAVE! En lugar de repetir el flujo del usuario, 
        // volvemos a la "centralita" para ver si escribe otro
        console.log("\n--- Mensaje enviado. Volviendo a la central ---\n");
        iniciarChat(); 
    });
}

// Arrancamos la centralita
console.log("🤖 CENTRAL DE MENSAJES INICIADA (Escribe 'salir' para finalizar)");

iniciarChat();

