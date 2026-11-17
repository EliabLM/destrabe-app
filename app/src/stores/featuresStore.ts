import { create } from 'zustand';
import { isFeatureFlag, type FeatureFlag } from '@destrabe/shared';
import { secureStorage } from '../lib/secureStorage';
import { getMyFeatures } from '../lib/apiFeatures';

/**
 * Feature flags de la sesión (issue #13). Guía: docs/runbooks/feature-flags.md.
 *
 * `load(userId)` se llama al iniciar sesión y al rehidratar (tras un `/api/me`
 * correcto): primero aplica los últimos valores guardados de ese usuario y
 * luego pide los actuales al backend. Si esa petición falla, se quedan los
 * guardados; si no hay, todo apagado. Ojo: sin red al abrir la app, `hydrate`
 * cierra la sesión (y borra esta caché), así que la caché solo cubre el caso en
 * que `/api/me` responde y `/api/me/features` falla.
 */
export interface FeaturesState {
  /** Usuario cuyos flags están cargados (null = ninguno). */
  userId: string | null;
  features: FeatureFlag[];
  load: (userId: string) => Promise<void>;
  reset: () => void;
}

interface CachedFeatures {
  userId: string;
  features: FeatureFlag[];
}

async function readCache(userId: string): Promise<FeatureFlag[]> {
  try {
    const raw = await secureStorage.getFeatures();
    if (!raw) return [];
    const cached = JSON.parse(raw) as Partial<CachedFeatures>;
    if (cached.userId !== userId || !Array.isArray(cached.features)) return [];
    return cached.features.filter(isFeatureFlag);
  } catch {
    return [];
  }
}

export const featuresStore = create<FeaturesState>((set, get) => ({
  userId: null,
  features: [],

  load: async (userId: string) => {
    set({ userId, features: [] });
    const cached = await readCache(userId);
    // Si entretanto se cerró sesión o entró otro usuario, no se pisa nada.
    if (get().userId !== userId) return;
    set({ features: cached });
    try {
      const features = await getMyFeatures();
      if (get().userId !== userId) return;
      set({ features });
      const cache: CachedFeatures = { userId, features };
      await secureStorage.setFeatures(JSON.stringify(cache));
    } catch {
      // Error al pedirlos: se quedan los últimos valores conocidos.
    }
  },

  reset: () => set({ userId: null, features: [] }),
}));

/** ¿Está activo `flag` para la sesión? Para mostrar u ocultar UI. */
export function useFeature(flag: FeatureFlag): boolean {
  return featuresStore((s) => s.features.includes(flag));
}
