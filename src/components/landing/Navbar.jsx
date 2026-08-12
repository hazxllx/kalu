import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Menu, X, ChevronDown } from "lucide-react";
import GovSeal from "@/components/landing/GovSeal";

const links = [
  { label: "Home", href: "#home" },
  { label: "About", href: "#about" },
  { label: "Health Services", href: "#services" },
  { label: "Programs", href: "#programs" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Contact", href: "#contact" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="relative z-50">
      <div
        className={`sticky top-0 border-b transition-all ${
          scrolled ? "border-brand-border bg-white shadow-sheet" : "border-brand-border/70 bg-white"
        }`}
      >
        <div className="mx-auto flex h-[76px] max-w-content items-center justify-between gap-4 px-5 md:px-8">
          {/* Agency mark */}
          <Link to="/" className="flex shrink-0 items-center gap-3">
            <GovSeal height={34} eager className="hidden sm:block" />
            <div className="leading-tight">
              <p className="font-display text-[17px] font-bold tracking-[0.04em] text-brand-dark">
                KALUSAGAP
              </p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-gov text-brand-blue">
                Community Health System
              </p>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-7 lg:flex">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="group relative text-[13px] font-medium text-brand-gray transition-colors hover:text-brand-dark"
              >
                {l.label}
                <span
                  className="absolute -bottom-[30px] left-0 h-[2px] w-full origin-left scale-x-0 bg-brand-blue transition-transform duration-200 group-hover:scale-x-100"
                  aria-hidden="true"
                />
              </a>
            ))}
          </nav>

          {/* Actions */}
          <div className="hidden items-center gap-3 lg:flex">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 border border-brand-rule bg-white px-4 py-2.5 text-[12.5px] font-semibold text-brand-dark transition-colors hover:border-brand-blue hover:text-brand-blue"
            >
              Log In <ChevronDown className="hidden h-3.5 w-3.5" />
            </Link>
            <Link
              to="/register"
              className="inline-flex items-center bg-brand-blue px-5 py-2.5 text-[12.5px] font-semibold text-white shadow-sheet transition-colors hover:bg-brand-dark"
            >
              Register
            </Link>
          </div>

          <button
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
            className="flex h-10 w-10 items-center justify-center border border-brand-border text-brand-dark lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      {open && (
        <div className="border-b border-brand-border bg-white lg:hidden">
          <nav className="mx-auto max-w-content space-y-1 px-5 py-4 md:px-8">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block border-b border-brand-border/60 py-3 text-sm font-medium text-brand-gray transition-colors hover:text-brand-blue"
              >
                {l.label}
              </a>
            ))}
            <div className="flex gap-3 pt-4 pb-2">
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="flex-1 border border-brand-rule bg-white py-2.5 text-center text-sm font-semibold text-brand-dark"
              >
                Log In
              </Link>
              <Link
                to="/register"
                onClick={() => setOpen(false)}
                className="flex-1 bg-brand-blue py-2.5 text-center text-sm font-semibold text-white"
              >
                Register
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
