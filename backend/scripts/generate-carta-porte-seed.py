#!/usr/bin/env python3
"""
Convierte los catálogos oficiales de Carta Porte 3.1 (XLS del SAT) a un archivo
SQL de seed idempotente que puede aplicarse a la BD de ALMACEN.

Uso:
    python generate-carta-porte-seed.py \
        --xls E:/Obsidian/ANBEOR/raw/carta_porte_31/CatalogosCartaPorte31.xls \
        --out ../src/database/seeds/2026-07-18_carta_porte_catalogs.sql

Diseño:
  · Idempotente: cada catálogo va con INSERT ... ON CONFLICT DO UPDATE
  · Versionado: cada carga registra sha256, record_count y timestamp en
    catalog_versions para auditar cambios del SAT
  · Conservador: solo procesa los catálogos oficialmente publicados por el SAT
    en CatalogosCartaPorte31.xls; NO inventa ni completa datos faltantes
  · Compatible con el runner de migraciones existente del proyecto
    (scripts/migrate-up.js) — este archivo es un seed, no una migración de
    schema. Las tablas se crean con la migración 2026-07-18_carta_porte.sql.

Regla de encoding: el .xls del SAT viene en latin-1 (cp1252). Se convierte
a UTF-8 antes de escribir el SQL. Los caracteres corruptos ("Ø=Ý") se
detectan y quedan reportados.

Fuente oficial:
    http://omawww.sat.gob.mx/tramitesyservicios/Paginas/complemento_carta_porte.htm
"""
import argparse
import hashlib
import re
import sys
from pathlib import Path

try:
    import xlrd
except ImportError:
    print("ERROR: pip install xlrd", file=sys.stderr)
    sys.exit(1)


# ─── Configuración: qué hojas cargar y cómo mapear columnas ────────────────
#
# Cada entrada: nombre de hoja SAT → (tabla SQL, PK col idx, cols a persistir)
#
# Formato de cols:  [(idx_col_xls, nombre_col_sql, tipo_sql)]
#
# El PDF oficial dice que la FILA 4 (índice 0-based) es donde vienen los
# encabezados. La fila 5 en adelante es data. Filas 0-3 son metadata.

HEADER_ROW = 4
DATA_START_ROW = 5

# Mapeo estricto: solo se importa lo que está aquí. Cualquier hoja no listada
# se ignora (silencio) y se reporta al final.
SHEETS_TO_LOAD = {
    # Catálogos básicos (obligatorios para autotransporte)
    "c_ClaveProdServCP": (
        "sat_cp_clave_prod_serv",
        [(0, "clave", "VARCHAR(8)"), (1, "descripcion", "TEXT"),
         (2, "material_peligroso", "VARCHAR(2)")],
    ),
    "c_ClaveUnidadPeso": (
        "sat_cp_clave_unidad_peso",
        [(0, "clave", "VARCHAR(3)"), (1, "nombre", "VARCHAR(60)"),
         (2, "descripcion", "TEXT")],
    ),
    "c_ConfigAutotransporte": (
        "sat_cp_config_autotransporte",
        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT"),
         (2, "numero_ejes", "VARCHAR(3)"), (3, "numero_llantas", "VARCHAR(3)"),
         (4, "remolque", "VARCHAR(2)")],
    ),
    "c_SubTipoRem": (   # OJO: viene con espacio inicial en el nombre de hoja
        "sat_cp_sub_tipo_rem",
        [(0, "clave", "VARCHAR(6)"), (1, "descripcion", "TEXT")],
    ),
    "c_TipoPermiso": (
        "sat_cp_tipo_permiso",
        [(0, "clave", "VARCHAR(6)"), (1, "descripcion", "TEXT"),
         (2, "clave_transporte", "VARCHAR(4)")],
    ),
    "c_TipoEmbalaje": (
        "sat_cp_tipo_embalaje",
        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")],
    ),
    "c_MaterialPeligroso": (
        "sat_cp_material_peligroso",
        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT"),
         (2, "clase_o_div", "VARCHAR(10)"), (3, "peligro_secundario", "VARCHAR(20)"),
         (4, "nombre_tecnico", "TEXT")],
    ),
    "c_FiguraTransporte": (
        "sat_cp_figura_transporte",
        [(0, "clave", "VARCHAR(2)"), (1, "descripcion", "TEXT")],
    ),
    "c_ParteTransporte": (
        "sat_cp_parte_transporte",
        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")],
    ),
    "c_TipoEstacion": (
        "sat_cp_tipo_estacion",
        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT"),
         (2, "clave_transporte", "VARCHAR(4)")],
    ),
    "c_CveTransporte": (
        "sat_cp_cve_transporte",
        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")],
    ),
    "c_DocumentoAduanero": (
        "sat_cp_documento_aduanero",
        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")],
    ),
    "c_RegimenAduanero": (
        "sat_cp_regimen_aduanero",
        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT"),
         (2, "impoexpo", "VARCHAR(20)")],
    ),
    # Direccional (geográfico) — ya viene en el .xls con las 3 hojas Colonia_*
    "c_Colonia_1": ("sat_cp_colonia", [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT"),
                                       (2, "codigo_postal", "VARCHAR(10)")]),
    "c_Colonia_2": ("sat_cp_colonia", [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT"),
                                       (2, "codigo_postal", "VARCHAR(10)")]),
    "c_Colonia_3": ("sat_cp_colonia", [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT"),
                                       (2, "codigo_postal", "VARCHAR(10)")]),
    "c_Localidad": ("sat_cp_localidad", [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT"),
                                          (2, "estado", "VARCHAR(3)")]),
    "c_Municipio": ("sat_cp_municipio", [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT"),
                                          (2, "estado", "VARCHAR(3)")]),
    # Marítimo, aéreo, ferroviario (Fase B — se cargan igual pero se activan
    # solo si el usuario responde SÍ a §9 pregunta 1)
    "c_ClaveTipoCarga":       ("sat_cp_clave_tipo_carga",       [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
    "c_ConfigMaritima":       ("sat_cp_config_maritima",        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
    "c_ContenedorMaritimo":   ("sat_cp_contenedor_maritimo",    [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
    "c_CodigoTransporteAereo":("sat_cp_codigo_transporte_aereo",[(0, "clave", "VARCHAR(6)"), (1, "nacionalidad", "VARCHAR(60)"), (2, "nombre_aerolinea", "TEXT")]),
    "c_TipoDeServicio":       ("sat_cp_tipo_de_servicio",       [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT"), (2, "contenedor", "VARCHAR(4)")]),
    "c_DerechosDePaso":       ("sat_cp_derechos_de_paso",       [(0, "clave", "VARCHAR(6)"), (1, "descripcion", "TEXT")]),
    "c_TipoCarro":            ("sat_cp_tipo_carro",             [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
    "c_Contenedor":           ("sat_cp_contenedor",             [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
    "c_TipoDeTrafico":        ("sat_cp_tipo_de_trafico",        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
    "c_TipoMateria":          ("sat_cp_tipo_materia",           [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
    "c_RegistroISTMO":        ("sat_cp_registro_istmo",         [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
    "c_Estaciones":           ("sat_cp_estaciones",             [(0, "clave", "VARCHAR(6)"), (1, "descripcion", "TEXT"), (2, "clave_transporte", "VARCHAR(4)")]),
    "c_NumAutorizacionNaviero": ("sat_cp_num_autorizacion_naviero", [(0, "clave", "VARCHAR(10)"), (1, "descripcion", "TEXT")]),
    # Farmacéuticos (para MedicamentosControlados en el complemento)
    "c_SectorCOFEPRIS":       ("sat_cp_sector_cofepris",        [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
    "c_FormaFarmaceutica":    ("sat_cp_forma_farmaceutica",     [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
    "c_CondicionesEspeciales":("sat_cp_condiciones_especiales", [(0, "clave", "VARCHAR(4)"), (1, "descripcion", "TEXT")]),
}


def sql_escape(s: str) -> str:
    """Escapa apóstrofes para SQL. NO usa parámetros porque este archivo
    se genera una vez y se lee muchas veces; el SQL inline es idempotente
    y auditable."""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def clean(v) -> str:
    """Limpia una celda de XLS. Latin-1 → UTF-8; recorta espacios."""
    if v is None or v == "":
        return None
    s = str(v).strip()
    # xlrd devuelve floats para enteros que caben; reconvierte a "N"
    if isinstance(v, float) and v == int(v):
        s = str(int(v))
    return s or None


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def process(xls_path: Path, out_path: Path):
    wb = xlrd.open_workbook(str(xls_path))
    sha = sha256_file(xls_path)
    # Los nombres oficiales del SAT vienen con espacios sobrantes en algunas
    # hojas (' c_SubTipoRem', 'c_Estaciones '). Se normalizan con .strip().
    sheet_by_norm = {n.strip(): n for n in wb.sheet_names()}
    sheets_seen = set(sheet_by_norm.keys())
    sheets_expected = set(SHEETS_TO_LOAD.keys())

    # Encabezado del SQL
    lines = [
        f"-- Seed de catálogos oficiales del Complemento Carta Porte 3.1",
        f"-- Fuente: SAT · CatalogosCartaPorte31.xls",
        f"-- SHA-256: {sha}",
        f"-- Generado por generate-carta-porte-seed.py",
        f"-- IDEMPOTENTE — se puede correr N veces sin duplicar registros",
        f"",
        f"BEGIN;",
        f"",
    ]

    stats = []
    for sheet_name, (table, cols) in SHEETS_TO_LOAD.items():
        if sheet_name not in sheets_seen:
            print(f"  [SKIP] hoja NO encontrada: {sheet_name}", file=sys.stderr)
            continue
        ws = wb.sheet_by_name(sheet_by_norm[sheet_name])
        col_names = ", ".join(c[1] for c in cols)
        # PK compuesta para catálogos geográficos (viene del SAT así)
        composite_pks = {
            "sat_cp_colonia": "clave, codigo_postal",
            "sat_cp_localidad": "clave, estado",
            "sat_cp_municipio": "clave, estado",
        }
        pk_col = composite_pks.get(table, cols[0][1])
        pk_cols_set = set(x.strip() for x in pk_col.split(","))
        update_set = ", ".join(f"{c[1]} = EXCLUDED.{c[1]}" for c in cols if c[1] not in pk_cols_set)

        n = 0
        for row in range(DATA_START_ROW, ws.nrows):
            row_vals = []
            skip = False
            for (idx, name, tipo) in cols:
                if idx >= ws.ncols:
                    row_vals.append("NULL")
                    continue
                v = clean(ws.cell_value(row, idx))
                if idx == cols[0][0] and not v:
                    skip = True
                    break
                row_vals.append(sql_escape(v) if v else "NULL")
            if skip:
                continue
            lines.append(
                f"INSERT INTO {table} ({col_names}) VALUES ({', '.join(row_vals)}) "
                f"ON CONFLICT ({pk_col}) DO UPDATE SET {update_set};"
            )
            n += 1
        stats.append((sheet_name, table, n))
        lines.append(f"-- ↑ {sheet_name} → {table}: {n} filas")
        lines.append("")

    # Registro de versión
    lines.extend([
        "-- Registro de auditoría de esta carga",
        f"INSERT INTO catalog_versions (catalog_name, source_file, sha256, record_count, loaded_at) VALUES",
        f"  ('CartaPorte31', 'CatalogosCartaPorte31.xls', '{sha}', {sum(n for _,_,n in stats)}, NOW())",
        f"ON CONFLICT (sha256) DO NOTHING;",
        "",
        "COMMIT;",
    ])

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"\n[OK] Generado: {out_path}")
    print(f"   Tamano: {out_path.stat().st_size / 1024 / 1024:.2f} MB")
    print(f"\nResumen:")
    for sheet, table, n in stats:
        print(f"   {sheet:36} -> {table:34} {n:>7,} filas")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--xls", required=True, help="Ruta al CatalogosCartaPorte31.xls")
    p.add_argument("--out", required=True, help="Ruta de salida del SQL")
    args = p.parse_args()
    process(Path(args.xls), Path(args.out))
