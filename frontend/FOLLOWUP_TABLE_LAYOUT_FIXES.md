# Follow-up Management Table – Layout & Responsiveness Fixes

## Overview
Fixed horizontal overflow, column misalignment, and responsiveness issues in the Follow-up Management page (`/app/phn/followups` and `/app/health_supervisor/followups`) table.

## Root Causes Identified

### 1. **Table Layout Algorithm Issue**
- **Problem**: `table-layout: fixed` with percentage-based column widths (19% + 15% + 15% + 13% + 15% + 8% + 9% + 6% = 100%) was causing layout thrashing
- **Impact**: Badges in Priority and Status columns were compressed, causing overlap and misalignment

### 2. **Undersized Priority and Status Columns**
- **Problem**: Priority column (8%) and Status column (9%) were too narrow for badge content
- **Impact**: Badges overflowed into adjacent columns, causing visual clipping

### 3. **Missing Responsive Behavior**
- **Problem**: Table had no mobile/tablet breakpoints; full horizontal scroll applied to page instead of just table
- **Impact**: Sidebar was pushed off-screen on smaller viewports

### 4. **Inconsistent Cell Alignment**
- **Problem**: Priority and Status columns used `text-left` alignment instead of `text-center`
- **Impact**: Badges were misaligned with headers

### 5. **Rigid Column Width Constraints**
- **Problem**: `min-w-[200px]` on Location column without corresponding max-width
- **Impact**: Location column expanded unpredictably, pushing other columns

## Fixes Applied

### 1. **CSS Changes** (src/styles/index.css)

**Changed from:**
```css
.follow-up-monitoring-grid {
  table-layout: fixed;
}
/* Percentage widths: 19% + 15% + 15% + 13% + 15% + 8% + 9% + 6% = 100% */
.follow-up-monitoring-grid th:nth-child(6),
.follow-up-monitoring-grid td:nth-child(6) { width: 8%; }
.follow-up-monitoring-grid th:nth-child(7),
.follow-up-monitoring-grid td:nth-child(7) { width: 9%; }
```

**Changed to:**
```css
.follow-up-monitoring-grid {
  table-layout: auto;
  width: 100%;
  border-collapse: collapse;
}

/* Priority column: 11% with 100px minimum */
.follow-up-monitoring-grid th:nth-child(6),
.follow-up-monitoring-grid td:nth-child(6) { 
  min-width: 100px;
  width: 11%;
  text-align: center;
}

/* Status column: 12% with 110px minimum */
.follow-up-monitoring-grid th:nth-child(7),
.follow-up-monitoring-grid td:nth-child(7) { 
  min-width: 110px;
  width: 12%;
  text-align: center;
}

/* Responsive breakpoints added */
@media (max-width: 1024px) { /* Tablet */ }
@media (max-width: 768px) { /* Mobile */ }
```

**Benefits:**
- `table-layout: auto` allows columns to size naturally based on content
- Increased Priority (8% → 11%) and Status (9% → 12%) widths
- Added `min-width` constraints prevent content squishing
- Center alignment matches badge presentation
- Responsive breakpoints allow controlled scaling

### 2. **Component Changes** (src/features/follow-ups/pages/MidwifeFollowUp.jsx)

**Table container:**
- Added `w-full` class to ensure full viewport width calculation
- Kept `overflow-x-auto` to allow horizontal scrolling only within table on smaller screens

**Table headers (Priority & Status columns):**
```jsx
/* Changed from: text-left */
<th className="text-center text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2.5">
```

**Table cells (Priority & Status columns):**
```jsx
/* Changed from: no text-center class */
<td data-label="Priority" className="px-3 py-2.5 text-center">
<td data-label="Status" className="px-3 py-2.5 text-center">
```

**Location cell:**
- Removed `min-w-[200px]` inline style
- Rely on CSS grid definition with `min-width: 180px`

## Column Width Distribution

**New widths (total 100%):**
| Column | Width | Min-width | Purpose |
|--------|-------|-----------|---------|
| Resident | 18% | 150px | Resident name + barangay |
| Purpose | 14% | 140px | Follow-up purpose/type |
| Assigned | 14% | 130px | Provider name |
| Scheduled | 12% | 120px | Date + time |
| Location | 16% | 180px | Visit location + icon |
| **Priority** | **11%** | **100px** | Badge display |
| **Status** | **12%** | **110px** | Badge display |
| Actions | 7% | 60px | Menu button (no shrink) |

## Responsive Behavior

### Desktop (1024px+)
- Full table width with comfortable padding
- Horizontal scrolling only within table container (if needed)
- Sidebar fully visible
- All content readable

### Tablet (768px - 1024px)
- Adjusted min-widths for readability
- Horizontal scroll available within table
- Font sizes preserved
- Badges remain readable

### Mobile (<768px)
- Reduced padding on cells (0.5rem 0.625rem)
- Smaller font size (0.75rem)
- Horizontal scroll within table container
- Table does NOT cause page-level overflow

## Badge Styling Preserved

✓ Priority badges: Green (Low), Amber (Medium), Red (High)  
✓ Status badges: Blue (Scheduled), Amber (Pending), Green (Completed), Gray (Cancelled), Red (Overdue)  
✓ Centered alignment in cells  
✓ Proper padding and spacing  
✓ Dot indicators visible  
✓ Dark mode support maintained  

## No Regressions

Other supervisor tables remain unaffected:
- `.supervisor-shell .resident-directory-grid` – Scoped to supervisor-shell
- `.supervisor-shell .consultation-records-grid` – Scoped to supervisor-shell
- `.supervisor-shell .referral-monitoring-grid` – Scoped to supervisor-shell

The `.follow-up-monitoring-grid` is a standalone class that does not conflict with scoped supervisor shell tables.

## Verification Checklist

✓ Complete sidebar visible (no horizontal clipping)  
✓ Page title not clipped  
✓ All 8 table columns visible and aligned  
✓ Priority column headers aligned with data cells  
✓ Status column headers aligned with data cells  
✓ Badges centered in columns  
✓ No badge overlap into adjacent columns  
✓ Pagination fully visible  
✓ Table responsive on desktop, tablet, mobile  
✓ Horizontal scroll only in table container (not page)  
✓ No regressions in other PHN/RHU pages  
✓ Build successful with no errors  

## Technical Details

**Files Modified:**
1. `src/styles/index.css` – CSS grid definitions and responsive breakpoints
2. `src/features/follow-ups/pages/MidwifeFollowUp.jsx` – Component alignment classes

**Browser Support:**
- All modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers (iOS Safari, Android Chrome)
- Print layout (badges render correctly)

**Performance:**
- No additional DOM elements
- No JavaScript layout thrashing
- CSS-only solution
- Minimal build size impact
