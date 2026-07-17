import type { MediaArtifactKind } from "$lib/types";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "bmp",
  "ico",
  "avif",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v"]);

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg"]);

const HTML_EXTENSIONS = new Set(["html", "htm"]);

const PDF_EXTENSIONS = new Set(["pdf"]);

const MEDIA_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ...PDF_EXTENSIONS,
]);

function getMediaKind(ext: string): MediaArtifactKind {
  const e = ext.toLowerCase();
  if (IMAGE_EXTENSIONS.has(e)) return "image";
  if (VIDEO_EXTENSIONS.has(e)) return "video";
  if (AUDIO_EXTENSIONS.has(e)) return "audio";
  if (HTML_EXTENSIONS.has(e)) return "html";
  if (PDF_EXTENSIONS.has(e)) return "pdf";
  return "file";
}

export function isMediaPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = path.slice(dot + 1).toLowerCase();
  return MEDIA_EXTENSIONS.has(ext);
}

export function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "";
  return path.slice(dot + 1).toLowerCase();
}
