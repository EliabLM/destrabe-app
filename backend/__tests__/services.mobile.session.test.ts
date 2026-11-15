import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';

const getState = vi.hoisted(() => vi.fn());
vi.mock('../../app/src/stores/authStore', () => ({ authStore: { getState } }));
import { api } from '../../app/src/lib/api';

describe('API session switch during a 401 response', () => {
  it('does not clear a newer login when an older request gets 401', async () => {
    const clearLocalSession = vi.fn();
    let token = 'old-token';
    getState.mockImplementation(() => ({ token, clearLocalSession }));
    api.defaults.adapter = async (config) => {
      expect(config.headers.Authorization).toBe('Bearer old-token');
      token = 'new-token';
      throw new axios.AxiosError(
        'Unauthorized',
        'ERR_BAD_REQUEST',
        config,
        undefined,
        {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config,
          data: {},
        },
      );
    };
    await expect(api.get('/services')).rejects.toBeDefined();
    expect(clearLocalSession).not.toHaveBeenCalled();
  });
});
