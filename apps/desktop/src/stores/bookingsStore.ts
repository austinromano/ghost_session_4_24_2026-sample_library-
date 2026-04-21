import { create } from 'zustand';
import { api, type Booking } from '../lib/api';
import { getSocket } from '../lib/socket';

interface BookingsState {
  bookings: Booking[];
  loading: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  create: (input: { inviteeId: string; title?: string; scheduledAt: string; durationMin: number }) => Promise<Booking>;
  accept: (id: string) => Promise<void>;
  decline: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

let socketHandlerAttached = false;

export const useBookingsStore = create<BookingsState>((set, get) => ({
  bookings: [],
  loading: false,
  error: null,

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const list = await api.listBookings();
      set({ bookings: list, loading: false });
    } catch (err: any) {
      set({ error: err?.message || 'Failed to load bookings', loading: false });
    }

    // Subscribe once to realtime booking events so both participants see
    // create/update/delete without a manual reload.
    const socket = getSocket();
    if (socket && !socketHandlerAttached) {
      socket.on('booking-updated', (payload) => {
        const current = get().bookings;
        if (payload.kind === 'deleted') {
          set({ bookings: current.filter((b) => b.id !== payload.bookingId) });
          return;
        }
        const booking = payload.booking as Booking | undefined;
        if (!booking) return;
        const idx = current.findIndex((b) => b.id === payload.bookingId);
        if (idx === -1) set({ bookings: [booking, ...current] });
        else {
          const next = [...current];
          next[idx] = booking;
          set({ bookings: next });
        }
      });
      socketHandlerAttached = true;
    }
  },

  create: async (input) => {
    const created = await api.createBooking(input);
    set({ bookings: [created, ...get().bookings] });
    return created;
  },

  accept: async (id) => {
    const updated = await api.updateBooking(id, { status: 'accepted' });
    set({ bookings: get().bookings.map((b) => b.id === id ? updated : b) });
  },

  decline: async (id) => {
    const updated = await api.updateBooking(id, { status: 'declined' });
    set({ bookings: get().bookings.map((b) => b.id === id ? updated : b) });
  },

  cancel: async (id) => {
    const updated = await api.updateBooking(id, { status: 'canceled' });
    set({ bookings: get().bookings.map((b) => b.id === id ? updated : b) });
  },

  remove: async (id) => {
    await api.deleteBooking(id);
    set({ bookings: get().bookings.filter((b) => b.id !== id) });
  },
}));
