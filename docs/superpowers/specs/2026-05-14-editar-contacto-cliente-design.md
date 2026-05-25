# Editar Contacto Cliente Design

## Objetivo

Permitir que el vendedor edite desde la pantalla de parada los datos principales del cliente: nombre comercial, nombre de contacto, telefono, movil y email.

## Alcance

- Agregar un boton "Editar cliente" en el mismo bloque donde se ve el nombre del cliente en `app/stop/[stopId].tsx`.
- Crear una pantalla de formulario para editar los datos de `res.partner`.
- Guardar cambios en la app localmente para que el nuevo nombre se vea de inmediato.
- Sincronizar cambios con Odoo usando la cola existente `customer_update`.
- Mantener soporte offline: si no hay conexion, el cambio queda en cola.

## Datos

Campos editables:

- `name`: nombre comercial del cliente.
- `contact_name`: nombre del contacto.
- `phone`: telefono.
- `mobile`: movil.
- `email`: correo.

El payload de sincronizacion debe incluir el `id` de `res.partner` y solo los campos editables normalizados.

## UI

La pantalla de parada muestra el boton secundario "Editar cliente" debajo del nombre/ref del cliente. El formulario usa los patrones actuales de `TopBar`, `Card`, `Button`, `TextInput` y `SafeAreaView`.

## Errores

- El nombre comercial es obligatorio.
- Si esta offline, se muestra confirmacion de que el cambio quedo pendiente.
- Si esta online y falla por error retryable, se deja en cola.
- Si el backend rechaza el dato, se muestra el mensaje sin perder lo escrito.

## Pruebas

- Helper de payload valida trimming, campos vacios y mapeo a `res.partner`.
- Store de ruta conserva y parchea campos de contacto en `GFStop`.
- Wiring frontend confirma que la pantalla de parada expone la entrada a editar cliente.
