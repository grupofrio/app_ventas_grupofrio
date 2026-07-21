# Impresión térmica Bluetooth directa en MP210 — Diseño

**Fecha:** 2026-07-21

**Estado:** Diseño conversacional y revisión técnica aprobados; pendiente de aprobación final del usuario

**Plataforma inicial:** Android

## Objetivo

Permitir que KOLD Field imprima el ticket de cada venta directamente en una impresora térmica MP210 vinculada por Bluetooth, sin depender de un visor de PDF ni de una aplicación de terceros.

La primera vez, el vendedor elegirá la MP210 entre los dispositivos ya vinculados en Android. La aplicación recordará esa selección y las siguientes ventas podrán enviarse con un solo toque.

El ticket Bluetooth se rasterizará a los 384 puntos físicos del cabezal para controlar el logo, los acentos, los saltos de línea y las columnas de manera independiente de las fuentes internas de la impresora.

## Hardware confirmado y significado de “al ras”

El manual y la etiqueta entregados por el usuario confirman:

- modelo MP210;
- papel térmico de 58 mm;
- ancho imprimible de 48 mm;
- resolución de 203 dpi, equivalente a 8 puntos por milímetro;
- conectividad Bluetooth y USB;
- soporte de mapas de bits y códigos de barras;
- SDK para Android/iOS, sin que se haya proporcionado el SDK del fabricante.

Por tanto, el ancho útil es `48 mm × 8 puntos/mm = 384 puntos`.

“Al ras” significa que la imagen ocupará del punto 0 al punto 383 del cabezal, sin margen agregado por la aplicación. El cabezal no cubre los 10 mm restantes del rollo de 58 mm, por lo que aproximadamente 5 mm físicos a cada lado del papel no son imprimibles y no pueden eliminarse por software.

Los divisores y elementos de diagnóstico podrán llegar a los puntos 0 y 383. El texto conservará un pequeño espacio de lectura dentro del lienzo; eso no cambia que la imagen enviada mida los 384 puntos completos.

## Contexto actual

La aplicación ya conserva cada venta en un `SaleTicketSnapshot`, muestra una vista previa y genera un PDF mediante `expo-print`:

- `src/services/saleTicket.ts` normaliza los datos y construye el HTML;
- `src/services/saleTicketPdf.ts` genera y comparte el PDF;
- `app/print/[orderId].tsx` carga el snapshot y ofrece “Abrir PDF”.

No existe todavía un módulo nativo de impresora ni permisos Bluetooth en Android. La aplicación usa Expo SDK 52 y genera sus proyectos nativos mediante Expo Prebuild; `/android` y `/ios` están ignorados por Git y no son fuentes versionadas. La configuración vigente declara `compileSdkVersion` 35, `targetSdkVersion` 34 y `minSdkVersion` 24.

El PDF seguirá siendo una salida independiente y una alternativa operativa. La impresión Bluetooth no intentará enviar el PDF a la impresora.

## Decisiones aprobadas

1. El usuario selecciona una impresora vinculada una sola vez y la aplicación recuerda su dirección Bluetooth.
2. La pantalla del ticket ofrece “Imprimir en MP210” como acción principal y conserva “Abrir PDF” como alternativa.
3. El ticket se convierte en una imagen monocromática de exactamente 384 píxeles de ancho.
4. Android dibuja el ticket mediante Canvas y lo transmite en franjas raster ESC/POS por Bluetooth clásico SPP.
5. No se envía un comando de corte, porque el manual no confirma que la MP210 tenga cortador.
6. Una interrupción parcial nunca provoca un reintento automático; el vendedor decide si reimprime.
7. La primera versión solo cubre Android, Bluetooth clásico y dispositivos previamente vinculados.

## Alcance funcional

### Selección de impresora

Al tocar “Imprimir en MP210” sin una impresora guardada:

1. la aplicación comprueba que el dispositivo Android admita Bluetooth;
2. solicita `BLUETOOTH_CONNECT` en Android 12 o superior;
3. comprueba que Bluetooth esté encendido;
4. obtiene únicamente `BluetoothAdapter.bondedDevices`;
5. muestra nombre y dirección de cada dispositivo vinculado;
6. destaca dispositivos cuyo nombre contiene `MP210`, sin ocultar los demás;
7. el usuario elige un dispositivo y confirma la selección;
8. la aplicación guarda nombre y dirección y ofrece imprimir un diagnóstico.

No se realizará descubrimiento activo. Vincular una impresora nueva seguirá ocurriendo en Ajustes de Android. Esto evita solicitar `BLUETOOTH_SCAN` y permisos de ubicación adicionales para este flujo.

La pantalla del ticket mostrará una acción secundaria “Cambiar impresora”, disponible aunque exista una selección guardada.

### Impresión habitual

Con una impresora guardada:

1. la aplicación carga el `SaleTicketSnapshot` sin modificarlo;
2. construye un documento térmico serializable con todos los textos ya formateados;
3. bloquea temporalmente el botón para impedir envíos duplicados;
4. abre una conexión Bluetooth SPP con la dirección guardada;
5. renderiza y envía el ticket;
6. avanza papel unas líneas y cierra la conexión;
7. informa “Ticket enviado a MP210”.

No se imprimirá automáticamente al confirmar una venta. El envío requiere un toque explícito desde la pantalla del ticket.

### Documento térmico

Se agregará un DTO puro, derivado del snapshot, que contenga únicamente cadenas listas para mostrar:

```ts
interface ThermalTicketDocument {
  schemaVersion: 1;
  branding: {
    logoPngBase64: string;
    logoVersion: string;
    legalName: string;
    rfcLabel: string;
    title: string;
    footer: string;
  };
  folio: string;
  formattedDate: string;
  customerName: string;
  sellerName: string;
  paymentLabel: string;
  lines: Array<{
    productId: number;
    productName: string;
    quantityAndUnitPrice: string;
    lineTotal: string;
  }>;
  subtotal: string;
  totalKg: string;
  total: string;
  creditNote?: string;
}
```

El formateo de moneda, fecha, cantidades, vendedor predeterminado y pagaré permanecerá en TypeScript. `folio` será exactamente el `saleId` visible del snapshot, sin agregar otro identificador. El código nativo se limitará a validar, distribuir y dibujar las cadenas. Así se evita que JavaScript, el PDF y Kotlin interpreten de forma distinta la misma venta.

La razón social, RFC, título, despedida y logo viajarán en `branding` desde una configuración TypeScript versionada que también consumirá el PDF. El logo canónico se almacenará como PNG/base64 de alto contraste y el módulo nativo lo decodificará y almacenará en caché por `logoVersion`. No habrá copias independientes de identidad fiscal dentro de Kotlin.

## Arquitectura

### Capa TypeScript

Una capa `thermalPrinter` será responsable de:

- detectar si el módulo nativo está disponible;
- solicitar el permiso mediante una API tipada;
- listar dispositivos vinculados;
- leer y guardar la selección con el wrapper existente de AsyncStorage;
- transformar `SaleTicketSnapshot` en `ThermalTicketDocument`;
- serializar una sola operación de impresión a la vez;
- traducir códigos de error nativos a mensajes en español;
- devolver un resultado que distinga fallo previo al envío de fallo parcial.

La selección persistida tendrá versión y forma explícita, por ejemplo:

```ts
interface SavedThermalPrinterV1 {
  version: 1;
  name: string | null;
  address: string;
}
```

La dirección Bluetooth no es una credencial y puede guardarse en AsyncStorage. Si ya no aparece entre los dispositivos vinculados, la selección se conserva para diagnóstico pero el envío se bloquea y se invita a cambiarla o volverla a vincular.

### Módulo Android

Se implementará un módulo Expo local rastreado en `modules/thermal-printer`, escrito en Kotlin y descubierto automáticamente desde el directorio local de módulos durante Prebuild/EAS Build. No se editará `/android` como fuente de verdad. Su contrato lógico será:

```ts
type BondedBluetoothDevice = {
  name: string | null;
  address: string;
};

type NativePrintResult = {
  transportBytesWritten: number;
  rasterBytesWritten: number;
  bandsCompleted: number;
  rasterPayloadAttempted: boolean;
};

getBondedDevices(): Promise<BondedBluetoothDevice[]>;
printTicket(address: string, document: ThermalTicketDocument): Promise<NativePrintResult>;
printDiagnostic(address: string): Promise<NativePrintResult>;
```

Las operaciones de conexión, rasterización y escritura se ejecutarán fuera del hilo principal. La creación de recursos Android que exijan el hilo principal se coordinará explícitamente. El módulo mantendrá un mutex de proceso para rechazar una segunda impresión con código `busy` mientras exista otra activa.

El progreso distinguirá bytes totales de transporte, bytes raster cuya llamada `write()` terminó, bandas completas y si alguna escritura de payload raster llegó a intentarse. Inmediatamente antes de invocar el primer `write()` que contenga payload raster se marcará `rasterPayloadAttempted = true`. Escribir solo `ESC @` o la cabecera de una banda no activa ese indicador.

Esta bandera es deliberadamente conservadora: `OutputStream.write()` puede transmitir una parte de un bloque y luego lanzar una excepción sin informar cuántos bytes salieron. Por tanto, cualquier error con `rasterPayloadAttempted === true` se tratará como impresión potencialmente parcial, aunque `rasterBytesWritten` siga en cero. Los contadores sirven para diagnóstico, pero no deciden por sí solos si reintentar.

No se mantendrá una conexión global permanente. Cada trabajo abrirá, usará y cerrará su socket, reduciendo conexiones obsoletas cuando la impresora se apaga o el teléfono cambia de estado.

### Permisos Android

El manifiesto declarará:

- `android.permission.BLUETOOTH` con `maxSdkVersion="30"`;
- `android.permission.BLUETOOTH_ADMIN` con `maxSdkVersion="30"`;
- `android.permission.BLUETOOTH_CONNECT` para Android 12 o superior.

`BLUETOOTH_CONNECT` se solicitará en tiempo de ejecución cuando corresponda. Esta versión no declarará `BLUETOOTH_SCAN`, porque no descubre dispositivos cercanos; solo consulta equipos ya vinculados y se conecta al elegido.

Los permisos se declararán en el `AndroidManifest.xml` versionado del módulo local y, cuando haga falta preservar atributos como `maxSdkVersion`, en su config plugin. `app.json` registrará el plugin. Una prueba ejecutará la evaluación de configuración/prebuild y verificará el manifiesto generado; no se versionará ni editará manualmente ese resultado.

Denegar el permiso no afectará la venta ni el PDF. La aplicación explicará cómo habilitarlo y permitirá volver a solicitarlo cuando Android lo admita. Si Android marca “no volver a preguntar”, la interfaz ofrecerá abrir los Ajustes de la aplicación en vez de repetir una solicitud que ya no puede mostrarse.

Referencia: [Android Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions).

### Conexión SPP

La conexión usará RFCOMM con el UUID Serial Port Profile estándar:

`00001101-0000-1000-8000-00805F9B34FB`

El módulo nunca iniciará descubrimiento. En Android 12 o superior tampoco consultará ni cancelará descubrimiento, porque ambas operaciones exigirían `BLUETOOTH_SCAN`, fuera del alcance aprobado. En Android 11 o anterior podrá cancelar descubrimiento únicamente si el adaptador indica que ya está activo, usando el permiso legacy disponible. La primera estrategia será un socket RFCOMM seguro; si la MP210 vinculada rechaza específicamente esa conexión, se podrá intentar una vez el socket RFCOMM inseguro con el mismo UUID.

`BluetoothSocket.connect()` y `OutputStream.write()` son operaciones bloqueantes. Cada intento se ejecutará en un worker con un watchdog que conserva el socket actual. Al vencer el timeout, el watchdog cerrará el socket desde otro contexto para desbloquear la operación, esperará la terminación del worker y solo entonces devolverá `connect_timeout` o `write_timeout`. Un worker tardío nunca podrá continuar escribiendo después de que la promesa haya terminado.

Valores iniciales, centralizados como constantes ajustables por calibración:

- conexión: 12 segundos por estrategia de socket;
- inactividad de escritura: 8 segundos sin progreso;
- duración total del trabajo: 60 segundos;
- altura máxima del lienzo: 6000 filas;
- franja raster: 512 filas, equivalente a 24,576 bytes de payload;
- bloque de escritura: 2,048 bytes;
- pausa inicial: 10 ms entre bloques y 40 ms entre franjas;
- avance final: 4 líneas.

El protocolo de impresión inicial será ESC/POS raster. El manual confirma impresión de mapas de bits pero no nombra ESC/POS; por eso la compatibilidad se considera una hipótesis que debe quedar confirmada con la MP210 real mediante el diagnóstico antes de liberar la función.

Referencias: [BluetoothSocket](https://developer.android.com/reference/android/bluetooth/BluetoothSocket) y [BluetoothDevice](https://developer.android.com/reference/android/bluetooth/BluetoothDevice).

### Renderizado a 384 puntos

Kotlin construirá un `Bitmap` blanco de 384 píxeles de ancho y altura calculada según el contenido. Android Canvas dibujará:

1. logo centrado y optimizado para monocromo;
2. razón social, RFC y título;
3. folio, fecha, cliente, vendedor y forma de pago;
4. líneas de producto con nombre ajustable, cantidad/precio unitario e importe alineado a la derecha;
5. subtotal, kilogramos y total;
6. pagaré cuando la forma de pago sea crédito;
7. agradecimiento y espacio final para corte manual.

Reglas de composición:

- lienzo siempre de 384 px;
- fondo blanco y tinta negra;
- divisores de ancho completo, de x=0 a x=383;
- padding de lectura solo para texto y logo;
- todo campo variable —cliente, vendedor, pago, RFC, producto y pagaré— envuelve por palabras y, si una palabra excede el ancho, por caracteres;
- las filas de etiqueta/valor usan una línea cuando caben; de lo contrario, el valor pasa a las líneas siguientes sin truncarse;
- importes nunca se parten; si no caben junto al nombre, pasan a una línea propia alineada a la derecha;
- un importe que aún exceda el ancho reduce su tamaño hasta el mínimo definido; si tampoco cabe, el documento se rechaza con `invalid_ticket`;
- altura dinámica sin truncar líneas ni pagaré;
- tipografías `SpaceMono-Regular.ttf` y `SpaceMono-Bold.ttf` empaquetadas con la app, sin depender de las fuentes del teléfono ni de la impresora;
- conversión determinista a 1 bit mediante umbral o tramado ordenado, afinado con la prueba física.

Las métricas iniciales serán constantes: cuerpo 20 px con interlineado de 26 px; texto menor 18/23 px; total 28/34 px; mínimo para importes 16 px; inset de texto 8 px; logo con ancho máximo de 256 px. La calibración física podrá ajustar estas constantes una vez y las pruebas golden fijarán el resultado aprobado.

El renderizador validará esquema, textos, listas y longitudes antes de reservar el bitmap. Se impondrá el máximo defensivo de 6000 filas y se devolverá `ticket_too_large` en vez de provocar falta de memoria.

### Codificación y escritura ESC/POS

La sesión enviará, en orden:

1. inicialización `ESC @`;
2. una o más franjas raster de 384 px de ancho;
3. avance de papel configurable;
4. `flush` y cierre del stream/socket.

384 píxeles equivalen a 48 bytes por fila. Cada franja inicial de 512 filas contiene 24,576 bytes de payload, claramente menos que los 40 KB por mapa indicados en el manual. El encoder nunca reunirá todas las franjas codificadas en un único buffer: codificará, escribirá y liberará cada una antes de continuar.

El manual también menciona un máximo total de 64 KB, pero no aclara si corresponde a gráficos almacenados o al flujo raster. Un trabajo raster supera 64 KB a partir de aproximadamente 1365 filas. Por ello, la aceptación incluirá deliberadamente un diagnóstico y un ticket largo mayores a 64 KB. Si la MP210 no procesa correctamente varias franjas `GS v 0`, la implementación deberá cambiar al modo raster por líneas `ESC *` de 24 puntos —manteniendo la imagen de 384 px— y repetir la prueba. Si ambas variantes fallan, la función quedará bloqueada; no se reducirá silenciosamente el contenido ni la densidad.

Cada franja se escribirá en bloques de 2,048 bytes con el pacing inicial definido. El watchdog de escritura se reiniciará únicamente cuando `write()` termine y aumente el contador de bytes; cerrar el socket será el mecanismo de cancelación ante inactividad o timeout total.

No se enviará comando de corte. Tampoco se usarán las páginas de código de la impresora, porque texto, logo y acentos ya estarán rasterizados.

El codificador de bytes será una clase Kotlin pura separada del socket, para poder verificar cabeceras, ancho, alto, orden de bits, bandas y avance de papel con pruebas unitarias.

## Interfaz y estados

La pantalla `app/print/[orderId].tsx` conservará su vista previa y añadirá:

- botón principal “Imprimir en MP210”;
- nombre de la impresora seleccionada;
- acción “Cambiar impresora”;
- botón secundario “Abrir PDF”;
- indicador durante conexión/envío.

Estados mínimos:

| Estado | Interfaz |
| --- | --- |
| Sin selección | Abre selección de dispositivos vinculados. |
| Solicitando permiso | Explica el permiso de dispositivos cercanos. |
| Conectando | Botón bloqueado, indicador visible. |
| Enviando | Botón bloqueado, indicador visible. |
| Completado | “Ticket enviado a MP210”. |
| Fallo con `rasterPayloadAttempted === false` | Permite reintentar normalmente. |
| Fallo con `rasterPayloadAttempted === true` | Advierte que pudo imprimirse parcialmente y exige decisión manual para reimprimir, incluso si el primer `write()` falló antes de actualizar contadores. |

La capa nativa devolverá errores estructurados con código, fase, `transportBytesWritten`, `rasterBytesWritten`, `bandsCompleted` y `rasterPayloadAttempted`. Como mínimo:

- `bluetooth_unsupported`;
- `bluetooth_disabled`;
- `permission_denied`;
- `printer_not_bonded`;
- `connect_timeout`;
- `connect_failed`;
- `busy`;
- `invalid_ticket`;
- `ticket_too_large`;
- `write_timeout`;
- `write_failed`.

Un envío de bytes exitoso no prueba que físicamente haya papel, batería o temperatura adecuada. Por eso la confirmación dirá “enviado”, no “impreso”.

La impresión nunca cambia el estado de la venta, su sincronización ni el snapshot guardado.

## Diagnóstico y calibración

La selección de impresora ofrecerá “Imprimir diagnóstico”. Se recomendará al configurar o cambiar equipo, pero el vendedor no tendrá que repetirlo antes de cada ticket. La impresión satisfactoria del diagnóstico en la MP210 de prueba sí es condición obligatoria de liberación de la función. El patrón incluirá:

- líneas verticales en x=0 y x=383;
- una regla horizontal o patrón alternado;
- logo monocromático;
- texto `á é í ó ú ñ Ñ $`;
- tamaños tipográficos usados por el ticket;
- columnas de importes;
- identificación visible de la estrategia raster y ancho `384 dots`;
- una sección larga de más de 64 KB de payload para comprobar el límite ambiguo del manual.

El diagnóstico valida cuatro supuestos antes de imprimir ventas:

1. la MP210 acepta RFCOMM SPP con el UUID elegido;
2. acepta la variante raster `GS v 0`;
3. consume correctamente las franjas y el ritmo de escritura;
4. el contenido ocupa el ancho imprimible sin recorte ni desplazamiento.

Si cualquiera falla, la función no se marcará lista: se capturará el resultado físico y se ajustará el transporte o el encoder para este modelo.

## Pruebas

### TypeScript

- transformación estable de `SaleTicketSnapshot` a `ThermalTicketDocument`;
- contado, crédito y transferencia;
- vendedor faltante;
- fecha inválida;
- cantidades enteras y decimales;
- importes grandes;
- nombres largos y caracteres españoles;
- persistencia versionada y validación de la selección;
- traducción de errores nativos;
- bloqueo contra doble toque y decisión de reimpresión parcial;
- distinción entre bytes de control, intento de raster, bytes raster confirmados y bandas completas;
- fallo/timeout durante el primer bloque raster, que debe exigir confirmación aunque `rasterBytesWritten === 0`;
- ausencia segura del módulo en Expo Go/iOS.

### Kotlin/JVM

- ancho fijo de 384 píxeles / 48 bytes por fila;
- orden de bits de izquierda a derecha;
- cabecera y dimensiones `GS v 0`;
- división en franjas por debajo del límite configurado;
- inicialización, orden de bandas y avance final;
- validación de dirección, documento y altura máxima;
- clasificación de fase, `transportBytesWritten`, `rasterBytesWritten`, `bandsCompleted` y `rasterPayloadAttempted` ante fallos simulados;
- cancelación efectiva de conexión y escritura mediante cierre de socket, sin workers tardíos;
- exclusión mutua de trabajos.

### Renderizador Android

- pruebas puras del motor de layout sobre posiciones, wrapping, altura y fallback de importes;
- pruebas instrumentadas/golden del Canvas con la fuente empaquetada;
- bitmap final de exactamente 384 píxeles;
- píxeles esperados en x=0 y x=383 para el patrón de diagnóstico;
- logo, campos largos, pagaré y total comparados con fixtures aprobados;
- salida estrictamente monocromática y altura máxima controlada.

### Integración Android

- permiso concedido, denegado, previamente concedido y denegado permanentemente con enlace a Ajustes;
- lista de dispositivos vinculados;
- selección persistente después de reiniciar la app;
- impresora apagada, Bluetooth apagado y dispositivo desvinculado;
- conexión agotada y corte durante la escritura;
- compilación de desarrollo y release con el módulo incluido.

### Aceptación física en MP210

- diagnóstico completo y legible;
- líneas visibles en ambos extremos del cabezal;
- logo reconocible;
- acentos y símbolo de moneda correctos;
- ticket de contado con varias líneas;
- ticket de crédito con pagaré;
- diagnóstico y ticket largo con más de 64 KB de payload raster;
- producto y cliente con nombres largos;
- total e importes sin recorte;
- avance suficiente para corte manual;
- reimpresión explícita después de una interrupción parcial.

La función se considerará terminada solo después de una impresión real satisfactoria en la MP210 mostrada por el usuario.

## Entrega y compatibilidad

El módulo nativo requiere ejecutar Prebuild y producir una nueva compilación Android; no puede entregarse únicamente por actualización JavaScript y no funcionará dentro de Expo Go. La interfaz detectará la ausencia del módulo y mantendrá disponible el PDF sin provocar un cierre.

Se conservarán las pruebas y el flujo de PDF actuales. El cambio Bluetooth será aditivo y no alterará la creación, persistencia o sincronización de ventas.

## Fuera de alcance

- USB;
- iOS;
- Bluetooth Low Energy;
- descubrimiento o vinculación desde la aplicación;
- impresión automática al confirmar la venta;
- impresión en segundo plano;
- corte automático;
- códigos QR o de barras;
- cajón de dinero;
- compatibilidad garantizada con modelos distintos a la MP210;
- sustitución o eliminación del PDF.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| El firmware MP210 no acepta `GS v 0`. | Diagnóstico físico obligatorio; cambiar a `ESC *` de 24 puntos sin tocar UI ni datos. |
| El límite total de 64 KB también aplica al streaming. | Prueba deliberada mayor a 64 KB; franjas procesadas individualmente y fallback `ESC *`; bloquear liberación si ambas variantes fallan. |
| El buffer pierde bytes en tickets largos. | Franjas de 24,576 bytes, bloques de 2,048, pacing configurable y prueba con pagaré largo. |
| El usuario confunde “enviado” con impresión confirmada. | Mensaje preciso y reimpresión manual. |
| La dirección guardada queda obsoleta al volver a vincular. | Verificar `bondedDevices` antes de conectar y ofrecer “Cambiar impresora”. |
| El raster consume demasiada memoria. | Ancho fijo, altura máxima, renderizado/compresión fuera del hilo principal y liberación inmediata de bitmaps. |
| La app se ejecuta sin el binario nativo actualizado. | Detección de disponibilidad y PDF como alternativa. |
