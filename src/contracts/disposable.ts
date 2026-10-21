// A registration that can be undone; `dispose` removes it.
export interface Disposable {
  dispose(): void;
}
