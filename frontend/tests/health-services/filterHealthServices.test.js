import test from "node:test";
import assert from "node:assert/strict";
import { filterHealthServices } from "../../src/features/health-services/lib/filterHealthServices.js";

const services = [
  { id: "maternal", name: "Prenatal Care", category: "Maternal" },
  { id: "tcls", name: "Child Wellness", category: "TCLS" },
  { id: "immunization", name: "Vaccination", category: "Immunization" },
  { id: "family-planning", name: "Family Planning Clinic", category: "Family Planning" },
];

const statuses = {
  maternal: "Active",
  tcls: "Upcoming",
  immunization: "Completed",
  "family-planning": "Inactive",
};

const categoryLabels = {
  Maternal: "Maternal Services",
  TCLS: "TCLS",
  Immunization: "Immunization",
  "Family Planning": "Family Planning",
};

const deriveStatus = (service) => statuses[service.id];
const filter = (category = "All", status = "All", search = "") =>
  filterHealthServices(services, { search, category, status }, deriveStatus, categoryLabels);

test("category and status filters work together for every dropdown combination", () => {
  const categories = ["All", "Maternal", "TCLS", "Immunization", "Family Planning"];
  const serviceStatuses = ["All", "Active", "Upcoming", "Completed", "Inactive"];

  for (const category of categories) {
    for (const status of serviceStatuses) {
      const actualIds = filter(category, status).map((service) => service.id);
      const expectedIds = services
        .filter((service) => category === "All" || service.category === category)
        .filter((service) => status === "All" || statuses[service.id] === status)
        .map((service) => service.id);

      assert.deepEqual(actualIds, expectedIds, `category=${category}, status=${status}`);
    }
  }
});

test("search combines with category and status filters and matches display labels", () => {
  assert.deepEqual(filter("Maternal", "Active", "prenatal").map((service) => service.id), ["maternal"]);
  assert.deepEqual(filter("All", "All", "maternal services").map((service) => service.id), ["maternal"]);
  assert.deepEqual(filter("TCLS", "Active").map((service) => service.id), []);
});
