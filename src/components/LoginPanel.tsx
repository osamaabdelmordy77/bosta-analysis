import React, { FormEvent, useState } from 'react';
import { LockKeyhole, Loader2, LogIn, Server } from 'lucide-react';

interface LoginPanelProps {
  error: string | null;
  isLoading: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
}

export const LoginPanel: React.FC<LoginPanelProps> = ({ error, isLoading, onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onLogin(email.trim(), password);
  };

  return (
    <main className="min-h-screen grid place-items-center px-4 py-10 bg-[#050a18] text-slate-100">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-[#263760] bg-[#0c1533] p-7 shadow-2xl">
        <div className="flex items-center gap-3 mb-7">
          <div className="w-11 h-11 rounded-full bg-sky-500/20 text-sky-300 grid place-items-center">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold m-0">Shipment Operations</h1>
            <p className="text-sm text-slate-400 m-0">Sign in to your MySQL-backed workspace.</p>
          </div>
        </div>

        <label className="block text-sm text-slate-300 mb-4">
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[#2c3e6b] bg-[#080f25] px-3 py-2.5 text-white outline-none focus:border-sky-400"
          />
        </label>

        <label className="block text-sm text-slate-300 mb-5">
          Password
          <span className="mt-1 flex items-center gap-2 rounded-lg border border-[#2c3e6b] bg-[#080f25] px-3 focus-within:border-sky-400">
            <LockKeyhole className="w-4 h-4 text-slate-500" />
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full bg-transparent py-2.5 text-white outline-none"
            />
          </span>
        </label>

        {error && <p role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

        <button type="submit" className="btn pri w-full justify-center" disabled={isLoading}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          <span>{isLoading ? 'Signing in…' : 'Sign in'}</span>
        </button>
      </form>
    </main>
  );
};
