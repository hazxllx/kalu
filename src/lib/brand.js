const db = { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

export const LOGO_URL = new URL("../public/logo-removebg-preview.png", import.meta.url).href;

export const ROLES = {
  "resident-limited": { key: "resident-limited", label: "Resident (Pending)", name: "Juan Dela Cruz", basePath: "/app/resident-limited" },
  resident: { key: "resident", label: "Resident (Verified)", name: "Maria Santos", basePath: "/app/resident" },
  bhw: { key: "bhw", label: "Barangay Health Worker", name: "Maria Cruz", basePath: "/app/bhw" },
  midwife: { key: "midwife", label: "Midwife", name: "Maria Dela Cruz", basePath: "/app/midwife" },
  rhu: { key: "rhu", label: "RHU Personnel", name: "Antonio Reyes", basePath: "/app/rhu" },
  mho: { key: "mho", label: "Municipal Health Officer", name: "Dr. Carmen Bautista", basePath: "/app/mho" },
  admin: { key: "admin", label: "System Administrator", name: "Jose Ramirez", basePath: "/app/admin" },
};