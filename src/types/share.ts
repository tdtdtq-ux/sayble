export interface SharedFile {
  id: string;
  name: string;
  path: string;
  size: number;
  addedAt: string;
}

export interface ShareHostCandidate {
  name: string;
  address: string;
  url: string;
  selected: boolean;
}

export interface ShareServerState {
  running: boolean;
  host: string;
  port: number;
  baseUrl: string;
  hosts: ShareHostCandidate[];
  lastError: string | null;
  files: SharedFile[];
}
