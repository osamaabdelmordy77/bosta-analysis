import React from 'react';
import { UploadedFile } from '../types';
import { FolderKanban, Menu, ShieldCheck, Trash2, Upload, LogOut } from 'lucide-react';
import { BackendConnectionStatus } from '../services/backend';
import { AuthUser, OrganizationOption } from '../services/api';

type BostaConnectionState = 'checking' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface HeaderProps {
  pageTitle: string;
  files: UploadedFile[];
  totalShipments: number;
  filteredShipments: number;
  backendStatus: BackendConnectionStatus | null;
  bostaToken: string;
  bostaConnection: BostaConnectionState;
  bostaConnectionError: string;
  onBostaTokenChange: (token: string) => void;
  onBostaConnect: () => void;
  currentUser: AuthUser;
  organizations: OrganizationOption[];
  activeOrganization: OrganizationOption;
  onOrganizationChange: (slug: string) => void;
  onLogout: () => void;
  onOpenUpload: () => void;
  onOpenFileManager: () => void;
  onOpenDuplicateInfo: () => void;
  onClearAll: () => void;
  onMenuClick: () => void;
  menuExpanded: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  pageTitle,
  files,
  totalShipments,
  filteredShipments,
  backendStatus,
  bostaToken,
  bostaConnection,
  bostaConnectionError,
  onBostaTokenChange,
  onBostaConnect,
  currentUser,
  organizations,
  activeOrganization,
  onOrganizationChange,
  onLogout,
  onOpenUpload,
  onOpenFileManager,
  onOpenDuplicateInfo,
  onClearAll,
  onMenuClick,
  menuExpanded,
}) => {
  const dates = files.map((f) => f.detectedDate).filter(Boolean).sort();
  const dateRangeStr =
    dates.length > 0
      ? dates.length === 1
        ? dates[0]
        : `${dates[0]} to ${dates[dates.length - 1]}`
      : '';
  const connectionLabel = backendStatus === 'connected'
    ? 'Connected'
    : backendStatus === 'unavailable'
      ? 'Offline'
      : backendStatus === 'checking' ? 'Checking' : 'Unknown';

  return (
    <header className="top">
      <button
        type="button"
        id="mobile-navigation-trigger"
        className="mobile-menu icon-button"
        onClick={onMenuClick}
        aria-label="Open navigation"
        aria-expanded={menuExpanded}
        aria-controls="primary-navigation"
      >
        <Menu size={20} />
      </button>
      <div className="top-title"><span>OPERATIONS</span><strong>{pageTitle}</strong></div>
      <div className="top-org">
        <span className="org-mark"><FolderKanban size={16} /></span>
        {organizations.length > 1 ? (
          <select
            aria-label="Organization"
            value={activeOrganization.slug}
            onChange={(event) => onOrganizationChange(event.target.value)}
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.slug}>{organization.name}</option>
            ))}
          </select>
        ) : <strong title={activeOrganization.name}>{activeOrganization.name}</strong>}
      </div>
      <form
        className={`top-bosta-token${bostaConnection === 'connected' ? ' is-connected' : ''}${bostaConnection === 'error' ? ' has-error' : ''}`}
        onSubmit={(event) => { event.preventDefault(); onBostaConnect(); }}
        aria-label="Bosta API connection"
      >
        <label className="sr-only" htmlFor="global-bosta-token">Bosta access token</label>
        <input
          id="global-bosta-token"
          type="password"
          autoComplete="off"
          value={bostaToken}
          onChange={(event) => onBostaTokenChange(event.target.value)}
          placeholder="Bosta API token"
          aria-describedby={bostaConnectionError ? 'global-bosta-token-error' : undefined}
        />
        <button type="submit" className="bosta-token-submit" disabled={!bostaToken.trim() || bostaConnection === 'connecting'} title={bostaConnectionError || (bostaConnection === 'connected' ? 'Bosta token is connected.' : 'Connect to Bosta')}>
          <span className="bosta-token-light" aria-hidden="true" />
          <span>{bostaConnection === 'connecting' ? 'Connecting' : bostaConnection === 'checking' ? 'Checking' : bostaConnection === 'connected' ? 'Connected' : bostaConnection === 'error' ? 'Retry' : 'Connect'}</span>
        </button>
        {bostaConnectionError && <span id="global-bosta-token-error" className="bosta-token-error" role="status" title={bostaConnectionError}>{bostaConnectionError}</span>}
      </form>
      <div className="top-spacer" />
      <div
        className={`connection-status ${backendStatus === 'connected' ? 'is-connected' : backendStatus === 'unavailable' ? 'is-offline' : backendStatus === 'checking' ? 'is-checking' : 'is-unknown'}`}
        role="status"
        aria-live="polite"
      >
        <span className="connection-dot" />
        <span>{connectionLabel}</span>
      </div>
      <div className="top-actions">
        <button type="button" className="btn sm top-secondary" onClick={onOpenDuplicateInfo} aria-label="Duplicate handling details" title="Duplicate handling details">
          <ShieldCheck size={16} /><span>Data integrity</span>
        </button>
        <button type="button" className="btn sm top-secondary" onClick={onOpenFileManager} aria-label="Manage uploaded files" title="Manage uploaded files">
          <FolderKanban size={16} /><span>Files {files.length > 0 && `(${files.length})`}</span>
        </button>
        {files.length > 0 && (
          <button type="button" className="btn danger sm top-clear" onClick={onClearAll} aria-label="Archive all active files" title="Archive all active files">
            <Trash2 size={15} /><span>Clear</span>
          </button>
        )}
        <button type="button" className="btn pri sm top-upload" onClick={onOpenUpload} aria-label="Upload files">
          <Upload size={16} /><span>Upload files</span>
        </button>
      </div>
      <div className="top-account" title={currentUser.email}>
        <span className="account-avatar">{currentUser.name.slice(0, 1).toUpperCase()}</span>
        <span className="account-name">{currentUser.name}</span>
        <button type="button" className="icon-button logout-button" onClick={onLogout} aria-label="Sign out" title="Sign out">
          <LogOut size={17} />
        </button>
      </div>
      {files.length > 0 && <span className="sr-only">{files.length} files, {dateRangeStr || 'no dates'}, {filteredShipments} of {totalShipments} shipments</span>}
    </header>
  );
};
