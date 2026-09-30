export interface ProgressUpdate {
  phase: string;
  completed: number;
  total: number;
  unit: string;
}

export type ProgressCallback = (update: ProgressUpdate) => void;
