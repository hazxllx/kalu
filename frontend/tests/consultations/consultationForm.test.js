import assert from "node:assert/strict";
import test from "node:test";

import {
  hasMaternalDetails,
  hasMaternalInformation,
  isDuplicateMedicine,
  isMaternalHealthService,
} from "../../src/features/consultations/lib/consultationForm.js";

test("default prenatal care type is not treated as entered maternal information", () => {
  assert.equal(hasMaternalDetails({ careType: "prenatal" }), false);
  assert.equal(hasMaternalInformation({ careType: "prenatal" }), false);
  assert.equal(hasMaternalInformation({ careType: "postpartum" }), false);
  assert.equal(hasMaternalInformation({ careType: "prenatal", lmpDate: "2026-03-01" }), true);
});

test("maternal service detection checks both service name and category", () => {
  assert.equal(isMaternalHealthService({ name: "Prenatal", category: "Other" }), true);
  assert.equal(isMaternalHealthService({ name: "Family Planning", category: "Family Planning" }), false);
  assert.equal(isMaternalHealthService({ name: "General Consultation", category: "Consultation" }), false);
});

test("medicine selection prevents catalog and equivalent custom duplicates", () => {
  const medicines = [
    { medicineId: "catalog-1", genericName: "Paracetamol", strength: "500 mg" },
    { genericName: "Herbal mixture", strength: "10 ml", dosageForm: "Liquid" },
  ];

  assert.equal(isDuplicateMedicine(medicines, { medicineId: "catalog-1", genericName: "Paracetamol" }), true);
  assert.equal(isDuplicateMedicine(medicines, { medicineId: "catalog-2", genericName: "Paracetamol" }), false);
  assert.equal(isDuplicateMedicine(medicines, { genericName: " herbal mixture ", strength: "10 ML", dosageForm: "liquid" }), true);
  assert.equal(isDuplicateMedicine(medicines, { genericName: "Paracetamol", strength: "500 mg" }), true);
  assert.equal(isDuplicateMedicine(medicines, { genericName: "Herbal mixture", strength: "5 ml", dosageForm: "Liquid" }), false);
});
