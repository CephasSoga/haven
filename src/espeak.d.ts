// eSpeak NG compiled to JavaScript (no types of its own); used by the read-aloud voice worker.
declare module "@echogarden/espeak-ng-emscripten" {
  const factory: (options?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default factory;
}
