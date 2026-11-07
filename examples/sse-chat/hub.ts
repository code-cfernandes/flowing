import type { SseStream } from 'sashiko';

export interface Message {
  id: number;
  author: string;
  text: string;
  at: string;
}

/** Sala de chat: guarda as últimas mensagens e as entrega a todas as conexões abertas. */
export class ChatHub {
  private readonly streams = new Set<SseStream>();
  private readonly history: Message[] = [];
  private nextId = 1;

  constructor(private readonly keep = 100) {}

  get connections(): number {
    return this.streams.size;
  }

  /** Abre a conexão e reenvia o que ela perdeu desde o `Last-Event-ID` (reconexão do navegador). */
  join(stream: SseStream): void {
    const since = Number(stream.lastEventId ?? 0) || 0;
    for (const m of this.history) if (m.id > since) stream.send(event(m));
    this.streams.add(stream);
    stream.onClose(() => this.streams.delete(stream));
  }

  post(author: string, text: string): Message {
    const message = { id: this.nextId++, author, text, at: new Date().toISOString() };
    this.history.push(message);
    if (this.history.length > this.keep) this.history.shift();
    for (const s of this.streams) s.send(event(message));
    return message;
  }
}

const event = (m: Message) => ({ event: 'message', id: String(m.id), data: m });
