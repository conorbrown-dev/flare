export type Member = { authorId: string; name: string; color: number };

export type Reaction = { emoji: string; users: { authorId: string; name: string }[] };

export type Message = {
  id: string;
  seq: number;
  tempId?: string;
  authorId: string;
  name: string;
  color: number;
  kind: "text" | "image" | "gif";
  text?: string;
  src?: string;
  createdAt: number;
  editedAt?: number;
  reactions: Reaction[];
  pending?: boolean; // sent by us, not yet confirmed by the server
  failed?: string; // why the server refused it
};

/** A line like "Ben left" shown between messages. Never sent to the server. */
export type SystemLine = { id: string; afterSeq: number; text: string; at: number };

export type Me = Member & { isOwner: boolean };

export type Outgoing = { kind: Message["kind"]; text?: string; src?: string };
