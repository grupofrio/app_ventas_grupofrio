"""Strict comparison for G3 snapshots.

Modes:
  bootstrap: fixed installation/backfill contract.
  e2e: exact record/field contract supplied by the E2E runner.
  cleanup: exact business restore with sealed module metadata only.
"""

import argparse
import hashlib
import json

BOOTSTRAP_FIELDS = {
    "gf.energy.reading": {"meter_id", "meter_multiplier", "multiplier_source",
                          "data_suspect", "data_suspect_reason", "write_date"},
    "gf.production.shift": {"energy_kwh", "energy_kwh_per_kg", "energy_cost_total",
                            "energy_cost_per_kg", "energy_vs_target_pct", "write_date"},
}
BOOTSTRAP_CREATED = {"gf.energy.meter", "gf.energy.tariff", "ir.config_parameter@g3"}
TARGET_MODULES = {"gf_plant_energy", "gf_milling_control"}
EXPECTED_CONFIG = {
    "gf_plant_energy.rolito_base_hours": "24",
    "gf_plant_energy.oil_stale_shifts": "2",
    "gf_plant_energy.rolito_cycle_min_minutes": "28",
    "gf_plant_energy.rolito_cycle_max_minutes": "35",
    "gf_milling_control.variance_threshold_pct": "5",
}
EXPECTED_MODULE_VERSIONS = {
    "gf_plant_energy": "18.0.1.2.2",
    "gf_milling_control": "18.0.1.0.0",
}
SCHEMA_DEFAULTS = {
    "gf.energy.reading": {"kwh_base": 0.0, "kwh_intermedia": 0.0,
                          "kwh_punta": 0.0, "capture_mode": "single"},
    "gf.transformation.recipe": {"expected_units_per_input": 0.0,
                                  "variance_threshold_pct": 0.0},
    "gf.transformation.order": {"first_output_qty_units": 0.0,
                                 "recount_output_qty_units": 0.0,
                                 "recount_captured": False,
                                 "recount_delta_units": 0.0,
                                 "recount_by_employee_id": None,
                                 "recount_at": False},
}


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def row_changes(left, right):
    left_rows = {row.get("id"): row for row in left.get("rows", [])}
    right_rows = {row.get("id"): row for row in right.get("rows", [])}
    changes = []
    for record_id in sorted(set(left_rows) | set(right_rows),
                            key=lambda value: (type(value).__name__, repr(value))):
        before, after = left_rows.get(record_id), right_rows.get(record_id)
        if before == after:
            continue
        if before is None:
            changes.append({"id": record_id, "change": "created", "after": after})
        elif after is None:
            changes.append({"id": record_id, "change": "deleted", "before": before})
        else:
            fields = {field: {"before": before.get(field), "after": after.get(field)}
                      for field in sorted(set(before) | set(after))
                      if before.get(field) != after.get(field)}
            changes.append({"id": record_id, "change": "updated", "fields": fields,
                            "before": before, "after": after})
    return changes


def _assert_identity(before, after):
    keys = ("schema", "database", "warehouse_id", "warehouse_code", "company_id")
    return ["%s mismatch" % key for key in keys if before.get(key) != after.get(key)]


def _section_digest(rows):
    raw = json.dumps(rows, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def _business_rows(rows):
    return [
        {name: value for name, value in row.items()
         if name not in ("write_date", "write_uid")}
        for row in rows
    ]


def _model_sections_errors(snapshot, label):
    errors = []
    models = snapshot.get("models")
    if not isinstance(models, dict):
        return ["models container invalid %s" % label], False
    expected_keys = {
        "available", "count", "fields", "ids", "rows", "sha256", "business_sha256",
    }
    for model_name, section in sorted(models.items()):
        prefix = "model section %s %s" % (model_name, label)
        if not isinstance(model_name, str) or not model_name:
            errors.append("model section name invalid %s" % label)
            continue
        if not isinstance(section, dict) or set(section) != expected_keys:
            actual = set(section) if isinstance(section, dict) else set()
            errors.append("%s fields mismatch: %s" %
                          (prefix, sorted(actual ^ expected_keys)))
            continue
        if type(section.get("available")) is not bool:
            errors.append("%s available type mismatch" % prefix)
        fields = section.get("fields")
        if (not isinstance(fields, list) or
                not all(isinstance(field, str) and field for field in fields) or
                len(fields) != len(set(fields))):
            errors.append("%s field schema invalid" % prefix)
            continue
        rows, ids = section.get("rows"), section.get("ids")
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            errors.append("%s rows invalid" % prefix)
            continue
        if not isinstance(ids, list):
            errors.append("%s ids invalid" % prefix)
            continue
        if section.get("available") is False and (fields or rows or ids):
            errors.append("%s unavailable payload must be empty" % prefix)
        if section.get("available") is True and "id" not in fields:
            errors.append("%s available schema requires id" % prefix)
        field_set = set(fields)
        if any(set(row) != field_set for row in rows):
            errors.append("%s row fields mismatch" % prefix)
        row_ids = [row.get("id") for row in rows]
        if any(type(record_id) is not int for record_id in row_ids):
            errors.append("%s row ids invalid" % prefix)
            continue
        if len(row_ids) != len(set(row_ids)):
            errors.append("duplicate model row ids %s %s" % (model_name, label))
        if ids != row_ids:
            errors.append("%s ids mismatch" % prefix)
        if row_ids != sorted(row_ids):
            errors.append("%s ids are not ordered" % prefix)
        if type(section.get("count")) is not int or section.get("count") != len(rows):
            errors.append("model section count mismatch %s %s" % (model_name, label))
        if section.get("sha256") != _section_digest(rows):
            errors.append("%s sha256 mismatch" % prefix)
        if section.get("business_sha256") != _section_digest(_business_rows(rows)):
            errors.append("%s business_sha256 mismatch" % prefix)
    return errors, not errors


def _strip_schema_defaults(before, after):
    errors = []
    left, right = json.loads(json.dumps(before)), json.loads(json.dumps(after))
    recipes = {row["id"]: row for row in right["models"].get(
        "gf.transformation.recipe", {}).get("rows", [])}
    config = {row.get("key"): row.get("value") for row in right["models"].get(
        "ir.config_parameter@g3", {}).get("rows", [])}
    global_threshold = float(config.get("gf_milling_control.variance_threshold_pct") or 5.0)
    for model, defaults in SCHEMA_DEFAULTS.items():
        left_rows = {row["id"]: row for row in left["models"].get(model, {}).get("rows", [])}
        right_rows = {row["id"]: row for row in right["models"].get(model, {}).get("rows", [])}
        for record_id in set(left_rows) & set(right_rows):
            old, new = left_rows[record_id], right_rows[record_id]
            schema_added = False
            for field, default in defaults.items():
                if field not in old and field in new:
                    schema_added = True
                    if new[field] != default:
                        errors.append("schema default mismatch %s id=%s %s=%r" %
                                      (model, record_id, field, new[field]))
                    old[field] = new[field]
            if schema_added and "write_date" in old and "write_date" in new:
                old["write_date"] = new["write_date"]
        # Computed milling threshold fields appear on install and are checked
        # against the captured variance instead of a fixed default.
        if model == "gf.transformation.order":
            for record_id in set(left_rows) & set(right_rows):
                old, new = left_rows[record_id], right_rows[record_id]
                computed_added = False
                for field in ("variance_threshold_pct", "exceeds_variance_threshold"):
                    if field not in old and field in new:
                        computed_added = True
                        old[field] = new[field]
                if computed_added and "write_date" in old and "write_date" in new:
                    old["write_date"] = new["write_date"]
                recipe = recipes.get(new.get("recipe_id"))
                override = float((recipe or {}).get("variance_threshold_pct") or 0.0)
                expected_threshold = (override if override > 0 else global_threshold) if recipe else 0.0
                threshold = float(new.get("variance_threshold_pct") or 0.0)
                if threshold != expected_threshold:
                    errors.append("milling threshold value mismatch id=%s actual=%s expected=%s" %
                                  (record_id, threshold, expected_threshold))
                expected = bool(threshold and abs(float(new.get("variance_pct") or 0.0)) > threshold)
                if new.get("exceeds_variance_threshold") is not expected:
                    errors.append("milling threshold compute mismatch id=%s" % record_id)
    return left, right, errors


def _all_changes(before, after):
    result = {}
    sections = set(before["models"]) | set(after["models"])
    for name in sorted(sections):
        changes = row_changes(before["models"].get(name, {}), after["models"].get(name, {}))
        if changes:
            result[name] = changes
    module_changes = row_changes(before.get("modules", {}), after.get("modules", {}))
    if module_changes:
        result["@modules"] = module_changes
    return result


def _bootstrap_errors(changes, before, after):
    errors = []
    for model, records in changes.items():
        for item in records:
            action = item["change"]
            fields = set(item.get("fields", {}))
            if model == "@modules":
                name = (item.get("after") or item.get("before") or {}).get("name")
                if action not in ("created", "updated") or name not in TARGET_MODULES:
                    errors.append("unexpected module change %s:%s" % (name, action))
                elif action == "updated" and not fields <= {
                    "state", "installed_version", "latest_version", "write_date"
                }:
                    errors.append("unexpected module fields %s:%s" % (name, sorted(fields)))
            elif model in BOOTSTRAP_CREATED:
                if action != "created":
                    errors.append("%s may only create records, got %s id=%s" %
                                  (model, action, item["id"]))
            elif model in BOOTSTRAP_FIELDS:
                if action != "updated" or not fields <= BOOTSTRAP_FIELDS[model]:
                    errors.append("unexpected %s change id=%s action=%s fields=%s" %
                                  (model, item["id"], action, sorted(fields)))
            else:
                errors.append("model outside bootstrap contract changed: %s id=%s" %
                              (model, item["id"]))
    after_models = after["models"]
    meter_rows = after_models.get("gf.energy.meter", {}).get("rows", [])
    approved_meters = [row for row in meter_rows
                       if row.get("serial") == "NPL889" and row.get("multiplier") == 1200.0
                       and row.get("active") is True and row.get("warehouse_id") == after["warehouse_id"]]
    if len(approved_meters) != 1:
        errors.append("expected exactly one active NPL889 x1200 meter in sealed warehouse")
        approved_meter_id = None
    else:
        approved_meter_id = approved_meters[0]["id"]
    tariff_rows = after_models.get("gf.energy.tariff", {}).get("rows", [])
    approved_tariffs = [row for row in tariff_rows if
                        str(row.get("date_from")) == "2026-07-01" and
                        row.get("warehouse_id") == after["warehouse_id"] and
                        row.get("price_base") == 0.74 and row.get("price_intermedia") == 1.45 and
                        row.get("price_punta") == 1.67 and
                        row.get("demand_charge_per_kw_month") == 234.0 and
                        row.get("source_note") == "Recibo CFE jul-26" and row.get("active") is True]
    if len(approved_tariffs) != 1:
        errors.append("expected exactly one approved CFE jul-26 tariff")
    config_rows = after_models.get("ir.config_parameter@g3", {}).get("rows", [])
    actual_config = {row.get("key"): row.get("value") for row in config_rows}
    if actual_config != EXPECTED_CONFIG:
        errors.append("G3 config values mismatch: %s" % actual_config)
    module_rows = {row.get("name"): row for row in after.get("modules", {}).get("rows", [])}
    for name, version in EXPECTED_MODULE_VERSIONS.items():
        row = module_rows.get(name, {})
        if row.get("state") != "installed" or row.get("installed_version") != version:
            errors.append("module %s is not installed at %s: %s" % (name, version, row))
    for item in changes.get("gf.energy.reading", []):
        after_row = item.get("after") or {}
        if (after_row.get("meter_id") != approved_meter_id or
                after_row.get("meter_multiplier") != 1200.0 or
                after_row.get("multiplier_source") != "backfill"):
            errors.append("reading %s has invalid backfill target/values" % item["id"])
    return errors


def _e2e_errors(changes, contract):
    errors = []
    allowed = contract.get("allowed_changes", {})
    alias_rules = contract.get("allowed_change_rules", [])
    used_aliases = set()
    actual_keys = set()
    for model, records in changes.items():
        for item in records:
            key = "%s:%s:%s" % (model, item["change"], item["id"])
            actual_keys.add(key)
            rule = allowed.get(key)
            if rule is None:
                source = item.get("after") if item["change"] != "deleted" else item.get("before")
                candidates = []
                for candidate in alias_rules:
                    alias = candidate.get("alias")
                    if alias in used_aliases or candidate.get("model") != model or candidate.get("change") != item["change"]:
                        continue
                    if all((source or {}).get(field) == value
                           for field, value in candidate.get("match", {}).items()):
                        candidates.append(candidate)
                if len(candidates) != 1:
                    errors.append("change not uniquely declared by E2E contract: %s matches=%s" %
                                  (key, [row.get("alias") for row in candidates]))
                    continue
                rule = candidates[0]
                used_aliases.add(rule["alias"])
            if item["change"] == "updated":
                fields = set(item.get("fields", {}))
                permitted = set(rule.get("fields", []))
                if fields != permitted:
                    errors.append("field mismatch %s actual=%s expected=%s" %
                                  (key, sorted(fields), sorted(permitted)))
                expected_after = rule.get("after", {})
                dynamic = set(rule.get("dynamic_fields", []))
                if fields - set(expected_after) - dynamic:
                    errors.append("updated fields lack exact/dynamic declaration: %s" % key)
                for field, value in expected_after.items():
                    if item.get("after", {}).get(field) != value:
                        errors.append("after-value mismatch %s.%s" % (key, field))
            elif item["change"] == "created":
                expected_after = rule.get("after")
                if not expected_after:
                    errors.append("created record rule requires non-empty after values: %s" % key)
                else:
                    for field, value in expected_after.items():
                        if item.get("after", {}).get(field) != value:
                            errors.append("created after-value mismatch %s.%s" % (key, field))
                    stable_actual = set(item.get("after", {})) - {"id"} - set(rule.get("dynamic_fields", []))
                    if stable_actual != set(expected_after):
                        errors.append("created stable-field set mismatch %s actual=%s expected=%s" %
                                      (key, sorted(stable_actual), sorted(expected_after)))
            elif item["change"] == "deleted":
                expected_before = rule.get("before")
                if not expected_before:
                    errors.append("deleted record rule requires non-empty before values: %s" % key)
                else:
                    for field, value in expected_before.items():
                        if item.get("before", {}).get(field) != value:
                            errors.append("deleted before-value mismatch %s.%s" % (key, field))
                    stable_actual = set(item.get("before", {})) - {"id"} - set(rule.get("dynamic_fields", []))
                    if stable_actual != set(expected_before):
                        errors.append("deleted stable-field set mismatch %s actual=%s expected=%s" %
                                      (key, sorted(stable_actual), sorted(expected_before)))
    missing = set(allowed) - actual_keys
    if missing:
        errors.append("declared E2E changes not observed: %s" % sorted(missing))
    missing_aliases = {rule.get("alias") for rule in alias_rules} - used_aliases
    if missing_aliases:
        errors.append("declared E2E alias changes not observed: %s" % sorted(missing_aliases))
    return errors


def _cleanup_contract_errors(contract, before):
    errors = []
    expected_keys = {
        "schema", "database", "warehouse_id", "warehouse_code", "company_id", "modules",
    }
    if set(contract) != expected_keys:
        errors.append("cleanup contract fields mismatch: %s" % sorted(set(contract) ^ expected_keys))
    if contract.get("schema") != "sp_r3_cleanup_contract_v1":
        errors.append("cleanup contract schema mismatch")
    for key in ("database", "warehouse_id", "warehouse_code", "company_id"):
        if contract.get(key) != before.get(key):
            errors.append("cleanup contract %s does not match snapshot" % key)
    modules = contract.get("modules")
    if not isinstance(modules, list):
        errors.append("cleanup contract modules must be a list")
        return errors, {}
    declared = {}
    expected_module_keys = {"name", "installed_version", "latest_version"}
    for row in modules:
        if not isinstance(row, dict) or set(row) != expected_module_keys:
            errors.append("cleanup contract module fields mismatch")
            continue
        name = row.get("name")
        if not isinstance(name, str) or not name:
            errors.append("cleanup contract module name is invalid")
        elif name in declared:
            errors.append("cleanup contract module is duplicated: %s" % name)
        else:
            declared[name] = row
    return errors, declared


def _module_container_errors(section, label):
    errors = []
    expected_keys = {"available", "count", "fields", "ids", "rows", "sha256"}
    if not isinstance(section, dict) or set(section) != expected_keys:
        actual = set(section) if isinstance(section, dict) else set()
        errors.append("module container fields mismatch %s: %s" %
                      (label, sorted(actual ^ expected_keys)))
        return errors, False
    expected_fields = [
        "id", "name", "state", "installed_version", "latest_version", "write_date",
    ]
    if section.get("available") is not True:
        errors.append("module container available mismatch %s" % label)
    if section.get("fields") != expected_fields:
        errors.append("module container fields list mismatch %s" % label)
    rows, ids = section.get("rows"), section.get("ids")
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        errors.append("module container rows invalid %s" % label)
        return errors, False
    if not isinstance(ids, list):
        errors.append("module container ids invalid %s" % label)
        return errors, False
    row_ids = [row.get("id") for row in rows]
    if any(type(record_id) is not int for record_id in row_ids):
        errors.append("module row ids invalid %s" % label)
        return errors, False
    if len(row_ids) != len(set(row_ids)):
        errors.append("duplicate module row ids %s" % label)
    if ids != row_ids:
        errors.append("module container ids mismatch %s" % label)
    if type(section.get("count")) is not int or section.get("count") != len(rows):
        errors.append("module container count mismatch %s" % label)
    expected_sha256 = hashlib.sha256(json.dumps(
        rows, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    ).encode()).hexdigest()
    if section.get("sha256") != expected_sha256:
        errors.append("module container sha256 mismatch %s" % label)
    return errors, not errors


def _cleanup_errors(before, after, contract):
    errors, declared = _cleanup_contract_errors(contract, before)
    if before.get("models") != after.get("models"):
        errors.append("models differ after cleanup")
    if before.get("outside_sentinels") != after.get("outside_sentinels"):
        errors.append("outside sentinels differ after cleanup")

    before_container_errors, before_valid = _module_container_errors(
        before.get("modules"), "before")
    after_container_errors, after_valid = _module_container_errors(
        after.get("modules"), "after")
    errors.extend(before_container_errors)
    errors.extend(after_container_errors)
    if not before_valid or not after_valid:
        return errors

    before_rows = {row["id"]: row for row in before["modules"]["rows"]}
    after_rows = {row["id"]: row for row in after["modules"]["rows"]}
    if set(before_rows) != set(after_rows):
        errors.append("module rows must not be created or deleted")
    exact_row_fields = {
        "id", "name", "state", "installed_version", "latest_version", "write_date",
    }
    allowed_changes = {"installed_version", "latest_version", "write_date"}
    after_by_name = {}
    for record_id in sorted(set(before_rows) & set(after_rows)):
        left, right = before_rows[record_id], after_rows[record_id]
        if set(left) != exact_row_fields or set(right) != exact_row_fields:
            errors.append("module row fields mismatch id=%s" % record_id)
            continue
        after_by_name[right["name"]] = right
        fields = {field for field in exact_row_fields if left.get(field) != right.get(field)}
        if not fields:
            continue
        if not fields <= allowed_changes:
            errors.append("unexpected module fields %s:%s" % (right.get("name"), sorted(fields)))
            continue
        rule = declared.get(right.get("name"))
        if rule is None:
            errors.append("module is not declared by cleanup contract: %s" % right.get("name"))
            continue
        for field in ("installed_version", "latest_version"):
            if right.get(field) != rule.get(field):
                errors.append("sealed version mismatch %s.%s" % (right.get("name"), field))
    for name, rule in declared.items():
        row = after_by_name.get(name)
        if row is None:
            errors.append("sealed module missing from snapshot: %s" % name)
            continue
        for field in ("installed_version", "latest_version"):
            if row.get(field) != rule.get(field):
                errors.append("sealed version mismatch %s.%s" % (name, field))
    return errors


def main(before_path, after_path, mode, contract_path=None, contract_sha256=None):
    before, after = load(before_path), load(after_path)
    errors = _assert_identity(before, after)
    contract = None
    if mode in ("e2e", "cleanup"):
        if not contract_path or not contract_sha256:
            errors.append("%s mode requires --contract and its pre-run --contract-sha256" % mode)
        else:
            raw = open(contract_path, "rb").read()
            if hashlib.sha256(raw).hexdigest() != contract_sha256:
                errors.append("%s contract hash mismatch" % mode.upper())
            try:
                contract = json.loads(raw)
            except (TypeError, ValueError) as exc:
                errors.append("%s contract is invalid JSON: %s" % (mode.upper(), exc))
                contract = None
    before_model_errors, before_models_valid = _model_sections_errors(before, "before")
    after_model_errors, after_models_valid = _model_sections_errors(after, "after")
    errors.extend(before_model_errors)
    errors.extend(after_model_errors)
    if not before_models_valid or not after_models_valid:
        report = {"schema": "g3_snapshot_comparison_v2", "mode": mode,
                  "database": before.get("database"), "changes": {},
                  "errors": errors, "pass": False}
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
        return 2
    if mode == "cleanup":
        if contract is not None:
            errors.extend(_cleanup_errors(before, after, contract))
        changes = _all_changes(before, after)
        report = {"schema": "g3_snapshot_comparison_v2", "mode": mode,
                  "database": before.get("database"), "changes": changes,
                  "errors": errors, "pass": not errors}
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
        return 0 if not errors else 2
    for name in sorted(set(before.get("outside_sentinels", {})) |
                       set(after.get("outside_sentinels", {}))):
        left = before.get("outside_sentinels", {}).get(name, {})
        right = after.get("outside_sentinels", {}).get(name, {})
        model_appeared_empty = (left.get("available") is False and
                                right.get("available") is True and
                                right.get("count") == 0)
        schema_metadata_only = (
            mode == "bootstrap" and name == "gf.transformation.order@outside" and
            left.get("available") is True and right.get("available") is True and
            left.get("count") == right.get("count") and
            left.get("business_sha256") and
            left.get("business_sha256") == right.get("business_sha256")
        )
        if left != right and not model_appeared_empty and not schema_metadata_only:
            errors.append("outside sealed warehouse changed: %s" % name)
    normalized_before, normalized_after, schema_errors = _strip_schema_defaults(before, after)
    errors.extend(schema_errors)
    changes = _all_changes(normalized_before, normalized_after)
    if mode == "bootstrap":
        errors.extend(_bootstrap_errors(changes, before, after))
    else:
        if contract is not None:
            for key in ("database", "warehouse_id", "company_id"):
                if contract.get(key) != before.get(key):
                    errors.append("E2E contract %s does not match snapshot" % key)
            errors.extend(_e2e_errors(changes, contract))
    report = {"schema": "g3_snapshot_comparison_v2", "mode": mode,
              "database": before.get("database"), "changes": changes,
              "errors": errors, "pass": not errors}
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
    return 0 if not errors else 2


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("--mode", choices=("bootstrap", "e2e", "cleanup"), required=True)
    parser.add_argument("--contract")
    parser.add_argument("--contract-sha256")
    args = parser.parse_args()
    raise SystemExit(main(args.before, args.after, args.mode, args.contract,
                          args.contract_sha256))
