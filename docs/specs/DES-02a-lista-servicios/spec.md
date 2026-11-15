# DES-02a — Delta spec: listado propio de servicios

## Estado y compatibilidad

En `main@b07282b`, `GET /services` no existe: la app esperaba un array y ocultaba errores. `POST /services` crea `ClientProfile` al primer servicio. `GET /services/:id` mantiene dueño completo, operador público y 404 para otro CLIENT; `/services/nearby` permanece OPERATOR y devuelve array. No cambia el otorgamiento de roles ni el esquema de DB.

## ADDED: GET /services (CLIENT)

- `requireAuth` → 401 `UNAUTHORIZED` sin sesión; `requireRole(CLIENT)` → 403 `FORBIDDEN` en otros roles.
- Query estricta: `limit` entero decimal positivo de 1 a 100 (default 20); `cursor` opcional opaco base64url; no se admiten otros parámetros, incluidos `userId` y `clientProfileId`. Malformados → 400 `VALIDATION_ERROR`.
- La identidad sale _solo_ de la sesión de `requireAuth`. Sin perfil todavía → 200 `{ "items": [], "nextCursor": null }` sin crearlo.
- 200 `{ items: ServiceListItem[], nextCursor: string|null }`. Campos: `id`, `type`, `status`, `originLat`, `originLng`, `destLat`, `destLng`, `description`, `photoUrl`, `expiresAt`, `createdAt`. Los opcionales de DB son `null`, las fechas ISO UTC; sin `client`, `clientProfileId`, datos de pago, sesión ni cotizaciones. Compatible con `ServiceItem` de app.
- Orden `(createdAt DESC, id DESC)`; cursor de la última fila visible. Páginas contiguas para datos sin borrados ni cambios en `createdAt`/`id`. No es snapshot transaccional entre peticiones: servicios nuevos por encima del cursor no aparecen hasta refresh; cambios de estado pueden reflejarse en páginas posteriores. No se filtra por status (historial completo).
- El cursor solo indica posición, no actor ni permiso; incluso si se forja, el filtro de `clientProfileId` de la sesión sigue aplicado. Cursor inválido → 400.

## Escenarios

1. Cliente nuevo sin perfil: 200 página vacía.
2. Dos clientes con servicios: cada uno ve únicamente los suyos, incluso con cursor ajeno o query manipulada.
3. Más de un servicio con el mismo `createdAt`: el desempate por `id` evita omisiones y duplicados entre páginas.
4. Cliente móvil: primera página al enfocar; scroll consume siguiente; error visible con reintento sin avanzar cursor; refresh reinicia; respuestas antiguas tras logout/cambio de cuenta no se mezclan.
5. 401 no se confunde con lista vacía; `/nearby` y `/:id` conservan sus contratos existentes.
