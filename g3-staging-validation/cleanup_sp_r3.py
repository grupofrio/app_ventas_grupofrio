"""Limpieza exacta, reversible e idempotente del fixture SP-R3."""

import hashlib
import json
import os
from pathlib import Path


MARKER = "[SP-R3 FIXTURE 2026-09-18]"
WAREHOUSE_ID = 76
COMPANY_ID = 35
EMPLOYEE_IDS = (586, 2548, 2549, 2550)
EXPECTED_EMPLOYEES = {
    586: ("operador_rolito", COMPANY_ID, None),
    2548: ("supervisor_produccion", COMPANY_ID, 76),
    2549: ("operador_barra", COMPANY_ID, 76),
    2550: ("supervisor_produccion", COMPANY_ID, 115),
}
EMPLOYEE_CONTEXTS = [
    {"id": employee_id, "role": role, "company_id": company_id,
     "warehouse_id": warehouse_id}
    for employee_id, (role, company_id, warehouse_id) in sorted(EXPECTED_EMPLOYEES.items())
]
CONFIG_KEYS = (
    "gf_production.require_haccp_for_close", "gf_production.require_energy_for_close",
    "gf_production.handover_blocking", "gf_production_ops.material_stock_enabled",
)
RUNTIME_CREATE_ALIASES = {"energy_end": "gf.energy.reading"}
RUNTIME_CREATE_MODELS = set(RUNTIME_CREATE_ALIASES.values())
RUNTIME_UPDATE_MODELS = RUNTIME_CREATE_MODELS | {
    "gf.production.shift", "gf.haccp.checklist", "gf.haccp.check",
    "gf.production.downtime",
    "gf.evaporator.cycle", "gf.production.material.issue",
    "gf.production.material.settlement",
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


class OdooCleanupOps:
    MODEL_BY_ALIAS = {
        "shift": "gf.production.shift", "energy_start": "gf.energy.reading",
        "haccp": "gf.haccp.checklist", "cycle": "gf.evaporator.cycle",
        "downtime": "gf.production.downtime", "issue": "gf.production.material.issue",
        "settlement": "gf.production.material.settlement",
    }

    def __init__(self, env):
        self.env = env
        self.cr = env.cr

    @classmethod
    def model_for_alias(cls, alias):
        if alias.startswith("haccp_check_"):
            return "gf.haccp.check"
        return cls.MODEL_BY_ALIAS.get(alias)

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
        employees = self.env["hr.employee"].sudo().browse(EMPLOYEE_IDS).exists()
        employee_data = {}
        for employee in employees:
            role = getattr(getattr(employee, "job_id", False), "x_job_key", False) or ""
            employee_warehouse = getattr(employee, "warehouse_id", False)
            employee_data[employee.id] = {
                "id": employee.id, "company_id": employee.company_id.id,
                "warehouse_ids": ([employee_warehouse.id] if employee_warehouse else []),
                "role": role,
            }
        return {"database": self.cr.dbname, "neutralized": self.neutralized,
                "warehouse": {"id": warehouse.id, "company_id": warehouse.company_id.id},
                "employees": employee_data}

    def set_param(self, key, value):
        params = self.env["ir.config_parameter"].sudo()
        if value is None:
            existing = params.search([("key", "=", key)])
            existing.unlink()
        else:
            params.set_param(key, value)

    def set_employee_warehouse(self, employee_id, warehouse_id):
        employee = self.env["hr.employee"].sudo().browse(employee_id).exists()
        if not employee:
            raise RuntimeError("STOP: fixture employee is missing")
        employee.write({"warehouse_id": warehouse_id or False})

    def params_restored(self, previous):
        params = self.env["ir.config_parameter"].sudo()
        rows = params.search([("key", "in", list(previous))])
        actual = {row.key: row.value for row in rows}
        return all(actual.get(key) == value for key, value in previous.items())

    def _record(self, alias, data):
        model = data.get("model") or self.model_for_alias(alias)
        if not model:
            return self.env["ir.model"]
        return self.env[model].sudo().browse(data["id"]).exists()

    def dependencies(self, setup, runtime):
        shift_id = setup["records"]["shift"]["id"]
        declared = {(item.get("model") or self.model_for_alias(alias), item["id"])
                    for manifest in (setup, runtime)
                    for alias, item in manifest.get("records", {}).items()}
        unexpected = []
        children = {
            "gf.energy.reading": [("shift_id", "=", shift_id)],
            "gf.haccp.checklist": [("shift_id", "=", shift_id)],
            "gf.haccp.check": [("checklist_id.shift_id", "=", shift_id)],
            "gf.production.downtime": [("shift_id", "=", shift_id)],
            "gf.evaporator.cycle": [("shift_id", "=", shift_id)],
            "gf.production.material.issue": [("shift_id", "=", shift_id)],
            "gf.production.material.settlement": [("shift_id", "=", shift_id)],
            "gf.compressor.event": [("shift_id", "=", shift_id)],
            "gf.compressor.oil.log": [("shift_id", "=", shift_id)],
            "gf.brine.reading.log": [("shift_id", "=", shift_id)],
            "gf.transformation.order": [("shift_id", "=", shift_id)],
        }
        for model, domain in children.items():
            if model not in self.env.registry:
                continue
            for record in self.env[model].sudo().search(domain):
                if (model, record.id) not in declared:
                    unexpected.append({"model": model, "id": record.id})
        stock = []
        issue_id = setup.get("records", {}).get("issue", {}).get("id")
        settlement_id = setup.get("records", {}).get("settlement", {}).get("id")
        move_ids = []
        if "stock.move" in self.env.registry:
            moves = self.env["stock.move"].sudo().search([
                "|", ("gf_material_issue_id", "=", issue_id),
                ("gf_material_settlement_id", "=", settlement_id),
            ])
            move_ids = moves.ids
            stock.extend({"model": "stock.move", "id": row.id} for row in moves)
        if move_ids and "stock.move.line" in self.env.registry:
            move_lines = self.env["stock.move.line"].sudo().search([
                ("move_id", "in", move_ids),
            ])
            stock.extend({"model": "stock.move.line", "id": row.id} for row in move_lines)
        return unexpected, stock

    def delete_exact(self, setup, runtime, marker):
        ordered = list(setup.get("records", {}).items()) + list(runtime.get("records", {}).items())
        for alias, data in reversed(ordered):
            record = self._record(alias, data)
            if not record:
                continue
            if record._name == "gf.haccp.check":
                shift = record.checklist_id.shift_id
            else:
                shift = record if record._name == "gf.production.shift" else getattr(record, "shift_id", False)
            expected_shift_id = setup["records"]["shift"]["id"]
            if not shift or shift.id != expected_shift_id:
                raise RuntimeError("STOP: relation mismatch")
            rule = data.get("contract_rule")
            if rule:
                for field, expected in (rule.get("match") or {}).items():
                    actual = getattr(record, field, False)
                    actual = actual.id if hasattr(actual, "id") else actual
                    if actual != expected:
                        raise RuntimeError("STOP: explicit runtime rule mismatch")
            marker_value = " ".join(str(getattr(record, field, "") or "")
                                    for field in ("notes", "reason", "name", "description", "result_text"))
            marker_aliases = {"shift", "haccp", "cycle", "downtime", "issue", "settlement"}
            if (alias in marker_aliases or alias.startswith("haccp_check_")) and marker not in marker_value:
                raise RuntimeError("STOP: marker mismatch")
            record.unlink()

    def is_clean(self, setup, runtime):
        for manifest in (setup, runtime):
            for alias, data in manifest.get("records", {}).items():
                if self._record(alias, data):
                    return False
        return True


def _ops(env):
    return env if hasattr(env, "delete_exact") else OdooCleanupOps(env)


def _ensure_context(ops, expected_db):
    if not expected_db or ops.cr.dbname != expected_db:
        raise RuntimeError("STOP: SP_EXPECTED_DB mismatch")
    info = ops.environment()
    if not info.get("neutralized"):
        raise RuntimeError("STOP: database.is_neutralized is not true")
    warehouse = info.get("warehouse") or {}
    if (warehouse.get("id"), warehouse.get("company_id")) != (WAREHOUSE_ID, COMPANY_ID):
        raise RuntimeError("STOP: warehouse_id/company_id mismatch")
    employees = info.get("employees") or {}
    for employee_id, (role, company_id, warehouse_id) in EXPECTED_EMPLOYEES.items():
        actual = employees.get(employee_id) or {}
        expected_warehouses = [] if warehouse_id is None else [warehouse_id]
        warehouse_ok = (actual.get("warehouse_ids") in ([], [WAREHOUSE_ID])
                        if employee_id == 586 else
                        actual.get("warehouse_ids") == expected_warehouses)
        if ((actual.get("role"), actual.get("company_id")) != (role, company_id) or
                not warehouse_ok):
            raise RuntimeError("STOP: employee identity/role/company/warehouse mismatch")
    return info


def _verify_manifest(setup, runtime, setup_sha256, runtime_sha256, expected_db, mode,
                     ui_contract, ui_contract_sha256):
    if digest(setup) != setup_sha256 or digest(runtime) != runtime_sha256:
        raise RuntimeError("STOP: manifest hash mismatch")
    if setup.get("schema") != "sp_r3_fixture_setup_v1" or setup.get("marker") != MARKER:
        raise RuntimeError("STOP: invalid FIXTURE_SETUP manifest")
    if setup.get("employee_contexts") != EMPLOYEE_CONTEXTS:
        raise RuntimeError("STOP: setup employee contexts mismatch")
    if runtime.get("schema") != "sp_r3_runtime_contract_v1":
        raise RuntimeError("STOP: invalid RUNTIME_MANIFEST")
    for manifest in (setup, runtime):
        if manifest.get("database") != expected_db:
            raise RuntimeError("STOP: manifest database mismatch")
        if manifest.get("warehouse_id") != WAREHOUSE_ID or manifest.get("company_id") != COMPANY_ID:
            raise RuntimeError("STOP: manifest scope mismatch")
    shift_id = setup.get("records", {}).get("shift", {}).get("id")
    if runtime.get("shift_id") != shift_id:
        raise RuntimeError("STOP: runtime shift relation mismatch")
    for key in ("marker", "date", "shift_code"):
        if runtime.get(key) != setup.get(key):
            raise RuntimeError("STOP: runtime fixture identity mismatch")
    if setup.get("employee_warehouse_restore") != {
            "employee_id": 586, "warehouse_id": None}:
        raise RuntimeError("STOP: employee warehouse restore seal mismatch")
    if mode == "setup-only" and (runtime.get("records") or runtime.get("updates")):
        raise RuntimeError("STOP: setup-only requires an empty sealed runtime manifest")
    if mode not in ("setup-only", "runtime"):
        raise RuntimeError("STOP: invalid cleanup mode")
    if mode == "runtime":
        if (not ui_contract_sha256 or digest(ui_contract) != ui_contract_sha256 or
                runtime.get("ui_contract_sha256") != ui_contract_sha256):
            raise RuntimeError("STOP: original UI contract hash mismatch")
        if ui_contract.get("schema") != "sp_r3_ui_contract_v1":
            raise RuntimeError("STOP: invalid original UI contract")
        for key in ("database", "warehouse_id", "company_id", "shift_id",
                    "marker", "date", "shift_code"):
            if ui_contract.get(key) != runtime.get(key):
                raise RuntimeError("STOP: original UI contract identity mismatch")
    for item in runtime.get("records", {}).values():
        if item.get("model") not in RUNTIME_CREATE_MODELS:
            raise RuntimeError("STOP: runtime model is outside cleanup whitelist")
        if item.get("shift_id") != shift_id or not isinstance(item.get("id"), int):
            raise RuntimeError("STOP: runtime record relation/id mismatch")
        alias = item.get("contract_alias")
        rule = item.get("contract_rule") or {}
        ui_rules = [candidate for candidate in ui_contract.get("allowed_change_rules", [])
                    if candidate.get("alias") == alias]
        if (RUNTIME_CREATE_ALIASES.get(alias) != item.get("model") or
                rule.get("alias") != alias or rule.get("model") != item.get("model") or
                rule.get("change") != "created" or
                len(ui_rules) != 1 or rule != ui_rules[0] or
                item.get("contract_rule_sha256") != digest(rule)):
            raise RuntimeError(
                "STOP: runtime record lacks explicit sealed rule or differs from original UI contract")
    setup_by_model = {}
    for alias, value in setup.get("records", {}).items():
        model = OdooCleanupOps.model_for_alias(alias)
        setup_by_model.setdefault(model, set()).add(value.get("id"))
    for item in runtime.get("updates", {}).values():
        model = item.get("model")
        if model not in RUNTIME_UPDATE_MODELS:
            raise RuntimeError("STOP: runtime model is outside update whitelist")
        if item.get("shift_id") != shift_id or item.get("id") not in setup_by_model.get(model, set()):
            raise RuntimeError("STOP: runtime update does not target a setup record")
        rule = item.get("contract_rule") or {}
        ui_rule = (ui_contract.get("allowed_changes") or {}).get(
            "%s:updated:%s" % (model, item.get("id")))
        changed_fields = set(item.get("changed_fields") or [])
        sealed_fields = set(rule.get("fields") or [])
        if (not changed_fields or not changed_fields <= sealed_fields or
                rule != ui_rule or
                item.get("contract_rule_sha256") != digest(rule)):
            raise RuntimeError(
                "STOP: runtime update lacks sealed rule or differs from original UI contract")


def cleanup_fixture(env, output_path, setup, runtime, setup_sha256,
                    runtime_sha256, expected_db=None, mode="runtime",
                    ui_contract=None, ui_contract_sha256=None):
    operations = _ops(env)
    expected_db = expected_db or os.environ.get("SP_EXPECTED_DB")
    info = _ensure_context(operations, expected_db)
    _verify_manifest(setup, runtime, setup_sha256, runtime_sha256, expected_db, mode,
                     ui_contract or {}, ui_contract_sha256)
    previous_params = setup.get("previous_params", {})
    if set(previous_params) != set(CONFIG_KEYS):
        raise RuntimeError("STOP: previous parameter set is incomplete")
    clean = operations.is_clean(setup, runtime)
    rolito_warehouses = (info.get("employees", {}).get(586) or {}).get("warehouse_ids")
    if (clean and rolito_warehouses not in ([], [WAREHOUSE_ID])) or (
            not clean and rolito_warehouses != [WAREHOUSE_ID]):
        raise RuntimeError("STOP: employee warehouse loan state mismatch")
    if (clean and rolito_warehouses == [] and
            operations.params_restored(previous_params)):
        report = {"schema": "sp_r3_cleanup_result_v1", "database": expected_db,
                  "warehouse_id": WAREHOUSE_ID, "company_id": COMPANY_ID,
                  "already_clean": True, "writes": 0}
        _write_private(output_path, report)
        return report
    try:
        operations.begin()
        unexpected, stock = operations.dependencies(setup, runtime)
        if unexpected or stock:
            raise RuntimeError("STOP: unexpected dependencies or stock records")
        operations.delete_exact(setup, runtime, MARKER)
        operations.set_employee_warehouse(586, None)
        for key in CONFIG_KEYS:
            operations.set_param(key, previous_params[key])
        restored_rolito = (operations.environment().get("employees", {}).get(586) or {})
        if (not operations.is_clean(setup, runtime) or
                restored_rolito.get("warehouse_ids") != [] or
                not operations.params_restored(previous_params)):
            raise RuntimeError("STOP: cleanup postcondition failed")
        report = {"schema": "sp_r3_cleanup_result_v1", "database": expected_db,
                  "warehouse_id": WAREHOUSE_ID, "company_id": COMPANY_ID,
                  "already_clean": False, "restored_params": sorted(CONFIG_KEYS),
                  "restored_employee_warehouse": {"employee_id": 586,
                                                   "warehouse_id": None},
                  "removed_records": sum(len(item.get("records", {})) for item in (setup, runtime))}
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
    setup = _load(os.environ["SP_SETUP_PATH"], os.environ["SP_SETUP_SHA256"])
    runtime = _load(os.environ["SP_RUNTIME_MANIFEST_PATH"],
                    os.environ["SP_RUNTIME_MANIFEST_SHA256"])
    mode = os.environ.get("SP_CLEANUP_MODE", "runtime")
    ui_contract = None
    ui_contract_sha256 = None
    if mode == "runtime":
        ui_contract_sha256 = os.environ["SP_UI_CONTRACT_SHA256"]
        ui_contract = _load(os.environ["SP_UI_CONTRACT_PATH"], ui_contract_sha256)
    output = os.environ.get("SP_CLEANUP_PATH", "/tmp/sp-r3-cleanup.json")
    result = cleanup_fixture(env, output, setup, runtime, os.environ["SP_SETUP_SHA256"],
                             os.environ["SP_RUNTIME_MANIFEST_SHA256"],
                             mode=mode,
                             ui_contract=ui_contract,
                             ui_contract_sha256=ui_contract_sha256)
    print(json.dumps({"output": output,
                      "sha256": hashlib.sha256(Path(output).read_bytes()).hexdigest()},
                     sort_keys=True))
    return result


if "env" in globals():  # pragma: no cover - odoo-bin shell wrapper
    main(env)  # noqa: F821
