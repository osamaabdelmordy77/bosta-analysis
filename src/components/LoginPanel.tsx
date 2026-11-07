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
    <main className="login-page">
      <form onSubmit={submit} className="login-card">
        <div className="login-heading">
          <div className="login-mark">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold m-0">Shipment Operations</h1>
            <p className="text-sm text-slate-400 m-0">Sign in to your organization workspace.</p>
          </div>
        </div>

        <label className="login-field">
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="login-input"
          />
        </label>

        <label className="login-field">
          Password
          <span className="login-password">
            <LockKeyhole className="w-4 h-4 text-slate-500" aria-hidden="true" />
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="login-password-input"
            />
          </span>
        </label>

        {error && <p role="alert" className="login-error">{error}</p>}

        <button type="submit" className="btn pri w-full justify-center" disabled={isLoading}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          <span>{isLoading ? 'Signing in…' : 'Sign in'}</span>
        </button>
      </form>
    </main>
  );
};
