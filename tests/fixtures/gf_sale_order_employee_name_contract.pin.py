# PINNED CONTRACT EXCERPT — gf_logistics_ops/models/sale_order.py
# (_serialize_kold_sales_order). Refresh when live serializer changes.
# Live path preferred when ../gf exists; pin enables single-repo CI.

        employee = order.x_kold_employee_id
        if not employee and "employee_id" in self._fields:
            employee = order.employee_id
        if not employee and order.gf_route_plan_id:
            employee = (
                order.gf_route_plan_id.salesperson_employee_id
                or order.gf_route_plan_id.driver_employee_id
            )
        return {
            "employee_name": employee.name if employee else "",
        }
