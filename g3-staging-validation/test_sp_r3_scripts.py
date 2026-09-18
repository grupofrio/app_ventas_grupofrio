import copy
import ast
import hashlib
import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeCursor:
    def __init__(self, dbname="g3-clean"):
        self.dbname = dbname
        self.commits = 0
        self.rollbacks = 0

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class FakeOps:
    def __init__(self, dbname="g3-clean"):
        self.cr = FakeCursor(dbname)
        self.neutralized = True
        self.warehouse = {"id": 76, "company_id": 35, "code": "PIGU-PLANTA"}
        self.employees = {
            2548: {"id": 2548, "company_id": 35, "warehouse_ids": [76], "role": "supervisor_produccion"},
            2549: {"id": 2549, "company_id": 35, "warehouse_ids": [76], "role": "operador_barra"},
            2550: {"id": 2550, "company_id": 35, "warehouse_ids": [115], "role": "supervisor_produccion"},
        }
        self.params = {
            "gf_production.require_haccp_for_close": "0",
            "gf_production.require_energy_for_close": "0",
            "gf_production.handover_blocking": "1",
            "gf_production_ops.material_stock_enabled": "1",
            "database.is_neutralized": "true",
        }
        self.shifts = []
        self.created = {}
        self.next_id = 9000
        self.mutating_calls = []
        self.blockers = {
            "haccp", "energy_end", "open_downtime", "open_cycles",
            "operator_barra_not_closed", "operator_rolito_not_closed",
        }
        self.unexpected_dependencies = []
        self.stock_dependencies = []
        self.fail_after_create = False
        self._transaction = None

    def clone(self):
        return copy.deepcopy(self)

    def begin(self):
        self._transaction = copy.deepcopy((self.params, self.shifts, self.created, self.next_id))

    def commit(self):
        self.cr.commit()
        self._transaction = None

    def rollback(self):
        self.cr.rollback()
        if self._transaction is not None:
            self.params, self.shifts, self.created, self.next_id = self._transaction
            self._transaction = None

    def environment(self):
        return {
            "database": self.cr.dbname,
            "neutralized": self.neutralized,
            "warehouse": copy.deepcopy(self.warehouse),
            "employees": copy.deepcopy(self.employees),
            "backend_sha": "be-sha",
            "frontend_sha": "fe-sha",
            "module_versions": {"gf_production_ops": "18.0.1.0.16"},
            "params": copy.deepcopy(self.params),
        }

    def occupied_shifts(self):
        return copy.deepcopy(self.shifts)

    def set_param(self, key, value):
        self.mutating_calls.append(("set_param", key, value))
        self.params[key] = value

    def create_fixture(self, plan, marker):
        self.mutating_calls.append(("create_fixture", plan["date"], plan["shift_code"]))
        if self.fail_after_create:
            raise RuntimeError("boom during setup")
        ids = {}
        for alias in ("shift", "energy_start", "haccp", "cycle", "downtime", "issue", "settlement"):
            self.next_id += 1
            ids[alias] = self.next_id
            self.created.setdefault(alias, {})[self.next_id] = {
                "id": self.next_id, "shift_id": ids.get("shift"), "marker": marker,
            }
        self.shifts.append({"id": ids["shift"], "date": plan["date"],
                            "shift_code": plan["shift_code"], "warehouse_id": 76,
                            "marker": marker, "has_production": False})
        return ids

    def fixture_blockers(self, _shift_id):
        return set(self.blockers)

    def fixture_state(self, ids):
        return {alias: {"id": value, "state": "in_progress" if alias == "shift" else "fixture"}
                for alias, value in ids.items()}

    def dependencies(self, _setup, _runtime):
        return list(self.unexpected_dependencies), list(self.stock_dependencies)

    def delete_exact(self, setup, runtime, marker):
        self.mutating_calls.append(("delete_exact", marker))
        for manifest in (runtime, setup):
            for alias, record in reversed(list(manifest.get("records", {}).items())):
                record_id = record["id"] if isinstance(record, dict) else record
                bucket = self.created.get(alias, {})
                existing = bucket.get(record_id)
                if existing and existing.get("marker") not in (None, marker):
                    raise RuntimeError("marker mismatch")
                bucket.pop(record_id, None)
        fixture_id = setup.get("records", {}).get("shift", {}).get("id")
        self.shifts = [row for row in self.shifts if row.get("id") != fixture_id]

    def is_clean(self, setup, runtime):
        ids = []
        for manifest in (setup, runtime):
            ids.extend(record["id"] for record in manifest.get("records", {}).values())
        return not any(record_id in bucket for bucket in self.created.values() for record_id in ids)


class SpR3ScriptTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.planner = load("plan_sp_r3_fixture")
        cls.generator = load("generate_sp_r3_contract")
        cls.prepare = load("prepare_sp_r3")
        cls.cleanup = load("cleanup_sp_r3")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)
        self.ops = FakeOps()

    def output(self, name):
        return self.dir / name

    def seal(self):
        return {
            "schema": "g3_environment_seal_v1", "database": "g3-clean",
            "branch": "staging-g3-clean-170926", "warehouse_id": 76,
            "warehouse_code": "PIGU-PLANTA", "company_id": 35,
            "backend_sha": "be-sha", "frontend_sha": "fe-sha",
            "module_versions": {"gf_production_ops": "18.0.1.0.16"},
        }

    def make_plan(self):
        return self.planner.plan_fixture(self.ops, self.seal(), self.output("plan.json"),
                                         expected_db="g3-clean", today="2026-09-18")

    def contract(self, plan):
        before = {"schema": "g3_business_snapshot_v2", "database": "g3-clean",
                  "warehouse_id": 76, "warehouse_code": "PIGU-PLANTA", "company_id": 35,
                  "models": {}, "modules": {"rows": []}}
        return self.generator.generate("fixture", plan=plan, before=before)

    def test_planner_is_read_only_moves_occupied_tuple_and_writes_0600(self):
        self.ops.shifts.append({"date": "2026-09-18", "shift_code": "1",
                               "warehouse_id": 76, "has_production": True})
        plan = self.make_plan()
        self.assertEqual((plan["date"], plan["shift_code"]), ("2026-09-18", "2"))
        self.assertEqual(self.ops.mutating_calls, [])
        self.assertEqual(self.ops.cr.commits, 0)
        self.assertEqual(stat.S_IMODE(self.output("plan.json").stat().st_mode), 0o600)
        self.assertEqual(hashlib.sha256(self.output("plan.json").read_bytes()).hexdigest(),
                         self.planner.digest(plan))

    def test_planner_rejects_seal_version_or_branch_drift(self):
        for key, value in (("branch", "wrong"),
                           ("module_versions", {"gf_production_ops": "wrong"})):
            seal = self.seal()
            seal[key] = value
            with self.assertRaisesRegex(RuntimeError, "STOP"):
                self.planner.plan_fixture(self.ops, seal, self.output("plan.json"),
                                          expected_db="g3-clean", today="2026-09-18")
            self.assertEqual(self.ops.mutating_calls, [])

    def test_wrong_database_and_non_neutralized_stop_before_writes(self):
        plan = self.make_plan()
        contract = copy.deepcopy(self.contract(plan))
        for wrong_db, neutralized in (("prod", True), ("g3-clean", False)):
            with self.subTest(wrong_db=wrong_db, neutralized=neutralized):
                ops = FakeOps(wrong_db)
                ops.neutralized = neutralized
                with self.assertRaisesRegex(RuntimeError, "STOP"):
                    self.prepare.prepare_fixture(ops, self.output("setup.json"), plan, contract,
                                                 self.generator.digest(plan),
                                                 self.generator.digest(contract), "g3-clean")
                self.assertEqual(ops.mutating_calls, [])
                self.assertEqual(ops.cr.commits, 0)

    def test_prepare_rejects_collision_or_wrong_identity_before_writes(self):
        plan = self.make_plan()
        contract = self.contract(plan)
        for mutation in ("collision", "identity"):
            ops = FakeOps()
            if mutation == "collision":
                ops.shifts.append({"date": plan["date"], "shift_code": plan["shift_code"],
                                   "warehouse_id": 76, "has_production": False})
            else:
                ops.employees[2550]["role"] = "auxiliar_produccion"
            with self.assertRaisesRegex(RuntimeError, "STOP"):
                self.prepare.prepare_fixture(ops, self.output("setup.json"), plan, contract,
                                             self.generator.digest(plan),
                                             self.generator.digest(contract), "g3-clean")
            self.assertEqual(ops.mutating_calls, [])

    def test_prepare_rejects_a_different_active_shift_that_would_win_resolution(self):
        plan = self.make_plan()
        contract = self.contract(plan)
        self.ops.shifts.append({"id": 88, "date": "2026-09-17", "shift_code": "1",
                                "warehouse_id": 76, "state": "in_progress",
                                "has_production": False})
        with self.assertRaisesRegex(RuntimeError, "active shift"):
            self.prepare.prepare_fixture(
                self.ops, self.output("setup.json"), plan, contract,
                self.generator.digest(plan), self.generator.digest(contract), "g3-clean")
        self.assertEqual(self.ops.mutating_calls, [])

    def test_prepare_rejects_tampered_contract_payload_even_when_rehashed(self):
        plan = self.make_plan()
        contract = copy.deepcopy(self.contract(plan))
        contract["planned_params"]["gf_production.require_energy_for_close"] = "0"
        with self.assertRaisesRegex(RuntimeError, "STOP"):
            self.prepare.prepare_fixture(
                self.ops, self.output("setup.json"), plan, contract,
                self.generator.digest(plan), self.generator.digest(contract), "g3-clean")
        self.assertEqual(self.ops.mutating_calls, [])

    def test_prepare_exact_config_blockers_permissions_redaction_and_commit(self):
        plan = self.make_plan()
        contract = self.contract(plan)
        report = self.prepare.prepare_fixture(
            self.ops, self.output("setup.json"), plan, contract,
            self.generator.digest(plan), self.generator.digest(contract), "g3-clean")
        self.assertEqual(self.ops.params["gf_production.require_haccp_for_close"], "1")
        self.assertEqual(self.ops.params["gf_production.require_energy_for_close"], "1")
        self.assertEqual(self.ops.params["gf_production.handover_blocking"], "0")
        self.assertEqual(self.ops.params["gf_production_ops.material_stock_enabled"], "0")
        self.assertEqual(set(report["blocker_codes"]), self.ops.blockers)
        self.assertEqual(report["write_class"], "FIXTURE_SETUP")
        self.assertEqual(self.ops.cr.commits, 1)
        self.assertEqual(stat.S_IMODE(self.output("setup.json").stat().st_mode), 0o600)
        raw = self.output("setup.json").read_text().lower()
        for forbidden in ("pin", "token", "api_key", "password", "secret"):
            self.assertNotIn(forbidden, raw)

    def test_prepare_additional_blocker_rolls_back_without_report(self):
        plan = self.make_plan()
        contract = self.contract(plan)
        self.ops.blockers.add("unexpected")
        with self.assertRaisesRegex(RuntimeError, "blocker"):
            self.prepare.prepare_fixture(self.ops, self.output("setup.json"), plan, contract,
                                         self.generator.digest(plan),
                                         self.generator.digest(contract), "g3-clean")
        self.assertEqual(self.ops.cr.rollbacks, 1)
        self.assertEqual(self.ops.cr.commits, 0)
        self.assertEqual(self.ops.params, plan["previous_params"] | {"database.is_neutralized": "true"})
        self.assertEqual(self.ops.shifts, [])
        self.assertEqual(self.ops.created, {})
        self.assertFalse(self.output("setup.json").exists())

    def test_prepare_exception_rolls_back(self):
        plan = self.make_plan()
        contract = self.contract(plan)
        self.ops.fail_after_create = True
        with self.assertRaisesRegex(RuntimeError, "boom"):
            self.prepare.prepare_fixture(self.ops, self.output("setup.json"), plan, contract,
                                         self.generator.digest(plan),
                                         self.generator.digest(contract), "g3-clean")
        self.assertEqual(self.ops.cr.rollbacks, 1)
        self.assertEqual(self.ops.cr.commits, 0)
        self.assertEqual(self.ops.params, plan["previous_params"] | {"database.is_neutralized": "true"})
        self.assertEqual(self.ops.shifts, [])
        self.assertEqual(self.ops.created, {})

    def test_prepare_report_failure_rolls_back_before_commit(self):
        plan = self.make_plan()
        contract = self.contract(plan)
        output_dir = self.output("output-is-a-directory")
        output_dir.mkdir()
        with self.assertRaises(OSError):
            self.prepare.prepare_fixture(
                self.ops, output_dir, plan, contract,
                self.generator.digest(plan), self.generator.digest(contract), "g3-clean")
        self.assertEqual(self.ops.cr.commits, 0)
        self.assertEqual(self.ops.cr.rollbacks, 1)
        self.assertEqual(self.ops.created, {})

    def test_contracts_are_deterministic_and_reject_tampered_inputs(self):
        plan = self.make_plan()
        before = {"schema": "g3_business_snapshot_v2", "database": "g3-clean",
                  "warehouse_id": 76, "warehouse_code": "PIGU-PLANTA",
                  "company_id": 35, "models": {},
                  "modules": {"rows": []}}
        pre_e2e = copy.deepcopy(before)
        pre_e2e["models"]["gf.production.shift"] = {"rows": [{
            "id": 777, "date": plan["date"], "shift_code": plan["shift_code"],
            "plant_warehouse_id": 76, "state": "in_progress",
        }]}
        first = self.generator.generate("fixture", plan=plan, before=before)
        second = self.generator.generate("fixture", plan=copy.deepcopy(plan), before=copy.deepcopy(before))
        self.assertEqual(self.generator.canonical(first), self.generator.canonical(second))
        self.assertTrue(first["allowed_change_rules"])
        with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
            self.generator.load_sealed(self.output("plan.json"), "0" * 64)
        for mode in ("ui", "runtime", "cleanup"):
            result = self.generator.generate(mode, plan=plan, before=before,
                                             pre_e2e=pre_e2e, current=pre_e2e,
                                             ui_contract={"schema": "sp_r3_ui_contract_v1",
                                                          "shift_id": 777,
                                                          "allowed_runtime_models": []},
                                             module_seal={"modules": []})
            self.assertEqual(result["schema"], f"sp_r3_{mode}_contract_v1")
            if mode == "ui":
                self.assertTrue(result["allowed_changes"])
                self.assertTrue(any(rule["alias"] == "energy_end"
                                    for rule in result["allowed_change_rules"]))

    def test_contract_modes_require_exact_inputs_and_cleanup_schema(self):
        plan = self.make_plan()
        before = {"schema": "g3_business_snapshot_v2", "database": "g3-clean",
                  "warehouse_id": 76, "warehouse_code": "PIGU-PLANTA", "company_id": 35,
                  "models": {}, "modules": {"rows": []}}
        for mode, kwargs in (
            ("fixture", {"plan": plan}),
            ("ui", {"plan": plan}),
            ("runtime", {"plan": plan, "pre_e2e": before}),
            ("cleanup", {"before": before}),
        ):
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, "requires"):
                self.generator.generate(mode, **kwargs)
        cleanup = self.generator.generate(
            "cleanup", before=before,
            module_seal={"modules": [{"name": "gf_production_ops",
                                       "installed_version": "18.0.1.0.16",
                                       "latest_version": "18.0.1.0.16"}]})
        self.assertEqual(set(cleanup), {
            "schema", "database", "warehouse_id", "warehouse_code", "company_id", "modules",
        })

    def test_each_contract_input_rejects_one_byte_tampering(self):
        values = {
            "plan": {"schema": "sp_r3_fixture_plan_v1"},
            "before": {"schema": "g3_business_snapshot_v2"},
            "pre_e2e": {"schema": "g3_business_snapshot_v2", "phase": "pre"},
            "current": {"schema": "g3_business_snapshot_v2", "phase": "after"},
            "ui_contract": {"schema": "sp_r3_ui_contract_v1"},
            "module_seal": {"modules": []},
        }
        for name, value in values.items():
            with self.subTest(name=name):
                path = self.output(name + ".json")
                raw = self.generator.canonical(value)
                path.write_bytes(raw)
                expected = hashlib.sha256(raw).hexdigest()
                tampered = bytearray(raw)
                tampered[-1] = ord("]") if tampered[-1] != ord("]") else ord("}")
                path.write_bytes(tampered)
                with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
                    self.generator.load_sealed(path, expected)

    def test_contract_writer_uses_0600_and_hashes_exact_bytes(self):
        output = self.output("contract.json")
        value = {"schema": "example", "value": 1}
        reported = self.generator.write_private(output, value)
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        self.assertEqual(reported, hashlib.sha256(output.read_bytes()).hexdigest())

    def test_runtime_rejects_record_outside_ui_contract(self):
        plan = self.make_plan()
        identity = {"database": "g3-clean", "warehouse_id": 76, "company_id": 35}
        base = {**identity, "models": {"gf.energy.reading": {"rows": []}}}
        current = {**identity, "models": {"gf.energy.reading": {"rows": [
            {"id": 99, "shift_id": 123, "reading_type": "end"},
        ]}}}
        with self.assertRaisesRegex(RuntimeError, "outside sealed UI contract"):
            self.generator.generate(
                "runtime", plan=plan, pre_e2e=base, current=current,
                ui_contract={"schema": "sp_r3_ui_contract_v1", "shift_id": 777,
                             "allowed_runtime_models": ["gf.energy.reading"]})

    def test_runtime_rejects_deletion_or_unsealed_update(self):
        plan = self.make_plan()
        identity = {"database": "g3-clean", "warehouse_id": 76, "company_id": 35}
        before = {**identity, "models": {"gf.production.shift": {"rows": [
            {"id": 777, "date": plan["date"], "shift_code": plan["shift_code"],
             "plant_warehouse_id": 76, "state": "in_progress", "notes": plan["marker"]},
            {"id": 778, "date": "2026-01-01", "shift_code": "1",
             "plant_warehouse_id": 76, "state": "closed", "notes": "real"},
        ]}}}
        ui = {"schema": "sp_r3_ui_contract_v1", "shift_id": 777,
              "allowed_runtime_models": ["gf.production.shift"],
              "allowed_runtime_fields": {"gf.production.shift": ["state"]}}
        deleted = {**identity, "models": {"gf.production.shift": {"rows": [before["models"]["gf.production.shift"]["rows"][0]]}}}
        changed = copy.deepcopy(before)
        changed["models"]["gf.production.shift"]["rows"][1]["state"] = "audited"
        for current in (deleted, changed):
            with self.assertRaisesRegex(RuntimeError, "STOP"):
                self.generator.generate("runtime", plan=plan, pre_e2e=before,
                                        current=current, ui_contract=ui)

    def test_runtime_keeps_updates_separate_from_created_cleanup_records(self):
        plan = self.make_plan()
        identity = {"database": "g3-clean", "warehouse_id": 76, "company_id": 35}
        before = {**identity, "models": {"gf.production.shift": {"rows": [
            {"id": 777, "state": "in_progress"},
        ]}}}
        current = copy.deepcopy(before)
        current["models"]["gf.production.shift"]["rows"][0]["state"] = "closed"
        runtime = self.generator.generate(
            "runtime", plan=plan, pre_e2e=before, current=current,
            ui_contract={"schema": "sp_r3_ui_contract_v1", "shift_id": 777,
                         "allowed_runtime_models": ["gf.production.shift"],
                         "allowed_runtime_fields": {"gf.production.shift": ["state"]}})
        self.assertEqual(runtime["records"], {})
        self.assertEqual(runtime["updates"]["gf.production.shift:777"]["changed_fields"], ["state"])

    def _prepared(self):
        plan = self.make_plan()
        contract = self.contract(plan)
        report = self.prepare.prepare_fixture(
            self.ops, self.output("setup.json"), plan, contract,
            self.generator.digest(plan), self.generator.digest(contract), "g3-clean")
        runtime = {"schema": "sp_r3_runtime_contract_v1", "database": "g3-clean",
                   "warehouse_id": 76, "company_id": 35, "shift_id": report["records"]["shift"]["id"],
                   "records": {}}
        return report, runtime

    def test_cleanup_restores_params_and_is_idempotent(self):
        setup, runtime = self._prepared()
        first = self.cleanup.cleanup_fixture(
            self.ops, self.output("cleanup.json"), setup, runtime,
            self.generator.digest(setup), self.generator.digest(runtime), "g3-clean", "setup-only")
        self.assertFalse(first["already_clean"])
        self.assertEqual(self.ops.params, setup["previous_params"] | {"database.is_neutralized": "true"})
        cleanup_raw = self.output("cleanup.json").read_text().lower()
        for forbidden in ("pin", "token", "api_key", "password", "secret"):
            self.assertNotIn(forbidden, cleanup_raw)
        commits = self.ops.cr.commits
        writes = len(self.ops.mutating_calls)
        second = self.cleanup.cleanup_fixture(
            self.ops, self.output("cleanup2.json"), setup, runtime,
            self.generator.digest(setup), self.generator.digest(runtime), "g3-clean", "setup-only")
        self.assertTrue(second["already_clean"])
        self.assertEqual(self.ops.cr.commits, commits)
        self.assertEqual(len(self.ops.mutating_calls), writes)

    def test_cleanup_report_failure_rolls_back_before_commit(self):
        setup, runtime = self._prepared()
        initial_commits = self.ops.cr.commits
        output_dir = self.output("cleanup-is-a-directory")
        output_dir.mkdir()
        with self.assertRaises(OSError):
            self.cleanup.cleanup_fixture(
                self.ops, output_dir, setup, runtime,
                self.generator.digest(setup), self.generator.digest(runtime), "g3-clean", "setup-only")
        self.assertEqual(self.ops.cr.commits, initial_commits)
        self.assertEqual(self.ops.cr.rollbacks, 1)
        self.assertFalse(self.ops.is_clean(setup, runtime))

    def test_cleanup_rejects_unexpected_dependency_or_stock(self):
        for kind in ("dependency", "stock"):
            ops = FakeOps()
            self.ops = ops
            setup, runtime = self._prepared()
            if kind == "dependency":
                ops.unexpected_dependencies = [{"model": "mail.message", "id": 1}]
            else:
                ops.stock_dependencies = [{"model": "stock.move", "id": 2}]
            with self.assertRaisesRegex(RuntimeError, "STOP"):
                self.cleanup.cleanup_fixture(
                    ops, self.output("cleanup.json"), setup, runtime,
                    self.generator.digest(setup), self.generator.digest(runtime), "g3-clean", "runtime")
            self.assertEqual(ops.cr.rollbacks, 1)

    def test_cleanup_rejects_marker_mismatch(self):
        setup, runtime = self._prepared()
        shift_id = setup["records"]["shift"]["id"]
        self.ops.created["shift"][shift_id]["marker"] = "someone else's record"
        with self.assertRaisesRegex(RuntimeError, "marker mismatch"):
            self.cleanup.cleanup_fixture(
                self.ops, self.output("cleanup.json"), setup, runtime,
                self.generator.digest(setup), self.generator.digest(runtime), "g3-clean", "setup-only")
        self.assertEqual(self.ops.cr.rollbacks, 1)

    def test_cleanup_rejects_rehashed_runtime_model_outside_whitelist(self):
        setup, runtime = self._prepared()
        runtime["records"] = {"res.users:1": {
            "id": 1, "model": "res.users", "shift_id": setup["records"]["shift"]["id"],
        }}
        with self.assertRaisesRegex(RuntimeError, "runtime model"):
            self.cleanup.cleanup_fixture(
                self.ops, self.output("cleanup.json"), setup, runtime,
                self.generator.digest(setup), self.generator.digest(runtime), "g3-clean", "runtime")
        self.assertEqual(self.ops.mutating_calls[-1][0], "create_fixture")

    def test_static_fail_closed_contracts_are_present(self):
        prepare = (ROOT / "prepare_sp_r3.py").read_text()
        cleanup = (ROOT / "cleanup_sp_r3.py").read_text()
        planner = (ROOT / "plan_sp_r3_fixture.py").read_text()
        required = ("SP_EXPECTED_DB", "database.is_neutralized", "2548", "2549", "2550",
                    "[SP-R3 FIXTURE 2026-09-18]", "FIXTURE_SETUP", "0o600", "sha256",
                    "warehouse_id", "company_id")
        for token in required:
            self.assertIn(token, prepare + cleanup + planner)
        self.assertIn("env.cr.dbname", prepare)
        self.assertIn("env.cr.dbname", cleanup)
        self.assertIn("operations.commit()", prepare)
        self.assertIn("operations.commit()", cleanup)
        self.assertIn("gf_material_issue_id", cleanup)
        self.assertIn("gf_material_settlement_id", cleanup)
        self.assertIn("move_id", cleanup)
        self.assertIn("set(info.get(\"employees\", []))", cleanup)
        self.assertIn("marker not in marker_value", cleanup)
        tree = ast.parse(planner)
        mutating_methods = {"create", "write", "unlink", "commit"}
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)]
        self.assertFalse(any(
            isinstance(call.func, ast.Attribute) and call.func.attr in mutating_methods and
            not (call.func.attr == "write" and isinstance(call.func.value, ast.Name) and
                 call.func.value.id == "os")
            for call in calls
        ))
        for sql_verb in ("UPDATE ", "DELETE ", "INSERT "):
            self.assertNotIn(sql_verb, planner)


if __name__ == "__main__":
    unittest.main()
