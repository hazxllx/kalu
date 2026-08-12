import React from "react";

export default function GovInfoBar() {
  return (
    <section className="bg-brand-blue/5 py-10">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <div className="grid gap-6 rounded-[20px] border border-brand-border bg-white p-6 md:grid-cols-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-blue">Municipal Health Office</p>
            <p className="mt-3 text-lg font-semibold text-brand-dark">Reliable local public health coordination</p>
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-blue">Barangay coverage</p>
            <p className="mt-3 text-lg font-semibold text-brand-dark">Secure health monitoring for every barangay in the municipality.</p>
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-blue">Community support</p>
            <p className="mt-3 text-lg font-semibold text-brand-dark">Connected residents, health workers, and municipal teams.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
