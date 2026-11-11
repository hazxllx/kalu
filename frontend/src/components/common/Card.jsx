import React from "react";

/**
 * Card - Responsive container with consistent styling
 * 
 * Features:
 * - Responsive padding via padding prop or manual classes
 * - Dark mode support
 * - Optional border and shadow
 * - Flexible sizing
 * 
 * Props:
 * - padding: "none" | "sm" | "md" | "lg" | "responsive" (default: none)
 * - className: Additional classes
 * - children: Card content
 */
export function Card({ className = "", padding = "none", children, ...props }) {
  const paddingClasses = {
    none: "",
    sm: "p-4",
    md: "p-5",
    lg: "p-6",
    responsive: "p-4 sm:p-5 md:p-6"
  };

  return (
    <div 
      className={`ui-card rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card shadow-card ${paddingClasses[padding]} ${className}`} 
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * CardHeader - Section heading used inside a Card
 * 
 * Features:
 * - Responsive layout that stacks on mobile
 * - Optional action button/element
 * - Consistent typography
 * - Dark mode support
 * 
 * Props:
 * - title: Main heading text
 * - subtitle: Optional supporting text
 * - action: Optional action element (button, link, etc.)
 * - className: Additional classes
 */
export function CardHeader({ title, subtitle, action = null, className = "" }) {
  return (
    <div className={`ui-card-header flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 ${className}`}>
      <div className="min-w-0 flex-1">
        <h3 className="text-base sm:text-lg font-semibold text-brand-ink dark:text-foreground break-words">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-1 text-xs sm:text-sm text-brand-gray dark:text-muted-foreground break-words">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="w-full sm:w-auto shrink-0">{action}</div>}
    </div>
  );
}

/**
 * CardContent - Standardized content wrapper for cards
 * 
 * Props:
 * - padding: "none" | "sm" | "md" | "lg" | "responsive" (default: "responsive")
 * - className: Additional classes
 * - children: Content
 */
export function CardContent({ className = "", padding = "responsive", children, ...props }) {
  const paddingClasses = {
    none: "",
    sm: "p-4",
    md: "p-5",
    lg: "p-6",
    responsive: "p-4 sm:p-5 md:p-6"
  };

  return (
    <div className={`ui-card-content ${paddingClasses[padding]} ${className}`} {...props}>
      {children}
    </div>
  );
}

/**
 * CardFooter - Footer section for cards
 * 
 * Props:
 * - className: Additional classes
 * - children: Footer content
 */
export function CardFooter({ className = "", children, ...props }) {
  return (
    <div 
      className={`ui-card-footer border-t border-slate-200 dark:border-border px-4 py-3 sm:px-5 sm:py-4 ${className}`} 
      {...props}
    >
      {children}
    </div>
  );
}
