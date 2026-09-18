import copy
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("compare_snapshots.py")


def snapshot():
    empty = {"available": True, "count": 0, "rows": [], "sha256": "empty"}
    def section(rows):
        return {"available": True, "count": len(rows), "rows": rows, "sha256": str(rows)}
    config = [
        {"id": 20, "key": "gf_plant_energy.rolito_base_hours", "value": "24"},
        {"id": 21, "key": "gf_plant_energy.oil_stale_shifts", "value": "2"},
        {"id": 22, "key": "gf_plant_energy.rolito_cycle_min_minutes", "value": "28"},
        {"id": 23, "key": "gf_plant_energy.rolito_cycle_max_minutes", "value": "35"},
        {"id": 24, "key": "gf_milling_control.variance_threshold_pct", "value": "5"},
    ]
    return {"schema": "g3_business_snapshot_v2", "database": "g3-copy",
            "warehouse_id": 89, "warehouse_code": "PIGU", "company_id": 34,
            "outside_sentinels": {"gf.energy.reading@outside": {"count": 2, "sha256": "stable"}},
            "modules": section([
                {"id": 1, "name": "gf_plant_energy", "state": "installed",
                 "installed_version": "18.0.1.2.2", "latest_version": None,
                 "write_date": "stable"},
                {"id": 2, "name": "gf_milling_control", "state": "installed",
                 "installed_version": "18.0.1.0.0", "latest_version": None,
                 "write_date": "stable"},
            ]), "models": {
                "stock.quant": copy.deepcopy(empty),
                "gf.energy.meter": section([{"id": 8, "serial": "NPL889", "warehouse_id": 89,
                                              "multiplier": 1200.0, "active": True}]),
                "gf.energy.tariff": section([{"id": 9, "warehouse_id": 89,
                                               "date_from": "2026-07-01", "price_base": 0.74,
                                               "price_intermedia": 1.45, "price_punta": 1.67,
                                               "demand_charge_per_kw_month": 234.0,
                                               "source_note": "Recibo CFE jul-26", "active": True}]),
                "ir.config_parameter@g3": section(config),
            }}


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
                "installed_version": "18.0.1.0.16",
                "latest_version": "18.0.1.0.16",
            }],
        }

    def test_bootstrap_rejects_inventory_mutation(self):
        before, after = snapshot(), snapshot()
        after["models"]["stock.quant"] = {
            "available": True, "count": 1, "rows": [{"id": 7, "quantity": 0}], "sha256": "changed"}
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("outside bootstrap contract", result.stdout)

    def test_bootstrap_rejects_reading_deletion(self):
        before, after = snapshot(), snapshot()
        before["models"]["gf.energy.reading"] = {
            "available": True, "count": 1, "rows": [{"id": 3, "meter_multiplier": 0}], "sha256": "a"}
        after["models"]["gf.energy.reading"] = {
            "available": True, "count": 0, "rows": [], "sha256": "b"}
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("action=deleted", result.stdout)

    def test_bootstrap_accepts_only_declared_reading_fields(self):
        before, after = snapshot(), snapshot()
        before["models"]["gf.energy.reading"] = {
            "available": True, "count": 1,
            "rows": [{"id": 3, "meter_id": None, "meter_multiplier": 0, "multiplier_source": False}],
            "sha256": "a"}
        after["models"]["gf.energy.reading"] = {
            "available": True, "count": 1,
            "rows": [{"id": 3, "meter_id": 8, "meter_multiplier": 1200, "multiplier_source": "backfill"}],
            "sha256": "b"}
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
        before["models"]["gf.energy.reading"] = {
            "available": True, "count": 1,
            "rows": [{"id": 3, "meter_id": None, "meter_multiplier": 0, "multiplier_source": False}],
            "sha256": "a"}
        after["models"]["gf.energy.reading"] = {
            "available": True, "count": 1,
            "rows": [{"id": 3, "meter_id": 8, "meter_multiplier": 999, "multiplier_source": "backfill"}],
            "sha256": "b"}
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("invalid backfill", result.stdout)

    def test_bootstrap_rejects_wrong_config_value(self):
        before, after = snapshot(), snapshot()
        after["models"]["ir.config_parameter@g3"]["rows"][0]["value"] = "999"
        after["models"]["ir.config_parameter@g3"]["sha256"] = "changed"
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("config values mismatch", result.stdout)

    def test_e2e_created_record_must_match_sealed_after_values(self):
        before, after = snapshot(), snapshot()
        before["models"]["gf.transformation.order"] = {
            "available": True, "count": 0, "rows": [], "sha256": "a"}
        after["models"]["gf.transformation.order"] = {
            "available": True, "count": 1,
            "rows": [{"id": 77, "warehouse_id": 999, "state": "done"}], "sha256": "b"}
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
        before["modules"] = {"available": True, "count": 0, "rows": [], "sha256": "none"}
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_bootstrap_accepts_addon_schema_defaults(self):
        before, after = snapshot(), snapshot()
        before["models"]["gf.transformation.recipe"] = {
            "available": True, "count": 1,
            "rows": [{"id": 40, "recipe_code": "MOL"}], "sha256": "a"}
        after["models"]["gf.transformation.recipe"] = {
            "available": True, "count": 1,
            "rows": [{"id": 40, "recipe_code": "MOL", "expected_units_per_input": 0.0,
                      "variance_threshold_pct": 0.0}], "sha256": "b"}
        before["models"]["gf.transformation.order"] = {
            "available": True, "count": 1,
            "rows": [{"id": 50, "recipe_id": 40, "variance_pct": 10.0,
                      "write_date": "2026-01-01T00:00:00"}], "sha256": "a"}
        after["models"]["gf.transformation.order"] = {
            "available": True, "count": 1,
            "rows": [{"id": 50, "recipe_id": 40, "variance_pct": 10.0, "first_output_qty_units": 0.0,
                      "recount_output_qty_units": 0.0, "recount_captured": False,
                      "recount_delta_units": 0.0, "recount_by_employee_id": None,
                      "recount_at": False, "variance_threshold_pct": 5.0,
                      "exceeds_variance_threshold": True,
                      "write_date": "2026-09-17T16:21:59"}], "sha256": "b"}
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
        before["models"]["gf.transformation.recipe"] = {
            "available": True, "count": 1,
            "rows": [{"id": 40, "recipe_code": "MOL"}], "sha256": "a"}
        after["models"]["gf.transformation.recipe"] = {
            "available": True, "count": 1,
            "rows": [{"id": 40, "recipe_code": "MOL", "expected_units_per_input": 0.0,
                      "variance_threshold_pct": 0.0}], "sha256": "b"}
        before["models"]["gf.transformation.order"] = {
            "available": True, "count": 1,
            "rows": [{"id": 50, "recipe_id": 40, "variance_pct": 10.0}], "sha256": "a"}
        after["models"]["gf.transformation.order"] = {
            "available": True, "count": 1,
            "rows": [{"id": 50, "recipe_id": 40, "variance_pct": 10.0,
                      "first_output_qty_units": 0.0, "recount_output_qty_units": 0.0,
                      "recount_captured": False, "recount_delta_units": 0.0,
                      "recount_by_employee_id": None, "recount_at": False,
                      "variance_threshold_pct": 999.0,
                      "exceeds_variance_threshold": False}], "sha256": "b"}
        result = self.run_compare(before, after, "--mode", "bootstrap")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("threshold value mismatch", result.stdout)

    def test_cleanup_accepts_exact_business_restore_and_sealed_module_metadata(self):
        before, after = snapshot(), snapshot()
        before["modules"]["rows"].append({
            "id": 3, "name": "gf_production_ops", "state": "installed",
            "installed_version": "18.0.1.0.15", "latest_version": "18.0.1.0.15",
            "write_date": "before",
        })
        after["modules"]["rows"].append({
            "id": 3, "name": "gf_production_ops", "state": "installed",
            "installed_version": "18.0.1.0.16", "latest_version": "18.0.1.0.16",
            "write_date": "after",
        })
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_cleanup_requires_exact_models_not_only_equal_rows(self):
        before, after = snapshot(), snapshot()
        after["models"]["stock.quant"]["sha256"] = "tampered"
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("models differ", result.stdout)

    def test_cleanup_requires_exact_external_sentinels(self):
        before, after = snapshot(), snapshot()
        after["outside_sentinels"]["gf.energy.reading@outside"]["count"] = 3
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("outside sentinels differ", result.stdout)

    def test_cleanup_rejects_module_row_addition(self):
        before, after = snapshot(), snapshot()
        after["modules"]["rows"].append({
            "id": 3, "name": "gf_production_ops", "state": "installed",
            "installed_version": "18.0.1.0.16", "latest_version": "18.0.1.0.16",
            "write_date": "after",
        })
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("module rows must not be created or deleted", result.stdout)

    def test_cleanup_rejects_additional_module_field_even_if_unchanged(self):
        before, after = snapshot(), snapshot()
        before["modules"]["rows"][0]["unexpected"] = "same"
        after["modules"]["rows"][0]["unexpected"] = "same"
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("module row fields mismatch", result.stdout)

    def test_cleanup_rejects_unsealed_module_or_field(self):
        before, after = snapshot(), snapshot()
        after["modules"]["rows"][0]["write_date"] = "after"
        result = self.run_cleanup(before, after, self.cleanup_contract())
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("module is not declared", result.stdout)

        after = snapshot()
        after["modules"]["rows"][0]["state"] = "to upgrade"
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
        before["modules"]["rows"].append({
            "id": 3, "name": "gf_production_ops", "state": "installed",
            "installed_version": "18.0.1.0.15", "latest_version": "18.0.1.0.15",
            "write_date": "before",
        })
        after["modules"]["rows"].append({
            "id": 3, "name": "gf_production_ops", "state": "installed",
            "installed_version": "18.0.1.0.17", "latest_version": "18.0.1.0.17",
            "write_date": "after",
        })
        result = self.run_cleanup(before, after, self.cleanup_contract())
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


if __name__ == "__main__":
    unittest.main()
