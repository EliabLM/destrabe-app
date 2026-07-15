# Spec — Mobile App Demo (NUEVA)

**Change ID:** `cambio-008-app-movil-demo` · **Capability:** `mobile-app-demo` (NUEVA)
**Basado en:** `docs/proposals/cambio-008-app-movil-demo/proposal.md`

> Capacidad nueva. La app Expo Dev Build es un límite del sistema que ejercita extremo a extremo los cambios 001–008. Los REQs describen contratos UX (Gherkin demostrativo), no unit tests. Stack locked: Expo SDK 52/53, React Navigation v7, Zustand, Axios, `@rnmapbox/maps`, `expo-web-browser`, `expo-linking`, `expo-secure-store`. Socket.io-client solo scaffold (sin conexión real en Demo).

---

## Requirements

### REQ-MOB-AUTH: Pantallas OTP y persistencia de sesión

La app SHALL mostrar pantalla de envío OTP (input teléfono E.164 → `POST /api/auth/phone-number/send-otp`) y pantalla de verificación (código 6 dígitos → `POST /api/auth/phone-number/verify`). El `session.token` de la respuesta verify se persiste en `expo-secure-store` y se inyecta como `Authorization: Bearer` vía interceptor Axios. Cualquier respuesta 401 en requests subsecuentes SHALL limpiar el token y redirigir a la pantalla de login.

```gherkin
Escenario: envío y verificación OTP exitosos
  Dado el usuario en la pantalla de login
  Cuando ingresa teléfono E.164 y presiona "Enviar código"
  Entonces la app llama POST /api/auth/phone-number/send-otp
  Y muestra la pantalla de verificación con input de 6 dígitos
  Cuando ingresa el código correcto y presiona "Verificar"
  Entonces la app llama POST /api/auth/phone-number/verify
  Y persiste el token Bearer en SecureStore
  Y navega a la siguiente pantalla según estado del perfil

Escenario: 401 en request subsecuente → logout automático
  Dado el usuario autenticado navegando la app
  Cuando una request responde 401
  Entonces la app limpia el token de SecureStore
  Y redirige a la pantalla de login
```

### REQ-MOB-ONBOARDING: Enrutamiento post-auth según perfil

Tras verify o al reabrir la app, la app SHALL llamar `GET /api/me`. Si la respuesta no incluye el perfil correspondiente al rol del usuario, la app navega a la pantalla de onboarding. El usuario CLIENT ve un resumen visual (TTD: el ClientProfile se crea lazy al primer servicio). El usuario OPERATOR ve un formulario (`truckType`, `licensePlate` obligatoria sin validación de formato, `photoUrl` opcional) → `POST /api/operator/profile`. No se permite cambiar de rol en Demo.

```gherkin
Escenario: OPERATOR sin perfil → pantalla de onboarding
  Dado GET /api/me responde sin operatorProfile y role=OPERATOR
  Cuando la app procesa la respuesta
  Entonces navega a la pantalla de onboarding de operador
  Cuando el usuario completa truckType y licensePlate y presiona "Crear perfil"
  Entonces llama POST /api/operator/profile
  Y navega al home del operador

Escenario: CLIENT sin perfil → home directo
  Dado GET /api/me responde sin clientProfile y role=CLIENT
  Cuando la app procesa la respuesta
  Entonces navega al home del cliente (ClientProfile se crea lazy)
```

### REQ-MOB-SERVICES-CLIENT: Crear solicitud de servicio

El cliente SHALL ver su lista de servicios y un FAB para crear nueva solicitud. La pantalla de creación incluye: picker de origen en mapa Mapbox, destino opcional (solo si tipo `TRANSFER`), selector tipo `BREAKDOWN | TRANSFER`, descripción opcional, `photoUrl` string opcional. Al confirmar → `POST /services`.

```gherkin
Escenario: cliente crea servicio BREAKDOWN
  Dado el cliente en la pantalla de crear servicio
  Cuando selecciona origen en el mapa, tipo BREAKDOWN y presiona "Solicitar"
  Entonces llama POST /services con { type: 'BREAKDOWN', originLat, originLng }
  Y navega al detalle del servicio creado

Escenario: TRANSFER requiere destino
  Dado el cliente selecciona tipo TRANSFER
  Cuando no ingresa destino
  Entonces el botón "Solicitar" permanece deshabilitado
```

### REQ-MOB-QUOTES-LIST: Detalle de servicio con polling de cotizaciones

La pantalla de detalle de servicio SHALL hacer polling cada 5 segundos a `GET /services/:id/quotes` mientras el servicio esté en `PENDING` o `QUOTED`. Muestra cada cotización con `amount`, `estimatedMinutes`, y datos del operador (nombre, rating, foto del camión). El cliente acepta con `POST /services/:id/quotes/:qid/accept`. Si el backend responde 409 (servicio ya no está `QUOTED`), la app muestra mensaje y refresca.

```gherkin
Escenario: polling muestra cotizaciones entrantes
  Dado un servicio en estado QUOTED
  Cuando transcurren 5 segundos
  Entonces la app llama GET /services/:id/quotes
  Y actualiza la lista de cotizaciones en pantalla

Escenario: aceptar cotización
  Dado el cliente en el detalle del servicio con cotizaciones
  Cuando presiona "Aceptar" en una cotización
  Entonces llama POST /services/:id/quotes/:qid/accept
  Y navega de regreso a la lista de servicios

Escenario: 409 al aceptar → servicio ya no QUOTED
  Dado el servicio cambió de estado antes del accept
  Cuando la app llama POST /quotes/:qid/accept y recibe 409
  Entonces muestra mensaje "El servicio ya no está disponible para aceptar"
  Y refresca el detalle
```

### REQ-MOB-PAYMENT: Flujo de pago con MercadoPago sandbox

Tras aceptar cotización, la app SHALL llamar `POST /payments/:id/init` y abrir la `redirectUrl` con `WebBrowser.openBrowserAsync` (expo-web-browser). Al cerrar el browser, la app hace polling del estado del pago cada 3 segundos vía `GET /services/:id` (que incluye payment). Timeout de 5 minutos: si no se confirma, muestra "Pago pendiente, revisa más tarde". Feedback visual: éxito (CONFIRMED) o fallo (FAILED).

```gherkin
Escenario: pago confirmado en sandbox
  Dado el cliente tras aceptar cotización
  Cuando presiona "Pagar" y la app llama POST /payments/:id/init
  Entonces abre la redirectUrl en el navegador externo
  Cuando el usuario completa el pago y cierra el browser
  Entonces la app hace polling cada 3s a GET /services/:id
  Cuando el payment cambia a CONFIRMED
  Entonces muestra feedback visual de éxito

Escenario: timeout de 5 minutos sin confirmación
  Dado el polling de pago activo por 5 minutos
  Cuando el payment no cambia a CONFIRMED ni FAILED
  Entonces muestra "Pago pendiente, revisa más tarde"
  Y detiene el polling

Escenario: pago fallido
  Dado el payment cambia a FAILED durante el polling
  Cuando la app detecta el estado FAILED
  Entonces muestra feedback visual de fallo con opción de reintentar
```

### REQ-MOB-OPERATOR-HOME: Home del operador con servicios cercanos

El operador SHALL ver un toggle de disponibilidad (`available`) que al activarse envía `PATCH /api/operator/location` con las coordenadas actuales. La lista de servicios `PENDING` cercanos se obtiene con `GET /services/nearby` (polling cada 10 segundos o pull-to-refresh). El operador crea cotización con `amount`, `estimatedMinutes` y `note` opcional → `POST /services/:id/quotes`.

```gherkin
Escenario: toggle available actualiza ubicación
  Dado el operador en home con available=false
  Cuando activa el toggle
  Entonces llama PATCH /api/operator/location con coordenadas actuales y available=true

Escenario: polling de servicios cercanos
  Dado el operador con available=true
  Cuando transcurren 10 segundos
  Entonces la app llama GET /services/nearby con lat/lng actuales
  Y actualiza la lista de servicios PENDING

Escenario: crear cotización
  Dado el operador en el detalle de un servicio PENDING
  Cuando ingresa amount y estimatedMinutes y presiona "Cotizar"
  Entonces llama POST /services/:id/quotes
  Y navega de regreso al home
```

### REQ-MOB-OPERATOR-ACTIVE: Servicio activo y completado

El operador SHALL ver su servicio `ACTIVE` actual (asignado vía `acceptedQuoteId`). Puede marcar como `COMPLETED` con `PATCH /services/:id/status`. Si el backend responde 409 con `code: 'PAYMENT_PENDING'`, la app muestra "El pago debe confirmarse antes de completar".

```gherkin
Escenario: operador completa servicio ACTIVE
  Dado el operador con servicio ACTIVE asignado
  Cuando presiona "Completar servicio"
  Entonces llama PATCH /services/:id/status con { status: 'COMPLETED' }
  Y muestra confirmación visual

Escenario: 409 PAYMENT_PENDING al completar
  Dado el servicio ACTIVE pero payment aún PENDING
  Cuando el operador presiona "Completar servicio" y recibe 409
  Entonces muestra "El pago debe confirmarse antes de completar"
```

### REQ-MOB-CONFIG: Variables de entorno y validación al startup

La app SHALL validar al startup un array Zod con: `EXPO_PUBLIC_API_URL` (string URL, runtime, público), `EXPO_PUBLIC_MAPBOX_TOKEN` (string, runtime, público). `MAPBOX_DOWNLOADS_TOKEN` es build-time secret (documentado en setup readme, no validado en runtime). Si alguna variable requerida falta, la app muestra pantalla de error con el nombre de la variable.

```gherkin
Escenario: startup con todas las variables
  Dado EXPO_PUBLIC_API_URL y EXPO_PUBLIC_MAPBOX_TOKEN definidos
  Cuando la app inicia
  Entonces la validación Zod pasa y la app muestra la pantalla de login

Escenario: startup sin variable requerida
  Dado EXPO_PUBLIC_MAPBOX_TOKEN no definido
  Cuando la app inicia
  Entonces muestra pantalla de error mencionando EXPO_PUBLIC_MAPBOX_TOKEN
```

---

**Notas de implementación:**

- Polling suspendido cuando la app está en background (AppState !== 'active').
- Deep link de regreso desde MP sandbox: `expo-linking` con scheme `destrabe://` + `WebBrowser.openBrowserAsync`. No se implementa deep link handler; MP solo envía webhook server-side. La app confirma vía polling.
- Socket.io-client incluido como dependencia pero sin conexión real en Demo (scaffold only).
- No se soporta multi-rol por cuenta en Demo.

**Cobertura:** Los REQs son contratos UX demostrativos. Tests E2E manuales cubren el flujo completo. **Next:** etapa `design`.
