import { describe, test, expect } from "vitest";
import { resolveScope, questInScope } from "../utils/departmentScope.js";

describe("resolveScope", () => {
  test("company with no departments is dormant — everyone sees everything", () => {
    expect(resolveScope({ departmentCount: 0, role: "CONTRIBUTOR", allDepartments: false, departmentIds: [3] }))
      .toEqual({ all: true });
  });

  test("ADMIN is always all-departments", () => {
    expect(resolveScope({ departmentCount: 4, role: "ADMIN", allDepartments: false, departmentIds: [] }))
      .toEqual({ all: true });
  });

  test("all_departments flag gives full scope", () => {
    expect(resolveScope({ departmentCount: 4, role: "LEAD", allDepartments: true, departmentIds: [] }))
      .toEqual({ all: true });
  });

  test("scoped user gets their department ids", () => {
    expect(resolveScope({ departmentCount: 4, role: "LEAD", allDepartments: false, departmentIds: [2, 5] }))
      .toEqual({ all: false, departmentIds: [2, 5] });
  });

  test("scoped user with no memberships gets an empty (not full) scope", () => {
    expect(resolveScope({ departmentCount: 4, role: "CONTRIBUTOR", allDepartments: false, departmentIds: [] }))
      .toEqual({ all: false, departmentIds: [] });
  });
});

describe("questInScope", () => {
  const scoped = { all: false, departmentIds: [2, 5] };

  test("full scope covers everything, including unassigned controls", () => {
    expect(questInScope({ all: true }, [])).toBe(true);
    expect(questInScope({ all: true }, [{ id: 9, name: "Legal" }])).toBe(true);
  });

  test("any overlap puts a jointly owned control in scope", () => {
    expect(questInScope(scoped, [{ id: 9, name: "Legal" }, { id: 5, name: "Security" }])).toBe(true);
  });

  test("disjoint ownership is out of scope", () => {
    expect(questInScope(scoped, [{ id: 9, name: "Legal" }])).toBe(false);
  });

  test("unassigned control is out of scope for a scoped user", () => {
    expect(questInScope(scoped, [])).toBe(false);
    expect(questInScope(scoped, undefined)).toBe(false);
  });
});
