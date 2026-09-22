# Despliegue y verificación de S31396

Esta guía corresponde al fix de fecha operativa mezclado en `main`.

- Commit efectivo: `89f958032746beabe54f31969e89dc398a11045c`
- Cambio: `localOperationalDate()` usa `America/Mexico_City`.
- La mitigación de negocio permanece activa hasta completar la prueba operativa.

## Build de producción

Ejecutar con la cuenta EAS de Diego, desde un checkout limpio de `main`:

```bash
git checkout main
git pull --ff-only
git rev-parse HEAD
npm ci
npm run typecheck
npm test
eas build --platform android --profile production
# Para iOS:
eas build --platform ios --profile production
```

El `git rev-parse HEAD` debe devolver `89f958032746beabe54f31969e89dc398a11045c`. En el panel y en los logs de EAS debe verificarse que el build usa ese mismo commit; no basta con que el número de versión coincida.

## Verificación del artefacto

Antes de instalar:

1. Confirmar que el build terminó en estado `Finished`/`Complete` y corresponde al perfil `production`.
2. Guardar el enlace y el identificador del build.
3. Registrar el SHA de `main` usado (`89f95803…`) y el hash SHA-256 del APK/AAB/IPA descargado.
4. Confirmar que el bundle contiene el código de `employeeDayBundle.ts` que delega en `formatLocalISODate` con `DEFAULT_OPERATION_TIME_ZONE`. Si se inspecciona el bundle compilado, buscar `America/Mexico_City`; la prueba principal es el comportamiento operativo siguiente.

## Prueba operativa de fecha

En un dispositivo de prueba, con la zona horaria del dispositivo distinta de México si es posible:

1. Antes de las 18:00 hora de México, comprobar que la app consulta y muestra el plan del día actual.
2. En la ventana de 18:00 hora de México y medianoche UTC, comprobar que no se cuelga la venta del plan siguiente. La fecha operativa debe seguir siendo la del día de México.
3. Después de medianoche local de México, comprobar que la app cambia al nuevo día operativo.
4. Repetir una rehidratación de la app, un check-in y una venta. Verificar que todos usan el mismo día operativo y que la venta queda asociada al plan correcto.

Registrar hora UTC, hora de México, zona del dispositivo, plan mostrado, `plan_id` y resultado visible. No usar datos de clientes reales en el informe.

## Instalación en dispositivo Android

1. Descargar el APK del build `production` desde EAS.
2. Verificar su SHA-256 y conservarlo junto con el identificador del build.
3. Transferirlo al dispositivo de prueba.
4. Habilitar temporalmente la instalación desde la fuente usada para transferir el APK.
5. Instalar o actualizar la aplicación.
6. Abrirla con Metro apagado y confirmar que no aparece una pantalla de desarrollo ni una URL `localhost:8081`.
7. Confirmar que el login apunta a `https://grupofrio-gf.odoo.com` y a la base de producción esperada.

Para iOS, instalar el artefacto mediante el canal de distribución configurado por EAS y repetir las comprobaciones de SHA, commit, entorno y fecha operativa.

## Criterio para levantar la mitigación

La mitigación “no publicar planes de mañana hasta cortar los de hoy” sólo se levanta cuando Diego confirme:

- build de producción basado en `89f95803…`;
- instalación correcta en dispositivo;
- prueba de 18:00/medianoche México correcta;
- rehidratación, check-in y venta asociando el plan correcto;
- evidencia guardada con SHA-256 del artefacto.
