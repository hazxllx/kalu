// frontend/src/features/health-records/lib/m1ProgramConfig.js
/**
 * M1 Program Configuration — Central routing, FHSIS mapping, and indicator definitions.
 *
 * This module provides the single source of truth for:
 * - Program identity and routing
 * - FHSIS section mapping
 * - Program-to-indicator relationships
 * - Breadcrumb generation
 * - Record counting queries
 *
 * Each program has a dedicated detail page and distinct indicator structure.
 * The consolidated report aggregates indicators from these programs according to FHSIS sections.
 */

export const PROGRAMS = {
  prenatal: {
    id: 'prenatal',
    title: 'Prenatal and Postpartum',
    description: 'Maternal pregnancy registration and postpartum follow-up',
    category: 'Maternal and Family Health',
    route: '/app/health_supervisor/m1/prenatal-detail',
    routePath: 'm1/prenatal-detail',
    fhsisSection: 'B',
    fhsisSectionTitle: 'Maternal Care and Services',
    subsections: [
      { id: 'prenatal-care', title: 'Prenatal Care Services', catalogSubsection: 'B1. Prenatal Care' },
      { id: 'intrapartum-newborn', title: 'Intrapartum and Newborn Care', catalogSubsection: 'B2. Intrapartum Care and Delivery Outcome' },
      { id: 'postpartum-care', title: 'Postpartum Care', catalogSubsection: 'B3. Postpartum and Newborn Care' },
    ],
    indicatorCodes: [
      // Indicator identities and descriptions come from the backend catalog.
    ],
    recordType: 'maternal_records',
    countField: 'id',
    icon: 'Baby',
    color: 'text-brand-blue',
    bgColor: 'bg-brand-blue/10',
  },

  ncd: {
    id: 'ncd',
    title: 'NCD Risk Assessment',
    description: 'Non-communicable disease screening and risk evaluation',
    category: 'Screening and Preventive Care',
    route: '/app/health_supervisor/m1/ncd-detail',
    routePath: 'm1/ncd-detail',
    fhsisSection: 'F',
    catalogSections: ['E', 'F'],
    fhsisSectionTitle: 'Health Risk Assessment and Disease Prevention',
    subsections: [],
    indicatorCodes: [], // Membership and category labels are supplied by the backend catalog.
    recordType: 'ncd_risk_assessments',
    countField: 'id',
    icon: 'Heart',
    color: 'text-brand-blue',
    bgColor: 'bg-brand-blue/10',
  },

  cervical: {
    id: 'cervical',
    title: 'Cervical Cancer and Breast Mass',
    description: 'Cervical cancer and breast cancer screening',
    category: 'Screening and Preventive Care',
    route: '/app/health_supervisor/m1/cervical-detail',
    routePath: 'm1/cervical-detail',
    fhsisSection: 'F',
    fhsisSectionTitle: 'Non-Communicable Disease Prevention and Control',
    subsections: [],
    indicatorCodes: [],
    recordType: 'cervical_breast_screening',
    countField: 'id',
    icon: 'Activity',
    color: 'text-brand-blue',
    bgColor: 'bg-brand-blue/10',
  },

  visual: {
    id: 'visual',
    title: 'Visual Acuity and PPV',
    description: 'Vision screening and preventive vision care',
    category: 'Screening and Preventive Care',
    route: '/app/health_supervisor/m1/visual-detail',
    routePath: 'm1/visual-detail',
    fhsisSection: 'F',
    fhsisSectionTitle: 'Non-Communicable Disease Prevention and Control',
    subsections: [],
    indicatorCodes: [],
    recordType: 'visual_acuity_screening',
    countField: 'id',
    icon: 'Eye',
    color: 'text-brand-blue',
    bgColor: 'bg-brand-blue/10',
  },

  oral: {
    id: 'oral',
    title: 'Oral Health',
    description: 'Dental screening and oral health services',
    category: 'Screening and Preventive Care',
    route: '/app/health_supervisor/m1/oral-detail',
    routePath: 'm1/oral-detail',
    fhsisSection: 'D',
    fhsisSectionTitle: 'Oral Health Care Services',
    subsections: [
      { id: 'first-visit', title: 'First Visit to an Oral Health Care Professional' },
      { id: 'completion-visits', title: 'Completion of Two Oral Health Visits' },
    ],
    indicatorCodes: [
      'D1_1', 'D1_2', 'D1_3', 'D1_4', 'D1_5', 'D1_6', 'D1_7', // First visits
      'D2_1', 'D2_2', 'D2_3', 'D2_4', 'D2_5', 'D2_6', // Completed visits
    ],
    recordType: 'oral_health_records',
    countField: 'id',
    icon: 'Smile',
    color: 'text-brand-blue',
    bgColor: 'bg-brand-blue/10',
  },

  environmental: {
    id: 'environmental',
    title: 'Household Environmental Masterlist',
    description: 'Water, sanitation, and environmental health monitoring',
    category: 'Environmental Health',
    route: '/app/health_supervisor/m1/environmental-detail',
    routePath: 'm1/environmental-detail',
    fhsisSection: 'G',
    fhsisSectionTitle: 'Environmental Health and Sanitation Services',
    subsections: [
      { id: 'water-supply', title: 'Water Supply' },
      { id: 'sanitation', title: 'Sanitation Facilities' },
    ],
    indicatorCodes: [
      'G1_1', 'G1_2', 'G1_3', 'G1_4', 'G1_5', // Water
      'G2_1', 'G2_2', 'G2_3', 'G2_4', 'G2_5', // Sanitation
    ],
    recordType: 'households',
    countField: 'id',
    icon: 'Home',
    color: 'text-brand-blue',
    bgColor: 'bg-brand-blue/10',
  },

  enrollment: {
    id: 'enrollment',
    title: 'Program Enrollment Register',
    description: 'Community health program enrollment and tracking',
    category: 'Community Health Programs',
    route: '/app/health_supervisor/m1/enrollment-detail',
    routePath: 'm1/enrollment-detail',
    fhsisSection: null, // Community program, not part of standard FHSIS sections
    fhsisSectionTitle: 'Program Enrollment and Community Health',
    subsections: [
      { id: 'active-enrollments', title: 'Active Program Enrollments' },
      { id: 'enrollment-tracking', title: 'Enrollment Status and Follow-up' },
    ],
    indicatorCodes: [], // Community program, managed separately
    recordType: 'tcl_entries',
    countField: 'id',
    icon: 'Users',
    color: 'text-brand-blue',
    bgColor: 'bg-brand-blue/10',
  },
};

/**
 * Get program configuration by program ID.
 * @param {string} programId
 * @returns {object|null}
 */
export const getProgram = (programId) => PROGRAMS[programId] || null;

/**
 * Get all programs as an array.
 * @returns {object[]}
 */
export const getAllPrograms = () => Object.values(PROGRAMS);

/**
 * Get breadcrumb path for a program.
 * @param {string} programId
 * @returns {string}
 */
export const getBreadcrumbPath = (programId) => {
  const program = getProgram(programId);
  if (!program) return '';
  return `M1 / Health Programs / ${program.title}`;
};

/**
 * Generate consolidated report breadcrumb.
 * @returns {string}
 */
export const getConsolidatedReportBreadcrumb = () => 'M1 / Consolidated Report';

/**
 * Get programs by category.
 * @param {string} category
 * @returns {object[]}
 */
export const getProgramsByCategory = (category) => 
  getAllPrograms().filter(p => p.category === category);

/**
 * Get all unique categories.
 * @returns {string[]}
 */
export const getCategories = () => {
  const categories = new Set();
  getAllPrograms().forEach(p => categories.add(p.category));
  return Array.from(categories);
};

/**
 * Get programs by FHSIS section.
 * @param {string} section
 * @returns {object[]}
 */
export const getProgramsByFhsisSection = (section) =>
  getAllPrograms().filter(p => p.fhsisSection === section);

/**
 * Map program record type to API endpoint.
 * Used for loading program-specific records.
 * @param {string} programId
 * @returns {string}
 */
export const getApiEndpointForProgram = (programId) => {
  const program = getProgram(programId);
  if (!program) return null;
  
  const endpointMap = {
    prenatal: 'maternal',
    ncd: 'ncd-risk',
    cervical: 'ncd-cervical',
    visual: 'ncd-visual',
    oral: 'oral-health',
    environmental: 'environmental',
    enrollment: 'program-enrollment',
  };
  
  return endpointMap[programId] || null;
};

/**
 * Map program to its icon component name.
 * @param {string} programId
 * @returns {string}
 */
export const getIconName = (programId) => {
  const program = getProgram(programId);
  return program?.icon || 'Activity';
};

/**
 * Validate program ID.
 * @param {string} programId
 * @returns {boolean}
 */
export const isValidProgramId = (programId) => programId in PROGRAMS;
