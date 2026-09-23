"""Genera contratos SP-R3 deterministas y verifica cada entrada sellada."""

import argparse
import hashlib
import json
import os
from pathlib import Path


RUNTIME_RELATIONS = {
    "gf.production.shift": "id",
    "gf.energy.reading": "shift_id",
    "gf.haccp.checklist": "shift_id",
    "gf.haccp.check": "checklist_id",
    "gf.production.downtime": "shift_id",
    "gf.evaporator.cycle": "shift_id",
    "gf.production.material.issue": "shift_id",
    "gf.production.material.settlement": "shift_id",
    "gf.compressor.event": "shift_id",
    "gf.compressor.oil.log": "shift_id",
    "gf.brine.reading.log": "shift_id",
    "gf.transformation.order": "shift_id",
}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def load_sealed(path, expected_sha256):
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise RuntimeError("STOP: input hash mismatch")
    return json.loads(raw)


def write_private(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(descriptor, canonical(value))
    finally:
        os.close(descriptor)
    os.chmod(path, 0o600)
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _identity(plan, snapshot=None):
    result = {
        "database": plan["database"],
        "warehouse_id": plan["warehouse_id"],
        "company_id": plan["company_id"],
        "marker": plan["marker"],
        "date": plan["date"],
        "shift_code": plan["shift_code"],
    }
    if snapshot:
        for key in ("database", "warehouse_id", "company_id"):
            if snapshot.get(key) != result[key]:
                raise RuntimeError("STOP: snapshot identity mismatch")
    return result


def _rows(snapshot, model):
    return ((snapshot or {}).get("models", {}).get(model, {}).get("rows", []))


def _fields(snapshot, model):
    return set(((snapshot or {}).get("models", {}).get(model, {}).get("fields", [])))


def _created_rule(snapshot, model, alias, after, match=None, dynamic_fields=()):
    """Build a created-row rule with an explicit field policy.

    Business values belong in ``after``. Only generated record IDs and server
    timestamps may be listed in ``dynamic_fields``. Never
    infer dynamics from whatever happens to be absent from ``after``.
    """
    available = _fields(snapshot, model)
    known = {key: value for key, value in after.items()
             if not available or key in available}
    dynamic = sorted(field for field in set(dynamic_fields)
                     if not available or field in available)
    if set(known) & set(dynamic):
        raise RuntimeError("STOP: static/dynamic created fields overlap")
    unclassified = available - {"id"} - set(known) - set(dynamic)
    if unclassified:
        raise RuntimeError(
            "STOP: unclassified created fields for %s: %s" %
            (alias, ", ".join(sorted(unclassified))))
    return {"alias": alias, "model": model, "change": "created",
            "match": match or known, "after": known, "dynamic_fields": dynamic}


def _config_rules(before, planned_params):
    existing = {row.get("key"): row for row in _rows(before, "ir.config_parameter@g3")}
    allowed, aliases = {}, []
    for key, value in sorted(planned_params.items()):
        row = existing.get(key)
        if row:
            if str(row.get("value")) == str(value):
                continue
            allowed["ir.config_parameter@g3:updated:%s" % row["id"]] = {
                "fields": ["value", "write_date"], "after": {"value": value},
                "dynamic_fields": ["write_date"],
            }
        else:
            aliases.append(_created_rule(
                before, "ir.config_parameter@g3", "config:%s" % key,
                {"key": key, "value": value}, {"key": key},
                dynamic_fields=["write_date"]))
    return allowed, aliases


def _updated_rule(snapshot, model, record_id, fields, after):
    available = _fields(snapshot, model)
    selected = [field for field in fields if not available or field in available]
    exact_after = {key: value for key, value in after.items() if key in selected}
    return {
        "fields": selected, "after": exact_after,
        "dynamic_fields": sorted(set(selected) - set(exact_after)),
    }


def _single_related(snapshot, model, field, value):
    rows = [row for row in _rows(snapshot, model) if row.get(field) == value]
    return rows[0] if len(rows) == 1 else None


def _haccp_marker(plan, check):
    return "%s HACCP:%s" % (plan["marker"], check["template_id"])


def _haccp_fixture_after(plan, check):
    result = {
        "passed": False, "result_bool": False, "result_numeric": 0.0,
        "result_text": _haccp_marker(plan, check),
    }
    if check["check_type"] == "numeric":
        result["result_numeric"] = (check["min_value"] - 1
                                    if check["min_value"]
                                    else check["max_value"] + 1)
    return result


def _energy_end_after(plan, pre_e2e, shift_id):
    starts = [row for row in _rows(pre_e2e, "gf.energy.reading")
              if row.get("shift_id") == shift_id and row.get("reading_type") == "start"]
    available = _fields(pre_e2e, "gf.energy.reading")
    if available and len(starts) != 1:
        raise RuntimeError("STOP: PRE_E2E requires exactly one start energy reading")
    start = starts[0] if starts else {}
    values = plan["energy_end_values"]
    return {
        "shift_id": shift_id, "reading_type": "end",
        "kwh_value": float(values["base"] + values["intermedia"] + values["punta"]),
        "employee_id": plan["leader_employee_id"],
        "meter_id": start.get("meter_id"),
        "meter_multiplier": start.get("meter_multiplier", 0.0),
        "multiplier_source": start.get("multiplier_source", "none"),
        "data_suspect": False, "data_suspect_reason": False,
        "kwh_base": float(values["base"]),
        "kwh_intermedia": float(values["intermedia"]),
        "kwh_punta": float(values["punta"]), "capture_mode": "periods",
    }


def _fixture_catalog_values(before, plan):
    """Seal catalog business values; leave only generated IDs/times dynamic."""
    result = {}
    if _fields(before, "gf.energy.meter"):
        meters = [row for row in _rows(before, "gf.energy.meter")
                  if row.get("warehouse_id") == plan["warehouse_id"] and row.get("active")]
        if len(meters) != 1:
            raise RuntimeError("STOP: fixture requires exactly one active energy meter")
        meter = meters[0]
        multiplier = float(meter.get("multiplier") or 0.0)
        result.update({"meter_id": meter["id"], "meter_multiplier": multiplier,
                       "multiplier_source": "capture" if multiplier else "none"})
    if (_fields(before, "gf.production.line") and
            _fields(before, "gf.production.machine")):
        rolito_lines = {row["id"] for row in _rows(before, "gf.production.line")
                        if row.get("active") and row.get("line_type") == "rolito"}
        machines = sorted(
            (row for row in _rows(before, "gf.production.machine")
             if row.get("active") and row.get("machine_type") == "evaporador" and
             row.get("line_id") in rolito_lines), key=lambda row: row["id"])
        if not machines:
            raise RuntimeError("STOP: fixture requires an active rolito evaporator")
        machine = machines[0]
        result.update({"machine_id": machine["id"], "line_id": machine["line_id"],
                       "kg_expected": float(machine.get("expected_kg_per_cycle") or 0.0)})
    return result


def _ui_rules(plan, pre_e2e, shift_id):
    allowed = {}
    shift_fields = [
        "state", "energy_end_id", "energy_kwh", "energy_kwh_per_kg",
        "energy_cost_total", "energy_cost_per_kg", "energy_vs_target_pct",
        "closed_by_employee_id", "closed_at", "end_time",
        "x_barra_closed", "x_barra_closed_at", "x_rolito_closed",
        "x_rolito_closed_at", "write_date",
    ]
    allowed["gf.production.shift:updated:%s" % shift_id] = _updated_rule(
        pre_e2e, "gf.production.shift", shift_id, shift_fields,
        {"state": "closed", "closed_by_employee_id": 2548,
         "x_barra_closed": True, "x_rolito_closed": True})
    expected_updates = {
        "gf.haccp.checklist": (
            ["state", "all_passed", "completed_by_id", "completed_at", "write_date"],
            {"state": "completed", "all_passed": True, "completed_by_id": 2548},
        ),
        "gf.production.downtime": (
            ["state", "end_time", "minutes", "ended_by_employee_id", "write_date"],
            {"state": "closed", "ended_by_employee_id": 2548},
        ),
        "gf.evaporator.cycle": (
            ["state", "freeze_end", "defrost_start", "defrost_end", "kg_dumped",
             "kg_deviation_pct", "dumped_by_employee_id", "dumped_at", "write_date"],
            {"state": "dumped", "dumped_by_employee_id": 586},
        ),
        "gf.production.material.settlement": (
            ["state", "write_date"], {"state": "abandoned"},
        ),
    }
    for model, (fields, after) in expected_updates.items():
        row = _single_related(pre_e2e, model, "shift_id", shift_id)
        if row:
            allowed["%s:updated:%s" % (model, row["id"])] = _updated_rule(
                pre_e2e, model, row["id"], fields, after)
    aliases = [
        _created_rule(
            pre_e2e, "gf.energy.reading", "energy_end",
            _energy_end_after(plan, pre_e2e, shift_id),
            {"shift_id": shift_id, "reading_type": "end"},
            dynamic_fields=["timestamp", "write_date"]),
    ]
    checklist = _single_related(pre_e2e, "gf.haccp.checklist", "shift_id", shift_id)
    if checklist:
        check_rows = _rows(pre_e2e, "gf.haccp.check")
        for index, check in enumerate(plan["haccp_checks"], 1):
            marker = _haccp_marker(plan, check)
            matches = [row for row in check_rows
                       if row.get("checklist_id") == checklist["id"] and
                       row.get("result_text") == marker]
            if len(matches) != 1:
                raise RuntimeError("STOP: PRE_E2E HACCP check catalog mismatch")
            row = matches[0]
            result_field = ("result_numeric" if check["check_type"] == "numeric"
                            else "result_bool")
            allowed["gf.haccp.check:updated:%s" % row["id"]] = _updated_rule(
                pre_e2e, "gf.haccp.check", row["id"],
                ["passed", result_field, "write_date"], {"passed": True})
    return allowed, aliases


def _require_mode_inputs(mode, values):
    required = {
        "fixture": ("plan", "before"),
        "ui": ("plan", "pre_e2e"),
        "runtime": ("plan", "pre_e2e", "current", "ui_contract"),
        "cleanup": ("before", "module_seal"),
    }[mode]
    missing = [name for name in required if values.get(name) is None]
    if missing:
        raise RuntimeError("STOP: %s contract requires %s" % (mode, ", ".join(missing)))


def _runtime(plan, pre_e2e, current, ui_contract):
    shift_id = ui_contract.get("shift_id")
    if not shift_id:
        raise RuntimeError("STOP: UI contract has no sealed shift_id")
    allowed = set(ui_contract.get("allowed_runtime_models") or [])
    allowed_fields = ui_contract.get("allowed_runtime_fields") or {}
    records = {}
    updates = {}
    used_aliases = set()
    created_rules = [rule for rule in ui_contract.get("allowed_change_rules", [])
                     if rule.get("change") == "created"]
    update_rules = ui_contract.get("allowed_changes") or {}
    def related(model, row):
        relation = RUNTIME_RELATIONS.get(model)
        if model == "gf.haccp.check" and relation:
            checklist_id = row.get("checklist_id")
            checklists = {item["id"]: item for item in _rows(current, "gf.haccp.checklist")}
            return bool(checklists.get(checklist_id, {}).get("shift_id") == shift_id)
        return bool(relation and row.get(relation) == shift_id)

    for model in sorted(set((current or {}).get("models", {})) | set((pre_e2e or {}).get("models", {}))):
        old = {row["id"]: row for row in _rows(pre_e2e, model)}
        new = {row["id"]: row for row in _rows(current, model)}
        deleted = sorted(set(old) - set(new))
        if deleted:
            raise RuntimeError("STOP: runtime deleted sealed records: %s" % deleted)
        for record_id in sorted(set(new) - set(old)):
            row = new[record_id]
            relation = RUNTIME_RELATIONS.get(model)
            related_to_shift = related(model, row)
            candidates = [rule for rule in created_rules
                          if rule.get("model") == model and
                          rule.get("alias") not in used_aliases and
                          all(row.get(field) == value
                              for field, value in (rule.get("match") or {}).items())]
            if (model not in allowed or not relation or not related_to_shift or
                    len(candidates) != 1):
                raise RuntimeError("STOP: runtime record lacks one explicit sealed alias")
            rule = candidates[0]
            expected_after = rule.get("after") or {}
            if any(row.get(field) != value for field, value in expected_after.items()):
                raise RuntimeError("STOP: runtime record outside sealed UI contract")
            used_aliases.add(rule["alias"])
            records[f"{model}:{record_id}"] = {
                "id": record_id, "model": model, "relation": relation,
                "shift_id": shift_id, "contract_alias": rule["alias"],
                "contract_rule": rule, "contract_rule_sha256": digest(rule),
            }
        for record_id in sorted(set(new) & set(old)):
            if new[record_id] == old[record_id]:
                continue
            changed = sorted(key for key in set(new[record_id]) | set(old[record_id])
                             if new[record_id].get(key) != old[record_id].get(key))
            relation = RUNTIME_RELATIONS.get(model)
            is_fixture_shift = model == "gf.production.shift" and record_id == shift_id
            related_to_shift = related(model, new[record_id])
            rule = update_rules.get("%s:updated:%s" % (model, record_id))
            changed_fields = set(changed)
            sealed_fields = set((rule or {}).get("fields", []))
            if (model not in allowed or not (is_fixture_shift or related_to_shift) or not rule or
                    not changed_fields or not changed_fields <= sealed_fields or
                    not changed_fields <= set(allowed_fields.get(model, [])) or
                    any(field in changed_fields and new[record_id].get(field) != value
                        for field, value in (rule.get("after") or {}).items())):
                raise RuntimeError("STOP: runtime update outside sealed UI contract")
            updates[f"{model}:{record_id}"] = {
                "id": record_id, "model": model, "action": "updated",
                "changed_fields": changed, "shift_id": shift_id,
                "contract_rule": rule, "contract_rule_sha256": digest(rule),
            }
    return records, updates


def generate(mode, *, plan=None, before=None, pre_e2e=None, current=None,
             ui_contract=None, module_seal=None):
    if mode not in ("fixture", "ui", "runtime", "cleanup"):
        raise RuntimeError("STOP: unknown contract mode")
    _require_mode_inputs(mode, locals())
    if mode == "cleanup":
        modules = module_seal.get("modules", [])
        return {
            "schema": "sp_r3_cleanup_contract_v1",
            "database": before["database"], "warehouse_id": before["warehouse_id"],
            "warehouse_code": before["warehouse_code"], "company_id": before["company_id"],
            "modules": sorted(modules, key=lambda item: item.get("name", "")),
        }
    plan = plan or {
        "database": (before or {}).get("database"),
        "warehouse_id": (before or {}).get("warehouse_id"),
        "company_id": (before or {}).get("company_id"),
        "marker": "[SP-R3 FIXTURE 2026-09-18]", "date": "", "shift_code": "",
    }
    identity = _identity(plan, before if mode in ("fixture", "cleanup") else pre_e2e)
    if mode == "fixture":
        config_changes, config_aliases = _config_rules(before, plan["planned_params"])
        catalog = _fixture_catalog_values(before, plan)
        adjustment = plan["employee_warehouse_adjustment"]
        config_changes["hr.employee:updated:%s" % adjustment["employee_id"]] = {
            "fields": ["warehouse_id"],
            "after": {"warehouse_id": adjustment["after"]},
            "dynamic_fields": [],
        }
        haccp_aliases = ["haccp_check_%s" % index
                         for index, _check in enumerate(plan["haccp_checks"], 1)]
        haccp_rules = [
            _created_rule(before, "gf.haccp.check", "haccp_check_%s" % index, {
                **_haccp_fixture_after(plan, check),
            }, {"result_text": _haccp_marker(plan, check)},
                dynamic_fields=["checklist_id", "write_date"])
            for index, check in enumerate(plan["haccp_checks"], 1)
        ]
        return {
            "schema": "sp_r3_fixture_contract_v1", **identity,
            "write_class": "FIXTURE_SETUP",
            "fixture_photo_sha256": plan["fixture_photo_sha256"],
            "employee_warehouse_adjustment": dict(adjustment),
            "planned_params": dict(plan["planned_params"]),
            "expected_blockers": list(plan["expected_blockers"]),
            "aliases": ["shift", "energy_start", "haccp", "cycle", "downtime", "issue", "settlement"] + haccp_aliases,
            "allowed_changes": config_changes,
            "allowed_change_rules": [
                _created_rule(before, "gf.production.shift", "shift", {
                    "date": plan["date"], "shift_code": plan["shift_code"],
                    "state": "in_progress", "plant_warehouse_id": plan["warehouse_id"],
                    "leader_employee_id": plan["leader_employee_id"],
                    "total_kg_produced": 0.0, "energy_end_id": None,
                    "energy_kwh": 0.0, "energy_kwh_per_kg": 0.0,
                    "energy_cost_total": 0.0, "energy_cost_per_kg": 0.0,
                    "energy_vs_target_pct": 0.0, "closed_by_employee_id": None,
                    "closed_at": False, "end_time": False,
                    "x_barra_closed": False, "x_barra_closed_at": False,
                    "x_rolito_closed": False, "x_rolito_closed_at": False,
                }, {"date": plan["date"], "shift_code": plan["shift_code"],
                    "plant_warehouse_id": plan["warehouse_id"]},
                    dynamic_fields=["line_ids", "energy_start_id", "write_date"]),
                _created_rule(before, "gf.energy.reading", "energy_start", {
                    "reading_type": "start", "employee_id": plan["leader_employee_id"],
                    "kwh_value": 0, "kwh_base": 0, "kwh_intermedia": 0, "kwh_punta": 0,
                    "meter_id": catalog.get("meter_id"),
                    "meter_multiplier": catalog.get("meter_multiplier", 0.0),
                    "multiplier_source": catalog.get("multiplier_source", "none"),
                    "data_suspect": False,
                    "data_suspect_reason": False, "capture_mode": "periods",
                }, {"reading_type": "start", "employee_id": plan["leader_employee_id"]},
                    dynamic_fields=["shift_id", "timestamp", "write_date"]),
                _created_rule(before, "gf.haccp.checklist", "haccp", {
                    "state": "pending", "all_passed": False,
                    "completed_by_id": None, "completed_at": False,
                }, dynamic_fields=["shift_id", "write_date"]),
                _created_rule(before, "gf.evaporator.cycle", "cycle", {
                    "machine_id": catalog.get("machine_id"),
                    "cycle_number": 1, "state": "freezing", "freeze_end": False,
                    "defrost_start": False, "defrost_end": False,
                    "kg_dumped": 0.0,
                    "kg_expected": catalog.get("kg_expected", 0.0),
                    # The model computes a -100% deviation at creation because
                    # the open fixture starts with 0 dumped against the sealed
                    # expected kilograms.
                    "kg_deviation_pct": -100.0,
                    "data_suspect": False, "data_suspect_reason": False,
                    "dumped_by_employee_id": None, "dumped_at": False,
                    "dumped_role_key": False, "dump_override_used": False,
                    "dump_override_reason": False,
                    "dump_override_supervisor_employee_id": None,
                    "dump_company_id": None, "dump_warehouse_id": None,
                    "dump_line_id": None, "dump_machine_id": None,
                }, dynamic_fields=["shift_id", "freeze_start", "write_date"]),
                _created_rule(before, "gf.production.downtime", "downtime", {
                    "state": "open", "company_id": plan["company_id"],
                    "warehouse_id": plan["warehouse_id"], "cycle_id": None,
                    "line_id": catalog.get("line_id"),
                    "machine_id": catalog.get("machine_id"),
                    "end_time": False, "minutes": 0.0,
                    "reason": "%s paro abierto" % plan["marker"],
                    "operator_id": None, "ended_by_employee_id": None,
                }, dynamic_fields=["shift_id", "category_id", "start_time", "write_date"]),
                _created_rule(before, "gf.production.material.issue", "issue", {
                    "line_id": catalog.get("line_id"), "state": "draft",
                    "notes": plan["fixture_notes"]["issue"],
                }, dynamic_fields=["shift_id", "product_id", "write_date"]),
                _created_rule(before, "gf.production.material.settlement", "settlement", {
                    "line_id": catalog.get("line_id"), "state": "draft",
                    "notes": plan["fixture_notes"]["settlement"],
                }, dynamic_fields=["shift_id", "product_id", "write_date"]),
            ] + haccp_rules + config_aliases,
        }
    if mode == "ui":
        shifts = _rows(pre_e2e, "gf.production.shift")
        matches = [row for row in shifts if row.get("date") == plan["date"] and
                   str(row.get("shift_code")) == str(plan["shift_code"]) and
                   row.get("plant_warehouse_id") == plan["warehouse_id"]]
        if len(matches) != 1:
            raise RuntimeError("STOP: PRE_E2E does not contain exactly one fixture shift")
        shift_id = matches[0]["id"]
        allowed_changes, allowed_change_rules = _ui_rules(plan, pre_e2e, shift_id)
        return {
            "schema": "sp_r3_ui_contract_v1", **identity, "shift_id": shift_id,
            "allowed_runtime_models": sorted({
                rule["model"] for rule in allowed_change_rules
            } | {
                key.split(":", 1)[0] for key in allowed_changes
            }),
            "allowed_runtime_fields": {
                "gf.production.shift": ["state", "energy_end_id", "energy_kwh",
                                        "energy_kwh_per_kg", "energy_cost_total",
                                        "energy_cost_per_kg", "energy_vs_target_pct",
                                        "closed_by_employee_id", "closed_at", "end_time",
                                        "x_barra_closed", "x_barra_closed_at",
                                        "x_rolito_closed", "x_rolito_closed_at", "write_date"],
                "gf.haccp.checklist": ["state", "all_passed", "completed_by_id", "completed_at", "write_date"],
                "gf.haccp.check": ["passed", "result_bool", "result_numeric", "result_text", "write_date"],
                "gf.production.downtime": ["state", "end_time", "minutes", "ended_by_employee_id", "write_date"],
                "gf.evaporator.cycle": ["state", "freeze_end", "defrost_start", "defrost_end",
                                        "kg_dumped", "kg_deviation_pct",
                                        "dumped_by_employee_id", "dumped_at", "write_date"],
                "gf.production.material.settlement": ["state", "write_date"],
            },
            "allowed_changes": allowed_changes,
            "allowed_change_rules": allowed_change_rules,
        }
    if mode == "runtime":
        _identity(plan, current)
        if ui_contract.get("schema") != "sp_r3_ui_contract_v1":
            raise RuntimeError("STOP: invalid sealed UI contract")
        for key, value in identity.items():
            if ui_contract.get(key) != value:
                raise RuntimeError("STOP: UI contract identity mismatch")
        records, updates = _runtime(plan, pre_e2e, current, ui_contract)
        return {
            "schema": "sp_r3_runtime_contract_v1", **identity,
            "shift_id": ui_contract.get("shift_id"),
            "records": records, "updates": updates,
            "ui_contract_sha256": digest(ui_contract),
        }
    raise RuntimeError("STOP: unreachable contract mode")


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("fixture", "ui", "runtime", "cleanup"))
    parser.add_argument("--plan")
    parser.add_argument("--plan-sha256")
    parser.add_argument("--before")
    parser.add_argument("--before-sha256")
    parser.add_argument("--pre-e2e")
    parser.add_argument("--pre-e2e-sha256")
    parser.add_argument("--current")
    parser.add_argument("--current-sha256")
    parser.add_argument("--ui-contract")
    parser.add_argument("--ui-contract-sha256")
    parser.add_argument("--module-seal")
    parser.add_argument("--module-seal-sha256")
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    values = {}
    for key in ("plan", "before", "pre_e2e", "current", "ui_contract", "module_seal"):
        path, expected = getattr(args, key), getattr(args, key + "_sha256")
        if path:
            if not expected:
                raise RuntimeError("STOP: every input requires a SHA-256")
            values[key] = load_sealed(path, expected)
    contract = generate(args.mode, **values)
    result_hash = write_private(args.output, contract)
    print(json.dumps({"output": args.output, "sha256": result_hash}, sort_keys=True))


if __name__ == "__main__":
    main()
