import { DatabaseSync } from 'node:sqlite';

export interface Task {
  id: number;
  title: string;
  done: boolean;
}

interface Row {
  id: number;
  title: string;
  done: number;
}

const toTask = (row: Row): Task => ({ id: row.id, title: row.title, done: row.done === 1 });

/** Repositório de tarefas sobre o `node:sqlite` (embutido no Node 22.13+): sem dependência externa. */
export class TaskRepository {
  private readonly db: DatabaseSync;

  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)',
    );
  }

  list(done?: boolean): Task[] {
    const rows = (done === undefined
      ? this.db.prepare('SELECT * FROM tasks ORDER BY id').all()
      : this.db.prepare('SELECT * FROM tasks WHERE done = ? ORDER BY id').all(done ? 1 : 0)) as unknown as Row[];
    return rows.map(toTask);
  }

  get(id: number): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return row ? toTask(row) : undefined;
  }

  create(title: string): Task {
    const { lastInsertRowid } = this.db.prepare('INSERT INTO tasks (title) VALUES (?)').run(title);
    return this.get(Number(lastInsertRowid))!;
  }

  update(id: number, patch: { title?: string; done?: boolean }): Task | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    this.db.prepare('UPDATE tasks SET title = ?, done = ? WHERE id = ?').run(next.title, next.done ? 1 : 0, id);
    return next;
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
