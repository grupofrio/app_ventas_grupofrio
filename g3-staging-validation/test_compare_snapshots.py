import copy
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("compare_snapshots.py")
MODULE_FIELDS = [
    "id", "name", "state", "installed_version", "latest_version", "write_date",
]


def rows_sha256(rows):
    raw = json.dumps(rows, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def business_rows(rows):
    return [
        {name: value for name, value in row.items()
         if name not in ("write_date", "write_uid")}
        for row in rows
    ]


def section(rows, fields=None, available=True):
    if fields is None:
        fields = list(rows[0]) if rows else ["id"]
    return {
        "available": available,
        "count": len(rows),
        "fields": list(fields),
        "ids": [row["id"] for row in rows],
        "rows": rows,
        "sha256": rows_sha256(rows),
        "business_sha256": rows_sha256(business_rows(rows)),
    }


def refresh_section(value):
    rows = value["rows"]
    value.update({
        "count": len(rows),
        "ids": [row["id"] for row in rows],
        "sha256": rows_sha256(rows),
        "business_sha256": rows_sha256(business_rows(rows)),
    })


def refresh_snapshot_business(value):
    value["business_sha256"] = rows_sha256({
        name: section_value["business_sha256"]
        for name, section_value in value["models"].items()
    })


def module_section(rows):
    return {
        "available": True,
        "count": len(rows),
        "fields": list(MODULE_FIELDS),
        "ids": [row["id"] for row in rows],
        "rows": rows,
        "sha256": rows_sha256(rows),
    }


def refresh_modules(value):
    rows = value["modules"]["rows"]
    value["modules"].update({
        "count": len(rows),
        "ids": [row["id"] for row in rows],
        "sha256": rows_sha256(rows),
    })


def snapshot():
    config = [
        {"id": 20, "key": "gf_plant_energy.rolito_base_hours", "value": "24"},
        {"id": 21, "key": "gf_plant_energy.oil_stale_shifts", "value": "2"},
        {"id": 22, "key": "gf_plant_energy.rolito_cycle_min_minutes", "value": "28"},
        {"id": 23, "key": "gf_plant_energy.rolito_cycle_max_minutes", "value": "35"},
        {"id": 24, "key": "gf_milling_control.variance_threshold_pct", "value": "5"},
    ]
    value = {"schema": "g3_business_snapshot_v2", "database": "g3-copy",
             "warehouse_id": 89, "warehouse_code": "PIGU", "company_id": 34,
             "outside_sentinels": {"gf.energy.reading@outside": {"count": 2, "sha256": "stable"}},
             "modules": module_section([
                {"id": 1, "name": "gf_plant_energy", "state": "installed",
                 "installed_version": "18.0.1.2.2", "latest_version": None,
                 "write_date": "stable"},
                {"id": 2, "name": "gf_milling_control", "state": "installed",
                 "installed_version": "18.0.1.0.0", "latest_version": None,
                 "write_date": "stable"},
                {"id": 3, "name": "gf_production_ops", "state": "installed",
                 "installed_version": "18.0.1.0.15", "latest_version": "18.0.1.0.15",
                 "write_date": "stable"},
            ]), "models": {
                "stock.quant": section([], ["id", "quantity"]),
                "gf.energy.meter": section([{"id": 8, "serial": "NPL889", "warehouse_id": 89,
                                              "multiplier": 1200.0, "active": True}]),
                "gf.energy.tariff": section([{"id": 9, "warehouse_id": 89,
                                               "date_from": "2026-07-01", "price_base": 0.74,
                                               "price_intermedia": 1.45, "price_punta": 1.67,
                                               "demand_charge_per_kw_month": 234.0,
                                               "source_note": "Recibo CFE jul-26", "active": True}]),
                 "ir.config_parameter@g3": section(config),
             }}
    refresh_snapshot_business(value)
    return value


class CompareSnapshotsTest(unittest.TestCase):
    def run_compare(self, before, after, *extra):
        with tempfile.TemporaryDirectory() as temp:
            left, right = Path(temp) / "left.json", Path(temp) / "right.json"
            left.write_text(json.dumps(before))
            right.write_text(json.dumps(after))
            return subprocess.run(["python3", str(SCRIPT), str(left), str(right), *extra],
                                  capture_output=True, text=True, check=False)

    def run_cleanup(self, before, after, contract):
        with tempfile.TemporaryDirectory() as temp:
            left = Path(temp) / "left.json"
            right = Path(temp) / "right.json"
            rule = Path(temp) / "cleanup.json"
            left.write_text(json.dumps(before))
            right.write_text(json.dumps(after))
            raw = json.dumps(contract, sort_keys=True).encode()
            rule.write_bytes(raw)
            return subprocess.run([
                "python3", str(SCRIPT), str(left), str(right),
                "--mode", "cleanup", "--contract", str(rule),
                "--contract-sha256", hashlib.sha256(raw).hexdigest(),
            ], capture_output=True, text=True, check=False)

    def cleanup_contract(self):
        return {
            "schema": "sp_r3_cleanup_contract_v1",
            "database": "g3-copy",
            "warehouse_id": 89,
            "warehouse_code": "PIGU",
            "company_id": 34,
            "modules": [{
                "name": "gf_production_ops",
                "installed_version": "18.0.1.0.15",
                "latest_version": "18.0.1.0.15",
            }],
        }

    def test_bootstrap_rejects_inventory_mutation(self):
        before, after = snapshot(), snapshot()
        after["models"]["stock.quant"] = section([{"id": 7, "quantity": 0}])
        refresh_snapshot_business(after)
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("outside bootstrap contract", result.stdout)

    def test_bootstrap_rejects_model_section_metadata_tampering(self):
        before, after = snapshot(), snapshot()
        after["models"]["stock.quant"]["count"] = 999
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("model section count mismatch", result.stdout)

    def test_bootstrap_rejects_duplicate_model_row_ids_even_when_both_sides_match(self):
        before, after = snapshot(), snapshot()
        duplicate = section([
            {"id": 7, "quantity": 0},
            {"id": 7, "quantity": 0},
        ])
        before["models"]["stock.quant"] = copy.deepcopy(duplicate)
        after["models"]["stock.quant"] = copy.deepcopy(duplicate)
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("duplicate model row ids", result.stdout)

    def test_bootstrap_rejects_model_section_hash_or_schema_tampering(self):
        mutations = {
            "sha256": lambda section: section.__setitem__("sha256", "tampered"),
            "business_sha256": lambda section: section.__setitem__(
                "business_sha256", "tampered"),
            "extra": lambda section: section.__setitem__("unexpected", True),
            "fields": lambda section: section.__setitem__("fields", ["id", "id"]),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                before, after = snapshot(), snapshot()
                mutate(after["models"]["stock.quant"])
                result = self.run_compare(before, after, "--mode", "bootstrap")
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertIn("model section", result.stdout)

    def test_bootstrap_rejects_extra_or_missing_model_even_when_sections_are_coherent(self):
        before, after = snapshot(), snapshot()
        after["models"]["unexpected.model"] = section([], ["id"])
        refresh_snapshot_business(after)
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("model set mismatch", result.stdout)

        before, after = snapshot(), snapshot()
        after["models"].pop("stock.quant")
        refresh_snapshot_business(after)
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("model set mismatch", result.stdout)

    def test_bootstrap_rejects_tampered_aggregate_business_hash(self):
        before, after = snapshot(), snapshot()
        after["business_sha256"] = "tampered"
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("aggregate business_sha256 mismatch", result.stdout)

    def test_bootstrap_rejects_reading_deletion(self):
        before, after = snapshot(), snapshot()
        before["models"]["gf.energy.reading"] = section(
            [{"id": 3, "meter_multiplier": 0}])
        after["models"]["gf.energy.reading"] = section(
            [], ["id", "meter_multiplier"])
        refresh_snapshot_business(before)
        refresh_snapshot_business(after)
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("action=deleted", result.stdout)

    def test_bootstrap_accepts_only_declared_reading_fields(self):
        before, after = snapshot(), snapshot()
        before["models"]["gf.energy.reading"] = section([
            {"id": 3, "meter_id": None, "meter_multiplier": 0, "multiplier_source": False},
        ])
        after["models"]["gf.energy.reading"] = section([
            {"id": 3, "meter_id": 8, "meter_multiplier": 1200,
             "multiplier_source": "backfill"},
        ])
        refresh_snapshot_business(before)
        refresh_snapshot_business(after)
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_identity_mismatch_is_stop(self):
        before, after = snapshot(), snapshot()
        after["database"] = "some-other-copy"
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("database mismatch", result.stdout)

    def test_bootstrap_rejects_wrong_multiplier_value(self):
        before, after = snapshot(), snapshot()
        before["models"]["gf.energy.reading"] = section([
            {"id": 3, "meter_id": None, "meter_multiplier": 0, "multiplier_source": False},
        ])
        after["models"]["gf.energy.reading"] = section([
            {"id": 3, "meter_id": 8, "meter_multiplier": 999,
             "multiplier_source": "backfill"},
        ])
        refresh_snapshot_business(before)
        refresh_snapshot_business(after)
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("invalid backfill", result.stdout)

    def test_bootstrap_rejects_wrong_config_value(self):
        before, after = snapshot(), snapshot()
        after["models"]["ir.config_parameter@g3"]["rows"][0]["value"] = "999"
        refresh_section(after["models"]["ir.config_parameter@g3"])
        refresh_snapshot_business(after)
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("config values mismatch", result.stdout)

    def test_e2e_created_record_must_match_sealed_after_values(self):
        before, after = snapshot(), snapshot()
        before["models"]["gf.transformation.order"] = section(
            [], ["id", "warehouse_id", "state"])
        after["models"]["gf.transformation.order"] = section([
            {"id": 77, "warehouse_id": 999, "state": "done"},
        ])
        refresh_snapshot_business(before)
        refresh_snapshot_business(after)
        contract = {"database": "g3-copy", "warehouse_id": 89, "company_id": 34,
                    "allowed_changes": {
                        "gf.transformation.order:created:77": {
                            "after": {"warehouse_id": 89, "state": "done"}}}}
        with tempfile.TemporaryDirectory() as temp:
            left, right, rule = (Path(temp) / name for name in ("left.json", "right.json", "rule.json"))
            left.write_text(json.dumps(before)); right.write_text(json.dumps(after))
            raw = json.dumps(contract).encode(); rule.write_bytes(raw)
            result = subprocess.run([
                "python3", str(SCRIPT), str(left), str(right), "--mode", "e2e",
                "--contract", str(rule), "--contract-sha256", hashlib.sha256(raw).hexdigest(),
            ], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("created after-value mismatch", result.stdout)

    def test_bootstrap_accepts_created_target_modules(self):
        before, after = snapshot(), snapshot()
        before["modules"] = module_section([
            copy.deepcopy(after["modules"]["rows"][2]),
        ])
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_bootstrap_accepts_addon_schema_defaults(self):
        before, after = snapshot(), snapshot()
        before["models"]["gf.transformation.recipe"] = section([
            {"id": 40, "recipe_code": "MOL"},
        ])
        after["models"]["gf.transformation.recipe"] = section([
            {"id": 40, "recipe_code": "MOL", "expected_units_per_input": 0.0,
             "variance_threshold_pct": 0.0},
        ])
        before["models"]["gf.transformation.order"] = section([
            {"id": 50, "recipe_id": 40, "variance_pct": 10.0,
             "write_date": "2026-01-01T00:00:00"},
        ])
        after["models"]["gf.transformation.order"] = section([
            {"id": 50, "recipe_id": 40, "variance_pct": 10.0,
             "first_output_qty_units": 0.0, "recount_output_qty_units": 0.0,
             "recount_captured": False, "recount_delta_units": 0.0,
             "recount_by_employee_id": None, "recount_at": False,
             "variance_threshold_pct": 5.0, "exceeds_variance_threshold": True,
             "write_date": "2026-09-17T16:21:59"},
        ])
        refresh_snapshot_business(before)
        refresh_snapshot_business(after)
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_bootstrap_accepts_only_schema_metadata_change_outside_plant(self):
        before, after = snapshot(), snapshot()
        before["outside_sentinels"]["gf.transformation.order@outside"] = {
            "available": True, "count": 209, "sha256": "old-with-metadata",
            "business_sha256": "same-business",
        }
        after["outside_sentinels"]["gf.transformation.order@outside"] = {
            "available": True, "count": 209, "sha256": "new-with-metadata",
            "business_sha256": "same-business",
        }
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_bootstrap_rejects_business_change_outside_plant(self):
        before, after = snapshot(), snapshot()
        before["outside_sentinels"]["gf.transformation.order@outside"] = {
            "available": True, "count": 209, "sha256": "old",
            "business_sha256": "old-business",
        }
        after["outside_sentinels"]["gf.transformation.order@outside"] = {
            "available": True, "count": 209, "sha256": "new",
            "business_sha256": "new-business",
        }
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("outside sealed warehouse changed", result.stdout)

    def test_cross_plaza_sentinel_change_is_stop(self):
        before, after = snapshot(), snapshot()
        after["outside_sentinels"]["gf.energy.reading@outside"]["sha256"] = "changed"
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("outside sealed warehouse changed", result.stdout)

    def test_empty_outside_model_may_appear_on_install(self):
        before, after = snapshot(), snapshot()
        before["outside_sentinels"]["gf.energy.meter@outside"] = {
            "available": False, "count": 0, "sha256": "old-empty"}
        after["outside_sentinels"]["gf.energy.meter@outside"] = {
            "available": True, "count": 0, "sha256": "new-empty"}
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_milling_threshold_is_derived_not_self_consistent(self):
        before, after = snapshot(), snapshot()
        before["models"]["gf.transformation.recipe"] = section([
            {"id": 40, "recipe_code": "MOL"},
        ])
        after["models"]["gf.transformation.recipe"] = section([
            {"id": 40, "recipe_code": "MOL", "expected_units_per_input": 0.0,
             "variance_threshold_pct": 0.0},
        ])
        before["models"]["gf.transformation.order"] = section([
            {"id": 50, "recipe_id": 40, "variance_pct": 10.0},
        ])
        after["models"]["gf.transformation.order"] = section([
            {"id": 50, "recipe_id": 40, "variance_pct": 10.0,
             "first_output_qty_units": 0.0, "recount_output_qty_units": 0.0,
             "recount_captured": False, "recount_delta_units": 0.0,
             "recount_by_employee_id": None, "recount_at": False,
             "variance_threshold_pct": 999.0, "exceeds_variance_threshold": False},
        ])
        refresh_snapshot_business(before)
        refresh_snapshot_business(after)
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("threshold value mismatch", result.stdout)

    def test_cleanup_accepts_exact_business_restore_and_sealed_module_metadata(self):
        before, after = snapshot(), snapshot()
        after["modules"]["rows"][2].update({
            "installed_version": "18.0.1.0.16",
            "latest_version": "18.0.1.0.16",
            "write_date": "after",
        })
        refresh_modules(after)
        contract = self.cleanup_contract()
        contract["modules"][0].update({
            "installed_version": "18.0.1.0.16",
            "latest_version": "18.0.1.0.16",
        })
        result = self.run_cleanup(before, after, contract)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_cleanup_requires_exact_models_not_only_equal_rows(self):
        before, after = snapshot(), snapshot()
        after["models"]["stock.quant"]["sha256"] = "tampered"
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("model section stock.quant after sha256 mismatch", result.stdout)

    def test_cleanup_requires_exact_external_sentinels(self):
        before, after = snapshot(), snapshot()
        after["outside_sentinels"]["gf.energy.reading@outside"]["count"] = 3
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("outside sentinels differ", result.stdout)

    def test_cleanup_rejects_module_row_addition(self):
        before, after = snapshot(), snapshot()
        after["modules"]["rows"].append({
            "id": 4, "name": "unexpected_module", "state": "installed",
            "installed_version": "18.0.1.0.16", "latest_version": "18.0.1.0.16",
            "write_date": "after",
        })
        refresh_modules(after)
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("module rows must not be created or deleted", result.stdout)

    def test_cleanup_rejects_additional_module_field_even_if_unchanged(self):
        before, after = snapshot(), snapshot()
        before["modules"]["rows"][0]["unexpected"] = "same"
        after["modules"]["rows"][0]["unexpected"] = "same"
        refresh_modules(before)
        refresh_modules(after)
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("module row fields mismatch", result.stdout)

    def test_cleanup_rejects_unsealed_module_or_field(self):
        before, after = snapshot(), snapshot()
        after["modules"]["rows"][0]["write_date"] = "after"
        refresh_modules(after)
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("module is not declared", result.stdout)

        after = snapshot()
        after["modules"]["rows"][0]["state"] = "to upgrade"
        refresh_modules(after)
        contract = self.cleanup_contract()
        contract["modules"].append({
            "name": "gf_plant_energy",
            "installed_version": "18.0.1.2.2",
            "latest_version": None,
        })
        result = self.run_cleanup(before, after, contract)
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("unexpected module fields", result.stdout)

    def test_cleanup_rejects_wrong_declared_version_or_contract_hash(self):
        before, after = snapshot(), snapshot()
        after["modules"]["rows"][2].update({
            "installed_version": "18.0.1.0.17", "latest_version": "18.0.1.0.17",
            "write_date": "after",
        })
        refresh_modules(after)
        contract = self.cleanup_contract()
        contract["modules"][0].update({
            "installed_version": "18.0.1.0.16",
            "latest_version": "18.0.1.0.16",
        })
        result = self.run_cleanup(before, after, contract)
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("sealed version mismatch", result.stdout)

        with tempfile.TemporaryDirectory() as temp:
            left, right, rule = (Path(temp) / name for name in
                                 ("left.json", "right.json", "cleanup.json"))
            left.write_text(json.dumps(before))
            right.write_text(json.dumps(before))
            rule.write_text(json.dumps(self.cleanup_contract()))
            result = subprocess.run([
                "python3", str(SCRIPT), str(left), str(right), "--mode", "cleanup",
                "--contract", str(rule), "--contract-sha256", "0" * 64,
            ], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("contract hash mismatch", result.stdout)

    def test_cleanup_rejects_additional_module_container_field(self):
        before, after = snapshot(), snapshot()
        after["modules"]["unexpected"] = "not part of snapshot schema"
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("module container fields mismatch", result.stdout)

    def test_cleanup_rejects_incoherent_module_container_metadata(self):
        mutations = {
            "count": lambda modules: modules.__setitem__("count", 999),
            "ids": lambda modules: modules.__setitem__("ids", [999]),
            "sha256": lambda modules: modules.__setitem__("sha256", "tampered"),
            "fields": lambda modules: modules.__setitem__("fields", ["id", "name"]),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                before, after = snapshot(), snapshot()
                mutate(after["modules"])
                result = self.run_cleanup(before, after, self.cleanup_contract())
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertIn("module container", result.stdout)

    def test_cleanup_rejects_duplicate_module_row_ids(self):
        before, after = snapshot(), snapshot()
        after["modules"]["rows"].append(copy.deepcopy(after["modules"]["rows"][0]))
        refresh_modules(after)
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("duplicate module row ids", result.stdout)

    def test_cleanup_rejects_non_integer_module_row_id(self):
        before, after = snapshot(), snapshot()
        after["modules"]["rows"][0]["id"] = "1"
        refresh_modules(after)
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("module row ids invalid", result.stdout)


if __name__ == "__main__":
    unittest.main()
