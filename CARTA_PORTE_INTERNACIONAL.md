# CARTA_PORTE_INTERNACIONAL.md

# Ampliación de Carta Porte Nacional a Internacional
## ERP HCGM Advisors

**Versión del documento:** 1.0  
**Versión Carta Porte:** 3.1  
**Ámbito principal:** México – Estados Unidos  
**Modalidades contempladas:** Autotransporte, ferroviario, marítimo y aéreo  
**Estado:** Diseño funcional y técnico base  

---

# 1. Objetivo

Ampliar el módulo actual de Carta Porte nacional para soportar operaciones internacionales, principalmente entre México y Estados Unidos, incluyendo los siguientes medios de transporte:

- Autotransporte.
- Transporte ferroviario.
- Transporte marítimo.
- Transporte aéreo.

El objetivo es conservar la estructura nacional ya desarrollada y agregar únicamente las capas, nodos, catálogos, validaciones y tablas necesarias para soportar operaciones internacionales y multimodales.

---

# 2. Principio general de diseño

No se debe crear un módulo completamente separado para Carta Porte internacional.

Debe conservarse la estructura común de Carta Porte nacional y agregar:

1. Una capa de comercio exterior.
2. Un selector de medio de transporte.
3. Un bloque específico por modalidad.
4. Documentación aduanera por mercancía.
5. Participantes y domicilios extranjeros.
6. Validaciones específicas antes del timbrado.

La estructura nacional probablemente ya contiene:

```text
CFDI
├── Datos generales
├── Ubicaciones
│   ├── Origen
│   └── Destino
├── Mercancías
├── Autotransporte
│   ├── Permiso
│   ├── Vehículo
│   ├── Seguros
│   └── Remolques
└── Figuras de transporte
```

La nueva estructura deberá evolucionar a:

```text
CFDI
├── Datos generales
├── Carta Porte
│   ├── Datos generales del traslado
│   ├── Comercio exterior
│   │   ├── Entrada o salida
│   │   ├── País de origen o destino
│   │   ├── Vía de entrada o salida
│   │   └── Regímenes aduaneros
│   ├── Ubicaciones
│   ├── Mercancías
│   │   └── Documentación aduanera
│   ├── Medio de transporte
│   │   ├── Autotransporte
│   │   ├── Marítimo
│   │   ├── Aéreo
│   │   └── Ferroviario
│   └── Figuras de transporte
└── Timbrado
```

---

# 3. Cambios principales frente a Carta Porte nacional

Los bloques que se pueden reutilizar son:

- CFDI.
- Ubicaciones.
- Mercancías.
- Cantidades transportadas.
- Figuras de transporte.
- Catálogos generales.
- Timbrado.
- Autotransporte nacional.

Los bloques que deben ampliarse o agregarse son:

```text
1. ComercioExteriorCartaPorte
2. DocumentacionAduanera
3. SelectorModalTransporte
4. TransporteFerroviario
5. TransporteMaritimo
6. TransporteAereo
7. ExpedienteMultimodal
8. ParticipantesExtranjeros
9. DomiciliosExtranjeros
10. ValidacionesInternacionales
```

---

# 4. Datos generales de transporte internacional

En la cabecera de Carta Porte se deben agregar o activar los siguientes campos:

| Campo XML | Finalidad |
|---|---|
| `TranspInternac` | Indica si el traslado es internacional |
| `EntradaSalidaMerc` | Indica entrada o salida de mercancías |
| `PaisOrigenDestino` | País extranjero de origen o destino |
| `ViaEntradaSalida` | Vía utilizada para entrada o salida |
| `RegimenAduaneroCCP` | Régimen o regímenes aduaneros aplicables |

---

## 4.1 TranspInternac

Para Carta Porte nacional:

```xml
TranspInternac="No"
```

Para México–Estados Unidos:

```xml
TranspInternac="Sí"
```

Cuando el valor sea `Sí`, deberán activarse:

- Entrada o salida.
- País de origen o destino.
- Vía de entrada o salida.
- Régimen aduanero.
- Tipo de materia.
- Documentación aduanera.
- Validaciones de participantes extranjeros.

---

## 4.2 EntradaSalidaMerc

Valores permitidos:

```text
Entrada
Salida
```

Ejemplos:

```text
México → Estados Unidos = Salida
Estados Unidos → México = Entrada
```

Este dato debe almacenarse expresamente y no inferirse únicamente por los domicilios.

---

## 4.3 PaisOrigenDestino

Para una operación México–Estados Unidos:

```text
USA
```

Regla de negocio:

```text
Si EntradaSalidaMerc = Salida
    PaisOrigenDestino = país de destino extranjero

Si EntradaSalidaMerc = Entrada
    PaisOrigenDestino = país de origen extranjero
```

Debe utilizarse la clave del catálogo SAT correspondiente.

---

## 4.4 ViaEntradaSalida

El usuario deberá seleccionar:

```text
Autotransporte
Marítimo
Aéreo
Ferroviario
```

En base de datos debe almacenarse la clave SAT, no solamente la descripción.

---

## 4.5 RegimenAduaneroCCP

Debe modelarse como una colección.

Ejemplo:

```json
{
  "regimenesAduaneros": [
    {
      "regimen": "EXD"
    }
  ]
}
```

La interfaz debe filtrar los regímenes según el sentido de la operación:

```text
Salida → regímenes compatibles con exportación
Entrada → regímenes compatibles con importación
```

No debe permitirse captura libre.

---

# 5. Cambios en Ubicaciones

La estructura actual de ubicaciones debe conservarse, pero deberá soportar:

```text
Domicilio mexicano
Domicilio extranjero
```

---

## 5.1 Ubicación mexicana

Debe continuar utilizando:

- Código postal.
- Estado.
- Municipio.
- Localidad.
- Colonia.
- Calle.
- Número exterior.
- Número interior.
- Referencia.
- País `MEX`.

---

## 5.2 Ubicación extranjera

Para Estados Unidos se deberá permitir:

- País `USA`.
- Código postal extranjero.
- Estado o provincia.
- Municipio, condado o ciudad.
- Localidad.
- Colonia, distrito o equivalente.
- Calle.
- Número exterior.
- Número interior.
- Referencia.

Regla:

```text
Si Pais = MEX
    validar código postal, estado, municipio, localidad y colonia
    contra catálogos SAT de México

Si Pais != MEX
    no validar contra catálogo mexicano de códigos postales
    aplicar longitudes y patrones del XSD
```

---

## 5.3 Remitentes y destinatarios extranjeros

El catálogo de participantes deberá ampliarse con:

```text
RFC
ResidenciaFiscal
NumRegIdTrib
Nombre o razón social
País
Tipo de identificación fiscal
```

Ejemplo:

```text
ResidenciaFiscal = USA
NumRegIdTrib = EIN o Tax ID
```

No debe forzarse RFC mexicano a entidades extranjeras.

---

## 5.4 Estaciones

Para ferrocarril, marítimo y aéreo deberán considerarse:

```text
NumEstacion
NombreEstacion
TipoEstacion
NavegacionTrafico, cuando corresponda
```

Las estaciones ferroviarias, puertos y aeropuertos deben manejarse mediante los catálogos SAT aplicables.

---

# 6. Cambios en Mercancías

La mercancía nacional probablemente contiene:

```text
BienesTransp
Descripcion
Cantidad
ClaveUnidad
Unidad
Dimensiones
MaterialPeligroso
CveMaterialPeligroso
Embalaje
DescripEmbalaje
PesoEnKg
ValorMercancia
Moneda
FraccionArancelaria
UUIDComercioExt
```

Para operaciones internacionales se deberá reforzar:

- Fracción arancelaria.
- Tipo de materia.
- Descripción de materia.
- Documentación aduanera.
- Valor y moneda.
- Mercancías peligrosas.
- COFEPRIS, cuando aplique.
- Relación de cantidades por origen y destino.

---

## 6.1 TipoMateria

Cuando corresponda, cada mercancía deberá permitir:

```text
TipoMateria
DescripcionMateria
```

Ejemplos:

```text
Materia prima
Materia procesada
Producto terminado
Otros
```

Debe utilizarse el catálogo SAT correspondiente.

---

## 6.2 DocumentacionAduanera

Cada mercancía deberá relacionarse con uno o varios documentos aduaneros:

```text
Mercancía
└── Documentación aduanera
    ├── Documento 1
    ├── Documento 2
    └── Documento N
```

Campos principales:

| Campo | Finalidad |
|---|---|
| `TipoDocumento` | Tipo de documento aduanero |
| `NumPedimento` | Número de pedimento |
| `IdentDocAduanero` | Identificador de otro documento |
| `RFCImpo` | RFC del importador cuando aplique |

Regla:

```text
Si TipoDocumento = Pedimento
    solicitar NumPedimento

Si TipoDocumento != Pedimento
    solicitar IdentDocAduanero

Solicitar RFCImpo cuando la regla aplicable lo requiera
```

No debe pedirse pedimento de forma indiscriminada para toda operación internacional.

---

## 6.3 Relación documento–mercancía

No debe guardarse el pedimento solamente a nivel de Carta Porte.

Una Carta Porte puede incluir:

- Mercancías con distintos pedimentos.
- Mercancías con documentos diferentes.
- Mercancías nacionales y extranjeras.
- Varios documentos para una misma mercancía.

Modelo recomendado:

```text
carta_porte_mercancias
        │
        └── mercancia_documentos_aduaneros
```

---

# 7. Selector de medio de transporte

Claves recomendadas:

| Clave | Modalidad |
|---|---|
| `01` | Autotransporte |
| `02` | Transporte marítimo |
| `03` | Transporte aéreo |
| `04` | Transporte ferroviario |

La selección debe ser exclusiva:

```text
medioTransporte = AUTOTRANSPORTE
medioTransporte = MARITIMO
medioTransporte = AEREO
medioTransporte = FERROVIARIO
```

No deben activarse simultáneamente varios nodos modales dentro de una misma Carta Porte.

---

# 8. Autotransporte internacional México–Estados Unidos

El nodo nacional puede reutilizarse:

```text
PermSCT
NumPermisoSCT
IdentificacionVehicular
Seguros
Remolques
```

Debe conservar:

- Configuración vehicular.
- Placa del vehículo.
- Año modelo.
- Aseguradora.
- Póliza de responsabilidad civil.
- Seguro ambiental.
- Seguro de carga.
- Remolques.
- Operador.
- Licencia.

Debe agregarse:

- Placas extranjeras.
- Permiso o autorización análoga.
- Operador extranjero.
- Residencia fiscal.
- Número de registro tributario.
- País del transportista.
- Punto fronterizo.
- Entrada o salida.
- Documentación aduanera.
- Régimen aduanero.

---

## 8.1 Catálogo interno de cruces fronterizos

Se recomienda crear un catálogo auxiliar:

```text
Nuevo Laredo – Laredo
Ciudad Juárez – El Paso
Tijuana – Otay Mesa
Reynosa – Hidalgo/Pharr
Matamoros – Brownsville
Nogales – Nogales
Piedras Negras – Eagle Pass
Mexicali – Calexico
```

Este catálogo facilitará la captura, pero el XML deberá usar las claves oficiales correspondientes.

---

# 9. Transporte ferroviario

Crear el bloque:

```text
TransporteFerroviario
├── TipoDeServicio
├── TipoDeTrafico
├── NombreAseg
├── NumPolizaSeguro
├── DerechosDePaso
└── Carro
    └── Contenedor
```

---

## 9.1 Datos principales

- Tipo de servicio ferroviario.
- Tipo de tráfico.
- Aseguradora.
- Número de póliza.
- Estación de origen.
- Estaciones intermedias.
- Estación de destino.
- Derechos de paso.
- Carros ferroviarios.
- Contenedores.
- Guía del carro.
- Toneladas netas.

---

## 9.2 Carro ferroviario

Cada carro debe permitir:

```text
TipoCarro
MatriculaCarro
GuiaCarro
ToneladasNetasCarro
```

---

## 9.3 Contenedor ferroviario

Cada carro puede relacionarse con:

```text
TipoContenedor
PesoContenedorVacio
PesoNetoMercancia
```

Debe utilizarse el catálogo ferroviario correspondiente.

---

## 9.4 Derechos de paso

Deben modelarse como colección:

```text
DerechosDePaso
├── TipoDerechoDePaso
└── KilometrajePagado
```

---

# 10. Transporte marítimo

Crear el bloque:

```text
TransporteMaritimo
├── Permiso
├── Embarcación
├── Seguro
├── Agente naviero
├── Viaje
├── Conocimiento de embarque
└── Contenedores
```

---

## 10.1 Datos principales

- Permiso.
- Número de permiso.
- Aseguradora.
- Póliza.
- Tipo de embarcación.
- Matrícula.
- Número OMI.
- Año de la embarcación.
- Nombre de la embarcación.
- Nacionalidad.
- Unidades de arqueo bruto.
- Tipo de carga.
- Certificado ITC.
- Eslora.
- Manga.
- Calado.
- Línea naviera.
- Agente naviero.
- Número de autorización.
- Número de viaje.
- Conocimiento de embarque.

Ejemplo de número OMI:

```text
IMO1234567
```

---

## 10.2 Contenedores marítimos

Cada embarque puede incluir:

```text
MatriculaContenedor
TipoContenedor
NumPrecinto
IdCCPRelacionado
PlacaVMCCP
FechaCertificacionCCP
```

Debe utilizarse el catálogo específico de contenedores marítimos.

---

# 11. Transporte aéreo

Crear el bloque:

```text
TransporteAereo
├── Permiso
├── Aeronave
├── Seguro
├── Guía aérea
├── Código del transportista
├── Lugar de contrato
└── Datos del embarcador
```

---

## 11.1 Datos principales

- Permiso.
- Número de permiso.
- Matrícula de aeronave.
- Aseguradora.
- Número de póliza.
- Número de guía aérea.
- Lugar del contrato.
- Código del transportista.
- RFC o identificación del embarcador.
- Nombre del embarcador.
- Residencia fiscal.
- Número de registro tributario.

---

## 11.2 Número de guía aérea

Debe validarse con las longitudes y patrones del estándar.

Ejemplo:

```text
NumeroGuia
```

---

## 11.3 Vuelos múltiples

Regla operativa:

```text
Si una mercancía se divide en dos vuelos,
se deberá separar la documentación correspondiente
a cada vuelo.
```

---

# 12. Figuras de transporte

La estructura nacional puede reutilizarse:

```text
Operador
Propietario
Arrendador
Notificado
```

Debe ampliarse con:

```text
TipoFigura
RFCFigura
NumLicencia
NombreFigura
NumRegIdTribFigura
ResidenciaFiscalFigura
Domicilio
PartesTransporte
```

Reglas:

```text
Si la figura es mexicana:
    solicitar RFC

Si la figura es extranjera:
    solicitar ResidenciaFiscal
    solicitar NumRegIdTribFigura

Si TipoFigura = Operador:
    solicitar licencia cuando corresponda

Si TipoFigura = Propietario o Arrendador:
    permitir PartesTransporte
```

---

# 13. Transporte multimodal

Ejemplo:

```text
Chicago
   ↓ Ferrocarril
Laredo, Texas
   ↓ Autotransporte
Nuevo Laredo
   ↓ Autotransporte
Monterrey
```

Otro ejemplo:

```text
Shanghai
   ↓ Marítimo
Manzanillo
   ↓ Ferrocarril
San Luis Potosí
   ↓ Autotransporte
Planta del cliente
```

No debe manejarse como una sola pantalla gigante.

Debe crearse:

```text
Expediente de transporte
├── Tramo 1
├── Tramo 2
├── Tramo 3
└── Tramo N
```

Cada tramo deberá contener:

```text
Origen
Destino
Medio de transporte
Transportista
Mercancías
Peso
Distancia
Fecha y hora
Documento de transporte
CFDI relacionado
IdCCP
Estatus
```

---

# 14. Cambios recomendados en base de datos

## 14.1 Tabla principal

Tabla:

```sql
carta_porte
```

Campos nuevos:

```sql
transporte_internacional BOOLEAN NOT NULL DEFAULT FALSE,
entrada_salida_mercancia VARCHAR(10),
pais_origen_destino VARCHAR(3),
via_entrada_salida VARCHAR(5),
medio_transporte VARCHAR(2),
version_complemento VARCHAR(5) DEFAULT '3.1'
```

---

## 14.2 Regímenes aduaneros

Tabla:

```sql
carta_porte_regimenes_aduaneros
```

Campos:

```sql
id
carta_porte_id
regimen_aduanero
orden
```

---

## 14.3 Documentación aduanera

Tabla:

```sql
mercancia_documentacion_aduanera
```

Campos:

```sql
id
mercancia_id
tipo_documento
numero_pedimento
identificador_documento
rfc_importador
```

---

## 14.4 Tramos

Tabla:

```sql
carta_porte_tramos
```

Campos:

```sql
id
expediente_id
orden
ubicacion_origen_id
ubicacion_destino_id
medio_transporte
transportista_id
fecha_salida
fecha_llegada
distancia_recorrida
estatus
cfdi_uuid
id_ccp
```

---

## 14.5 Transporte ferroviario

Tablas:

```sql
carta_porte_ferroviario
carta_porte_ferroviario_derechos_paso
carta_porte_ferroviario_carros
carta_porte_ferroviario_contenedores
```

---

## 14.6 Transporte marítimo

Tablas:

```sql
carta_porte_maritimo
carta_porte_maritimo_contenedores
```

---

## 14.7 Transporte aéreo

Tabla:

```sql
carta_porte_aereo
```

---

# 15. Validaciones antes del timbrado

Se recomienda crear un validador por capas.

---

## 15.1 Capa CFDI

Validar:

- Emisor.
- Receptor.
- Tipo de comprobante.
- Moneda.
- Tipo de cambio.
- Conceptos.
- Impuestos.
- Exportación.
- Lugar de expedición.

---

## 15.2 Capa Carta Porte general

Validar:

- Versión 3.1.
- `IdCCP`.
- Transporte internacional.
- Distancia total.
- Ubicaciones.
- Mercancías.
- Peso bruto.
- Unidad de peso.
- Medio de transporte.
- Figuras.

---

## 15.3 Capa internacional

Validar:

```text
TranspInternac = Sí
EntradaSalidaMerc existe
PaisOrigenDestino existe
ViaEntradaSalida existe
RegimenAduaneroCCP existe
TipoMateria existe cuando corresponda
DocumentacionAduanera existe
```

---

## 15.4 Capa modal

```text
Si medio = 01:
    validar Autotransporte

Si medio = 02:
    validar TransporteMaritimo

Si medio = 03:
    validar TransporteAereo

Si medio = 04:
    validar TransporteFerroviario
```

---

## 15.5 Validación técnica

Antes de enviar al PAC:

```text
1. Construir XML.
2. Validar CFDI 4.0.
3. Validar CartaPorte31.xsd.
4. Validar catálogos.
5. Ejecutar reglas internas.
6. Generar cadena original.
7. Sellar.
8. Enviar al PAC.
```

---

# 16. Expediente documental internacional

La Carta Porte no sustituye:

- Pedimento.
- DODA.
- Manifiesto.
- Bill of Lading.
- Air Waybill.
- Conocimiento de embarque.
- Documentos CBP.
- Documentos ferroviarios.
- Documentos marítimos.
- Documentos aéreos.

Se recomienda crear:

```text
Expediente de comercio exterior
├── CFDI
├── Carta Porte
├── Pedimento
├── DODA
├── Factura comercial
├── Packing List
├── Bill of Lading
├── Air Waybill
├── Manifiesto ferroviario
├── Documentos CBP
└── Acuses y anexos
```

---

# 17. Orden recomendado de desarrollo

## Fase 1. Autotransporte internacional México–Estados Unidos

Agregar:

- `TranspInternac`.
- Entrada o salida.
- País.
- Vía.
- Régimen aduanero.
- Domicilios extranjeros.
- Participantes extranjeros.
- Tipo de materia.
- Documentación aduanera.
- Cruce fronterizo.
- Validaciones internacionales.

---

## Fase 2. Ferroviario

Agregar:

- Estaciones.
- Derechos de paso.
- Carros.
- Contenedores ferroviarios.
- Toneladas.
- Guías ferroviarias.

---

## Fase 3. Marítimo

Agregar:

- Embarcaciones.
- Agente naviero.
- Conocimiento de embarque.
- Viaje.
- Contenedores marítimos.
- Precintos.

---

## Fase 4. Aéreo

Agregar:

- Aeronave.
- Permisos.
- Guía aérea.
- Código de transportista.
- Embarcador.
- Aeropuertos.

---

## Fase 5. Multimodal

Agregar:

- Expediente logístico.
- Tramos.
- Relación entre CFDI.
- Relación entre IdCCP.
- Seguimiento por medio de transporte.

---

# 18. Arquitectura recomendada

```text
CartaPorteService
├── CartaPorteGeneralValidator
├── CartaPorteInternacionalValidator
├── AutotransporteValidator
├── FerroviarioValidator
├── MaritimoValidator
├── AereoValidator
├── AduanaValidator
├── CatalogosSATService
├── ExpedienteMultimodalService
└── CartaPorteXmlBuilder
```

---

# 19. Conclusión

La base nacional puede conservarse.

No es necesario rehacer:

- CFDI.
- Ubicaciones.
- Mercancías.
- Cantidades transportadas.
- Figuras.
- Catálogos generales.
- Timbrado.
- Autotransporte nacional.

La ampliación debe concentrarse en:

```text
1. ComercioExteriorCartaPorte
2. DocumentacionAduanera
3. ParticipantesExtranjeros
4. DomiciliosExtranjeros
5. SelectorModalTransporte
6. TransporteFerroviario
7. TransporteMaritimo
8. TransporteAereo
9. ExpedienteMultimodal
10. ValidacionesPreviasAlTimbrado
```

Con esta arquitectura, el sistema podrá evolucionar de Carta Porte nacional a una solución internacional y multimodal sin mezclar reglas de autotransporte, ferrocarril, barco y avión.
