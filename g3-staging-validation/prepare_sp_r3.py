"""Setup transaccional y fail-closed del fixture SP-R3."""

import hashlib
import json
import os
from pathlib import Path


MARKER = "[SP-R3 FIXTURE 2026-09-18]"
WAREHOUSE_ID = 76
COMPANY_ID = 35
EXPECTED_EMPLOYEES = {
    2548: ("supervisor_produccion", COMPANY_ID, WAREHOUSE_ID),
    2549: ("operador_barra", COMPANY_ID, WAREHOUSE_ID),
    2550: ("supervisor_produccion", COMPANY_ID, 115),
}
EXPECTED_BLOCKERS = {
    "haccp", "energy_end", "open_downtime", "open_cycles",
    "operator_barra_not_closed", "operator_rolito_not_closed",
}
PLANNED_PARAMS = {
    "gf_production.require_haccp_for_close": "1",
    "gf_production.require_energy_for_close": "1",
    "gf_production.handover_blocking": "0",
    "gf_production_ops.material_stock_enabled": "0",
}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _write_private(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(descriptor, canonical(value))
    finally:
        os.close(descriptor)
    os.chmod(path, 0o600)


class OdooPrepareOps:
    def __init__(self, env):
        self.env = env
        self.cr = env.cr

    def begin(self):
        return None

    def commit(self):
        self.cr.commit()

    def rollback(self):
        self.cr.rollback()

    @property
    def neutralized(self):
        value = self.env["ir.config_parameter"].sudo().get_param("database.is_neutralized")
        return str(value).strip().lower() in ("1", "true", "yes")

    def environment(self):
        warehouse = self.env["stock.warehouse"].sudo().browse(WAREHOUSE_ID).exists()
        employees = self.env["hr.employee"].sudo().browse(list(EXPECTED_EMPLOYEES)).exists()
        info = {}
        for employee in employees:
            role = getattr(getattr(employee, "job_id", False), "x_job_key", False) or ""
            warehouse = getattr(employee, "warehouse_id", False)
            info[employee.id] = {"id": employee.id, "company_id": employee.company_id.id,
                                 "warehouse_ids": [warehouse.id] if warehouse else [], "role": role}
        params = self.env["ir.config_parameter"].sudo()
        modules = self.env["ir.module.module"].sudo().search([
            ("name", "in", ["gf_production_ops", "gf_plant_energy", "gf_milling_control"])
        ])
        return {
            "database": self.cr.dbname,
            "neutralized": self.neutralized,
            "warehouse": {"id": warehouse.id, "company_id": warehouse.company_id.id,
                          "code": warehouse.code},
            "employees": info,
            "backend_sha": os.environ.get("SP_BACKEND_SHA", ""),
            "frontend_sha": os.environ.get("SP_FRONTEND_SHA", ""),
            "module_versions": {record.name: record.installed_version for record in modules},
            "params": {key: params.get_param(key) for key in PLANNED_PARAMS},
        }

    def occupied_shifts(self):
        shifts = self.env["gf.production.shift"].sudo().search([
            ("plant_warehouse_id", "=", WAREHOUSE_ID),
        ])
        return [{"id": row.id, "date": str(row.date), "shift_code": str(row.shift_code),
                 "warehouse_id": row.plant_warehouse_id.id,
                 "state": row.state,
                 "has_production": bool(row.line_ids)} for row in shifts]

    def set_param(self, key, value):
        self.env["ir.config_parameter"].sudo().set_param(key, value)

    def _marked(self, text):
        return "%s %s" % (MARKER, text)

    def create_fixture(self, plan, marker):
        Shift = self.env["gf.production.shift"].sudo()
        lines = self.env["gf.production.line"].sudo().search([
            ("plant_warehouse_id", "=", WAREHOUSE_ID), ("active", "=", True),
            ("line_type", "in", ["rolito", "barras"]),
        ])
        if not {"rolito", "barras"} <= set(lines.mapped("line_type")):
            raise RuntimeError("STOP: fixture requires active rolito and barras lines")
        shift = Shift.create({
            "date": plan["date"], "shift_code": plan["shift_code"],
            "plant_warehouse_id": WAREHOUSE_ID, "leader_employee_id": 2548,
            "operator_employee_ids": [(6, 0, [2549])], "state": "in_progress",
            "line_ids": [(6, 0, lines.ids)], "notes": self._marked("turno"),
        })
        meter = self.env["gf.energy.meter"].sudo().search([
            ("warehouse_id", "=", WAREHOUSE_ID), ("active", "=", True),
        ], limit=1)
        energy = self.env["gf.energy.reading"].sudo().create({
            "shift_id": shift.id, "reading_type": "start", "employee_id": 2548,
            "meter_id": meter.id, "kwh_value": 0,
            "kwh_base": 0, "kwh_intermedia": 0, "kwh_punta": 0,
        })
        shift.write({"energy_start_id": energy.id})
        template = self.env["gf.haccp.template"].sudo().search([
            ("active", "=", True), ("line_type", "in", ["all", "rolito"]),
        ], limit=1)
        if not template:
            raise RuntimeError("STOP: no HACCP template available")
        haccp = self.env["gf.haccp.checklist"].sudo().create({
            "shift_id": shift.id, "template_id": template.id,
            "state": "pending", "notes": self._marked("HACCP pendiente"),
        })
        shift.write({"haccp_checklist_id": haccp.id})
        machine = self.env["gf.production.machine"].sudo().search([
            ("line_id.plant_warehouse_id", "=", WAREHOUSE_ID),
            ("line_id.line_type", "=", "rolito"),
            ("machine_type", "=", "evaporador"), ("active", "=", True),
        ], limit=1)
        if not machine:
            raise RuntimeError("STOP: no active rolito evaporator available")
        cycle = self.env["gf.evaporator.cycle"].sudo().create({
            "shift_id": shift.id, "machine_id": machine.id, "cycle_number": 1,
            "state": "freezing", "notes": self._marked("ciclo abierto"),
        })
        category = self.env["gf.production.downtime.category"].sudo().search([
            ("active", "=", True),
        ], limit=1)
        if not category:
            raise RuntimeError("STOP: no downtime category available")
        downtime = self.env["gf.production.downtime"].sudo().create({
            "shift_id": shift.id, "line_id": machine.line_id.id,
            "machine_id": machine.id, "category_id": category.id,
            "state": "open", "reason": self._marked("paro abierto"),
            "company_id": COMPANY_ID, "warehouse_id": WAREHOUSE_ID,
        })
        material = self.env["gf.production.material"].sudo().search([
            ("active", "=", True), ("company_id", "=", COMPANY_ID),
            ("applies_to_rolito", "=", True),
        ], limit=1)
        if not material:
            raise RuntimeError("STOP: no applicable production material available")
        issue = self.env["gf.production.material.issue"].sudo().create({
            "shift_id": shift.id, "line_id": machine.line_id.id, "material_id": material.id,
            "qty_issued": 1, "issued_by": 2548, "received_by": 2549,
            "state": "draft", "notes": self._marked("material"),
        })
        settlement = self.env["gf.production.material.settlement"].sudo().create({
            "shift_id": shift.id, "line_id": machine.line_id.id, "material_id": material.id,
            "state": "draft", "notes": self._marked("conciliacion"),
        })
        return {"shift": shift.id, "energy_start": energy.id, "haccp": haccp.id,
                "cycle": cycle.id, "downtime": downtime.id, "issue": issue.id,
                "settlement": settlement.id}

    def fixture_blockers(self, shift_id):
        shift = self.env["gf.production.shift"].sudo().browse(shift_id).exists()
        readiness = shift._get_shift_close_readiness()
        return {item["code"] for item in readiness.get("blockers", [])}

    def fixture_state(self, ids):
        model_by_alias = {
            "shift": "gf.production.shift", "energy_start": "gf.energy.reading",
            "haccp": "gf.haccp.checklist", "cycle": "gf.evaporator.cycle",
            "downtime": "gf.production.downtime", "issue": "gf.production.material.issue",
            "settlement": "gf.production.material.settlement",
        }
        result = {}
        for alias, record_id in ids.items():
            record = self.env[model_by_alias[alias]].sudo().browse(record_id).exists()
            result[alias] = {"id": record.id, "state": getattr(record, "state", "created")}
        return result


def _ops(env):
    return env if hasattr(env, "create_fixture") else OdooPrepareOps(env)


def _ensure_context(ops, expected_db):
    if not expected_db or ops.cr.dbname != expected_db:
        raise RuntimeError("STOP: SP_EXPECTED_DB mismatch")
    info = ops.environment()
    if not info.get("neutralized"):
        raise RuntimeError("STOP: database.is_neutralized is not true")
    warehouse = info.get("warehouse") or {}
    if (warehouse.get("id"), warehouse.get("company_id")) != (WAREHOUSE_ID, COMPANY_ID):
        raise RuntimeError("STOP: warehouse_id/company_id mismatch")
    for employee_id, (role, company_id, warehouse_id) in EXPECTED_EMPLOYEES.items():
        actual = (info.get("employees") or {}).get(employee_id) or {}
        if actual.get("role") != role or actual.get("company_id") != company_id:
            raise RuntimeError("STOP: employee identity/role mismatch")
        if warehouse_id not in actual.get("warehouse_ids", []):
            raise RuntimeError("STOP: employee warehouse mismatch")
    return info


def _verify_seals(plan, contract, plan_sha256, contract_sha256):
    if digest(plan) != plan_sha256 or digest(contract) != contract_sha256:
        raise RuntimeError("STOP: fixture plan/contract hash mismatch")
    if plan.get("schema") != "sp_r3_fixture_plan_v1":
        raise RuntimeError("STOP: invalid fixture plan")
    if contract.get("schema") != "sp_r3_fixture_contract_v1":
        raise RuntimeError("STOP: invalid FIXTURE_SETUP contract")
    for key in ("database", "warehouse_id", "company_id", "date", "shift_code", "marker"):
        if plan.get(key) != contract.get(key):
            raise RuntimeError("STOP: plan/contract identity mismatch")
    if plan.get("marker") != MARKER or contract.get("write_class") != "FIXTURE_SETUP":
        raise RuntimeError("STOP: fixture marker/write class mismatch")
    if plan.get("planned_params") != PLANNED_PARAMS:
        raise RuntimeError("STOP: planned configuration mismatch")
    if set(plan.get("expected_blockers", [])) != EXPECTED_BLOCKERS:
        raise RuntimeError("STOP: expected blocker contract mismatch")
    if contract.get("planned_params") != PLANNED_PARAMS:
        raise RuntimeError("STOP: FIXTURE_SETUP configuration mismatch")
    if set(contract.get("expected_blockers", [])) != EXPECTED_BLOCKERS:
        raise RuntimeError("STOP: FIXTURE_SETUP blocker mismatch")
    if set(contract.get("aliases", [])) != {
            "shift", "energy_start", "haccp", "cycle", "downtime", "issue", "settlement"}:
        raise RuntimeError("STOP: FIXTURE_SETUP alias mismatch")


def _tuple_is_free(ops, plan):
    existing = ops.occupied_shifts()
    active = [row for row in existing
              if row.get("warehouse_id") == WAREHOUSE_ID and
              row.get("state") in ("draft", "in_progress")]
    if active:
        raise RuntimeError("STOP: another active shift would win fixture resolution")
    collisions = [row for row in existing
                  if row.get("warehouse_id") == WAREHOUSE_ID and
                  str(row.get("date")) == plan["date"] and
                  str(row.get("shift_code")) == str(plan["shift_code"])]
    if collisions:
        production = any(row.get("has_production") for row in collisions)
        raise RuntimeError("STOP: planned date/shift collision%s" %
                           (" with production" if production else ""))


def prepare_fixture(env, output_path, plan, contract, plan_sha256,
                    contract_sha256, expected_db=None):
    operations = _ops(env)
    expected_db = expected_db or os.environ.get("SP_EXPECTED_DB")
    _verify_seals(plan, contract, plan_sha256, contract_sha256)
    info = _ensure_context(operations, expected_db)
    _tuple_is_free(operations, plan)
    if plan.get("backend_sha") != info.get("backend_sha") or plan.get("frontend_sha") != info.get("frontend_sha"):
        raise RuntimeError("STOP: deployed SHA mismatch")
    if plan.get("module_versions") != info.get("module_versions"):
        raise RuntimeError("STOP: module version mismatch")
    try:
        operations.begin()
        previous = {key: info["params"].get(key) for key in PLANNED_PARAMS}
        for key, value in PLANNED_PARAMS.items():
            if str(previous.get(key)) != str(value):
                operations.set_param(key, value)
        ids = operations.create_fixture(plan, MARKER)
        blockers = set(operations.fixture_blockers(ids["shift"]))
        if blockers != EXPECTED_BLOCKERS:
            raise RuntimeError("STOP: exact blocker postcondition failed: %s" % sorted(blockers))
        states = operations.fixture_state(ids)
        if set(states) != {"shift", "energy_start", "haccp", "cycle", "downtime", "issue", "settlement"}:
            raise RuntimeError("STOP: fixture record postcondition failed")
        report = {
            "schema": "sp_r3_fixture_setup_v1", "database": expected_db,
            "warehouse_id": WAREHOUSE_ID, "company_id": COMPANY_ID,
            "marker": MARKER, "date": plan["date"], "shift_code": plan["shift_code"],
            "write_class": "FIXTURE_SETUP", "previous_params": previous,
            "applied_params": dict(PLANNED_PARAMS),
            "blocker_codes": sorted(blockers), "records": states,
            "fixture_sha256": digest({"records": states, "blocker_codes": sorted(blockers)}),
        }
        _write_private(output_path, report)
        operations.commit()
        return report
    except Exception:
        operations.rollback()
        path = Path(output_path)
        if path.is_file():
            path.unlink()
        raise


def _load(path, expected):
    raw = Path(path).read_bytes()
    value = json.loads(raw)
    if digest(value) != expected:
        raise RuntimeError("STOP: sealed input hash mismatch")
    return value


def main(env):
    # Direct comparison is intentional and covered by the static safety contract.
    if env.cr.dbname != os.environ.get("SP_EXPECTED_DB"):
        raise RuntimeError("STOP: SP_EXPECTED_DB mismatch")
    plan = _load(os.environ["SP_PLAN_PATH"], os.environ["SP_PLAN_SHA256"])
    contract = _load(os.environ["SP_FIXTURE_CONTRACT_PATH"],
                     os.environ["SP_FIXTURE_CONTRACT_SHA256"])
    return prepare_fixture(env, os.environ.get("SP_SETUP_PATH", "/tmp/sp-r3-fixture-setup.json"),
                           plan, contract, os.environ["SP_PLAN_SHA256"],
                           os.environ["SP_FIXTURE_CONTRACT_SHA256"])


if "env" in globals():  # pragma: no cover - odoo-bin shell wrapper
    main(env)  # noqa: F821
