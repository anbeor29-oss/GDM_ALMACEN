/**
 * Auth Store
 * Global state management for authentication
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AuthState, User } from '@/types';

interface AuthStore extends AuthState {
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setRefreshToken: (refreshToken: string | null) => void;
  login: (user: User, token: string, refreshToken: string) => void;
  logout: () => void;
  /** Marca la cuenta como "ya cambió su password" (tras flujo forzado). */
  markPasswordChanged: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,

      setUser: (user) => {
        set({ user, isAuthenticated: user !== null });
      },

      setToken: (token) => {
        set({ token });
        if (token) {
          localStorage.setItem('token', token);
        } else {
          localStorage.removeItem('token');
        }
      },

      setRefreshToken: (refreshToken) => {
        set({ refreshToken });
        if (refreshToken) {
          localStorage.setItem('refreshToken', refreshToken);
        } else {
          localStorage.removeItem('refreshToken');
        }
      },

      login: (user, token, refreshToken) => {
        set({
          user,
          token,
          refreshToken,
          isAuthenticated: true,
        });
        localStorage.setItem('token', token);
        localStorage.setItem('refreshToken', refreshToken);
      },

      logout: () => {
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
        });
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
      },

      markPasswordChanged: () => {
        const u = (useAuthStore.getState() as any).user as User | null;
        if (u) set({ user: { ...u, passwordChangeRequired: false } });
      },
    }),
    {
      name: 'auth-store',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
