export function filterHealthServices(
  services,
  { search, category, status },
  deriveStatus,
  categoryLabels,
) {
  const query = search.trim().toLowerCase();

  return services.filter((service) => {
    const name = String(service?.name || "").toLowerCase();
    const serviceCategory = service?.category || "Other";
    if (
      query &&
      !name.includes(query) &&
      !serviceCategory.toLowerCase().includes(query) &&
      !(categoryLabels[serviceCategory] || "").toLowerCase().includes(query)
    ) return false;
    if (category !== "All" && serviceCategory !== category) return false;
    if (status !== "All" && deriveStatus(service) !== status) return false;
    return true;
  });
}
