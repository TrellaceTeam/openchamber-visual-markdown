// Types for the few upstream modules the shim imports. The build resolves `@upstream/*` to
// the real files in .upstream/markdown-for-humans/src; these declarations keep our own
// type check from compiling upstream's whole tree.

declare module '@upstream/shared/blankLinePolicy' {
  export type BlankLineMode = 'preserve' | 'strip';
  export function applyBlankLinePolicy(markdown: string, mode: BlankLineMode): string;
}

declare module '@upstream/editor/markdownAstEquivalence' {
  export function isMarkdownStructurallyEquivalent(a: string, b: string): boolean;
  export function hasSameBlankLineLayout(a: string, b: string): boolean;
}

declare module '@upstream/shared/typographySettings' {
  export interface TypographySettings {
    readonly fontFamily: string | null;
    readonly fontWeight: number | null;
    readonly fontSize: number | null;
    readonly lineHeight: number | null;
    readonly letterSpacing: number | null;
    readonly wordSpacing: number | null;
  }
  export function resolveTypographySettings(config: Record<string, unknown>): TypographySettings;
}

declare module '@upstream/shared/aiReferenceProtocol' {
  export interface AiReferenceRequest {
    readonly selection: unknown;
    readonly blocks: readonly unknown[];
  }
  export function parseAiReferenceRequest(value: unknown): AiReferenceRequest | null;
}

declare module '@upstream/editor/aiReference' {
  export interface AiReferenceLineRange {
    startLine: number;
    endLine: number;
  }
  export function resolveAiReferenceLines(sourceText: string, canonicalBlocks: readonly unknown[], selection: unknown): AiReferenceLineRange | null;
  export function formatAiReference(path: string, range: AiReferenceLineRange | null): string;
}
