import { create } from 'zustand';

export interface ServiceItem {
  id: string;
  type: string;
  status: string;
  originLat: number;
  originLng: number;
  destLat?: number | null;
  destLng?: number | null;
  description?: string | null;
  photoUrl?: string | null;
  expiresAt?: string;
  createdAt?: string;
}

export interface ServicesState {
  myServices: ServiceItem[];
  activeService: ServiceItem | null;
  setMyServices: (services: ServiceItem[]) => void;
  setActiveService: (service: ServiceItem | null) => void;
  addService: (service: ServiceItem) => void;
}

export const servicesStore = create<ServicesState>((set) => ({
  myServices: [],
  activeService: null,

  setMyServices: (services: ServiceItem[]) => set({ myServices: services }),

  setActiveService: (service: ServiceItem | null) =>
    set({ activeService: service }),

  addService: (service: ServiceItem) =>
    set((state) => ({ myServices: [...state.myServices, service] })),
}));
