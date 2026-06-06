import type { ShareContentItem, ShareServerState, ShareUploadRecord } from "@/types/share";

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fileLabel(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function downloadUrl(baseUrl: string, id: string) {
  return `${baseUrl.replace(/\/$/, "")}/download/${encodeURIComponent(id)}`;
}

export function uploadPercent(upload: ShareUploadRecord) {
  if (upload.size <= 0) return upload.status === "completed" ? 100 : 0;
  return Math.min(100, Math.round((upload.received / upload.size) * 100));
}

export function statusLabel(upload: ShareUploadRecord) {
  switch (upload.status) {
    case "pending":
      return "待接收";
    case "accepted":
      return "已接收";
    case "uploading":
      return "上传中";
    case "completed":
      return "已完成";
    case "rejected":
      return "已拒绝";
    case "failed":
      return "失败";
    default:
      return upload.status;
  }
}

export function mergeUpload(
  state: ShareServerState | null,
  upload: ShareUploadRecord,
): ShareServerState | null {
  if (!state) return state;
  const exists = state.uploads.some((item) => item.id === upload.id);
  return {
    ...state,
    uploads: exists
      ? state.uploads.map((item) => (item.id === upload.id ? upload : item))
      : [upload, ...state.uploads],
  };
}

export function mergeContent(
  state: ShareServerState | null,
  item: ShareContentItem,
): ShareServerState | null {
  if (!state) return state;
  const exists = state.contents.some((content) => content.id === item.id);
  return {
    ...state,
    contents: exists
      ? state.contents.map((content) => (content.id === item.id ? item : content))
      : [item, ...state.contents],
  };
}
