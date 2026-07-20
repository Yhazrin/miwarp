// Chat, Message, and Directory types
// Auto-generated from types.ts — do not edit manually

export interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

export interface DirListing {
  path: string;
  entries: DirEntry[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  contentBase64: string;
}
