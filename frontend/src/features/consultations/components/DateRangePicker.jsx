import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

/**
 * DateRangePicker – A two-step date range selector with calendar popover.
 * 
 * Props:
 * - startDate: ISO date string (YYYY-MM-DD) or empty string (applied start date)
 * - endDate: ISO date string (YYYY-MM-DD) or empty string (applied end date)
 * - onApply: (startDate, endDate) => void – Called when user confirms selection
 * - placeholder: string – Placeholder text when no range selected
 */
export default function DateRangePicker({
  startDate = '',
  endDate = '',
  onApply = () => {},
  placeholder = 'Select date range',
}) {
  const [isOpen, setIsOpen] = useState(false);
  // Temporary state: dates currently being selected in the calendar
  const [tempStart, setTempStart] = useState(startDate);
  const [tempEnd, setTempEnd] = useState(endDate);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const containerRef = useRef(null);

  // Format dates for display
  const formatDateDisplay = (start, end) => {
    if (!start && !end) return placeholder;
    const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    if (start && end) return `${fmt(start)} – ${fmt(end)}`;
    // Incomplete ranges: do not show display (user is still selecting)
    return placeholder;
  };

  // Validate date range: end date must be >= start date
  const isValidRange = (start, end) => {
    if (!start || !end) return false;
    return new Date(start) <= new Date(end);
  };

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        // When closing, reset temp state to applied state
        setTempStart(startDate);
        setTempEnd(endDate);
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('pointerdown', handleClickOutside);
      return () => document.removeEventListener('pointerdown', handleClickOutside);
    }
  }, [isOpen, startDate, endDate]);

  const handleApply = () => {
    if (isValidRange(tempStart, tempEnd)) {
      onApply(tempStart, tempEnd);
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    setTempStart('');
    setTempEnd('');
    onApply('', '');
    setIsOpen(false);
  };

  const daysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

  const renderCalendar = () => {
    const days = [];
    const totalDays = daysInMonth(currentMonth);
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = firstDayOfMonth(currentMonth);

    // Empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="text-center text-xs text-brand-gray py-1" />);
    }

    // Days of month
    for (let day = 1; day <= totalDays; day++) {
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isStart = date === tempStart;
      const isEnd = date === tempEnd;
      const isInRange = tempStart && tempEnd && date > tempStart && date < tempEnd;
      const isBefore = tempStart && date < tempStart;
      const isAfter = tempEnd && date > tempEnd;

      days.push(
        <button
          key={date}
          type="button"
          onClick={() => {
            if (!tempStart) {
              // Step 1: Select start date
              setTempStart(date);
              setTempEnd('');
            } else if (!tempEnd) {
              // Step 2: Select end date
              if (date < tempStart) {
                // If user selects an earlier date, swap them
                setTempStart(date);
                setTempEnd(tempStart);
              } else {
                // Normal case: end date is after start date
                setTempEnd(date);
              }
            } else {
              // Both dates selected, start over with new start date
              setTempStart(date);
              setTempEnd('');
            }
          }}
          disabled={isBefore || isAfter}
          className={`text-xs py-1 px-0.5 rounded transition-colors ${
            isStart || isEnd
              ? 'bg-brand-blue text-white font-medium'
              : isInRange
              ? 'bg-brand-light text-brand-blue'
              : isBefore || isAfter
              ? 'text-brand-gray/30 cursor-not-allowed'
              : 'text-brand-ink hover:bg-brand-bg'
          }`}
        >
          {day}
        </button>
      );
    }

    return days;
  };

  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div ref={containerRef} className="relative">
      {/* Input Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full rounded-btn border border-brand-border bg-white px-3 py-2 text-left text-sm text-brand-ink outline-none hover:border-brand-blue focus:border-brand-blue transition-colors"
      >
        <span className={startDate && endDate ? 'text-brand-ink' : 'text-brand-gray'}>
          {formatDateDisplay(startDate, endDate)}
        </span>
      </button>

      {/* Popover Calendar */}
      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-2 w-72 rounded-btn border border-brand-border bg-white p-4 shadow-lg">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
              className="p-1 hover:bg-brand-bg rounded transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-brand-gray" />
            </button>
            <p className="text-sm font-medium text-brand-ink">{monthName}</p>
            <button
              type="button"
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
              className="p-1 hover:bg-brand-bg rounded transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-brand-gray" />
            </button>
          </div>

          {/* Day Headers */}
          <div className="mb-2 grid grid-cols-7 gap-1 text-center">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
              <div key={d} className="text-xs font-medium text-brand-gray">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="mb-3 grid grid-cols-7 gap-1">
            {renderCalendar()}
          </div>

          {/* Selection Status Display */}
          <div className="mb-3 rounded-btn bg-brand-bg p-2 text-xs">
            {tempStart && tempEnd ? (
              <p className="text-brand-ink">
                <span className="font-medium">Range:</span> {new Date(`${tempStart}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(`${tempEnd}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            ) : tempStart ? (
              <p className="text-brand-gray">
                <span className="font-medium">Start:</span> {new Date(`${tempStart}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                <br />
                <span className="font-medium">End:</span> (select end date)
              </p>
            ) : (
              <p className="text-brand-gray">Select start and end dates</p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="flex-1 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-gray hover:bg-brand-bg transition-colors flex items-center justify-center gap-1"
            >
              <X className="w-3 h-3" /> Clear
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!isValidRange(tempStart, tempEnd)}
              className="flex-1 rounded-btn bg-brand-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
