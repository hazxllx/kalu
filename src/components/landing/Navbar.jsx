import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { LOGO_URL } from "@/lib/brand";

const links = [
  { label: "Home", href: "#home" },
  { label: "Features", href: "#features" },
  { label: "Health Services", href: "#services" },
  { label: "About", href: "#about" },
  { label: "Contact", href: "#contact" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all ${
        scrolled
          ? "bg-white/90 backdrop-blur border-b border-brand-border"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-content mx-auto px-5 md:px-8 h-20 flex items-center justify-between">
        {/* Logo */}
        <a href="#home" className="flex items-center">
          <img
            src={LOGO_URL}
            alt="KALUSAGAP"
            className="h-16 md:h-20 w-auto object-contain transition-all duration-300"
          />
        </a>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-brand-gray hover:text-brand-blue transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Desktop Buttons */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            to="/login"
            className="text-sm font-medium text-brand-blue px-4 py-2 rounded-btn hover:bg-brand-light transition-colors"
          >
            Login
          </Link>

          <Link
            to="/register"
            className="text-sm font-medium text-white bg-brand-blue px-5 py-2.5 rounded-btn hover:bg-brand-dark transition-colors shadow-soft"
          >
            Register
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden text-brand-ink"
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Navigation */}
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="md:hidden bg-white border-t border-brand-border px-5 py-4 space-y-1"
        >
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-2.5 text-brand-gray font-medium"
            >
              {l.label}
            </a>
          ))}

          <Link
            to="/login"
            className="block text-center text-brand-blue border border-brand-blue py-2.5 rounded-btn font-medium"
          >
            Login
          </Link>

          <Link
            to="/register"
            className="block text-center text-white bg-brand-blue py-2.5 rounded-btn font-medium"
          >
            Register
          </Link>
        </motion.div>
      )}
    </header>
  );
}