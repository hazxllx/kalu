const REVIEWER_ROLES = new Set(["mho", "phn"]);

export const isMedicalCertificateReviewer = (user) => REVIEWER_ROLES.has(user?.role);

export const canReviewMedicalCertificate = (user, certificate) =>
  isMedicalCertificateReviewer(user) && ["For Review", "Approved"].includes(certificate?.status);

export const canPrintOfficialMedicalCertificate = (user, certificate) =>
  isMedicalCertificateReviewer(user) && certificate?.status === "Issued";
