/** Tiny typed event emitter: the simulation's only side effect is emitting events. */
export class Emitter<E> {
  private listeners = new Set<(event: E) => void>();

  on(listener: (event: E) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: E) {
    for (const l of this.listeners) l(event);
  }
}
