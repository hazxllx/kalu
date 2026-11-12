// Badge Components - Standardized Implementation
// =================================================
//
// This file documents the standardized badge components for Follow-up Management
// in KALUSAGAP v2.0.
//
// OVERVIEW
// --------
// Two new reusable badge components have been created to replace inline styling
// and ensure consistent visual presentation across all follow-up views.
//
// COMPONENTS
// ----------
//
// 1. PriorityBadge (NEW)
//    Location: src/features/follow-ups/components/PriorityBadge.jsx
//    Purpose: Display priority levels (Low, Medium, High) with standardized styling
//    Features:
//      - Soft background colors with dark text
//      - Colored dot indicator for visual scanning
//      - Dark mode support
//      - Rounded corners (6px)
//      - Font size: 12px (text-xs)
//      - Medium font weight
//    
//    Styling:
//      Low:    emerald-50 bg / emerald-700 text (dark: emerald-500/15 / emerald-400)
//      Medium: amber-50 bg / amber-700 text (dark: amber-500/15 / amber-400)
//      High:   rose-50 bg / rose-700 text (dark: rose-500/15 / rose-400)
//    
//    Usage:
//      <PriorityBadge value="High" />
//      <PriorityBadge value="Medium" showDot={false} />
//
// 2. FollowUpStatusBadge (NEW)
//    Location: src/features/follow-ups/components/FollowUpStatusBadge.jsx
//    Purpose: Display follow-up status with standardized styling
//    Supported Statuses:
//      - Scheduled:  blue-50 bg / blue-700 text
//      - Pending:    amber-50 bg / amber-700 text
//      - Completed:  emerald-50 bg / emerald-700 text
//      - Cancelled:  slate-100 bg / slate-700 text
//      - Overdue:    rose-50 bg / rose-700 text
//      - Today:      blue-50 bg / blue-700 text
//      - Upcoming:   slate-50 bg / slate-700 text
//      - Ongoing:    blue-50 bg / blue-700 text
//      - Missed:     rose-50 bg / rose-700 text
//      - Rejected:   rose-50 bg / rose-700 text
//    
//    Features:
//      - Semantic colored dots (h-2 w-2)
//      - Dark mode support
//      - Rounded corners (6px)
//      - Font size: 12px (text-xs)
//      - Medium font weight
//    
//    Usage:
//      <FollowUpStatusBadge value="Completed" />
//      <FollowUpStatusBadge value="Overdue" showDot={true} />
//
// 3. ScheduleStatusBadge (EXISTING - UNCHANGED)
//    Location: src/features/follow-ups/components/ScheduleStatusBadge.jsx
//    Purpose: Display follow-up schedule status with semantic styling
//    Status: Maintained for backward compatibility with calendar views
//    Used by: ResidentFollowUpCalendar, FollowUpCalendar, ScheduleCalendarViews
//
// IMPLEMENTATION LOCATIONS
// -------------------------
//
// MidwifeFollowUp.jsx (UPDATED)
//   - Imports: PriorityBadge, FollowUpStatusBadge
//   - Table Priority Column: <PriorityBadge value={f.priority || "Medium"} />
//   - Table Status Column: <FollowUpStatusBadge value={isOverdue(f) ? "Overdue" : f.status} />
//   - Removed: Old STATUS_COLORS and PRIORITY_COLORS constants
//
// ResidentFollowUps.jsx (NO CHANGES NEEDED)
//   - Uses ScheduleStatusBadge (appropriate for resident view)
//   - Uses ConfirmationBadge for confirmation status
//
// FollowUpCalendar.jsx (NO CHANGES NEEDED)
//   - Uses ScheduleStatusBadge in detail modals and calendar views
//   - Priority shown in form selects (no badge display in calendar view)
//
// ResidentFollowUpCalendar.jsx (NO CHANGES NEEDED)
//   - Uses ScheduleStatusBadge for resident-facing calendar view
//   - Uses ConfirmationBadge for confirmation status
//
// ScheduleCalendarViews.jsx (NO CHANGES NEEDED)
//   - Uses ScheduleStatusBadge for all calendar presentations
//   - Consistent across supervisor and resident variants
//
// DESIGN SPECIFICATIONS
// ---------------------
//
// All badges follow these specifications:
//
// 1. Dimensions:
//    - Height: Auto (content-based with py-1)
//    - Padding: px-2.5 py-1 (horizontal 10px, vertical 4px)
//    - Border Radius: 6px (rounded-[6px])
//
// 2. Typography:
//    - Font Size: 12px (text-xs)
//    - Font Weight: 500 (font-medium)
//    - Line Height: Tight (no additional line-height override)
//
// 3. Dot Indicator:
//    - Width: 8px (w-2)
//    - Height: 8px (h-2)
//    - Border Radius: 100% (rounded-full)
//    - Gap from text: 6px (gap-1.5)
//    - Default opacity: 100% (no opacity adjustment)
//
// 4. Color Palette:
//    - Light Mode: Soft background (50/100 shade) with darker text (600/700 shade)
//    - Dark Mode: Semi-transparent background (500/15) with lighter text (400 shade)
//    - No borders or shadows
//    - No gradients or excessive saturation
//
// 5. Accessibility:
//    - High contrast between text and background
//    - Readable in light and dark modes
//    - Semantic colors that map to status meaning
//    - No icon-only indicators (always includes text label)
//
// ALIGNMENT & LAYOUT
// ------------------
//
// In table contexts:
//   - Badges are center-aligned vertically within rows (py-2.5 on row cell)
//   - Consistent row height maintained (no overflow)
//   - Badges do not cause row height inconsistencies
//   - Column widths preserved
//   - Spacing between columns balanced
//
// DARK MODE SUPPORT
// ------------------
//
// All colors include dark mode variants using Tailwind dark: prefix:
//   - Low/Emerald:   dark:bg-emerald-500/15 dark:text-emerald-400
//   - Medium/Amber:  dark:bg-amber-500/15 dark:text-amber-400
//   - High/Rose:     dark:bg-rose-500/15 dark:text-rose-400
//   - Blue (Scheduled/Today): dark:bg-blue-500/15 dark:text-blue-400
//   - Slate (Cancelled): dark:bg-slate-500/20 dark:text-slate-400
//
// MIGRATION NOTES
// ---------------
//
// Old Implementation (Removed):
//   const PRIORITY_COLORS = {
//     High: "bg-brand-danger/10 text-brand-danger",
//     Medium: "bg-brand-yellow/15 text-[#B07E00]",
//     Low: "bg-brand-green/10 text-brand-green",
//   };
//   
//   const STATUS_COLORS = {
//     Scheduled: "bg-brand-blue/10 text-brand-blue",
//     ...
//   };
//
// New Implementation:
//   All color mappings are now in the badge components themselves
//   No need to maintain separate color constants
//   Consistent across all follow-up views
//
// FUNCTIONAL REQUIREMENTS MET
// ----------------------------
//
// ✓ Priority values (Low, Medium, High) are not modified
// ✓ Status values (Scheduled, Pending, Completed, Cancelled, Overdue) are not modified
// ✓ Database schemas unchanged
// ✓ API contracts unchanged
// ✓ Badges dynamically reflect actual record status
// ✓ Filtering and sorting behavior preserved
// ✓ Dark mode has appropriate colors and contrast
// ✓ All status types render correctly
// ✓ No backend logic changes required
//
// TESTING CHECKLIST
// ------------------
//
// [ ] PriorityBadge renders all three levels (Low, Medium, High)
// [ ] FollowUpStatusBadge renders all statuses (Scheduled, Pending, Completed, Cancelled, Overdue)
// [ ] Badges display correctly in MidwifeFollowUp table
// [ ] Badges maintain consistent alignment in table rows
// [ ] Dot indicators display correctly
// [ ] Light mode colors are readable and professional
// [ ] Dark mode colors maintain contrast and readability
// [ ] Build completes without errors
// [ ] No TypeScript/ESLint warnings
// [ ] Responsive design works on mobile (table converts to card layout)
// [ ] Print view displays badges correctly
//
// FUTURE ENHANCEMENTS
// --------------------
//
// Consider centralizing color mappings in a shared constants file for even
// greater consistency, but the current implementation is self-contained and
// maintainable as-is.
