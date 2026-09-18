"""Snapshot read-only del gate G3, sellado a base/almacen/compania exactos."""

import datetime as _dt
import hashlib
import json
import os

OUTPUT = os.environ.get("G3_SNAPSHOT_PATH", "/tmp/g3-snapshot.json")
CONFIG_KEYS = (
    "gf_plant_energy.rolito_base_hours", "gf_plant_energy.oil_stale_shifts",
    "gf_plant_energy.rolito_cycle_min_minutes", "gf_plant_energy.rolito_cycle_max_minutes",
    "gf_milling_control.variance_threshold_pct",
    "gf_production.require_haccp_for_close",
    "gf_production.require_energy_for_close",
    "gf_production.handover_blocking",
    "gf_production_ops.material_stock_enabled",
)
ADDON_SCHEMA_FIELDS = {
    "gf.energy.reading": {"kwh_base", "kwh_intermedia", "kwh_punta", "capture_mode",
                          "meter_id", "meter_multiplier", "multiplier_source",
                          "data_suspect", "data_suspect_reason"},
    "gf.transformation.recipe": {"expected_units_per_input", "variance_threshold_pct"},
    "gf.transformation.order": {"first_output_qty_units", "recount_output_qty_units",
                                 "recount_captured", "recount_delta_units",
                                 "recount_by_employee_id", "recount_at",
                                 "variance_threshold_pct", "exceeds_variance_threshold"},
}
MODEL_SPECS = {
    "stock.warehouse": (["id", "code", "company_id", "view_location_id", "lot_stock_id",
                         "energy_cost_per_kwh", "energy_kwh_per_kg_target", "energy_tz", "write_date"],
                        lambda w: [("id", "=", w.id)]),
    "gf.production.shift": (["id", "date", "shift_code", "state", "plant_warehouse_id",
                             "leader_employee_id", "line_ids", "energy_start_id", "energy_end_id",
                             "total_kg_produced", "energy_kwh", "energy_kwh_per_kg",
                             "energy_cost_total", "energy_cost_per_kg", "energy_vs_target_pct",
                             "closed_by_employee_id", "closed_at", "end_time",
                             "x_barra_closed", "x_barra_closed_at",
                             "x_rolito_closed", "x_rolito_closed_at", "write_date"],
                            lambda w: [("plant_warehouse_id", "=", w.id)]),
    "gf.energy.reading": (["id", "shift_id", "reading_type", "timestamp", "kwh_value", "employee_id",
                           "meter_id", "meter_multiplier", "multiplier_source", "data_suspect",
                           "data_suspect_reason", "kwh_base", "kwh_intermedia", "kwh_punta",
                           "capture_mode", "write_date"],
                          lambda w: [("shift_id.plant_warehouse_id", "=", w.id)]),
    "gf.energy.meter": (["id", "serial", "warehouse_id", "multiplier", "active", "write_date"],
                        lambda w: [("warehouse_id", "=", w.id)]),
    "gf.energy.tariff": (["id", "warehouse_id", "date_from", "price_base", "price_intermedia",
                          "price_punta", "demand_charge_per_kw_month", "source_note", "active", "write_date"],
                         lambda w: [("warehouse_id", "=", w.id)]),
    "gf.production.line": (["id", "active", "line_type", "plant_warehouse_id",
                            "expected_output_kg_hour", "write_date"],
                           lambda w: [("plant_warehouse_id", "=", w.id)]),
    "gf.production.machine": (["id", "active", "line_id", "machine_type", "capacity_tons_day",
                               "expected_kg_per_cycle", "expected_cycle_minutes", "freeze_hours",
                               "slot_rows", "slot_columns", "kg_per_bar", "bars_per_basket",
                               "min_brine_temp_for_harvest", "write_date"],
                              lambda w: [("line_id.plant_warehouse_id", "=", w.id)]),
    "gf.evaporator.cycle": (["id", "shift_id", "machine_id", "cycle_number", "state",
                              "freeze_start", "freeze_end", "defrost_start", "defrost_end",
                              "kg_dumped", "kg_expected", "kg_deviation_pct", "data_suspect",
                              "data_suspect_reason", "dumped_by_employee_id", "dumped_at",
                              "dumped_role_key", "dump_override_used", "dump_override_reason",
                              "dump_override_supervisor_employee_id", "dump_company_id",
                              "dump_warehouse_id", "dump_line_id", "dump_machine_id", "write_date"],
                             lambda w: [("shift_id.plant_warehouse_id", "=", w.id)]),
    "gf.production.downtime": (["id", "shift_id", "line_id", "machine_id", "category_id",
                                 "cycle_id", "state", "start_time", "end_time", "minutes",
                                 "reason", "operator_id", "ended_by_employee_id", "company_id",
                                 "warehouse_id", "write_date"],
                                lambda w: [("shift_id.plant_warehouse_id", "=", w.id)]),
    "maintenance.request": (["id", "name", "request_date", "maintenance_type", "priority",
                              "equipment_id", "stage_id", "description", "company_id", "write_date"],
                             lambda w: [("equipment_id", "in", env["gf.production.machine"].sudo().search(  # noqa: F821
                                 [("active", "=", True),
                                  ("line_id.plant_warehouse_id", "=", w.id),
                                  ("maintenance_equipment_id", "!=", False)]
                             ).mapped("maintenance_equipment_id").ids or [0])]),
    "gf.compressor.event": (["id", "machine_id", "line_id", "shift_id", "event_type", "timestamp",
                             "employee_id", "source_role", "is_seed", "write_date"],
                            lambda w: [("machine_id.line_id.plant_warehouse_id", "=", w.id)]),
    "gf.compressor.oil.log": (["id", "machine_id", "shift_id", "log_type", "timestamp", "employee_id",
                               "source_role", "oil_level", "liters", "write_date"],
                              lambda w: [("machine_id.line_id.plant_warehouse_id", "=", w.id)]),
    "gf.brine.reading.log": (["id", "machine_id", "shift_id", "timestamp", "salt_level",
                              "salt_level_unit", "brine_temp", "employee_id", "source_role", "write_date"],
                             lambda w: [("machine_id.line_id.plant_warehouse_id", "=", w.id)]),
    "gf.haccp.checklist": (["id", "shift_id", "state", "all_passed", "completed_by_id",
                            "completed_at", "write_date"],
                           lambda w: [("shift_id.plant_warehouse_id", "=", w.id)]),
    "gf.haccp.check": (["id", "checklist_id", "passed", "result_bool", "result_numeric",
                        "result_text", "write_date"],
                       lambda w: [("checklist_id.shift_id.plant_warehouse_id", "=", w.id)]),
    "gf.production.material.issue": (["id", "shift_id", "line_id", "product_id", "state",
                                      "notes", "write_date"],
                                     lambda w: [("shift_id.plant_warehouse_id", "=", w.id)]),
    "gf.production.material.settlement": (["id", "shift_id", "line_id", "product_id", "state",
                                           "write_date"],
                                          lambda w: [("shift_id.plant_warehouse_id", "=", w.id)]),
    "gf.transformation.recipe": (["id", "active", "recipe_code", "role_scope", "warehouse_ids",
                                  "input_product_id", "output_product_id", "ideal_output_weight_kg",
                                  "expected_units_per_input", "variance_threshold_pct", "write_date"],
                                 lambda w: [("warehouse_ids", "in", [w.id])]),
    "gf.transformation.order": (["id", "date", "state", "shift_id", "warehouse_id", "operator_id",
                                 "recipe_id", "recipe_code", "input_product_id", "input_qty",
                                 "input_qty_units", "input_kg_total", "output_qty_units", "output_kg_total",
                                 "expected_output_qty_units", "variance_units", "variance_pct",
                                 "first_output_qty_units", "recount_output_qty_units", "recount_captured",
                                 "recount_delta_units", "recount_by_employee_id", "recount_at",
                                 "variance_threshold_pct", "exceeds_variance_threshold", "write_date"],
                                lambda w: ["|", ("warehouse_id", "=", w.id),
                                           ("shift_id.plant_warehouse_id", "=", w.id)]),
    "gf.transformation.line": (["id", "order_id", "product_id", "lot_id", "qty",
                                "kg_total", "write_date"],
                               lambda w: ["|", ("order_id.warehouse_id", "=", w.id),
                                          ("order_id.shift_id.plant_warehouse_id", "=", w.id)]),
}
OUTSIDE_DOMAINS = {
    "stock.warehouse": lambda w: [("id", "!=", w.id)],
    "gf.production.shift": lambda w: [("plant_warehouse_id", "!=", w.id)],
    "gf.energy.reading": lambda w: [("shift_id.plant_warehouse_id", "!=", w.id)],
    "gf.energy.meter": lambda w: [("warehouse_id", "!=", w.id)],
    "gf.energy.tariff": lambda w: [("warehouse_id", "!=", w.id)],
    "gf.production.line": lambda w: [("plant_warehouse_id", "!=", w.id)],
    "gf.production.machine": lambda w: [("line_id.plant_warehouse_id", "!=", w.id)],
    "gf.evaporator.cycle": lambda w: [("shift_id.plant_warehouse_id", "!=", w.id)],
    "gf.production.downtime": lambda w: [("shift_id.plant_warehouse_id", "!=", w.id)],
    "maintenance.request": lambda w: [("equipment_id", "not in", env["gf.production.machine"].sudo().search(  # noqa: F821
        [("active", "=", True),
         ("line_id.plant_warehouse_id", "=", w.id),
         ("maintenance_equipment_id", "!=", False)]
    ).mapped("maintenance_equipment_id").ids or [0])],
    "gf.compressor.event": lambda w: [("machine_id.line_id.plant_warehouse_id", "!=", w.id)],
    "gf.compressor.oil.log": lambda w: [("machine_id.line_id.plant_warehouse_id", "!=", w.id)],
    "gf.brine.reading.log": lambda w: [("machine_id.line_id.plant_warehouse_id", "!=", w.id)],
    "gf.haccp.checklist": lambda w: [("shift_id.plant_warehouse_id", "!=", w.id)],
    "gf.haccp.check": lambda w: [("checklist_id.shift_id.plant_warehouse_id", "!=", w.id)],
    "gf.production.material.issue": lambda w: [("shift_id.plant_warehouse_id", "!=", w.id)],
    "gf.production.material.settlement": lambda w: [("shift_id.plant_warehouse_id", "!=", w.id)],
    "gf.transformation.recipe": lambda w: ["!", ("warehouse_ids", "in", [w.id])],
    "gf.transformation.order": lambda w: ["!", "|", ("warehouse_id", "=", w.id),
                                            ("shift_id.plant_warehouse_id", "=", w.id)],
    "gf.transformation.line": lambda w: ["!", "|", ("order_id.warehouse_id", "=", w.id),
                                           ("order_id.shift_id.plant_warehouse_id", "=", w.id)],
}


def _seal():
    path, expected_hash = os.environ.get("G3_SEAL_PATH"), os.environ.get("G3_SEAL_SHA256")
    if not path or not expected_hash:
        raise RuntimeError("STOP: independently-created environment seal is required")
    raw = open(path, "rb").read()
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise RuntimeError("STOP: environment seal hash mismatch")
    seal = json.loads(raw)
    if (seal.get("schema") != "g3_environment_seal_v1" or
            seal.get("branch") != "staging-g3-clean-170926" or
            not seal.get("forbidden_databases")):
        raise RuntimeError("STOP: invalid G3 environment seal")
    if env.cr.dbname != seal.get("database") or env.cr.dbname in seal.get("forbidden_databases", []):  # noqa: F821
        raise RuntimeError("STOP: sealed database mismatch or forbidden database")
    neutralized = env["ir.config_parameter"].sudo().get_param("database.is_neutralized")  # noqa: F821
    if str(neutralized).strip().lower() not in ("1", "true", "yes"):
        raise RuntimeError("STOP: database.is_neutralized is not true")
    warehouse_id, company_id, code = seal["warehouse_id"], seal["company_id"], seal["warehouse_code"]
    warehouse = env["stock.warehouse"].sudo().browse(warehouse_id).exists()  # noqa: F821
    if not warehouse or warehouse.company_id.id != company_id or warehouse.code != code:
        raise RuntimeError("STOP: warehouse/company/code seal mismatch")
    matches = env["stock.warehouse"].sudo().search([("code", "=", code)])  # noqa: F821
    if len(matches) != 1 or matches.id != warehouse.id:
        raise RuntimeError("STOP: warehouse code is not globally unique")
    return warehouse


def _value(record, name):
    field, value = record._fields[name], record[name]
    if field.type == "many2one":
        return value.id or None
    if field.type in ("many2many", "one2many"):
        return sorted(value.ids)
    if isinstance(value, (_dt.date, _dt.datetime)):
        return value.isoformat()
    return value


def _digest(value):
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def _business_rows(rows):
    return [
        {name: value for name, value in row.items()
         if name not in ("write_date", "write_uid")}
        for row in rows
    ]


def _require_fields(model, requested_fields):
    missing = sorted(set(requested_fields) - set(model._fields))
    if missing:
        model_name = getattr(model, "_name", repr(model))
        raise RuntimeError(
            "STOP: model %s is missing required fields: %s" %
            (model_name, ", ".join(missing))
        )
    return list(requested_fields)


def _rows(model_name, field_names, domain, include_business=True):
    if model_name not in env.registry:  # noqa: F821
        result = {"available": False, "count": 0, "fields": [], "ids": [], "rows": [],
                  "sha256": _digest([])}
        if include_business:
            result["business_sha256"] = _digest([])
        return result
    model = env[model_name].sudo()  # noqa: F821
    field_names = _require_fields(model, field_names)
    records = model.search(domain, order="id asc")
    rows = [{name: _value(record, name) for name in field_names} for record in records]
    result = {"available": True, "count": len(rows), "fields": field_names,
              "ids": records.ids, "rows": rows, "sha256": _digest(rows)}
    if include_business:
        result["business_sha256"] = _digest(_business_rows(rows))
    return result


def _outside_sentinel(model_name, field_names, domain):
    """Hash every record outside PIGU without exporting its rows."""
    if model_name not in env.registry:  # noqa: F821
        return {"available": False, "count": 0, "sha256": _digest([])}
    model = env[model_name].sudo()  # noqa: F821
    field_names = _require_fields(model, field_names)
    digest = hashlib.sha256()
    business_digest = hashlib.sha256()
    business_fields = [name for name in field_names if name not in ("write_date", "write_uid")]
    count, last_id = 0, 0
    while True:
        records = model.search(list(domain) + [("id", ">", last_id)],
                               order="id asc", limit=1000)
        if not records:
            break
        for record in records:
            row = {name: _value(record, name) for name in field_names}
            digest.update(json.dumps(row, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode("utf-8"))
            digest.update(b"\n")
            business_row = {name: row[name] for name in business_fields}
            business_digest.update(json.dumps(
                business_row, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
            ).encode("utf-8"))
            business_digest.update(b"\n")
        count += len(records)
        last_id = records[-1].id
        # Odoo's prefetch cache otherwise retains every traversed record even
        # though the Python list is batched. This keeps global inventory scans
        # bounded on production-sized copies.
        records.invalidate_recordset(field_names, flush=False)
        del record
        del records
    return {"available": True, "count": count, "sha256": digest.hexdigest(),
            "business_sha256": business_digest.hexdigest()}


def _inventory(warehouse):
    root = warehouse.view_location_id or warehouse.lot_stock_id
    in_plant = [("location_id", "child_of", root.id)]
    quants = _rows("stock.quant", ["id", "product_id", "location_id", "lot_id", "package_id",
                                    "owner_id", "quantity", "reserved_quantity", "write_date"], in_plant)
    move_domain = ["|", ("location_id", "child_of", root.id),
                   ("location_dest_id", "child_of", root.id)]
    move_lines = _rows("stock.move.line", ["id", "move_id", "product_id", "lot_id", "location_id",
                                             "location_dest_id", "quantity", "write_date"], move_domain)
    moves = _rows("stock.move", ["id", "product_id", "location_id", "location_dest_id", "state",
                                  "product_uom_qty", "quantity", "write_date"], move_domain)
    lot_ids = sorted({row.get("lot_id") for row in quants["rows"] + move_lines["rows"] if row.get("lot_id")})
    lots = _rows("stock.lot", ["id", "product_id", "company_id", "write_date"], [("id", "in", lot_ids)])
    return {"stock.quant": quants, "stock.move.line": move_lines, "stock.move": moves, "stock.lot": lots}


def main():
    warehouse = _seal()
    models = {name: _rows(name, names, domain(warehouse))
              for name, (names, domain) in MODEL_SPECS.items()}
    models.update(_inventory(warehouse))
    models["ir.config_parameter@g3"] = _rows(
        "ir.config_parameter", ["id", "key", "value", "write_date"],
        [("key", "in", list(CONFIG_KEYS))])
    modules = _rows("ir.module.module", ["id", "name", "state", "installed_version",
                                         "latest_version", "write_date"],
                    [("name", "in", ["gf_production_ops", "gf_plant_energy", "gf_milling_control"])],
                    include_business=False)
    sentinels = {}
    for name, (names, _domain) in MODEL_SPECS.items():
        sentinels[name + "@outside"] = _outside_sentinel(
            name, [field for field in names
                   if field not in ADDON_SCHEMA_FIELDS.get(name, set())],
            OUTSIDE_DOMAINS[name](warehouse))
    root = warehouse.view_location_id or warehouse.lot_stock_id
    inventory_outside = {
        "stock.quant": ["!", ("location_id", "child_of", root.id)],
        "stock.move.line": ["!", "|", ("location_id", "child_of", root.id),
                            ("location_dest_id", "child_of", root.id)],
        "stock.move": ["!", "|", ("location_id", "child_of", root.id),
                       ("location_dest_id", "child_of", root.id)],
        # Lots have no warehouse dimension. The local set is normally small;
        # this is the sole bounded NOT IN used by the sentinel layer.
        "stock.lot": [("id", "not in", models["stock.lot"].get("ids", []) or [0])],
    }
    for name, domain in inventory_outside.items():
        sentinels[name + "@outside"] = _outside_sentinel(
            name, models[name].get("fields", []), domain)
    report = {"schema": "g3_business_snapshot_v2", "database": env.cr.dbname,  # noqa: F821
              "captured_at_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(),
              "warehouse_id": warehouse.id, "warehouse_code": warehouse.code,
              "company_id": warehouse.company_id.id, "modules": modules,
              "models": models, "outside_sentinels": sentinels}
    report["business_sha256"] = _digest(
        {name: data["business_sha256"] for name, data in models.items()})
    fd = os.open(OUTPUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, sort_keys=True, indent=2)
        handle.write("\n")
    os.chmod(OUTPUT, 0o600)
    print(json.dumps({"output": OUTPUT, "database": report["database"],
                      "warehouse_id": warehouse.id, "company_id": warehouse.company_id.id,
                      "business_sha256": report["business_sha256"],
                      "counts": {name: data["count"] for name, data in models.items()}}, sort_keys=True))


main()
