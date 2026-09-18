"""Setup transaccional y fail-closed del fixture SP-R3."""

import hashlib
import base64
import json
import os
from pathlib import Path


MARKER = "[SP-R3 FIXTURE 2026-09-18]"
WAREHOUSE_ID = 76
COMPANY_ID = 35
EXPECTED_EMPLOYEES = {
    586: ("operador_rolito", COMPANY_ID, None),
    2548: ("supervisor_produccion", COMPANY_ID, WAREHOUSE_ID),
    2549: ("operador_barra", COMPANY_ID, WAREHOUSE_ID),
    2550: ("supervisor_produccion", COMPANY_ID, 115),
}
EMPLOYEE_CONTEXTS = [
    {"id": employee_id, "role": role, "company_id": company_id,
     "warehouse_id": warehouse_id}
    for employee_id, (role, company_id, warehouse_id) in sorted(EXPECTED_EMPLOYEES.items())
]
ENERGY_FIXTURE_PHOTO_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
ENERGY_FIXTURE_PHOTO_SHA256 = hashlib.sha256(
    base64.b64decode(ENERGY_FIXTURE_PHOTO_B64, validate=True)).hexdigest()
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
        target_warehouse = self.env["stock.warehouse"].sudo().browse(WAREHOUSE_ID).exists()
        employees = self.env["hr.employee"].sudo().browse(list(EXPECTED_EMPLOYEES)).exists()
        info = {}
        for employee in employees:
            role = getattr(getattr(employee, "job_id", False), "x_job_key", False) or ""
            employee_warehouse = getattr(employee, "warehouse_id", False)
            info[employee.id] = {"id": employee.id, "company_id": employee.company_id.id,
                                 "warehouse_ids": ([employee_warehouse.id]
                                                   if employee_warehouse else []),
                                 "role": role}
        params = self.env["ir.config_parameter"].sudo()
        param_rows = params.search([("key", "in", list(PLANNED_PARAMS))])
        existing_params = {row.key: row.value for row in param_rows}
        modules = self.env["ir.module.module"].sudo().search([
            ("name", "in", ["gf_production_ops", "gf_plant_energy", "gf_milling_control"])
        ])
        return {
            "database": self.cr.dbname,
            "neutralized": self.neutralized,
            "warehouse": {"id": target_warehouse.id,
                          "company_id": target_warehouse.company_id.id,
                          "code": target_warehouse.code},
            "employees": info,
            "backend_sha": os.environ.get("SP_BACKEND_SHA", ""),
            "frontend_sha": os.environ.get("SP_FRONTEND_SHA", ""),
            "module_versions": {record.name: record.installed_version for record in modules},
            "params": {key: existing_params.get(key) for key in PLANNED_PARAMS},
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

    def set_employee_warehouse(self, employee_id, warehouse_id):
        employee = self.env["hr.employee"].sudo().browse(employee_id).exists()
        if not employee:
            raise RuntimeError("STOP: fixture employee is missing")
        employee.write({"warehouse_id": warehouse_id or False})

    def _marked(self, text):
        return "%s %s" % (MARKER, text)

    def create_fixture(self, plan, marker, photo):
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
            "operator_employee_ids": [(6, 0, [2549, 586])], "state": "in_progress",
            "line_ids": [(6, 0, lines.ids)], "notes": self._marked("turno"),
        })
        employee = self.env["hr.employee"].sudo().browse(2548).exists()
        Energy = self.env["gf.energy.reading"].sudo()
        energy = Energy.create_period_reading(
            shift, "start", {"base": 0, "intermedia": 0, "punta": 0},
            employee=employee, photo=photo)
        template = self.env["gf.haccp.template"].sudo().browse(
            plan["haccp_template_id"]).exists()
        if not template or not template.active or template.line_type not in ("all", "rolito"):
            raise RuntimeError("STOP: no HACCP template available")
        actual_checks = [
            {"template_id": row.id, "check_type": row.check_type,
             "min_value": row.min_value, "max_value": row.max_value}
            for row in template.check_template_ids.sorted(key=lambda row: (row.sequence, row.id))
        ]
        expected_checks = plan["haccp_checks"]
        if actual_checks != expected_checks:
            raise RuntimeError("STOP: HACCP template/check catalog drift")
        haccp = self.env["gf.haccp.checklist"].sudo().create({
            "shift_id": shift.id, "template_id": template.id,
            "state": "pending", "notes": self._marked("HACCP pendiente"),
        })
        shift.write({"haccp_checklist_id": haccp.id})
        haccp_checks = {}
        for index, check in enumerate(expected_checks, 1):
            values = {
                "checklist_id": haccp.id,
                "check_template_id": check["template_id"],
                "result_text": "%s HACCP:%s" % (marker, check["template_id"]),
            }
            if check["check_type"] == "numeric":
                values["result_numeric"] = (
                    check["min_value"] - 1 if check["min_value"]
                    else check["max_value"] + 1)
            check_row = self.env["gf.haccp.check"].sudo().create(values)
            haccp_checks["haccp_check_%s" % index] = check_row.id
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
            "state": "draft", "notes": plan["fixture_notes"]["issue"],
        })
        settlement = self.env["gf.production.material.settlement"].sudo().create({
            "shift_id": shift.id, "line_id": machine.line_id.id, "material_id": material.id,
            "state": "draft", "notes": plan["fixture_notes"]["settlement"],
        })
        return {"shift": shift.id, "energy_start": energy.id, "haccp": haccp.id,
                "cycle": cycle.id, "downtime": downtime.id, "issue": issue.id,
                "settlement": settlement.id, **haccp_checks}

    def fixture_blockers(self, shift_id):
        shift = self.env["gf.production.shift"].sudo().browse(shift_id).exists()
        readiness = shift._get_close_readiness()
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
            model = ("gf.haccp.check" if alias.startswith("haccp_check_")
                     else model_by_alias[alias])
            record = self.env[model].sudo().browse(record_id).exists()
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
        expected_warehouses = [] if warehouse_id is None else [warehouse_id]
        if actual.get("warehouse_ids", []) != expected_warehouses:
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
    if (plan.get("leader_employee_id"), plan.get("operator_employee_id"),
            plan.get("rolito_employee_id"),
            plan.get("negative_employee_id"), plan.get("negative_employee_warehouse_id")) != (
            2548, 2549, 586, 2550, 115):
        raise RuntimeError("STOP: fixture employee identity mismatch")
    if plan.get("employee_contexts") != EMPLOYEE_CONTEXTS:
        raise RuntimeError("STOP: sealed employee contexts mismatch")
    if plan.get("employee_warehouse_adjustment") != {
            "employee_id": 586, "before": None, "after": WAREHOUSE_ID,
            "write_class": "FIXTURE_SETUP"}:
        raise RuntimeError("STOP: employee warehouse adjustment mismatch")
    if (plan.get("fixture_photo_sha256") != ENERGY_FIXTURE_PHOTO_SHA256 or
            contract.get("fixture_photo_sha256") != ENERGY_FIXTURE_PHOTO_SHA256):
        raise RuntimeError("STOP: sanitized fixture photo seal mismatch")
    checks = plan.get("haccp_checks") or []
    check_ids = [item.get("template_id") for item in checks]
    if (not isinstance(plan.get("haccp_template_id"), int) or not checks or
            len(check_ids) != len(set(check_ids)) or
            any(item.get("check_type") not in ("numeric", "yes_no") for item in checks) or
            any(item.get("check_type") == "numeric" and
                not (item.get("min_value") or item.get("max_value")) for item in checks)):
        raise RuntimeError("STOP: invalid sealed HACCP catalog")
    if plan.get("planned_params") != PLANNED_PARAMS:
        raise RuntimeError("STOP: planned configuration mismatch")
    if plan.get("fixture_notes") != {
            "issue": "%s material" % MARKER,
            "settlement": "%s conciliacion" % MARKER}:
        raise RuntimeError("STOP: fixture note contract mismatch")
    if plan.get("energy_end_values") != {
            "base": 110.0, "intermedia": 55.0, "punta": 30.0}:
        raise RuntimeError("STOP: energy end contract mismatch")
    if set(plan.get("expected_blockers", [])) != EXPECTED_BLOCKERS:
        raise RuntimeError("STOP: expected blocker contract mismatch")
    if contract.get("planned_params") != PLANNED_PARAMS:
        raise RuntimeError("STOP: FIXTURE_SETUP configuration mismatch")
    if contract.get("employee_warehouse_adjustment") != {
            "employee_id": 586, "before": None, "after": WAREHOUSE_ID,
            "write_class": "FIXTURE_SETUP"}:
        raise RuntimeError("STOP: employee warehouse FIXTURE_SETUP rule mismatch")
    if contract.get("allowed_changes", {}).get("hr.employee:updated:586") != {
            "fields": ["warehouse_id"], "after": {"warehouse_id": WAREHOUSE_ID},
            "dynamic_fields": []}:
        raise RuntimeError("STOP: employee warehouse snapshot rule mismatch")
    if set(contract.get("expected_blockers", [])) != EXPECTED_BLOCKERS:
        raise RuntimeError("STOP: FIXTURE_SETUP blocker mismatch")
    expected_aliases = {
        "shift", "energy_start", "haccp", "cycle", "downtime", "issue", "settlement",
        *("haccp_check_%s" % index
          for index, _check in enumerate(plan.get("haccp_checks", []), 1)),
    }
    if set(contract.get("aliases", [])) != expected_aliases:
        raise RuntimeError("STOP: FIXTURE_SETUP alias mismatch")
    rule_aliases = [rule.get("alias") for rule in contract.get("allowed_change_rules", [])]
    if (len(rule_aliases) != len(set(rule_aliases)) or
            not expected_aliases <= set(rule_aliases)):
        raise RuntimeError("STOP: every fixture record requires one explicit contract rule")
    rules = {rule.get("alias"): rule for rule in contract.get("allowed_change_rules", [])}
    if (rules["issue"].get("after", {}).get("notes") != plan["fixture_notes"]["issue"] or
            rules["settlement"].get("after", {}).get("notes") !=
            plan["fixture_notes"]["settlement"]):
        raise RuntimeError("STOP: fixture note rule mismatch")


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
    if plan.get("warehouse_code") != (info.get("warehouse") or {}).get("code"):
        raise RuntimeError("STOP: warehouse code mismatch")
    current_params = {key: (info.get("params") or {}).get(key) for key in PLANNED_PARAMS}
    if plan.get("previous_params") != current_params:
        raise RuntimeError("STOP: planned configuration baseline drift")
    if plan.get("backend_sha") != info.get("backend_sha") or plan.get("frontend_sha") != info.get("frontend_sha"):
        raise RuntimeError("STOP: deployed SHA mismatch")
    if plan.get("module_versions") != info.get("module_versions"):
        raise RuntimeError("STOP: module version mismatch")
    try:
        operations.begin()
        previous = {key: info["params"].get(key) for key in PLANNED_PARAMS}
        operations.set_employee_warehouse(586, WAREHOUSE_ID)
        adjusted = (operations.environment().get("employees") or {}).get(586) or {}
        if (adjusted.get("role"), adjusted.get("company_id"),
                adjusted.get("warehouse_ids")) != (
                "operador_rolito", COMPANY_ID, [WAREHOUSE_ID]):
            raise RuntimeError("STOP: employee warehouse adjustment postcondition failed")
        for key, value in PLANNED_PARAMS.items():
            if str(previous.get(key)) != str(value):
                operations.set_param(key, value)
        ids = operations.create_fixture(plan, MARKER, ENERGY_FIXTURE_PHOTO_B64)
        blockers = set(operations.fixture_blockers(ids["shift"]))
        if blockers != EXPECTED_BLOCKERS:
            raise RuntimeError("STOP: exact blocker postcondition failed: %s" % sorted(blockers))
        states = operations.fixture_state(ids)
        if set(states) != set(contract["aliases"]):
            raise RuntimeError("STOP: fixture record postcondition failed")
        report = {
            "schema": "sp_r3_fixture_setup_v1", "database": expected_db,
            "warehouse_id": WAREHOUSE_ID, "company_id": COMPANY_ID,
            "marker": MARKER, "date": plan["date"], "shift_code": plan["shift_code"],
            "write_class": "FIXTURE_SETUP", "previous_params": previous,
            "employee_contexts": list(EMPLOYEE_CONTEXTS),
            "employee_warehouse_restore": {
                "employee_id": 586, "warehouse_id": None,
            },
            "fixture_setup_changes": [{
                "model": "hr.employee", "id": 586, "field": "warehouse_id",
                "before": None, "after": WAREHOUSE_ID,
                "write_class": "FIXTURE_SETUP",
            }],
            "fixture_photo_sha256": ENERGY_FIXTURE_PHOTO_SHA256,
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
    if hashlib.sha256(raw).hexdigest() != expected:
        raise RuntimeError("STOP: sealed input hash mismatch")
    return json.loads(raw)


def main(env):
    # Direct comparison is intentional and covered by the static safety contract.
    if env.cr.dbname != os.environ.get("SP_EXPECTED_DB"):
        raise RuntimeError("STOP: SP_EXPECTED_DB mismatch")
    plan = _load(os.environ["SP_PLAN_PATH"], os.environ["SP_PLAN_SHA256"])
    contract = _load(os.environ["SP_FIXTURE_CONTRACT_PATH"],
                     os.environ["SP_FIXTURE_CONTRACT_SHA256"])
    output = os.environ.get("SP_SETUP_PATH", "/tmp/sp-r3-fixture-setup.json")
    result = prepare_fixture(env, output, plan, contract, os.environ["SP_PLAN_SHA256"],
                             os.environ["SP_FIXTURE_CONTRACT_SHA256"])
    print(json.dumps({"output": output,
                      "sha256": hashlib.sha256(Path(output).read_bytes()).hexdigest()},
                     sort_keys=True))
    return result


if "env" in globals():  # pragma: no cover - odoo-bin shell wrapper
    main(env)  # noqa: F821
