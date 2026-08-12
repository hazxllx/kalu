import React from "react";

export default function WhyKALUSAGAP() {
  return (
    <section className="bg-brand-bg py-24">
      <div className="mx-auto max-w-content px-5 md:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-blue">Why KALUSAGAP</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-brand-dark">A trusted government health platform for the community</h2>
            <p className="mt-4 text-base leading-8 text-brand-gray">Designed to support local health delivery with reliable data, clear workflows, and community-focused tools.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { title: "Secure community records", value: "Household health data is stored in a protected municipal system." },
              { title: "Early intervention", value: "Alerts help health workers act quickly on priority cases." },
              { title: "Integrated health teams", value: "Barangay, RHU, and municipal staff collaborate in one portal." },
              { title: "Resident support", value: "Residents can access services and verification status with ease." },
            ].map((item) => (
              <div key={item.title} className="rounded-[18px] border border-brand-border bg-white p-6 shadow-soft">
                <p className="text-sm font-semibold text-brand-dark">{item.title}</p>
                <p className="mt-3 text-sm leading-7 text-brand-gray">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
