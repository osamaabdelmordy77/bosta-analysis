import type { CarsSheetSnapshot } from '../services/api';

export interface ManifestCar {
  key: string;
  label?: string;
  master_seal: string | null;
  details: string[];
  fingerprint: string;
  seals: { seal: string; source_row: number }[];
}
export interface ManifestRecord {
  master_seal: string; seal: string; tracking: string; seal_type: string;
  source_hub: string; destination_hub: string; status: string;
  source_sheet: string; source_row: number;
}
export type SealResult = 'matched' | 'missing_from_file' | 'extra_in_file';
export interface ManifestSeal {
  seal: string; in_cars: boolean; sheet_rows: number[]; file_rows: number;
  unique_trackings: number; duplicate_rows: number; other_cars: string[]; result: SealResult;
}
export interface ManifestSummary {
  id: string; date: string; car: string; vehicle_number: string; filename: string;
  created_at: string; verified_identity: boolean;
  snapshot_date_basis?: string;
  totals: { file_rows: number; expected_seals: number; matched: number; missing_from_file: number; extra_in_file: number; duplicate_rows: number };
}
export interface ManifestReport extends ManifestSummary {
  sha256: string;
  snapshot_date_basis: string;
  selected_car: ManifestCar;
  cars_snapshot: CarsSheetSnapshot;
  checks: {
    master_seal: { match: boolean; cars: string | null; file: string[] };
    date: { match: boolean; selected: string; filename_candidates: string[]; basis: string };
    car: { match: boolean; selected: string; filename: string | null; basis: string };
  };
  seals: ManifestSeal[];
  records: ManifestRecord[];
  issues: { row: number | null; sheet: string; source_row: number | null; issue: string }[];
}
