const { obtenerDatosSocio } = require('./baseDeDatos');

async function test() {
    console.log("🔍 Buscando socio...");
    
    const dniPrueba = '44567201'; 
    const resultado = await obtenerDatosSocio(dniPrueba);

    if (resultado) {
        console.log("✅ Socio encontrado:");
        console.log(`Nombre: ${resultado.nombre}`);
        console.log(`Estado: ${resultado.estado}`);
        console.log(`Deuda: ${resultado.deuda}`);
    } else {
        console.log("❌ No se encontró ningún socio con ese DNI.");
    }
}

test();