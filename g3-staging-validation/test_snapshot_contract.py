import ast
import types
import unittest
from pathlib import Path


SOURCE = Path(__file__).with_name("snapshot_g3.py").read_text(encoding="utf-8")


class SnapshotContractTest(unittest.TestCase):
    def _assignment(self, name):
        tree = ast.parse(SOURCE)
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                    isinstance(target, ast.Name) and target.id == name
                    for target in node.targets):
                return node.value
        self.fail(f"missing assignment: {name}")

    def _model_spec(self, model_name):
        specs = self._assignment("MODEL_SPECS")
        for key, value in zip(specs.keys, specs.values):
            if ast.literal_eval(key) == model_name:
                fields = ast.literal_eval(value.elts[0])
                domain = ast.unparse(value.elts[1].body)
                return fields, domain
        self.fail(f"missing model spec: {model_name}")

    def _outside_domain(self, model_name):
        specs = self._assignment("OUTSIDE_DOMAINS")
        for key, value in zip(specs.keys, specs.values):
            if ast.literal_eval(key) == model_name:
                return ast.unparse(value.body)
        self.fail(f"missing outside domain: {model_name}")

    def test_sp_r2_business_models_are_in_snapshot_and_outside_sentinels(self):
        for model in (
            "gf.evaporator.cycle",
            "gf.production.downtime",
            "maintenance.request",
        ):
            self.assertIn(f'"{model}": (', SOURCE)
            self.assertIn(f'"{model}": lambda w:', SOURCE)

    def test_inventory_outside_uses_prefix_negation(self):
        self.assertNotIn("not child_of", SOURCE)
        self.assertIn('"stock.quant": ["!", ("location_id", "child_of", root.id)]', SOURCE)
        self.assertIn('"stock.move.line": ["!", "|"', SOURCE)
        self.assertIn('"stock.move": ["!", "|"', SOURCE)

    def test_global_batches_release_odoo_prefetch_cache(self):
        tree = ast.parse(SOURCE)
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)]
        self.assertTrue(any(
            isinstance(call.func, ast.Attribute) and
            call.func.attr == "invalidate_recordset" and
            any(keyword.arg == "flush" and isinstance(keyword.value, ast.Constant) and
                keyword.value.value is False for keyword in call.keywords)
            for call in calls
        ))

    def test_sp_r3_shift_close_fields_are_captured(self):
        fields, _domain = self._model_spec("gf.production.shift")
        self.assertTrue({
            "closed_by_employee_id", "closed_at", "end_time",
            "x_barra_closed", "x_barra_closed_at",
            "x_rolito_closed", "x_rolito_closed_at",
        } <= set(fields))

    def test_fixture_employee_context_is_narrow_and_contains_no_names_or_credentials(self):
        fields, domain = self._model_spec("hr.employee")
        self.assertEqual(fields, [
            "id", "job_id", "company_id", "warehouse_id", "active",
        ])
        self.assertEqual(domain, "[('id', 'in', [586, 2548, 2549, 2550])]")
        self.assertNotIn("name", fields)
        self.assertNotIn("pin", fields)
        self.assertNotIn('"hr.employee": lambda w:', SOURCE)

    def test_environment_seal_requires_exact_sp_r3_clean_branch(self):
        self.assertIn('seal.get("branch") != "staging-g3-clean-170926"', SOURCE)
        self.assertNotIn('seal.get("branch") != "staging-g3-170926"', SOURCE)

    def test_module_snapshot_keeps_cleanup_schema_separate_from_business_models(self):
        tree = ast.parse(SOURCE)
        main = next(
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "main"
        )
        module_calls = [
            call for call in ast.walk(main)
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and
            call.func.id == "_rows" and call.args and
            isinstance(call.args[0], ast.Constant) and
            call.args[0].value == "ir.module.module"
        ]
        self.assertEqual(len(module_calls), 1)
        keyword = {item.arg: item.value for item in module_calls[0].keywords}
        self.assertIn("include_business", keyword)
        self.assertIs(keyword["include_business"].value, False)

    def test_sp_r3_models_have_exact_local_and_external_scope(self):
        expected = {
            "gf.haccp.checklist": (
                ["id", "shift_id", "state", "all_passed", "completed_by_id",
                 "completed_at", "write_date"],
                "shift_id.plant_warehouse_id",
            ),
            "gf.haccp.check": (
                ["id", "checklist_id", "passed", "result_bool", "result_numeric",
                 "result_text", "write_date"],
                "checklist_id.shift_id.plant_warehouse_id",
            ),
            "gf.production.material.issue": (
                ["id", "shift_id", "line_id", "product_id", "state", "notes", "write_date"],
                "shift_id.plant_warehouse_id",
            ),
            "gf.production.material.settlement": (
                ["id", "shift_id", "line_id", "product_id", "state", "write_date"],
                "shift_id.plant_warehouse_id",
            ),
        }
        for model, (expected_fields, relation) in expected.items():
            fields, local_domain = self._model_spec(model)
            self.assertEqual(fields, expected_fields)
            self.assertEqual(
                local_domain,
                f"[('{relation}', '=', w.id)]",
            )
            self.assertEqual(
                self._outside_domain(model),
                f"[('{relation}', '!=', w.id)]",
            )

    def test_sp_r3_config_keys_are_added_without_losing_existing_keys(self):
        actual = set(ast.literal_eval(self._assignment("CONFIG_KEYS")))
        existing = {
            "gf_plant_energy.rolito_base_hours",
            "gf_plant_energy.oil_stale_shifts",
            "gf_plant_energy.rolito_cycle_min_minutes",
            "gf_plant_energy.rolito_cycle_max_minutes",
            "gf_milling_control.variance_threshold_pct",
        }
        additions = {
            "gf_production.require_haccp_for_close",
            "gf_production.require_energy_for_close",
            "gf_production.handover_blocking",
            "gf_production_ops.material_stock_enabled",
        }
        self.assertEqual(actual, existing | additions)

    def test_require_fields_lists_every_missing_field(self):
        tree = ast.parse(SOURCE)
        function = next(
            (node for node in tree.body
             if isinstance(node, ast.FunctionDef) and node.name == "_require_fields"),
            None,
        )
        self.assertIsNotNone(function, "_require_fields must fail closed")
        module = ast.Module(body=[function], type_ignores=[])
        namespace = {}
        exec(compile(ast.fix_missing_locations(module), "snapshot_g3.py", "exec"), namespace)
        model = types.SimpleNamespace(_name="gf.fake", _fields={"id": object()})
        with self.assertRaisesRegex(RuntimeError, r"gf\.fake.*missing_a.*missing_b"):
            namespace["_require_fields"](model, ["id", "missing_b", "missing_a"])

    def test_rows_and_sentinels_validate_fields_before_searching_domains(self):
        tree = ast.parse(SOURCE)
        for function_name in ("_rows", "_outside_sentinel"):
            function = next(
                node for node in tree.body
                if isinstance(node, ast.FunctionDef) and node.name == function_name
            )
            calls = [node for node in ast.walk(function) if isinstance(node, ast.Call)]
            self.assertTrue(any(
                isinstance(call.func, ast.Name) and call.func.id == "_require_fields"
                for call in calls
            ), f"{function_name} must call _require_fields")
            self.assertFalse(any(
                isinstance(node, ast.ListComp) and
                any(isinstance(child, ast.Compare) and
                    any(isinstance(op, ast.In) for op in child.ops)
                    for child in ast.walk(node))
                for node in ast.walk(function)
            ), f"{function_name} must not silently filter missing fields")

    def test_invalid_relation_in_rows_or_sentinel_stops_snapshot(self):
        tree = ast.parse(SOURCE)
        functions = [
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and
            node.name in {"_rows", "_outside_sentinel"}
        ]

        class InvalidDomainModel:
            _name = "gf.fake"
            _fields = {"id": object()}

            def sudo(self):
                return self

            def search(self, _domain, **_kwargs):
                raise RuntimeError("invalid relational field")

        model = InvalidDomainModel()

        class FakeEnv:
            registry = {"gf.fake": object()}

            def __getitem__(self, _name):
                return model

        namespace = {
            "env": FakeEnv(),
            "_require_fields": lambda recordset, names: list(names),
            "_digest": lambda _value: "digest",
            "hashlib": __import__("hashlib"),
            "json": __import__("json"),
            "_value": lambda _record, _name: None,
        }
        exec(compile(ast.fix_missing_locations(ast.Module(
            body=functions, type_ignores=[])), "snapshot_g3.py", "exec"), namespace)
        for function_name in ("_rows", "_outside_sentinel"):
            with self.assertRaisesRegex(RuntimeError, "invalid relational field"):
                namespace[function_name]("gf.fake", ["id"], [("bad.relation", "=", 1)])


if __name__ == "__main__":
    unittest.main()
