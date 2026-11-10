import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import { SkeletonList } from "@/components/common/Skeleton";
import { usePhnWorkflow } from "@/hooks/usePhnWorkflow";
import { CHECKUP_STATUS } from "@/lib/phnWorkflowMap";
import { useAuth } from "@/context/AuthContext";
import { canTriage, canConsult } from "@/lib/rhuStations";
import {
  Activity,
  ArrowRight,
  Bell,
  FileText,
  RefreshCw,
} from "lucide-react";

// Shared shortcuts only. Station pages remain available from the role
// navigation, without duplicating them as quick-action cards here.
const QUICK_ACTIONS = [
  {
    icon: FileText,
    label: "Incoming Referrals",
    path: "/app/rhu_personnel/incoming-referrals",
    description: "Respond to referrals assigned to your account and facility.",
  },
  {
    icon: FileText,
    label: "Medical Certificate Requests",
    path: "/app/rhu_personnel/certificates",
    description: "Initiate a medical certificate request.",
    station: "triage",
  },
  {
    icon: Bell,
    label: "View Notifications",
    path: "/app/rhu_personnel/notifications",
    description: "Review RHU notifications and updates.",
  },
];

const formatDate = (iso) => {
  if (!iso) return "";

  const d = new Date(
    String(iso).length === 10 ? `${iso}T00:00:00` : iso,
  );

  if (Number.isNaN(d.getTime())) return "";

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatTime = (value) => {
  if (!value) return "Time unavailable";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
};

const localDayStart = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export default function RHUDashboard() {
  const { user } = useAuth();
  const triageStation = canTriage(user);
  const consultationStation = canConsult(user);
  const {
    patients,
    loading,
    error,
    refresh,
  } = usePhnWorkflow({ source: consultationStation ? "queue" : "intake" });

  // Only surface the quick actions the signed-in station can actually use.
  const quickActions = useMemo(
    () =>
      QUICK_ACTIONS.filter((action) => {
        if (action.station === "triage") return canTriage(user);
        if (action.station === "consultation") return canConsult(user);
        return true;
      }),
    [user]
  );

  const patientList = Array.isArray(patients) ? patients : [];

  const counts = useMemo(() => {
    return {
      waiting: patientList.filter(
        (p) => p.status === CHECKUP_STATUS.WAITING,
      ).length,
      inCheckup: patientList.filter(
        (p) => p.status === CHECKUP_STATUS.IN_CHECKUP,
      ).length,
      completed: patientList.filter(
        (p) => p.status === CHECKUP_STATUS.COMPLETED,
      ).length,
    };
  }, [patientList]);

  const waitingPatients = useMemo(
    () =>
      patientList.filter(
        (p) => p.status === CHECKUP_STATUS.WAITING,
      ),
    [patientList],
  );

  const recent = useMemo(() => {
    return [...patientList]
      .sort((a, b) =>
        String(b.visitDate || "").localeCompare(
          String(a.visitDate || ""),
        ),
      )
      .slice(0, 8);
  }, [patientList]);

  const todayStart = localDayStart(new Date());

  const visitsToday = useMemo(
    () =>
      patientList.filter(
        (visit) =>
          localDayStart(consultationStation
            ? visit.checkup?.completedAt || visit.raw?.updatedAt || visit.visitDate
            : visit.visitDate) === todayStart,
      ),
    [patientList, todayStart, consultationStation],
  );

  const stats = consultationStation
    ? [
        { icon: "CalendarClock", label: "Waiting for Consultation", value: loading ? "—" : counts.waiting.toLocaleString(), tone: "yellow" },
        { icon: "Stethoscope", label: "In Consultation", value: loading ? "—" : counts.inCheckup.toLocaleString(), tone: "blue" },
        { icon: "CheckCircle2", label: "Completed Consultations", value: loading ? "—" : counts.completed.toLocaleString(), tone: "green" },
      ]
    : [
        { icon: "CalendarClock", label: "Waiting for Consultation", value: loading ? "—" : counts.waiting.toLocaleString(), tone: "yellow" },
        { icon: "Stethoscope", label: "In Consultation", value: loading ? "—" : counts.inCheckup.toLocaleString(), tone: "blue" },
        { icon: "CheckCircle2", label: "Completed Consultations", value: loading ? "—" : counts.completed.toLocaleString(), tone: "green" },
        { icon: "ClipboardList", label: "Triage Screenings Today", value: loading ? "—" : visitsToday.length.toLocaleString(), tone: "accent" },
      ];

  const columns = [
    { key: "patient", label: "Patient" },
    { key: "barangay", label: "Barangay" },
    { key: "reason", label: "Reason" },
    { key: "status", label: "Status" },
  ];

  const renderCell = (row, column) => {
    if (column.key === "status") {
      return <StatusBadge value={row.status} />;
    }

    if (column.key === "barangay") {
      return row.barangay || "—";
    }

    if (column.key === "reason") {
      return row.reason || "—";
    }

    return row[column.key] || "—";
  };

  const todayActivity = useMemo(() => {
    return visitsToday
      .map((visit) => ({
        id: visit.id,
        kind: consultationStation
          ? visit.status === CHECKUP_STATUS.COMPLETED ? "Consultation completed" : "Consultation activity"
          : "Screening submitted",
        patient: visit.patient,
        at: consultationStation
          ? visit.checkup?.completedAt || visit.raw?.updatedAt || visit.visitDate
          : visit.visitDate,
      }))
      .sort(
        (left, right) =>
          new Date(right.at).getTime() -
          new Date(left.at).getTime(),
      );
  }, [visitsToday, consultationStation]);

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={["Dashboard"]}
        title={consultationStation ? "RHU Consultation Dashboard" : "RHU Triage Dashboard"}
        subtitle={consultationStation
          ? "Review the consultation queue and track completed consultations."
          : "Review the triage workload, record resident screening, and hand patients off to consultation."}
        action={(
          <button
            type="button"
            onClick={() => { void refresh(); }}
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-btn border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15 disabled:opacity-50 md:w-auto"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        )}
      />

      {error && (
        <Card className="p-4 text-sm text-brand-danger">
          {error}
        </Card>
      )}
      <section aria-labelledby="summary-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="summary-heading"
            className="text-base font-semibold text-brand-ink"
          >
            {consultationStation ? "Consultation Overview" : "Triage Overview"}
          </h2>

          {loading && (
            <span className="text-xs text-brand-gray">
              Updating…
            </span>
          )}
        </div>

        <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${stats.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
          {stats.map((stat, index) => (
            <StatCard
              key={stat.label}
              {...stat}
              index={index}
              compact
              indicator
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="quick-actions-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="quick-actions-heading"
            className="text-base font-semibold text-brand-ink"
          >
            Quick Actions
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {quickActions.map((action) => (
            <Link
              key={action.label}
              to={action.path}
              className="block h-full"
            >
              <Card className="h-full p-4 transition-colors hover:border-brand-blue hover:shadow-md">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-brand-blue/10 p-2">
                    <action.icon className="h-5 w-5 text-brand-blue" />
                  </div>

                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-brand-ink">
                      {action.label}
                    </h4>

                    <p className="mt-1 text-xs text-brand-gray">
                      {action.description}
                    </p>
                  </div>

                  <ArrowRight className="mt-1 h-4 w-4 text-brand-gray" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <div className={`grid grid-cols-1 gap-4 sm:gap-5 ${triageStation ? "lg:grid-cols-3" : ""}`}>
        <Card className={`p-4 sm:p-6 ${triageStation ? "lg:col-span-2" : ""}`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-ink sm:text-base">
              {consultationStation ? "Consultation Queue" : "Recent Screening Hand-offs"}
            </h3>

            <Link
              to={consultationStation ? "/app/rhu_personnel/consultation" : "/app/rhu_personnel/triage"}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
            >
              {consultationStation ? "View Consultation Queue" : "View Screening History"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {loading ? (
            <SkeletonList rows={5} />
          ) : recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-brand-gray">
              {consultationStation ? "No consultation queue records yet." : "No screening hand-offs yet."}
            </p>
          ) : (
            <DataTable
              columns={columns}
              rows={recent}
              renderCell={renderCell}
            />
          )}
        </Card>

        {triageStation && <Card className="h-fit p-4 sm:p-6">
          <h3 className="mb-4 text-sm font-semibold text-brand-ink sm:text-base">
            Consultation Queue
          </h3>

          {loading ? (
            <SkeletonList rows={4} />
          ) : waitingPatients.length === 0 ? (
            <p className="py-6 text-center text-sm text-brand-gray">
              No patients waiting for consultation.
            </p>
          ) : (
            <div className="space-y-3">
              {waitingPatients.slice(0, 5).map((patient) => (
                <div
                  key={patient.id}
                  className="flex items-center justify-between border-b border-brand-border py-2 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-brand-ink">
                      {patient.patient}
                    </p>

                    <p className="truncate text-xs text-brand-gray">
                      {[
                        patient.barangay,
                        formatDate(patient.visitDate),
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </p>
                  </div>

                  <StatusBadge value={patient.status} />
                </div>
              ))}
            </div>
          )}

          <Link
            to="/app/rhu_personnel/consultation"
            className="mt-4 block w-full text-center text-sm font-medium text-brand-blue hover:underline"
          >
            View Consultation Queue
          </Link>
        </Card>}
      </div>

      <div>
        <Card className="p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-brand-ink sm:text-base">
                Today&apos;s Activity
              </h3>

              <p className="mt-1 text-xs text-brand-gray">
              {consultationStation ? "Consultation activity recorded today" : "Triage activity recorded today"}
              </p>
            </div>

            <Activity className="h-5 w-5 text-brand-blue" />
          </div>

          {loading ? (
            <SkeletonList rows={3} />
          ) : todayActivity.length === 0 ? (
            <p className="py-6 text-center text-sm text-brand-gray">
              No {consultationStation ? "consultation" : "triage"} activity recorded today.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {todayActivity.slice(0, 5).map((item, index) => (
                <li
                  key={`${item.id || "activity"}-${index}`}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Activity className="h-4 w-4 shrink-0 text-brand-blue" />

                    <span className="truncate text-sm text-brand-ink">
                      {item.kind}
                      {item.patient
                        ? ` — ${item.patient}`
                        : ""}
                    </span>
                  </div>

                  <time className="shrink-0 text-xs text-brand-gray">
                    {formatTime(item.at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

    </div>
  );
}
