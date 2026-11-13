// A stand-in for the `vscode` module.
//
// A few of upstream's host-side files (the ones that work out line numbers for an AI
// reference) import `vscode` for messages they show in VS Code. None of that code runs here,
// but the import has to resolve to something.
export const l10n = {
  t: (message: string, ...args: unknown[]): string => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)] ?? '')),
};
