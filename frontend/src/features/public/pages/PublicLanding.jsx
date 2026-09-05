import { ArrowRight, Building2, LogIn, MapPinned, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import GovSeal from "@/components/branding/GovSeal";

const accessOptions = [
  {
    icon: LogIn,
    eyebrow: "Already registered?",
    title: "Login",
    description: "For municipalities and authorized users who already have a KALUSAGAP account.",
    href: "/login",
    className: "bg-brand-blue text-white hover:bg-brand-dark",
    iconClassName: "bg-white/10 text-brand-goldlight",
  },
  {
    icon: Building2,
    eyebrow: "Not registered yet?",
    title: "Register Municipality",
    description: "For municipalities with an RHU that want to onboard their municipality to KALUSAGAP.",
    href: "/municipality-registration",
    className: "border border-brand-border bg-white text-brand-dark hover:border-brand-blue hover:bg-brand-light/50",
    iconClassName: "bg-brand-light text-brand-blue",
  },
];

export default function PublicLanding() {
  return (
    <div className="min-h-dvh bg-brand-bg text-brand-ink">
      <header className="border-b border-white/10 bg-brand-dark text-white">
        <div className="gov-hatch mx-auto flex max-w-content items-center justify-between px-5 py-5 md:px-8">
          <Link to="/" className="flex items-center gap-3">
            <GovSeal height={44} eager onDark />
            <div>
              <p className="font-display text-lg font-bold leading-tight tracking-[0.04em]">KALUSAGAP</p>
              <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-gov text-white/65">Community Health System</p>
            </div>
          </Link>
          <Link to="/login" className="hidden items-center gap-2 border border-white/25 px-4 py-2.5 text-[11px] font-bold uppercase tracking-gov text-white transition-colors hover:border-white sm:inline-flex">
            <LogIn className="h-3.5 w-3.5" /> Login
          </Link>
        </div>
        <div className="gov-flag-rule h-1" aria-hidden="true" />
      </header>

      <main>
        <section className="relative overflow-hidden bg-brand-dark text-white">
          <div className="pointer-events-none absolute inset-0 gov-guilloche opacity-70" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-content gap-12 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <div className="flex items-center gap-3">
                <span className="h-px w-8 bg-brand-goldlight/70" aria-hidden="true" />
                <p className="gov-kicker text-brand-goldlight">Camarines Sur shared health system</p>
              </div>
              <h1 className="mt-6 max-w-2xl font-display text-4xl font-bold leading-tight md:text-6xl">KALUSAGAP</h1>
              <p className="mt-3 font-display text-xl font-semibold text-brand-goldlight md:text-2xl">Community Health System</p>
              <p className="mt-7 max-w-xl text-[15px] leading-8 text-white/75">Supporting municipalities and Rural Health Units across Camarines Sur through a shared digital health platform.</p>
              <p className="mt-4 max-w-xl text-[13px] leading-7 text-white/60">KALUSAGAP helps local health teams manage community health information, monitor health risks, and support early intervention through connected municipal systems.</p>
              <div className="mt-9 flex flex-wrap gap-3 sm:hidden">
                <Link to="/login" className="inline-flex flex-1 items-center justify-center gap-2 bg-white px-5 py-3 text-[12px] font-bold uppercase tracking-gov text-brand-dark">Login <ArrowRight className="h-4 w-4" /></Link>
                <Link to="/municipality-registration" className="inline-flex flex-1 items-center justify-center gap-2 border border-white/35 px-5 py-3 text-[12px] font-bold uppercase tracking-gov text-white">Register <ArrowRight className="h-4 w-4" /></Link>
              </div>
            </div>

            <div className="relative border border-white/15 bg-white p-6 text-brand-ink shadow-raise sm:p-8">
              <div className="flex items-start gap-4 border-b border-brand-border pb-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center bg-brand-light text-brand-blue"><MapPinned className="h-5 w-5" /></span>
                <div><p className="gov-kicker text-brand-blue">One connected public health record</p><h2 className="mt-2 font-display text-2xl font-bold text-brand-dark">Choose how to enter KALUSAGAP</h2></div>
              </div>
              <div className="mt-6 space-y-3">
                {accessOptions.map(({ icon: Icon, eyebrow, title, description, href, className, iconClassName }) => (
                  <Link key={href} to={href} className={`group block p-4 transition-colors ${className}`}>
                    <div className="flex items-start gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center ${iconClassName}`}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-gov opacity-70">{eyebrow}</span><span className="mt-1 flex items-center gap-2 font-display text-xl font-bold">{title}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span><span className="mt-2 block text-[12px] leading-5 opacity-75">{description}</span></span>
                    </div>
                  </Link>
                ))}
              </div>
              <div className="mt-6 flex items-center gap-2 border-t border-brand-border pt-5 text-[11px] leading-5 text-brand-gray"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-green" />Municipality access is authenticated and tenant-scoped.</div>
            </div>
          </div>
        </section>

        <section className="border-b border-brand-border bg-white">
          <div className="mx-auto grid max-w-content gap-6 px-5 py-10 sm:grid-cols-3 md:px-8">
            {["Municipalities and RHUs", "Health risk monitoring", "Early intervention support"].map((label, index) => <div key={label} className="flex gap-3 border-l-2 border-brand-gold px-4"><span className="font-display text-2xl font-bold text-brand-blue">0{index + 1}</span><p className="pt-1 text-[13px] font-semibold leading-5 text-brand-ink">{label}</p></div>)}
          </div>
        </section>
      </main>

      <footer className="bg-brand-paper">
        <div className="mx-auto flex max-w-content flex-col gap-2 px-5 py-6 text-[11px] text-brand-gray sm:flex-row sm:items-center sm:justify-between md:px-8"><span className="font-semibold uppercase tracking-gov text-brand-dark">KALUSAGAP · Community Health System</span><span>Municipalities and Rural Health Units across Camarines Sur</span></div>
      </footer>
    </div>
  );
}
