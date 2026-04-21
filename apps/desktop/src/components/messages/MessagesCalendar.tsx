import { useState, useMemo, useEffect } from 'react';
import { useBookingsStore } from '../../stores/bookingsStore';
import { useAuthStore } from '../../stores/authStore';
import type { Booking } from '../../lib/api';

const JOIN_WINDOW_BEFORE_MS = 5 * 60 * 1000; // Join button appears 5 min before start
// Returns true if `now` is within [scheduledAt - 5min, scheduledAt + durationMin]
function isInJoinWindow(b: Booking, now: number): boolean {
  const start = Date.parse(b.scheduledAt);
  const end = start + b.durationMin * 60 * 1000;
  return now >= start - JOIN_WINDOW_BEFORE_MS && now <= end;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function dateKey(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function MessagesCalendar() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<Date | null>(today);

  const currentUserId = useAuthStore((s) => s.user?.id);
  const bookings = useBookingsStore((s) => s.bookings);
  const bootstrap = useBookingsStore((s) => s.bootstrap);
  const accept = useBookingsStore((s) => s.accept);
  const decline = useBookingsStore((s) => s.decline);
  const cancel = useBookingsStore((s) => s.cancel);

  useEffect(() => {
    if (currentUserId) bootstrap();
  }, [currentUserId, bootstrap]);

  // Tick once a minute so the Join window is re-evaluated on all visible cards
  // (bookings don't change, but their `is it time?` status does).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Bucket non-canceled/declined bookings by local-date key for dot rendering.
  const bookingsByDay = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (b.status === 'canceled' || b.status === 'declined') continue;
      const key = dateKey(new Date(b.scheduledAt));
      const list = m.get(key) || [];
      list.push(b);
      m.set(key, list);
    }
    return m;
  }, [bookings]);

  const { days, firstWeekday, todayKey } = useMemo(() => {
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    return {
      days: Array.from({ length: daysInMonth }, (_, i) => i + 1),
      firstWeekday: new Date(viewYear, viewMonth, 1).getDay(),
      todayKey: new Date().toDateString(),
    };
  }, [viewYear, viewMonth]);

  const prev = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const next = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };
  const goToday = () => {
    setViewMonth(today.getMonth());
    setViewYear(today.getFullYear());
    setSelected(today);
  };

  const selectedBookings = selected
    ? (bookingsByDay.get(dateKey(selected)) || []).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    : [];

  return (
    <div className="flex flex-col p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-white truncate">{MONTHS[viewMonth]}</div>
          <div className="text-[10px] text-white/40 font-medium">{viewYear}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={prev} title="Previous month" className="w-6 h-6 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button onClick={goToday} title="Jump to today" className="h-6 px-2 rounded text-[10px] font-semibold text-white/60 hover:text-ghost-green hover:bg-white/10 transition-colors uppercase tracking-wider">
            Today
          </button>
          <button onClick={next} title="Next month" className="w-6 h-6 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1.5">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="text-[9px] text-white/30 text-center font-semibold uppercase tracking-wider">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstWeekday }).map((_, i) => <div key={`blank-${i}`} />)}
        {days.map((day) => {
          const date = new Date(viewYear, viewMonth, day);
          const key = dateKey(date);
          const dayBookings = bookingsByDay.get(key) || [];
          const hasPending = dayBookings.some((b) => b.status === 'pending');
          const hasAccepted = dayBookings.some((b) => b.status === 'accepted');
          const isToday = date.toDateString() === todayKey;
          const isSelected = selected?.toDateString() === date.toDateString();
          return (
            <button
              key={day}
              onClick={() => setSelected(date)}
              className={`aspect-square text-[11px] rounded-md flex items-center justify-center transition-colors font-medium relative ${
                isSelected
                  ? 'text-white font-bold'
                  : isToday
                    ? 'text-ghost-green font-bold'
                    : 'text-white/70 hover:bg-white/[0.06]'
              }`}
              style={{
                background: isSelected
                  ? 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)'
                  : isToday
                    ? 'rgba(0,255,200,0.08)'
                    : undefined,
                boxShadow: isSelected ? '0 2px 8px rgba(124,58,237,0.4)' : undefined,
              }}
            >
              {day}
              {(hasAccepted || hasPending) && (
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full"
                  style={{ background: hasAccepted ? '#7C3AED' : '#F59E0B' }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-white/[0.06]">
        {selected ? (
          <>
            <p className="text-[9px] text-white/35 uppercase tracking-wider font-semibold mb-1.5">
              {selected.toLocaleDateString('en-US', { weekday: 'long' })}, {selected.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
            </p>
            {selectedBookings.length === 0 ? (
              <p className="text-[11px] text-white/35 italic">No sessions scheduled</p>
            ) : (
              <div className="flex flex-col gap-2">
                {selectedBookings.map((b) => {
                  const iAmCreator = b.creatorId === currentUserId;
                  const other = iAmCreator ? b.invitee : b.creator;
                  const canAcceptDecline = !iAmCreator && b.status === 'pending';
                  const canCancel = iAmCreator && b.status !== 'canceled';
                  return (
                    <div
                      key={b.id}
                      className="rounded-lg p-2 border"
                      style={{
                        borderColor: b.status === 'accepted' ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.06)',
                        background: b.status === 'accepted' ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.02)',
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="text-[11px] font-bold text-white">{formatTime(b.scheduledAt)}</span>
                        <span className={`text-[9px] uppercase tracking-wider font-semibold ${
                          b.status === 'accepted' ? 'text-ghost-purple' :
                          b.status === 'pending' ? 'text-amber-400' :
                          'text-white/30'
                        }`}>{b.status}</span>
                      </div>
                      <div className="text-[11px] text-white/80 truncate">
                        {b.title || 'Session'}
                      </div>
                      <div className="text-[10px] text-white/40 mt-0.5">
                        {iAmCreator ? 'With' : 'From'} {other?.displayName || 'Unknown'} · {b.durationMin}m
                      </div>
                      {(() => {
                        const canJoin = b.status === 'accepted' && b.projectId && isInJoinWindow(b, Date.now());
                        if (canJoin) {
                          return (
                            <button
                              onClick={() => window.dispatchEvent(new CustomEvent('ghost-open-project', { detail: { projectId: b.projectId } }))}
                              className="w-full h-7 mt-2 rounded text-[11px] font-bold text-black transition-opacity hover:opacity-90 flex items-center justify-center gap-1.5"
                              style={{ background: 'linear-gradient(135deg, #00FFC8 0%, #00B896 100%)', boxShadow: '0 0 12px rgba(0,255,200,0.35)' }}
                            >
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full rounded-full bg-black/50 opacity-75 animate-ping" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-black" />
                              </span>
                              Join session
                            </button>
                          );
                        }
                        if (canAcceptDecline || canCancel) {
                          return (
                            <div className="flex gap-1 mt-2">
                              {canAcceptDecline && (
                                <>
                                  <button
                                    onClick={() => accept(b.id)}
                                    className="flex-1 h-6 rounded text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
                                    style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #4C1D95 100%)' }}
                                  >
                                    Accept
                                  </button>
                                  <button
                                    onClick={() => decline(b.id)}
                                    className="flex-1 h-6 rounded text-[10px] font-semibold text-white/60 bg-white/[0.05] hover:bg-white/[0.1] transition-colors"
                                  >
                                    Decline
                                  </button>
                                </>
                              )}
                              {canCancel && (
                                <button
                                  onClick={() => cancel(b.id)}
                                  className="flex-1 h-6 rounded text-[10px] font-semibold text-white/60 bg-white/[0.05] hover:bg-white/[0.1] transition-colors"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] text-white/35 italic">Select a day to see sessions</p>
        )}
      </div>
    </div>
  );
}
