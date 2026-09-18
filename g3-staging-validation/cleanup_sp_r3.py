"""Limpieza exacta, reversible e idempotente del fixture SP-R3."""

import hashlib
import json
import os
from pathlib import Path


MARKER = "[SP-R3 FIXTURE 2026-09-18]"
WAREHOUSE_ID = 76
COMPANY_ID = 35
EMPLOYEE_IDS = (2548, 2549, 2550)
CONFIG_KEYS = (
    "gf_production.require_haccp_for_close", "gf_production.require_energy_for_close",
    "gf_production.handover_blocking", "gf_production_ops.material_stock_enabled",
)
RUNTIME_CREATE_MODELS = {
    "gf.energy.reading", "gf.haccp.check", "gf.compressor.event",
    "gf.compressor.oil.log", "gf.brine.reading.log", "gf.transformation.order",
}
RUNTIME_UPDATE_MODELS = RUNTIME_CREATE_MODELS | {
    "gf.production.shift", "gf.haccp.checklist", "gf.production.downtime",
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
        return {"database": self.cr.dbname, "neutralized": self.neutralized,
                "warehouse": {"id": warehouse.id, "company_id": warehouse.company_id.id},
                "employees": sorted(employees.ids)}

    def set_param(self, key, value):
        params = self.env["ir.config_parameter"].sudo()
        if value is None:
            existing = params.search([("key", "=", key)])
            existing.unlink()
        else:
            params.set_param(key, value)

    def _record(self, alias, data):
        model = data.get("model") or self.MODEL_BY_ALIAS.get(alias)
        if not model:
            return self.env["ir.model"]
        return self.env[model].sudo().browse(data["id"]).exists()

    def dependencies(self, setup, runtime):
        shift_id = setup["records"]["shift"]["id"]
        declared = {(item.get("model") or self.MODEL_BY_ALIAS.get(alias), item["id"])
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
            marker_value = " ".join(str(getattr(record, field, "") or "")
                                    for field in ("notes", "reason", "name", "description"))
            marker_aliases = {"shift", "haccp", "cycle", "downtime", "issue", "settlement"}
            if alias in marker_aliases and marker not in marker_value:
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
    if set(info.get("employees", [])) != set(EMPLOYEE_IDS):
        raise RuntimeError("STOP: employees 2548/2549/2550 mismatch")


def _verify_manifest(setup, runtime, setup_sha256, runtime_sha256, expected_db, mode):
    if digest(setup) != setup_sha256 or digest(runtime) != runtime_sha256:
        raise RuntimeError("STOP: manifest hash mismatch")
    if setup.get("schema") != "sp_r3_fixture_setup_v1" or setup.get("marker") != MARKER:
        raise RuntimeError("STOP: invalid FIXTURE_SETUP manifest")
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
    if mode == "setup-only" and (runtime.get("records") or runtime.get("updates")):
        raise RuntimeError("STOP: setup-only requires an empty sealed runtime manifest")
    if mode not in ("setup-only", "runtime"):
        raise RuntimeError("STOP: invalid cleanup mode")
    for item in runtime.get("records", {}).values():
        if item.get("model") not in RUNTIME_CREATE_MODELS:
            raise RuntimeError("STOP: runtime model is outside cleanup whitelist")
        if item.get("shift_id") != shift_id or not isinstance(item.get("id"), int):
            raise RuntimeError("STOP: runtime record relation/id mismatch")
    setup_by_model = {
        OdooCleanupOps.MODEL_BY_ALIAS.get(alias): value.get("id")
        for alias, value in setup.get("records", {}).items()
    }
    for item in runtime.get("updates", {}).values():
        model = item.get("model")
        if model not in RUNTIME_UPDATE_MODELS:
            raise RuntimeError("STOP: runtime model is outside update whitelist")
        if item.get("shift_id") != shift_id or setup_by_model.get(model) != item.get("id"):
            raise RuntimeError("STOP: runtime update does not target a setup record")


def cleanup_fixture(env, output_path, setup, runtime, setup_sha256,
                    runtime_sha256, expected_db=None, mode="runtime"):
    operations = _ops(env)
    expected_db = expected_db or os.environ.get("SP_EXPECTED_DB")
    _ensure_context(operations, expected_db)
    _verify_manifest(setup, runtime, setup_sha256, runtime_sha256, expected_db, mode)
    if operations.is_clean(setup, runtime):
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
        for key in CONFIG_KEYS:
            if key not in setup.get("previous_params", {}):
                raise RuntimeError("STOP: previous parameter set is incomplete")
            operations.set_param(key, setup["previous_params"][key])
        if not operations.is_clean(setup, runtime):
            raise RuntimeError("STOP: cleanup postcondition failed")
        report = {"schema": "sp_r3_cleanup_result_v1", "database": expected_db,
                  "warehouse_id": WAREHOUSE_ID, "company_id": COMPANY_ID,
                  "already_clean": False, "restored_params": sorted(CONFIG_KEYS),
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


def _load(path):
    return json.loads(Path(path).read_bytes())


def main(env):
    # Direct comparison is intentional and covered by the static safety contract.
    if env.cr.dbname != os.environ.get("SP_EXPECTED_DB"):
        raise RuntimeError("STOP: SP_EXPECTED_DB mismatch")
    setup = _load(os.environ["SP_SETUP_PATH"])
    runtime = _load(os.environ["SP_RUNTIME_MANIFEST_PATH"])
    return cleanup_fixture(env, os.environ.get("SP_CLEANUP_PATH", "/tmp/sp-r3-cleanup.json"),
                           setup, runtime, os.environ["SP_SETUP_SHA256"],
                           os.environ["SP_RUNTIME_MANIFEST_SHA256"],
                           mode=os.environ.get("SP_CLEANUP_MODE", "runtime"))


if "env" in globals():  # pragma: no cover - odoo-bin shell wrapper
    main(env)  # noqa: F821
