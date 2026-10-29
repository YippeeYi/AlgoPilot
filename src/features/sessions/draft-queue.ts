export type DraftState = {
  value: string;
  savedValue: string;
  revision: number;
  status: "saved" | "dirty" | "saving" | "error";
  error: string;
};

// 每个会话/每种草稿一个串行队列。响应只更新 revision，不把旧内容写回编辑器。
export class DraftQueue {
  private snapshot: DraftState;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private disposed = false;
  constructor(
    value: string,
    revision: number,
    private persist: (value: string, revision: number) => Promise<number>,
  ) {
    this.snapshot = {
      value,
      savedValue: value,
      revision,
      status: "saved",
      error: "",
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<DraftState>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (!this.disposed) this.listeners.forEach((listener) => listener());
  }
  setValue(value: string) {
    this.update({
      value,
      status: this.running
        ? "saving"
        : value === this.snapshot.savedValue
          ? "saved"
          : "dirty",
      error: "",
    });
  }
  acceptVersion(value: string, revision: number) {
    this.update({
      savedValue: value,
      revision,
      status: this.snapshot.value === value ? "saved" : "dirty",
      error: "",
    });
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.save().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async save() {
    try {
      while (
        !this.disposed &&
        this.snapshot.value !== this.snapshot.savedValue
      ) {
        const value = this.snapshot.value;
        const revision = this.snapshot.revision;
        this.update({ status: "saving", error: "" });
        const nextRevision = await this.persist(value, revision);
        this.update({ savedValue: value, revision: nextRevision });
      }
      if (!this.disposed) this.update({ status: "saved", error: "" });
    } catch (error) {
      this.update({
        status: "error",
        error: error instanceof Error ? error.message : "保存失败，请重试。",
      });
      throw error;
    }
  }
  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
  activate() {
    this.disposed = false;
  }
}
