import React from 'react';
import { UploadedFile, ColumnMapping } from '../types';
import { ROLES } from '../utils/excelParser';

interface ProfileSectionProps {
  files: UploadedFile[];
  totalShipments: number;
  totalDuplicatesRemoved: number;
  allHeaders: string[];
  hubLabels: string[];
  hubBasis: string;
  onHubBasisChange: (newBasis: string) => void;
  columnOverrides: Partial<ColumnMapping>;
  onColumnOverrideChange: (role: keyof ColumnMapping, colName: string) => void;
  onApplyMapping: () => void;
}

export const ProfileSection: React.FC<ProfileSectionProps> = ({
  files,
  totalShipments,
  totalDuplicatesRemoved,
  allHeaders,
  hubLabels,
  hubBasis,
  onHubBasisChange,
  columnOverrides,
  onColumnOverrideChange,
  onApplyMapping,
}) => {
  return (
    <details className="card" id="profile">
      <summary>Data profile, column mapping &amp; how each KPI is calculated</summary>
      <div className="prof">
        {/* Left Column: Files & Quality */}
        <div>
          <h5>Uploaded Files &amp; Datasets</h5>
          <table>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Shipment Date</th>
                <th className="r">Records</th>
                <th className="r">Dups Removed</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-slate-400">
                    No files loaded
                  </td>
                </tr>
              ) : (
                files.map((f) => (
                  <tr key={f.id}>
                    <td className="font-medium text-slate-200">{f.name}</td>
                    <td className="text-sky-400 font-semibold">{f.detectedDate}</td>
                    <td className="r">{f.recordCount.toLocaleString()}</td>
                    <td className="r text-slate-400">{f.duplicateCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <h5 style={{ marginTop: '16px' }}>Hub Network Fields Found</h5>
          <table>
            <thead>
              <tr>
                <th>Column Name</th>
                <th>Status / Role</th>
              </tr>
            </thead>
            <tbody>
              {hubLabels.length === 0 ? (
                <tr>
                  <td colSpan={2} className="text-center text-slate-400">
                    No hub columns detected
                  </td>
                </tr>
              ) : (
                hubLabels.map((l) => (
                  <tr key={l}>
                    <td className="text-slate-200">{l}</td>
                    <td>
                      {l === hubBasis ? (
                        <span className="pill up">Primary Ranking Basis</span>
                      ) : (
                        <span className="pill z">Network List Only</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {hubLabels.length > 0 && (
            <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: 'var(--text)' }}>
              Hub ranking field:{' '}
              <select
                value={hubBasis}
                onChange={(e) => onHubBasisChange(e.target.value)}
              >
                {hubLabels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>{' '}
              <span style={{ color: 'var(--mut)' }}>
                (default = “Assigned Hub”, or the column with most distinct hubs)
              </span>
            </p>
          )}

          <h5 style={{ marginTop: '16px' }}>Data Quality Summary</h5>
          <ul>
            <li>
              Total active shipments in memory: <b>{totalShipments.toLocaleString()}</b>
            </li>
            <li>
              Duplicate tracking numbers in daily imports preserved and marked:{' '}
              <b>{totalDuplicatesRemoved.toLocaleString()}</b> (source rows remain in MySQL history)
            </li>
            <li>
              Shipment Date source: <b>Filenames</b> (e.g. <code>Shipment_2026-07-01.xlsx</code>)
            </li>
            <li>
              Cross-day tracking numbers: Preserved under their respective daily dates for day-to-day operational analysis.
            </li>
            <li>Database storage: MySQL tenant database; original workbook files and source rows are retained.</li>
          </ul>
        </div>

        {/* Right Column: Column Mapping & Methodology */}
        <div>
          <h5>Column Mapping (Auto-detected — change if needed)</h5>
          <table>
            <thead>
              <tr>
                <th>Dashboard Field</th>
                <th>Assigned Excel Column</th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map((r) => {
                const curVal = columnOverrides[r.k as keyof ColumnMapping] || '';
                return (
                  <tr key={r.k}>
                    <td className="text-slate-200">{r.label}</td>
                    <td>
                      <select
                        value={curVal}
                        onChange={(e) =>
                          onColumnOverrideChange(
                            r.k as keyof ColumnMapping,
                            e.target.value
                          )
                        }
                      >
                        <option value="">— Auto-detect —</option>
                        {allHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p style={{ margin: '10px 0 16px' }}>
            <button type="button" className="btn sm" onClick={onApplyMapping}>
              Apply Column Mapping
            </button>
          </p>

          <h5>How Each KPI is Calculated</h5>
          <ul>
            <li>
              <b>Total Shipments</b> — count of distinct tracking numbers across all uploaded reports after applying filters.
            </li>
            <li>
              <b>Total Hubs</b> — count of distinct hub names known across all hub columns in the network.
            </li>
            <li>
              <b>Active Hubs / Hubs with No Shipments</b> — hubs with ≥1 or 0 shipments on the active ranking field “{hubBasis}”.
            </li>
            <li>
              <b>Total Businesses</b> — distinct business/merchant names with ≥1 shipment.
            </li>
            <li>
              <b>Total Items</b> — sum of the Items/Quantity column over distinct shipments.
            </li>
            <li>
              <b>Avg Shipments per Hub</b> — total shipments with a hub ÷ active hubs.
            </li>
            <li>
              <b>Avg Shipments per Business</b> — total shipments with a business ÷ businesses.
            </li>
            <li>
              <b>Highest / Lowest Volume</b> — shipments of the top and bottom active hubs.
            </li>
            <li>
              <b>% Contribution</b> — entity shipments ÷ total filtered shipments.
            </li>
            <li>
              <b>Progress Bar</b> — compares the current filtered metric against the unfiltered baseline (white tick = 100%).
            </li>
          </ul>
        </div>
      </div>
    </details>
  );
};
