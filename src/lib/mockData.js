// Realistic Philippine community-health mock data — frontend only.

export const stats = {
  landing: [
    { label: "Barangays Connected", value: "6" },
    { label: "Residents", value: "12,845" },
    { label: "Follow-ups Completed", value: "2,450" },
    { label: "Record Accuracy", value: "95%" },
    { label: "Resident Satisfaction", value: "98%" },
  ],
};

export const features = [
  { icon: "FileHeart", title: "Resident Health Records", desc: "Centralized, secure health records for every resident in the barangay." },
  { icon: "Home", title: "Household Profiling", desc: "Capture household conditions, water, sanitation and risk factors." },
  { icon: "Activity", title: "Risk Monitoring", desc: "Automatically flag high-risk residents needing closer attention." },
  { icon: "HeartPulse", title: "Early Intervention", desc: "Act early with guided care pathways and priority alerts." },
  { icon: "CalendarClock", title: "Follow-up Scheduling", desc: "Never miss a visit with smart follow-up reminders." },
  { icon: "RefreshCw", title: "Offline Sync", desc: "Work in remote areas — data syncs automatically when online." },
];

export const services = [
  { icon: "Stethoscope", name: "Consultation" },
  { icon: "Syringe", name: "Immunization" },
  { icon: "Baby", name: "Maternal Care" },
  { icon: "Blocks", name: "Child Health" },
  { icon: "Accessibility", name: "Senior Citizen Care" },
  { icon: "HeartHandshake", name: "Family Planning" },
  { icon: "Smile", name: "Dental Services" },
  { icon: "FileText", name: "Medical Certificates" },
];

export const howItWorks = [
  { icon: "UserPlus", title: "Register Residents", desc: "Enroll residents and households into the barangay registry." },
  { icon: "ClipboardList", title: "Record Health Information", desc: "Log vitals, consultations, and medical history." },
  { icon: "Activity", title: "Monitor Health Risks", desc: "Track risk levels across the community in real time." },
  { icon: "CalendarCheck", title: "Schedule Follow-ups", desc: "Plan visits and keep residents on their care journey." },
];

export const residentTimeline = [
  { type: "Vaccination", title: "COVID-19 Booster", date: "2026-06-20", desc: "Administered at Barangay Health Center", color: "green" },
  { type: "Prenatal", title: "Prenatal Check-up", date: "2026-06-02", desc: "Blood pressure normal, fetal heartbeat detected", color: "accent" },
  { type: "Consultation", title: "General Consultation", date: "2026-05-18", desc: "Mild fever, prescribed paracetamol", color: "blue" },
  { type: "Follow-up", title: "Hypertension Follow-up", date: "2026-04-30", desc: "BP monitoring, medication continued", color: "yellow" },
  { type: "Referral", title: "Referral to RHU Pili", desc: "Laboratory tests for anemia screening", date: "2026-04-10", color: "danger" },
];

export const residentDashboard = {
  followUp: { date: "August 15", time: "9:00 AM", place: "Barangay Health Center" },
  bhw: "Maria Cruz",
  risk: "Low",
  lastCheck: "July 18",
  healthStatus: { status: "Healthy", score: 92, note: "All vitals within normal range" },
  latestConsultation: { date: "July 18, 2026", type: "General Consultation", provider: "Midwife M. Dela Cruz", diagnosis: "Mild fever, prescribed paracetamol", status: "Completed" },
};

export const recentMedicalRecords = [
  { title: "Complete Blood Count", date: "Jul 18, 2026", type: "Laboratory", result: "Normal", tone: "green" },
  { title: "Urinalysis", date: "Jul 18, 2026", type: "Laboratory", result: "Normal", tone: "green" },
  { title: "COVID-19 Booster", date: "Jun 20, 2026", type: "Vaccination", result: "Administered", tone: "blue" },
  { title: "Prenatal Check-up", date: "Jun 02, 2026", type: "Consultation", result: "Normal", tone: "accent" },
  { title: "Blood Glucose (FBS)", date: "May 15, 2026", type: "Laboratory", result: "92 mg/dL", tone: "yellow" },
];

export const healthAnnouncements = [
  { icon: "Syringe", title: "Free Immunization Drive", desc: "Catch-up immunization for children ages 0-5 this July at the Barangay Health Center.", date: "Jul 12, 2026", tone: "blue" },
  { icon: "ShieldCheck", title: "Dengue Prevention Campaign", desc: "Community cleanup and fogging operations scheduled for Barangay San Jose.", date: "Jul 10, 2026", tone: "green" },
  { icon: "HeartPulse", title: "Hypertension Awareness Month", desc: "Free BP screening every Friday. Walk-ins welcome at the health station.", date: "Jul 05, 2026", tone: "yellow" },
];

export const appointments = [
  { date: "2026-08-15", time: "9:00 AM", service: "Prenatal Check-up", place: "Barangay Health Center", status: "Upcoming" },
  { date: "2026-08-28", time: "10:30 AM", service: "Immunization", place: "Barangay Health Center", status: "Upcoming" },
  { date: "2026-07-18", time: "8:00 AM", service: "General Consultation", place: "RHU Pili", status: "Completed" },
  { date: "2026-06-22", time: "1:00 PM", service: "Dental Check-up", place: "Barangay Health Center", status: "Completed" },
  { date: "2026-05-30", time: "9:00 AM", service: "Follow-up Visit", place: "Barangay Health Center", status: "Missed" },
];

export const notifications = [
  { icon: "CalendarClock", title: "Follow-up Reminder", desc: "Your prenatal follow-up is on August 15 at 9:00 AM.", time: "2h ago", tone: "accent" },
  { icon: "Syringe", title: "Vaccination Reminder", desc: "Child immunization schedule due next week.", time: "1d ago", tone: "green" },
  { icon: "AlertTriangle", title: "Health Advisory", desc: "Dengue prevention drive this Saturday in Barangay San Jose.", time: "3d ago", tone: "yellow" },
];

export const residents = [
  { id: "R-1024", name: "Maria Santos", age: 28, gender: "Female", risk: "Low", barangay: "San Jose", status: "Active", program: "Maternal Care" },
  { id: "R-1025", name: "Juan Dela Cruz", age: 54, gender: "Male", risk: "High", barangay: "San Isidro", status: "Active", program: "Hypertension" },
  { id: "R-1026", name: "Rosa Bautista", age: 67, gender: "Female", risk: "Medium", barangay: "Sta. Cruz", status: "Active", program: "Senior Care" },
  { id: "R-1027", name: "Pedro Reyes", age: 3, gender: "Male", risk: "Low", barangay: "San Jose", status: "Active", program: "Child Health" },
  { id: "R-1028", name: "Ana Villanueva", age: 32, gender: "Female", risk: "High", barangay: "Bagong Silang", status: "Active", program: "Maternal Care" },
  { id: "R-1029", name: "Carlos Mendoza", age: 61, gender: "Male", risk: "High", barangay: "San Isidro", status: "Active", program: "Diabetes" },
  { id: "R-1030", name: "Liza Gonzales", age: 45, gender: "Female", risk: "Medium", barangay: "Sta. Cruz", status: "Inactive", program: "TB Monitoring" },
  { id: "R-1031", name: "Miguel Torres", age: 22, gender: "Male", risk: "Low", barangay: "San Jose", status: "Active", program: "Family Planning" },
];

export const households = [
  { id: "HH-201", address: "12 Mabini St., Brgy. San Jose", members: 5, riskScore: 34, income: "₱9,500/mo", water: "Level II - Communal", toilet: "Water-sealed", concerns: ["Hypertension", "Prenatal"] },
  { id: "HH-202", address: "8 Rizal Ave., Brgy. San Isidro", members: 7, riskScore: 72, income: "₱6,200/mo", water: "Level I - Point Source", toilet: "Shared", concerns: ["Diabetes", "Malnutrition"] },
  { id: "HH-203", address: "45 Bonifacio St., Brgy. Sta. Cruz", members: 4, riskScore: 28, income: "₱14,000/mo", water: "Level III - Piped", toilet: "Water-sealed", concerns: ["Senior Care"] },
  { id: "HH-204", address: "3 Luna St., Brgy. Bagong Silang", members: 6, riskScore: 58, income: "₱7,800/mo", water: "Level II - Communal", toilet: "Water-sealed", concerns: ["Maternal", "TB Contact"] },
];

export const bhwDashboard = [
  { icon: "CalendarCheck", label: "Today's Follow-ups", value: "7", tone: "accent" },
  { icon: "AlertTriangle", label: "High Risk Residents", value: "14", tone: "danger" },
  { icon: "UserPlus", label: "New Residents", value: "23", tone: "green" },
  { icon: "Home", label: "Pending Household Visits", value: "9", tone: "yellow" },
  { icon: "Syringe", label: "Upcoming Immunization", value: "18", tone: "blue" },
];

export const midwifeStats = [
  { icon: "Users", label: "Patients Today", value: "18", tone: "accent" },
  { icon: "CalendarCheck", label: "Scheduled Follow-ups", value: "9", tone: "blue" },
  { icon: "ClipboardList", label: "TCLS Records", value: "124", tone: "green" },
  { icon: "FileHeart", label: "M1 Records", value: "32", tone: "yellow" },
  { icon: "Activity", label: "Health Services Today", value: "5", tone: "accent" },
  { icon: "Send", label: "Pending Referrals", value: "4", tone: "danger" },
];

export const healthServices = [
  { name: "General Consultation", schedule: "8:00 AM - 12:00 PM", personnel: "Midwife M. Dela Cruz", enrolled: 42, status: "Ongoing" },
  { name: "Child Immunization", schedule: "1:00 PM - 3:00 PM", personnel: "BHW M. Cruz", enrolled: 28, status: "Ongoing" },
  { name: "Family Planning Session", schedule: "Wednesday 9:00 AM", personnel: "Midwife M. Dela Cruz", enrolled: 16, status: "Scheduled" },
  { name: "Hypertension Monitoring", schedule: "Friday 8:00 AM", personnel: "RHU Nurse", enrolled: 34, status: "Scheduled" },
  { name: "Nutrition Counseling", schedule: "Every Tuesday", personnel: "Nutrition Scholar", enrolled: 21, status: "Scheduled" },
  { name: "Senior Citizen Check-up", schedule: "Last Friday of Month", personnel: "Midwife M. Dela Cruz", enrolled: 39, status: "Scheduled" },
];

export const tclsRecords = [
  { resident: "Ana Villanueva", program: "Pregnant Women", bhw: "M. Cruz", status: "Active", lastVisit: "2026-06-28", nextVisit: "2026-07-12", priority: "High" },
  { resident: "Rosa Bautista", program: "Senior Citizens", bhw: "L. Ramos", status: "Active", lastVisit: "2026-06-20", nextVisit: "2026-07-20", priority: "Medium" },
  { resident: "Carlos Mendoza", program: "Diabetes", bhw: "M. Cruz", status: "Active", lastVisit: "2026-06-15", nextVisit: "2026-07-15", priority: "High" },
  { resident: "Miguel Torres", program: "Family Planning", bhw: "L. Ramos", status: "Active", lastVisit: "2026-06-10", nextVisit: "2026-08-10", priority: "Low" },
  { resident: "Liza Gonzales", program: "TB Patients", bhw: "M. Cruz", status: "Monitoring", lastVisit: "2026-06-05", nextVisit: "2026-07-05", priority: "High" },
];

export const m1Records = [
  { resident: "Ana Villanueva", lmp: "2026-01-10", edd: "2026-10-17", prenatalVisits: 4, risk: "High", status: "Ongoing" },
  { resident: "Maria Santos", lmp: "2026-02-02", edd: "2026-11-09", prenatalVisits: 3, risk: "Low", status: "Ongoing" },
  { resident: "Grace Aquino", lmp: "2025-11-20", edd: "2026-08-27", prenatalVisits: 6, risk: "Medium", status: "Ongoing" },
];

export const followUps = [
  { resident: "Ana Villanueva", purpose: "Prenatal", reason: "Routine check", personnel: "Midwife M. Dela Cruz", location: "Health Center", priority: "High", status: "Today", remarks: "BP monitoring" },
  { resident: "Carlos Mendoza", purpose: "Diabetes", reason: "Blood sugar review", personnel: "BHW M. Cruz", location: "Home Visit", priority: "High", status: "Today", remarks: "Bring glucometer" },
  { resident: "Rosa Bautista", purpose: "Senior Care", reason: "BP & meds", personnel: "BHW L. Ramos", location: "Home Visit", priority: "Medium", status: "Upcoming", remarks: "" },
  { resident: "Pedro Reyes", purpose: "Immunization", reason: "Next dose", personnel: "Midwife M. Dela Cruz", location: "Health Center", priority: "Low", status: "Completed", remarks: "Completed" },
  { resident: "Liza Gonzales", purpose: "TB Follow-up", reason: "DOTS", personnel: "BHW M. Cruz", location: "Health Center", priority: "High", status: "Missed", remarks: "Reschedule" },
];

export const referrals = [
  { resident: "Ana Villanueva", facility: "RHU Pili", reason: "High-risk pregnancy", status: "Pending", direction: "Outgoing" },
  { resident: "Carlos Mendoza", facility: "Bicol Medical Center", reason: "Uncontrolled diabetes", status: "Accepted", direction: "Outgoing" },
  { resident: "Juan Dela Cruz", facility: "Barangay Health Station", reason: "Post-discharge care", status: "Received", direction: "Incoming" },
];

export const immunizations = [
  { child: "Pedro Reyes", vaccine: "Pentavalent (3rd)", status: "Due", nextDose: "2026-07-14", completed: 2 },
  { child: "Baby Torres", vaccine: "BCG", status: "Completed", nextDose: "—", completed: 1 },
  { child: "Sofia Reyes", vaccine: "Measles (MCV1)", status: "Missed", nextDose: "2026-07-08", completed: 3 },
  { child: "Liam Gonzales", vaccine: "OPV (2nd)", status: "Due", nextDose: "2026-07-16", completed: 1 },
];

export const monthlyConsultations = [
  { month: "Jan", value: 320 }, { month: "Feb", value: 410 }, { month: "Mar", value: 385 },
  { month: "Apr", value: 470 }, { month: "May", value: 520 }, { month: "Jun", value: 610 },
];

export const topDiseases = [
  { name: "Hypertension", value: 1240 }, { name: "Diabetes", value: 860 },
  { name: "Respiratory", value: 720 }, { name: "Dengue", value: 340 }, { name: "TB", value: 190 },
];

export const ageDistribution = [
  { name: "0-5", value: 1820 }, { name: "6-17", value: 3100 }, { name: "18-59", value: 6200 }, { name: "60+", value: 1725 },
];

export const vaccinationCoverage = [
  { name: "San Jose", value: 96 }, { name: "San Isidro", value: 88 },
  { name: "Sta. Cruz", value: 92 }, { name: "Bagong Silang", value: 79 },
];

export const barangayOverview = [
  { name: "San Jose", residents: 2450, highRisk: 42, coverage: "96%" },
  { name: "San Isidro", residents: 2120, highRisk: 68, coverage: "88%" },
  { name: "Sta. Cruz", residents: 1980, highRisk: 31, coverage: "92%" },
  { name: "Bagong Silang", residents: 2310, highRisk: 74, coverage: "79%" },
];

export const adminStats = [
  { icon: "Users", label: "Total Users", value: "248", tone: "accent" },
  { icon: "Activity", label: "System Usage", value: "94%", tone: "green" },
  { icon: "Database", label: "Backup Status", value: "Healthy", tone: "green" },
  { icon: "ScrollText", label: "Audit Events (24h)", value: "1,203", tone: "yellow" },
];

export const auditLogs = [
  { user: "Maria Cruz", role: "BHW", action: "Updated resident record R-1028", time: "2026-07-05 09:12", ip: "192.168.1.24" },
  { user: "Maria Dela Cruz", role: "Midwife", action: "Created M1 record for Ana Villanueva", time: "2026-07-05 08:47", ip: "192.168.1.31" },
  { user: "Antonio Reyes", role: "RHU", action: "Generated monthly report", time: "2026-07-04 16:30", ip: "192.168.1.10" },
  { user: "Jose Ramirez", role: "Admin", action: "Created user account (Nurse L. Ramos)", time: "2026-07-04 14:02", ip: "192.168.1.2" },
  { user: "Maria Cruz", role: "BHW", action: "Scheduled follow-up for Carlos Mendoza", time: "2026-07-04 11:20", ip: "192.168.1.24" },
];

export const systemUsers = [
  { name: "Maria Cruz", email: "m.cruz@pili.gov.ph", role: "BHW", barangay: "San Jose", status: "Active" },
  { name: "Maria Dela Cruz", email: "m.delacruz@pili.gov.ph", role: "Midwife", barangay: "Municipal", status: "Active" },
  { name: "Antonio Reyes", email: "a.reyes@pili.gov.ph", role: "RHU Personnel", barangay: "Municipal", status: "Active" },
  { name: "Lourdes Ramos", email: "l.ramos@pili.gov.ph", role: "BHW", barangay: "Sta. Cruz", status: "Active" },
  { name: "Jose Ramirez", email: "j.ramirez@pili.gov.ph", role: "Administrator", barangay: "Municipal", status: "Active" },
  { name: "Grace Aquino", email: "g.aquino@pili.gov.ph", role: "BHW", barangay: "San Isidro", status: "Inactive" },
];

// === RHU Analytics: Community Health Map & Trends ===

export const highlightedBarangays = [
  {
    name: "San Jose",
    color: "#28B463",
    trend: "Healthy",
    healthStatus: "Healthy",
    population: 4215,
    households: 1052,
    consultations: 168,
    highRisk: 27,
    followUpCompletion: 94,
    vaccinationCoverage: 96,
    assignedMidwife: "Maria Dela Cruz",
    assignedBHWs: 4,
    completedFollowUps: 142,
    pendingFollowUps: 9,
    spot: { x: 22, y: 45 },
    panel: {
      monthlyConsultations: [
        { month: "Jan", value: 120 }, { month: "Feb", value: 135 }, { month: "Mar", value: 128 },
        { month: "Apr", value: 145 }, { month: "May", value: 152 }, { month: "Jun", value: 168 },
      ],
      diseaseTrends: [
        { name: "Hypertension", value: 180 }, { name: "Diabetes", value: 95 },
        { name: "Respiratory", value: 72 }, { name: "Dengue", value: 28 }, { name: "TB", value: 15 },
      ],
      referrals: { pending: 3, accepted: 8, completed: 15 },
      healthPrograms: [
        { name: "Maternal Care", coverage: 92, enrolled: 145 },
        { name: "Child Immunization", coverage: 96, enrolled: 320 },
        { name: "Senior Citizen Care", coverage: 88, enrolled: 198 },
        { name: "Hypertension Monitoring", coverage: 91, enrolled: 167 },
      ],
      recentAlerts: [
        { msg: "Vaccination coverage reached 96% this month.", time: "5 hours ago", level: "success" },
        { msg: "2 new prenatal registrations recorded.", time: "1 day ago", level: "info" },
        { msg: "Follow-up completion improved by 4%.", time: "2 days ago", level: "success" },
      ],
      monthlySummary: [
        { month: "Jan", consultations: 120, followUps: 98, vaccinations: 45 },
        { month: "Feb", consultations: 135, followUps: 112, vaccinations: 52 },
        { month: "Mar", consultations: 128, followUps: 105, vaccinations: 38 },
        { month: "Apr", consultations: 145, followUps: 128, vaccinations: 61 },
        { month: "May", consultations: 152, followUps: 135, vaccinations: 48 },
        { month: "Jun", consultations: 168, followUps: 142, vaccinations: 55 },
      ],
    },
  },
  {
    name: "San Isidro",
    color: "#2A7DE1",
    trend: "Stable",
    healthStatus: "Stable",
    population: 3486,
    households: 871,
    consultations: 142,
    highRisk: 41,
    followUpCompletion: 88,
    vaccinationCoverage: 91,
    assignedMidwife: "Lourdes Ramos",
    assignedBHWs: 3,
    completedFollowUps: 108,
    pendingFollowUps: 15,
    spot: { x: 70, y: 40 },
    panel: {
      monthlyConsultations: [
        { month: "Jan", value: 98 }, { month: "Feb", value: 112 }, { month: "Mar", value: 105 },
        { month: "Apr", value: 118 }, { month: "May", value: 125 }, { month: "Jun", value: 142 },
      ],
      diseaseTrends: [
        { name: "Hypertension", value: 220 }, { name: "Diabetes", value: 140 },
        { name: "Respiratory", value: 88 }, { name: "Dengue", value: 42 }, { name: "TB", value: 22 },
      ],
      referrals: { pending: 5, accepted: 6, completed: 11 },
      healthPrograms: [
        { name: "Maternal Care", coverage: 85, enrolled: 98 },
        { name: "Child Immunization", coverage: 89, enrolled: 245 },
        { name: "Senior Citizen Care", coverage: 82, enrolled: 156 },
        { name: "Hypertension Monitoring", coverage: 84, enrolled: 185 },
      ],
      recentAlerts: [
        { msg: "Follow-up completion improved this month.", time: "1 day ago", level: "success" },
        { msg: "Diabetes monitoring program expanded.", time: "3 days ago", level: "info" },
        { msg: "3 new high-risk residents identified.", time: "4 days ago", level: "warning" },
      ],
      monthlySummary: [
        { month: "Jan", consultations: 98, followUps: 82, vaccinations: 38 },
        { month: "Feb", consultations: 112, followUps: 95, vaccinations: 42 },
        { month: "Mar", consultations: 105, followUps: 88, vaccinations: 35 },
        { month: "Apr", consultations: 118, followUps: 102, vaccinations: 48 },
        { month: "May", consultations: 125, followUps: 108, vaccinations: 41 },
        { month: "Jun", consultations: 142, followUps: 108, vaccinations: 52 },
      ],
    },
  },
  {
    name: "Old San Roque",
    color: "#E67E22",
    trend: "Needs Attention",
    healthStatus: "Needs Attention",
    population: 5144,
    households: 1286,
    consultations: 213,
    highRisk: 50,
    followUpCompletion: 82,
    vaccinationCoverage: 89,
    assignedMidwife: "Maria Dela Cruz",
    assignedBHWs: 5,
    completedFollowUps: 156,
    pendingFollowUps: 24,
    spot: { x: 45, y: 68 },
    panel: {
      monthlyConsultations: [
        { month: "Jan", value: 145 }, { month: "Feb", value: 138 }, { month: "Mar", value: 152 },
        { month: "Apr", value: 168 }, { month: "May", value: 185 }, { month: "Jun", value: 213 },
      ],
      diseaseTrends: [
        { name: "Hypertension", value: 310 }, { name: "Diabetes", value: 185 },
        { name: "Respiratory", value: 125 }, { name: "Dengue", value: 65 }, { name: "TB", value: 38 },
      ],
      referrals: { pending: 8, accepted: 7, completed: 9 },
      healthPrograms: [
        { name: "Maternal Care", coverage: 78, enrolled: 112 },
        { name: "Child Immunization", coverage: 84, enrolled: 298 },
        { name: "Senior Citizen Care", coverage: 74, enrolled: 215 },
        { name: "Hypertension Monitoring", coverage: 71, enrolled: 267 },
      ],
      recentAlerts: [
        { msg: "Increase in hypertension cases detected.", time: "2 hours ago", level: "warning" },
        { msg: "Dengue prevention campaign launched.", time: "3 days ago", level: "warning" },
        { msg: "Follow-up completion below target.", time: "5 days ago", level: "warning" },
      ],
      monthlySummary: [
        { month: "Jan", consultations: 145, followUps: 108, vaccinations: 52 },
        { month: "Feb", consultations: 138, followUps: 102, vaccinations: 48 },
        { month: "Mar", consultations: 152, followUps: 115, vaccinations: 58 },
        { month: "Apr", consultations: 168, followUps: 125, vaccinations: 62 },
        { month: "May", consultations: 185, followUps: 138, vaccinations: 55 },
        { month: "Jun", consultations: 213, followUps: 156, vaccinations: 68 },
      ],
    },
  },
];

export const comparisonMonthlyConsultations = [
  { month: "Jan", "San Jose": 120, "San Isidro": 98, "Old San Roque": 145 },
  { month: "Feb", "San Jose": 135, "San Isidro": 112, "Old San Roque": 138 },
  { month: "Mar", "San Jose": 128, "San Isidro": 105, "Old San Roque": 152 },
  { month: "Apr", "San Jose": 145, "San Isidro": 118, "Old San Roque": 168 },
  { month: "May", "San Jose": 152, "San Isidro": 125, "Old San Roque": 185 },
  { month: "Jun", "San Jose": 168, "San Isidro": 142, "Old San Roque": 213 },
];

export const diseaseDonutData = [
  { name: "Hypertension", value: 710 },
  { name: "Diabetes", value: 420 },
  { name: "Respiratory", value: 285 },
  { name: "Dengue", value: 135 },
  { name: "TB", value: 75 },
];

export const comparisonFollowUpTrend = [
  { month: "Jan", "San Jose": 88, "San Isidro": 82, "Old San Roque": 76 },
  { month: "Feb", "San Jose": 90, "San Isidro": 84, "Old San Roque": 78 },
  { month: "Mar", "San Jose": 91, "San Isidro": 85, "Old San Roque": 79 },
  { month: "Apr", "San Jose": 92, "San Isidro": 86, "Old San Roque": 80 },
  { month: "May", "San Jose": 93, "San Isidro": 87, "Old San Roque": 81 },
  { month: "Jun", "San Jose": 94, "San Isidro": 88, "Old San Roque": 82 },
];

export const comparisonVaccinationCoverage = [
  { name: "San Jose", value: 96 },
  { name: "San Isidro", value: 91 },
  { name: "Old San Roque", value: 89 },
];

export const comparisonReferralCompletion = [
  { name: "San Jose", value: 83 },
  { name: "San Isidro", value: 76 },
  { name: "Old San Roque", value: 68 },
];

export const comparisonMaternalTrend = [
  { month: "Jan", "San Jose": 88, "San Isidro": 82, "Old San Roque": 72 },
  { month: "Feb", "San Jose": 90, "San Isidro": 83, "Old San Roque": 74 },
  { month: "Mar", "San Jose": 89, "San Isidro": 84, "Old San Roque": 73 },
  { month: "Apr", "San Jose": 91, "San Isidro": 85, "Old San Roque": 76 },
  { month: "May", "San Jose": 92, "San Isidro": 85, "Old San Roque": 77 },
  { month: "Jun", "San Jose": 92, "San Isidro": 85, "Old San Roque": 78 },
];

export const comparisonChildHealth = [
  { name: "San Jose", value: 96 },
  { name: "San Isidro", value: 89 },
  { name: "Old San Roque", value: 84 },
];

export const comparisonSeniorTrend = [
  { month: "Jan", "San Jose": 84, "San Isidro": 78, "Old San Roque": 70 },
  { month: "Feb", "San Jose": 85, "San Isidro": 79, "Old San Roque": 71 },
  { month: "Mar", "San Jose": 86, "San Isidro": 80, "Old San Roque": 72 },
  { month: "Apr", "San Jose": 87, "San Isidro": 81, "Old San Roque": 73 },
  { month: "May", "San Jose": 87, "San Isidro": 82, "Old San Roque": 74 },
  { month: "Jun", "San Jose": 88, "San Isidro": 82, "Old San Roque": 74 },
];

export const comparisonProgramParticipation = [
  { name: "San Jose", value: 91 },
  { name: "San Isidro", value: 84 },
  { name: "Old San Roque", value: 76 },
];

export const healthStatusSummary = [
  {
    status: "Healthy",
    residents: 4215,
    percentage: 33,
    trend: "+4.2%",
    trendUp: true,
    color: "#28B463",
    summary: "All health indicators within normal range. Consistent follow-up compliance and high vaccination coverage.",
  },
  {
    status: "Stable",
    residents: 3486,
    percentage: 27,
    trend: "+1.8%",
    trendUp: true,
    color: "#2A7DE1",
    summary: "Most indicators stable with minor fluctuations. Follow-up completion steady at 88%.",
  },
  {
    status: "Needs Attention",
    residents: 5144,
    percentage: 40,
    trend: "-2.3%",
    trendUp: false,
    color: "#E67E22",
    summary: "Elevated risk factors detected. Hypertension and diabetes cases above municipal average.",
  },
];

export const recentHealthAlerts = [
  { icon: "AlertTriangle", msg: "Increase in hypertension cases detected in Old San Roque.", time: "2 hours ago", level: "warning" },
  { icon: "Syringe", msg: "Vaccination coverage reached 96% in San Jose.", time: "5 hours ago", level: "success" },
  { icon: "CalendarCheck", msg: "Follow-up completion improved in San Isidro.", time: "1 day ago", level: "info" },
  { icon: "Accessibility", msg: "Senior citizen monitoring completed this week.", time: "2 days ago", level: "info" },
  { icon: "HeartPulse", msg: "Dengue prevention campaign launched in Old San Roque.", time: "3 days ago", level: "warning" },
  { icon: "Baby", msg: "New prenatal registrations up 12% across all barangays.", time: "4 days ago", level: "success" },
];