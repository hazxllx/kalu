// frontend/src/features/dashboards/components/RecentBarangayUpdates.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { Activity, CalendarClock, ClipboardCheck, FilePlus2, Send } from 'lucide-react';
import ErrorState from '@/components/common/ErrorState';

const dateFormatter = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// Renders or manages RecentBarangayUpdates logic.
export default function RecentBarangayUpdates({ source, allowed, can = () => false }) {
  return <section className="hs-panel hs-recent-panel" aria-labelledby="recent-barangay-heading">
    <header className="hs-panel-header"><div><h2 id="recent-barangay-heading">Recent Barangay Updates</h2><p>Latest monitoring activities in your assigned barangay.</p></div></header>
    {!allowed ? <p className="hs-loading">Monitoring activity access unavailable.</p>
      : source.loading ? <p className="hs-loading" role="status">Loading recent activities...</p>
        : source.error ? <ErrorState compact title="Recent updates unavailable" message={source.error} onRetry={source.refresh} />
          : source.data?.activities?.length ? <ol className="hs-recent-list">{source.data.activities.map((event) => {
            const Icon = /assessment/i.test(event.kind) ? ClipboardCheck : /follow/i.test(event.kind) ? CalendarClock : /referral/i.test(event.kind) ? Send : /created/i.test(event.kind) ? FilePlus2 : Activity;
            const routes = {
              referral: can('referrals.view') || can('referrals.history.view') ? `/app/health_supervisor/referrals?referral=${encodeURIComponent(event.target?.id)}` : null,
              follow_up: can('followups.view') ? `/app/health_supervisor/followups?followup=${encodeURIComponent(event.target?.id)}` : null,
              household: can('households.view') ? `/app/health_supervisor/households/${encodeURIComponent(event.target?.id)}` : null,
            };
            const href = event.target?.id ? routes[event.target.type] : null;
            const content = <><Icon aria-hidden="true" /><div><h3>{event.title}</h3><p>{event.description}</p><time dateTime={event.occurredAt}>{dateFormatter.format(new Date(event.occurredAt))}</time></div></>;
            return <li key={event.id}>{href ? <Link className="hs-recent-entry" to={href}>{content}</Link> : <article className="hs-recent-entry">{content}</article>}</li>;
          })}</ol> : <p className="hs-loading">No recent monitoring activities recorded.</p>}
  </section>;
}
