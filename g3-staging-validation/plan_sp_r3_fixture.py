"""Planificador read-only para el fixture SP-R3.

Se ejecuta con ``odoo-bin shell``. La funcion :func:`plan_fixture` es la
unidad inyectable usada por las pruebas; nunca abre una transaccion de
escritura ni selecciona una tupla distinta despues de sellar el plan.
"""

import datetime as dt
import base64
import hashlib
import json
import os
from pathlib import Path


MARKER = "[SP-R3 FIXTURE 2026-09-18]"
WAREHOUSE_ID = 76
COMPANY_ID = 35
EMPLOYEE_IDS = (586, 2548, 2549, 2550)
APPROVED_EMPLOYEES = {
    586: ("operador_rolito", COMPANY_ID, None),
    2548: ("supervisor_produccion", COMPANY_ID, 76),
    2549: ("operador_barra", COMPANY_ID, 76),
    2550: ("supervisor_produccion", COMPANY_ID, 115),
}
ENERGY_FIXTURE_PHOTO_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
ENERGY_FIXTURE_PHOTO_SHA256 = hashlib.sha256(
    base64.b64decode(ENERGY_FIXTURE_PHOTO_B64, validate=True)).hexdigest()
CONFIG_KEYS = (
    "gf_production.require_haccp_for_close",
    "gf_production.require_energy_for_close",
    "gf_production.handover_blocking",
    "gf_production_ops.material_stock_enabled",
)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _write_private(path, value):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(descriptor, canonical(value))
    finally:
        os.close(descriptor)
    os.chmod(target, 0o600)


class OdooReadOnlyOps:
    """Adaptador de solo lectura; sus metodos no contienen primitivas mutantes."""

    def __init__(self, env):
        self.env = env
        self.cr = env.cr

    @property
    def neutralized(self):
        value = self.env["ir.config_parameter"].sudo().get_param("database.is_neutralized")
        return str(value).strip().lower() in ("1", "true", "yes")

    def environment(self):
        target_warehouse = self.env["stock.warehouse"].sudo().browse(WAREHOUSE_ID).exists()
        employees = self.env["hr.employee"].sudo().browse(EMPLOYEE_IDS).exists()
        employee_data = {}
        for employee in employees:
            role = getattr(getattr(employee, "job_id", False), "x_job_key", False) or ""
            employee_warehouse = getattr(employee, "warehouse_id", False)
            employee_data[employee.id] = {
                "id": employee.id,
                "company_id": employee.company_id.id,
                "warehouse_ids": [employee_warehouse.id] if employee_warehouse else [],
                "role": role,
            }
        params = self.env["ir.config_parameter"].sudo()
        param_rows = params.search([("key", "in", list(CONFIG_KEYS))])
        existing_params = {row.key: row.value for row in param_rows}
        modules = self.env["ir.module.module"].sudo().search([
            ("name", "in", ["gf_production_ops", "gf_plant_energy", "gf_milling_control"])
        ])
        haccp_template = self.env["gf.haccp.template"].sudo().search([
            ("active", "=", True), ("line_type", "in", ["all", "rolito"]),
        ], limit=1)
        checks = haccp_template.check_template_ids.sorted(key=lambda row: (row.sequence, row.id))
        return {
            "database": self.cr.dbname,
            "neutralized": self.neutralized,
            "warehouse": {
                "id": target_warehouse.id,
                "company_id": target_warehouse.company_id.id,
                "code": target_warehouse.code,
            },
            "employees": employee_data,
            "backend_sha": os.environ.get("SP_BACKEND_SHA", ""),
            "frontend_sha": os.environ.get("SP_FRONTEND_SHA", ""),
            "module_versions": {module.name: module.installed_version for module in modules},
            "params": {key: existing_params.get(key) for key in CONFIG_KEYS},
            "haccp_template": {"id": haccp_template.id, "checks": [
                {"template_id": row.id, "check_type": row.check_type,
                 "min_value": row.min_value, "max_value": row.max_value}
                for row in checks
            ]},
        }

    def occupied_shifts(self):
        shifts = self.env["gf.production.shift"].sudo().search([
            ("plant_warehouse_id", "=", WAREHOUSE_ID),
        ])
        return [{
            "id": shift.id,
            "date": str(shift.date),
            "shift_code": str(shift.shift_code),
            "warehouse_id": shift.plant_warehouse_id.id,
            "state": shift.state,
            "has_production": bool(shift.line_ids),
        } for shift in shifts]


def _ops(env):
    return env if hasattr(env, "occupied_shifts") else OdooReadOnlyOps(env)


def _verify_environment(info, seal, expected_db):
    if not expected_db or info.get("database") != expected_db:
        raise RuntimeError("STOP: SP_EXPECTED_DB mismatch")
    if not info.get("neutralized"):
        raise RuntimeError("STOP: database.is_neutralized is not true")
    warehouse = info.get("warehouse") or {}
    if (warehouse.get("id"), warehouse.get("company_id")) != (WAREHOUSE_ID, COMPANY_ID):
        raise RuntimeError("STOP: warehouse_id/company_id mismatch")
    if seal.get("database") != expected_db or seal.get("warehouse_id") != WAREHOUSE_ID:
        raise RuntimeError("STOP: environment seal mismatch")
    if seal.get("schema") != "g3_environment_seal_v1" or seal.get("branch") != "staging-g3-clean-170926":
        raise RuntimeError("STOP: environment seal branch/schema mismatch")
    if seal.get("company_id") != COMPANY_ID:
        raise RuntimeError("STOP: company seal mismatch")
    if seal.get("warehouse_code") != warehouse.get("code"):
        raise RuntimeError("STOP: warehouse code seal mismatch")
    if seal.get("backend_sha") != info.get("backend_sha"):
        raise RuntimeError("STOP: backend SHA mismatch")
    if seal.get("frontend_sha") != info.get("frontend_sha"):
        raise RuntimeError("STOP: frontend SHA mismatch")
    if seal.get("module_versions") != info.get("module_versions"):
        raise RuntimeError("STOP: module version seal mismatch")
    employees = info.get("employees") or {}
    for employee_id, (role, company_id, warehouse_id) in APPROVED_EMPLOYEES.items():
        actual = employees.get(employee_id) or {}
        expected_warehouses = [] if warehouse_id is None else [warehouse_id]
        if (actual.get("role"), actual.get("company_id"), actual.get("warehouse_ids")) != (
                role, company_id, expected_warehouses):
            raise RuntimeError("STOP: employee identity/role/company/warehouse mismatch")


def _free_tuple(occupied, start_date):
    taken = {(str(row.get("date")), str(row.get("shift_code"))) for row in occupied}
    candidate = dt.date.fromisoformat(start_date)
    for _day in range(367):
        for shift_code in ("1", "2"):
            if (candidate.isoformat(), shift_code) not in taken:
                return candidate.isoformat(), shift_code
        candidate += dt.timedelta(days=1)
    raise RuntimeError("STOP: no free SP-R3 fixture tuple")


def plan_fixture(env, seal, output_path, expected_db=None, today=None):
    operations = _ops(env)
    expected_db = expected_db or os.environ.get("SP_EXPECTED_DB")
    info = operations.environment()
    _verify_environment(info, seal, expected_db)
    date_value, shift_code = _free_tuple(
        operations.occupied_shifts(), today or dt.date.today().isoformat())
    haccp = info.get("haccp_template") or {}
    if not haccp.get("id") or not haccp.get("checks"):
        raise RuntimeError("STOP: HACCP template/check catalog is incomplete")
    if any(check.get("check_type") not in ("numeric", "yes_no")
           for check in haccp["checks"]):
        raise RuntimeError("STOP: HACCP fixture only supports numeric/yes_no checks")
    if any(check.get("check_type") == "numeric" and
           not (check.get("min_value") or check.get("max_value"))
           for check in haccp["checks"]):
        raise RuntimeError("STOP: numeric HACCP fixture checks require a bound")
    plan = {
        "schema": "sp_r3_fixture_plan_v1",
        "database": expected_db,
        "warehouse_id": WAREHOUSE_ID,
        "warehouse_code": info["warehouse"]["code"],
        "company_id": COMPANY_ID,
        "date": date_value,
        "shift_code": shift_code,
        "leader_employee_id": 2548,
        "operator_employee_id": 2549,
        "rolito_employee_id": 586,
        "negative_employee_id": 2550,
        "negative_employee_warehouse_id": 115,
        "employee_contexts": [
            {"id": employee_id, "role": role, "company_id": company_id,
             "warehouse_id": warehouse_id}
            for employee_id, (role, company_id, warehouse_id) in sorted(APPROVED_EMPLOYEES.items())
        ],
        "employee_warehouse_adjustment": {
            "employee_id": 586, "before": None, "after": WAREHOUSE_ID,
            "write_class": "FIXTURE_SETUP",
        },
        "fixture_photo_sha256": ENERGY_FIXTURE_PHOTO_SHA256,
        "fixture_notes": {
            "issue": "%s material" % MARKER,
            "settlement": "%s conciliacion" % MARKER,
        },
        "energy_end_values": {
            "base": 110.0, "intermedia": 55.0, "punta": 30.0,
        },
        "haccp_template_id": haccp["id"],
        "haccp_checks": list(haccp["checks"]),
        "marker": MARKER,
        "backend_sha": info["backend_sha"],
        "frontend_sha": info["frontend_sha"],
        "module_versions": info["module_versions"],
        "previous_params": {key: info["params"].get(key) for key in CONFIG_KEYS},
        "planned_params": {
            "gf_production.require_haccp_for_close": "1",
            "gf_production.require_energy_for_close": "1",
            "gf_production.handover_blocking": "0",
            "gf_production_ops.material_stock_enabled": "0",
        },
        "expected_blockers": sorted({
            "haccp", "energy_end", "open_downtime", "open_cycles",
            "operator_barra_not_closed", "operator_rolito_not_closed",
        }),
        "database_writes": 0,
    }
    _write_private(output_path, plan)
    return plan


def main(env):
    output = os.environ.get("SP_PLAN_PATH", "/tmp/sp-r3-fixture-plan.json")
    seal_path = os.environ["G3_SEAL_PATH"]
    seal_raw = Path(seal_path).read_bytes()
    expected = os.environ["G3_SEAL_SHA256"]
    if hashlib.sha256(seal_raw).hexdigest() != expected:
        raise RuntimeError("STOP: environment seal hash mismatch")
    result = plan_fixture(env, json.loads(seal_raw), output)
    print(json.dumps({"output": output,
                      "sha256": hashlib.sha256(Path(output).read_bytes()).hexdigest()},
                     sort_keys=True))
    return result


if "env" in globals():  # pragma: no cover - odoo-bin shell wrapper
    main(env)  # noqa: F821
