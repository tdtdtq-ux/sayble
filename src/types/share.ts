export interface SharedFile {
  id: string;
  name: string;
  path: string;
  size: number;
  addedAt: string;
}

export type ShareUploadStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "uploading"
  | "completed"
  | "failed";

export interface ShareUploadRecord {
  id: string;
  batchId: string;
  name: string;
  savedName: string | null;
  path: string | null;
  size: number;
  received: number;
  sourceIp: string;
  status: ShareUploadStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
}

export type ShareContentDirection = "pcToMobile" | "mobileToPc";

export interface ShareContentItem {
  id: string;
  direction: ShareContentDirection;
  text: string;
  sourceIp: string | null;
  createdAt: string;
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
  uploadSaveDir: string | null;
  uploads: ShareUploadRecord[];
  contents: ShareContentItem[];
}
