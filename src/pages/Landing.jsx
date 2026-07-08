import React from "react";
import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import TrustStats from "@/components/landing/TrustStats";
import Features from "@/components/landing/Features";
import ServicesSection from "@/components/landing/ServicesSection";
import HowItWorks from "@/components/landing/HowItWorks";
import About from "@/components/landing/About";
import Footer from "@/components/landing/Footer";

export default function Landing() {
  return (
    <div className="bg-brand-bg overflow-x-hidden">
      <Navbar />
      <Hero />
      <TrustStats />
      <Features />
      <ServicesSection />
      <HowItWorks />
      <About />
      <Footer />
    </div>
  );
}